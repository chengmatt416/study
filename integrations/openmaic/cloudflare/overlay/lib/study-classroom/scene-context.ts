const SCENE_CONTEXT_MAX_CHARS = 6000;

/** Strips HTML tags and common entities to plain text using ASCII-only patterns. */
export function htmlToPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Caps plain text at maxChars without splitting a UTF-16 surrogate pair. */
export function capContextText(text: string, maxChars = SCENE_CONTEXT_MAX_CHARS): string {
  const trimmed = text.trim();
  if (maxChars <= 0) return '';
  if (trimmed.length <= maxChars) return trimmed;
  const sliced = trimmed.slice(0, maxChars);
  const last = sliced.charCodeAt(sliced.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) return sliced.slice(0, -1);
  return sliced;
}

const CHROME_TEXT_TYPES = new Set(['header', 'footer', 'partNumber', 'itemNumber']);

interface SlideElementLike {
  type?: string;
  top?: number;
  left?: number;
  textType?: string;
  content?: string;
  text?: { content?: string };
  data?: unknown;
  latex?: string;
  html?: string;
  language?: string;
  fileName?: string;
  lines?: { content?: string }[];
  name?: string;
  imageType?: string;
}

interface SceneLike {
  id?: string;
  title?: string;
  type?: string;
  content?: {
    type?: string;
    canvas?: { elements?: SlideElementLike[]; script?: string };
    questions?: { question?: string; options?: { label?: string; value?: string }[] }[];
    projectV2?: {
      title?: string;
      description?: string;
      milestones?: { title?: string; description?: string }[];
    };
  };
  actions?: { type?: string; text?: string }[];
}

function extractElementText(el: SlideElementLike): string {
  switch (el.type) {
    case 'text': {
      if (el.textType && CHROME_TEXT_TYPES.has(el.textType)) return '';
      return htmlToPlainText(el.content ?? '');
    }
    case 'shape':
      return htmlToPlainText(el.text?.content ?? '');
    case 'table': {
      if (!Array.isArray(el.data)) return '';
      const rows: string[] = [];
      for (const row of el.data) {
        if (!Array.isArray(row)) continue;
        const cells = row
          .map((cell) => htmlToPlainText(typeof (cell as { text?: unknown })?.text === 'string' ? (cell as { text: string }).text : ''))
          .filter(Boolean);
        if (cells.length) rows.push(cells.join(' | '));
      }
      return rows.join('\n');
    }
    case 'latex': {
      const tex = typeof el.latex === 'string' ? el.latex.trim() : '';
      return tex || htmlToPlainText(el.html ?? '');
    }
    case 'code': {
      if (!Array.isArray(el.lines) || !el.lines.length) return '';
      const body = el.lines
        .map((line) => (typeof line?.content === 'string' ? line.content : ''))
        .join('\n')
        .trim();
      if (!body) return '';
      const header = el.fileName || el.language;
      return header ? `${header}:\n${body}` : body;
    }
    case 'image':
      if (el.imageType === 'background') return '';
      return typeof el.name === 'string' ? el.name.trim() : '';
    case 'chart': {
      const chartData = el.data as { labels?: unknown[]; series?: { name?: unknown }[] } | undefined;
      if (!chartData) return '';
      const parts: string[] = [];
      if (Array.isArray(chartData.labels)) {
        const labels = chartData.labels.filter((l): l is string => typeof l === 'string' && l.trim().length > 0);
        if (labels.length) parts.push(labels.join(', '));
      }
      if (Array.isArray(chartData.series)) {
        const names = chartData.series
          .map((s) => (typeof s?.name === 'string' ? s.name.trim() : ''))
          .filter(Boolean);
        if (names.length) parts.push(names.join(', '));
      }
      return parts.join(' | ');
    }
    default:
      return '';
  }
}

/** Extracts plain-text context from a scene's pre-generated content, capped at maxChars. */
export function extractSceneContext(scene: SceneLike | null | undefined, maxChars = SCENE_CONTEXT_MAX_CHARS): string {
  if (!scene) return '';
  const parts: string[] = [];

  if (scene.content?.canvas?.elements && Array.isArray(scene.content.canvas.elements)) {
    const ordered = [...scene.content.canvas.elements].sort(
      (a, b) => (a.top ?? 0) - (b.top ?? 0) || (a.left ?? 0) - (b.left ?? 0),
    );
    for (const el of ordered) {
      const text = extractElementText(el);
      if (text) parts.push(text);
    }
    const script = typeof scene.content.canvas.script === 'string' ? scene.content.canvas.script.trim() : '';
    if (script) parts.push(script);
  }

  if (scene.content?.questions && Array.isArray(scene.content.questions)) {
    scene.content.questions.forEach((q, idx) => {
      const stem = typeof q?.question === 'string' ? htmlToPlainText(q.question) : '';
      if (!stem) return;
      const opts = Array.isArray(q.options)
        ? q.options
            .map((o) => {
              const v = typeof o?.value === 'string' ? o.value.trim() : '';
              const l = typeof o?.label === 'string' ? htmlToPlainText(o.label) : '';
              return v && l ? `${v}. ${l}` : l || v;
            })
            .filter(Boolean)
        : [];
      parts.push(opts.length ? `${idx + 1}. ${stem}\n${opts.join(' / ')}` : `${idx + 1}. ${stem}`);
    });
  }

  if (scene.content?.projectV2) {
    const p = scene.content.projectV2;
    if (typeof p.title === 'string' && p.title.trim()) parts.push(p.title.trim());
    if (typeof p.description === 'string' && p.description.trim()) parts.push(p.description.trim());
    if (Array.isArray(p.milestones)) {
      for (const m of p.milestones) {
        const line = [m?.title?.trim(), m?.description?.trim()].filter(Boolean).join(': ');
        if (line) parts.push(line);
      }
    }
  }

  if (Array.isArray(scene.actions)) {
    let lastSpeech = '';
    for (const action of scene.actions) {
      if (action?.type !== 'speech' || typeof action.text !== 'string') continue;
      const text = action.text.trim();
      if (text && text !== lastSpeech) {
        parts.push(text);
        lastSpeech = text;
      }
    }
  }

  return capContextText(parts.join('\n'), maxChars);
}
