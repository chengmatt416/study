// Course blueprint: the plan a chatbot submits before it generates a classroom, and the checks that keep the
// finished classroom and its mock exam tied to the ebook, the IB documents, the school syllabus and a normal learning curve.
// Pure functions only. The worker adds the checks that need the database (are the cited books real, accessible and for this subject).
import { buildCourseMap, parseTitle, strandedScenes } from './course-map';

export const BLUEPRINT_SCHEMA = 'course-blueprint/v1';
export const SOURCE_KINDS = ['ib_syllabus', 'ib_guide', 'ib_markscheme', 'ebook', 'school_syllabus', 'note', 'chapter_material'] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const BLOOM = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;
export type Bloom = (typeof BLOOM)[number];
export const LEVELS = ['SL', 'HL', 'both', 'none'] as const;
export type BlueprintLevel = (typeof LEVELS)[number];

/** IB command terms (English as the IB writes them). A subject with level "none" is not held to this list. */
export const COMMAND_TERMS = [
  'annotate', 'analyse', 'analyze', 'apply', 'calculate', 'classify', 'comment', 'compare', 'compare and contrast', 'construct', 'contrast', 'deduce', 'define', 'derive', 'describe', 'design', 'determine', 'discuss',
  'distinguish', 'draw', 'estimate', 'evaluate', 'examine', 'explain', 'explore', 'find', 'formulate', 'identify', 'interpret', 'justify', 'label', 'list', 'measure', 'outline', 'plot', 'predict', 'prove', 'show',
  'show that', 'sketch', 'solve', 'state', 'suggest', 'summarise', 'summarize', 'verify', 'write down',
] as const;

export interface BlueprintSource { kind: SourceKind; book_id?: string; title: string; version?: string; pages?: string; used_for: string }
export interface BlueprintObjective { id: string; text: string; command_term: string; syllabus_ref: string; bloom: Bloom; source_pages?: string }
export interface BlueprintConcept { name: string; kind: 'formula' | 'concept' | 'procedure' | 'term' }
export interface BlueprintChapter {
  key: string; summary: string; prerequisites: string[]; minutes: number; difficulty: 1 | 2 | 3;
  new_concepts: BlueprintConcept[]; objectives: BlueprintObjective[]; misconceptions: string[]; exam_traps: string[];
}
export interface CourseBlueprint {
  schema: typeof BLUEPRINT_SCHEMA;
  level: BlueprintLevel;
  learner: string;
  sources: BlueprintSource[];
  source_exemptions: { kind: SourceKind; reason: string }[];
  chapters: BlueprintChapter[];
  assessment: { pretest_plan: string; checkpoint_plan: string; exam_alignment: string };
}
export interface BlueprintReport { ok: boolean; errors: string[]; warnings: string[]; value?: CourseBlueprint }

export const MAX_CHAPTERS = 12;
export const MAX_NEW_CONCEPTS = 4;
export const MAX_BLUEPRINT_BYTES = 60_000;
const ID = /^[a-z0-9][a-z0-9.-]{0,39}$/;
const text = (value: unknown, min: number, max: number): string | null => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max ? value.trim() : null;
const list = <T>(value: unknown): T[] | null => Array.isArray(value) ? value as T[] : null;
const BLOOM_RANK: Record<string, number> = Object.fromEntries(BLOOM.map((name, index) => [name, index]));

/** Structure and learning-curve rules. Which books exist is checked by the worker. */
export function validateBlueprint(input: unknown): BlueprintReport {
  const errors: string[] = []; const warnings: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['blueprint 必須是物件'], warnings };
  if (JSON.stringify(input).length > MAX_BLUEPRINT_BYTES) return { ok: false, errors: [`blueprint 超過 ${MAX_BLUEPRINT_BYTES} 字元，請精簡`], warnings };
  const o = input as Record<string, unknown>;
  if (o.schema !== BLUEPRINT_SCHEMA) errors.push(`schema 必須是 "${BLUEPRINT_SCHEMA}"`);
  const level = LEVELS.includes(o.level as BlueprintLevel) ? o.level as BlueprintLevel : null;
  if (!level) errors.push('level 必須是 SL、HL、both 或 none（沒有 IB 層級的科目用 none）');
  const learner = text(o.learner, 8, 300);
  if (!learner) errors.push('learner 要寫出學習者的年級／學期與已具備的先備知識（8 到 300 字）');

  const sources: BlueprintSource[] = [];
  const rawSources = list<Record<string, unknown>>(o.sources);
  if (!rawSources || rawSources.length > 20) errors.push('sources 必須是最多 20 筆的陣列');
  else rawSources.forEach((source, index) => {
    const where = `sources[${index}]`;
    const kind = SOURCE_KINDS.includes(source?.kind as SourceKind) ? source.kind as SourceKind : null;
    const title = text(source?.title, 1, 200); const usedFor = text(source?.used_for, 8, 300);
    if (!kind) return void errors.push(`${where}.kind 必須是 ${SOURCE_KINDS.join('、')}`);
    if (!title) errors.push(`${where}.title 必填`);
    if (!usedFor) errors.push(`${where}.used_for 要說明這份文件用來決定什麼（8 到 300 字）`);
    const bookId = typeof source.book_id === 'string' && source.book_id.length <= 100 ? source.book_id : undefined;
    if (kind !== 'note' && !bookId) errors.push(kind === 'chapter_material' ? `${where}: chapter_material 的 book_id 填教材的 material_id（get_chapter 取得）` : `${where}: ${kind} 必須填 book_id（list_books／list_ib_resources／list_syllabi 取得）`);
    const pages = typeof source.pages === 'string' ? source.pages.trim().slice(0, 100) : '';
    if (kind !== 'note' && !pages) errors.push(`${where}: 要寫出實際讀過的頁碼（例如 "12-34, 40"）；沒讀過的文件不能列出`);
    if (title && usedFor && kind) sources.push({ kind, book_id: bookId, title, version: typeof source.version === 'string' ? source.version.slice(0, 80) : undefined, pages, used_for: usedFor });
  });

  const exemptions: CourseBlueprint['source_exemptions'] = [];
  for (const [index, item] of (list<Record<string, unknown>>(o.source_exemptions) ?? []).entries()) {
    const kind = SOURCE_KINDS.includes(item?.kind as SourceKind) ? item.kind as SourceKind : null; const reason = text(item?.reason, 10, 300);
    if (!kind || !reason) errors.push(`source_exemptions[${index}] 需要 kind 與至少 10 字的 reason`); else exemptions.push({ kind, reason });
  }

  const chapters: BlueprintChapter[] = [];
  const rawChapters = list<Record<string, unknown>>(o.chapters);
  if (!rawChapters || rawChapters.length < 2 || rawChapters.length > MAX_CHAPTERS) errors.push(`chapters 必須是 2 到 ${MAX_CHAPTERS} 章，依先備知識由淺到深排序`);
  else {
    const seen = new Set<string>(); const objectiveIds = new Set<string>();
    rawChapters.forEach((chapter, index) => {
      const where = `chapters[${index}]`;
      const key = text(chapter?.key, 1, 60);
      if (!key) return void errors.push(`${where}.key 必填（章名，之後場景標題照寫）`);
      if (/[：:〔〕｜]/.test(key)) errors.push(`${where}.key「${key}」不可含全形或半形冒號、〔〕或｜，會和場景標題規則衝突`);
      if (seen.has(key)) errors.push(`${where}.key「${key}」重複`);
      const summary = text(chapter.summary, 8, 300);
      if (!summary) errors.push(`${where}（${key}）summary 要說明這章教什麼（8 到 300 字）`);
      const prerequisites = (list<unknown>(chapter.prerequisites) ?? []).filter((item): item is string => typeof item === 'string');
      for (const prerequisite of prerequisites) if (!seen.has(prerequisite)) errors.push(`${where}（${key}）的先備章節「${prerequisite}」必須是排在前面的章節（先備知識要先教）`);
      if (index > 0 && !prerequisites.length) warnings.push(`「${key}」沒有列先備章節；若它依賴前面的內容，請補上`);
      const minutes = typeof chapter.minutes === 'number' ? chapter.minutes : NaN;
      if (!(minutes >= 5 && minutes <= 40)) errors.push(`${where}（${key}）minutes 必須是 5 到 40（一章太長會超出注意力範圍，請拆章）`);
      const difficulty = chapter.difficulty === 1 || chapter.difficulty === 2 || chapter.difficulty === 3 ? chapter.difficulty : null;
      if (!difficulty) errors.push(`${where}（${key}）difficulty 必須是 1、2 或 3`);
      const concepts: BlueprintConcept[] = [];
      for (const [number, item] of (list<Record<string, unknown>>(chapter.new_concepts) ?? []).entries()) {
        const name = text(item?.name, 1, 100);
        if (name && ['formula', 'concept', 'procedure', 'term'].includes(item.kind as string)) concepts.push({ name, kind: item.kind as BlueprintConcept['kind'] });
        // A concept that is dropped without a word is never taught and never reviewed.
        else errors.push(`${where}（${key}）new_concepts[${number}] 需要 name（1 到 100 字）與 kind（formula、concept、procedure 或 term）`);
      }
      if (!concepts.length) errors.push(`${where}（${key}）new_concepts 至少列出 1 個這章新引入的公式／觀念／步驟／術語`);
      if (concepts.length > MAX_NEW_CONCEPTS) errors.push(`${where}（${key}）一章最多引入 ${MAX_NEW_CONCEPTS} 個新概念（現在 ${concepts.length} 個）：一次只教一個，請拆章`);
      const objectives: BlueprintObjective[] = [];
      const rawObjectives = list<Record<string, unknown>>(chapter.objectives) ?? [];
      if (!rawObjectives.length || rawObjectives.length > 6) errors.push(`${where}（${key}）objectives 必須是 1 到 6 個可觀察的學習目標`);
      let lastRank = -1;
      rawObjectives.forEach((objective, number) => {
        const at = `${where}.objectives[${number}]`;
        const id = typeof objective?.id === 'string' && ID.test(objective.id) ? objective.id : null;
        const objectiveText = text(objective?.text, 6, 300); const ref = text(objective?.syllabus_ref, 1, 80);
        const term = typeof objective?.command_term === 'string' ? objective.command_term.trim().toLowerCase() : '';
        const bloom = BLOOM.includes(objective?.bloom as Bloom) ? objective.bloom as Bloom : null;
        if (!id) errors.push(`${at}.id 必須是小寫英數與連字號（例如 b2-1-calc）`); else if (objectiveIds.has(id)) errors.push(`${at}.id「${id}」重複`); else objectiveIds.add(id);
        if (!objectiveText) errors.push(`${at}.text 要寫成可觀察的目標（6 到 300 字）`);
        if (!ref) errors.push(`${at}.syllabus_ref 要填對應的 IB 大綱編號或學校課綱章節（例如 "B2.1"）`);
        if (level && level !== 'none' && !COMMAND_TERMS.includes(term as (typeof COMMAND_TERMS)[number])) errors.push(`${at}.command_term「${objective?.command_term ?? ''}」不是 IB 指令詞（例如 Define、Explain、Calculate、Evaluate）`);
        if (!bloom) errors.push(`${at}.bloom 必須是 ${BLOOM.join('、')}`);
        else { if (BLOOM_RANK[bloom] < lastRank) errors.push(`${at}: 同一章的目標要由淺到深排列（${bloom} 不可排在較深的目標之後）`); lastRank = Math.max(lastRank, BLOOM_RANK[bloom]); }
        const sourcePages = typeof objective?.source_pages === 'string' ? objective.source_pages.trim().slice(0, 100) : '';
        if (sources.some(source => source.kind !== 'note') && !sourcePages) errors.push(`${at}.source_pages 要寫出支持這個目標的課本或大綱頁碼`);
        if (id && objectiveText && ref && bloom) objectives.push({ id, text: objectiveText, command_term: term, syllabus_ref: ref, bloom, source_pages: sourcePages || undefined });
      });
      const strings = (value: unknown, limit: number) => (list<unknown>(value) ?? []).filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim().slice(0, 200)).slice(0, limit);
      const misconceptions = strings(chapter.misconceptions, 8);
      // These ids end the question ids (__m_<id>) the router reads, so prose here would silently lose every misconception.
      for (const item of misconceptions) if (!ID.test(item)) errors.push(`${where}（${key}）misconceptions「${item.slice(0, 30)}」必須是迷思 id（英文小寫、數字與連字號，例如 forgot-delta-t）；說明文字寫在 exam_traps`);
      const examTraps = strings(chapter.exam_traps, 6);
      if (!examTraps.length) warnings.push(`「${key}」沒有列 exam_traps；〔精簡〕版需要 3 到 5 個考試陷阱`);
      seen.add(key);
      if (summary && minutes >= 5 && minutes <= 40 && difficulty) chapters.push({ key, summary, prerequisites, minutes, difficulty, new_concepts: concepts, objectives, misconceptions, exam_traps: examTraps });
    });
    // Learning curve: start gently, rise one step at a time, and do not end where it began.
    const levels = chapters.map(chapter => chapter.difficulty);
    if (levels.length && levels[0] === 3) errors.push('第一章難度不可是 3：課程要從容易的起點開始');
    levels.forEach((value, index) => { if (index > 0 && value - levels[index - 1] > 1) errors.push(`「${chapters[index].key}」難度從 ${levels[index - 1]} 直接跳到 ${value}：中間要有過渡的章節`); });
    if (levels.length >= 4 && Math.max(...levels) === levels[0]) warnings.push('所有章節難度相同，沒有由淺入深的學習曲線');
    const total = chapters.reduce((sum, chapter) => sum + chapter.minutes, 0);
    if (total > 300) warnings.push(`全部章節合計約 ${total} 分鐘，建議拆成多門課`);
  }

  const assessment = (o.assessment ?? {}) as Record<string, unknown>;
  const plans = { pretest_plan: text(assessment.pretest_plan, 20, 600), checkpoint_plan: text(assessment.checkpoint_plan, 20, 600), exam_alignment: text(assessment.exam_alignment, 20, 600) };
  if (!plans.pretest_plan) errors.push('assessment.pretest_plan 要說明前測如何涵蓋基礎／核心／難題（20 到 600 字）');
  if (!plans.checkpoint_plan) errors.push('assessment.checkpoint_plan 要說明檢核如何只考已講解的內容並含遷移題（20 到 600 字）');
  if (!plans.exam_alignment) errors.push('assessment.exam_alignment 要說明題型、指令詞與給分如何對應 IB 試卷與 mark scheme（20 到 600 字）');

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, errors, warnings, value: { schema: BLUEPRINT_SCHEMA, level: level!, learner: learner!, sources, source_exemptions: exemptions, chapters, assessment: plans as CourseBlueprint['assessment'] } };
}

/** The part of the generation requirement that carries the plan, so the official outline step builds from it. */
export function blueprintRequirement(blueprint: CourseBlueprint): string {
  const lines = [
    '## 課程藍圖（強制：章節、順序與標題照此，不可自行增刪或改名）',
    `層級：${blueprint.level}。學習者：${blueprint.learner}`,
    '依據文件：' + (blueprint.sources.map(source => `${source.title}${source.version ? `（${source.version}）` : ''}${source.pages ? ` p.${source.pages}` : ''}→${source.used_for}`).join('；') || '無'),
    '章節（依先備知識由淺到深，場景標題的章名必須與下列完全相同）：',
    ...blueprint.chapters.map((chapter, index) => [
      `${index + 1}. 「${chapter.key}」難度 ${chapter.difficulty}，約 ${chapter.minutes} 分鐘。${chapter.summary}`,
      chapter.prerequisites.length ? `   先備：${chapter.prerequisites.join('、')}` : '',
      `   新引入（逐一講解，一次一個）：${chapter.new_concepts.map(concept => `${concept.name}（${concept.kind}）`).join('、')}`,
      ...chapter.objectives.map(objective => `   目標 ${objective.id}［${objective.command_term}／${objective.bloom}／${objective.syllabus_ref}${objective.source_pages ? `／p.${objective.source_pages}` : ''}］${objective.text}`),
      chapter.misconceptions.length ? `   迷思 id（用於 __m_）：${chapter.misconceptions.join('、')}` : '',
      chapter.exam_traps.length ? `   考試陷阱：${chapter.exam_traps.join('；')}` : '',
    ].filter(Boolean).join('\n')),
    `前測：${blueprint.assessment.pretest_plan}`,
    `檢核：${blueprint.assessment.checkpoint_plan}`,
    `試卷對應：${blueprint.assessment.exam_alignment}`,
    '每章都要有「先測：章名」「檢核：章名」「章名」「章名〔補強〕」「章名〔精簡〕」場景；教學內容要分多張時，後續場景標題用「章名｜小節」，依序放在「章名」之後、「檢核：章名」之前；講解內容、例題與術語依上列文件與頁碼，IB 術語附英文，題目的指令詞與難度對應上列目標。',
  ];
  return lines.join('\n');
}

// ---- checking a finished classroom against its blueprint ----
export interface SceneSummary { id?: string; type?: string; title?: string; content?: { questions?: { id?: string }[] }; quizConfig?: { questionCount?: number } }
export interface AlignmentReport { ok: boolean; errors: string[]; warnings: string[] }
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
const levelOf = (id: string) => /__d([123])(?:__m_|$)/.exec(id)?.[1];
const lessonKey = (scene: SceneSummary) => { const parsed = parseTitle(scene.title ?? ''); return parsed.role === 'content' && !parsed.variant && scene.type !== 'quiz' ? parsed.key : null; };

/** A scene the learner's "next" never reaches, in words a chatbot can act on. */
function strandedMessages(scenes: SceneSummary[]): string[] {
  const infos = scenes.map((scene, index) => ({ id: scene.id ?? `scene-${index}`, title: scene.title ?? '', type: scene.type ?? '' }));
  return strandedScenes(buildCourseMap(infos), infos).map(scene => `場景「${scene.title}」不屬於任何章節，學生按下一步走不到：標題改成「章名｜小節」並放在該章的「檢核：章名」之前`);
}

/**
 * `fixable` holds what is only advice on a finished classroom (it still plays) but costs nothing to correct in an outline:
 * a missing variant, a missing closing scene, a chapter outside the plan, pretests in the wrong place.
 */
function compareWithBlueprint(blueprint: CourseBlueprint, scenes: SceneSummary[]): { errors: string[]; fixable: string[]; warnings: string[] } {
  const errors: string[] = []; const fixable: string[] = []; const warnings: string[] = [];
  const pretests = new Map<string, SceneSummary>(); const checkpoints = new Map<string, SceneSummary>(); const standard: string[] = []; const variants = new Map<string, Set<string>>();
  scenes.forEach(scene => {
    const parsed = parseTitle(scene.title ?? ''); const quiz = scene.type === 'quiz';
    if (quiz && parsed.role === 'pretest') pretests.set(parsed.key, scene);
    else if (quiz && parsed.role === 'checkpoint') checkpoints.set(parsed.key, scene);
    else if (!quiz && parsed.variant) variants.set(parsed.key, (variants.get(parsed.key) ?? new Set()).add(parsed.variant));
    else if (!quiz) standard.push(parsed.role === 'content' ? parsed.key : normalize(scene.title ?? ''));
    // A quiz scene cannot be part of a variant lesson: the router only plays slides and modules there.
    if (quiz && parsed.role === 'content' && parsed.variant) fixable.push(`「${scene.title}」是 quiz 場景：〔補強〕〔精簡〕〔延伸〕裡的練習、復測與難題要用 interactive 場景（<sk-*> 題型），quiz 只用於「先測：章名」與「檢核：章名」`);
  });
  const known = new Set(blueprint.chapters.map(chapter => chapter.key));
  /** Question ids of a generated quiz; null for an outline, which has no questions yet. */
  const questionIds = (scene: SceneSummary) => Array.isArray(scene.content?.questions) ? scene.content.questions.map(question => String(question.id ?? '')) : null;
  for (const chapter of blueprint.chapters) {
    if (!standard.includes(chapter.key)) errors.push(`缺少章節教學場景「${chapter.key}」`);
    if (!pretests.has(chapter.key)) errors.push(`缺少前測場景「先測：${chapter.key}」`);
    if (!checkpoints.has(chapter.key)) errors.push(`缺少檢核場景「檢核：${chapter.key}」`);
    const present = variants.get(chapter.key) ?? new Set<string>();
    for (const [mark, label, name] of [['remedial', '補強', '補強版'], ['quick', '精簡', '精簡版']] as const) if (!present.has(mark)) fixable.push(`「${chapter.key}」缺少〔${label}〕${name}場景`);
    const pretest = pretests.get(chapter.key); const ids = pretest ? questionIds(pretest) : null;
    if (ids) {
      if (!ids.length) errors.push(`「先測：${chapter.key}」沒有任何題目`);
      else if (ids.length < 4) warnings.push(`「先測：${chapter.key}」只有 ${ids.length} 題，建議 5 到 6 題才能判斷程度`);
      const levels = ids.map(levelOf);
      if (ids.length && !levels.some(Boolean)) warnings.push(`「先測：${chapter.key}」的題目 id 沒有 __d1／__d2／__d3 難度標記，系統無法分辨基礎不足與只差難題`);
      else if (ids.length && !levels.includes('3')) warnings.push(`「先測：${chapter.key}」沒有難題（__d3）：全對也無法證明學生熟練`);
    }
    const checkpoint = checkpoints.get(chapter.key); const checkIds = checkpoint ? questionIds(checkpoint) : null;
    if (checkIds) {
      if (!checkIds.length) errors.push(`「檢核：${chapter.key}」沒有任何題目`);
      else if (!checkIds.map(levelOf).includes('3')) warnings.push(`「檢核：${chapter.key}」沒有遷移難題（__d3）`);
      const repeated = checkIds.filter(id => id && ids?.includes(id));
      if (repeated.length) warnings.push(`「檢核：${chapter.key}」與先測用了相同的題目 id（${repeated.slice(0, 3).join('、')}）：檢核題要和先測不同`);
    }
  }
  for (const title of standard) if (!known.has(title) && (pretests.has(title) || checkpoints.has(title))) fixable.push(`場景「${title}」不在藍圖的章節裡`);
  const order = blueprint.chapters.map(chapter => standard.indexOf(chapter.key)).filter(index => index >= 0);
  if (order.some((value, index) => index > 0 && value < order[index - 1])) errors.push('章節教學場景的順序和藍圖不同：先備知識必須先教');
  const firstLesson = Math.min(...blueprint.chapters.map(chapter => scenes.findIndex(scene => lessonKey(scene) === chapter.key)).filter(index => index >= 0));
  const lastPretest = Math.max(-1, ...scenes.map((scene, index) => scene.type === 'quiz' && parseTitle(scene.title ?? '').role === 'pretest' ? index : -1));
  if (Number.isFinite(firstLesson) && lastPretest > firstLesson) fixable.push('先測沒有全部放在課程最前面');
  if (!scenes.some(scene => normalize(scene.title ?? '') === '課後：字卡與模考')) fixable.push('缺少最後的「課後：字卡與模考」場景');
  return { errors, fixable, warnings };
}

export function checkClassroomAgainstBlueprint(blueprint: CourseBlueprint, scenes: SceneSummary[]): AlignmentReport {
  const report = compareWithBlueprint(blueprint, scenes);
  return { ok: report.errors.length === 0, errors: report.errors, warnings: [...report.fixable, ...report.warnings, ...strandedMessages(scenes)] };
}

/** The official outline keeps only its first 100 scenes, so anything beyond them would disappear without an error. */
export const MAX_OUTLINE_SCENES = 100;

/** What the official quiz prompt is told to write when an outline gives a quiz no count. */
const DEFAULT_QUIZ_QUESTIONS = 3;

/**
 * The same plan check while the outline can still be corrected, before any scene has been generated. Everything that is
 * only advice on a finished classroom is an error here, because renaming or adding a planned scene costs nothing.
 */
export function checkOutlineAgainstBlueprint(blueprint: CourseBlueprint, scenes: SceneSummary[]): AlignmentReport {
  const report = compareWithBlueprint(blueprint, scenes);
  const errors = [...report.errors, ...report.fixable, ...strandedMessages(scenes)];
  if (scenes.length > MAX_OUTLINE_SCENES) errors.push(`大綱有 ${scenes.length} 個場景，官方只保留前 ${MAX_OUTLINE_SCENES} 個：把內容拆到另一冊`);
  // The completion review and the router both find scenes by title.
  const titles = new Map<string, number>();
  for (const scene of scenes) { const title = normalize(scene.title ?? ''); titles.set(title, (titles.get(title) ?? 0) + 1); }
  for (const [title, count] of titles) if (count > 1) errors.push(`場景標題「${title}」重複 ${count} 次：每個場景標題要不同（教學分多張時用「章名｜小節」）`);
  // The quiz prompt is told how many questions to write by the outline, so a wrong count here contradicts the pretest rules later.
  for (const scene of scenes) {
    if (scene.type !== 'quiz') continue;
    const role = parseTitle(scene.title ?? '').role; if (role === 'content') continue;
    const count = typeof scene.quizConfig?.questionCount === 'number' ? scene.quizConfig.questionCount : DEFAULT_QUIZ_QUESTIONS;
    if (role === 'pretest' && (count < 5 || count > 6)) errors.push(`「${scene.title}」的 quizConfig.questionCount 是 ${count}：先測每章 5 到 6 題`);
    if (role === 'checkpoint' && (count < 3 || count > 5)) errors.push(`「${scene.title}」的 quizConfig.questionCount 是 ${count}：檢核每章 3 到 5 題`);
  }
  return { ok: errors.length === 0, errors, warnings: report.warnings };
}

// ---- mock exam alignment ----
export const EXAM_ALIGNMENT_SCHEMA = 'exam-alignment/v1';
export interface ExamAlignmentQuestion { question: string; syllabus_ref: string; command_term: string; marks: number; difficulty: 1 | 2 | 3; source_pages?: string }
export interface ExamAlignment {
  schema: typeof EXAM_ALIGNMENT_SCHEMA; level: BlueprintLevel; paper: string; sources: BlueprintSource[];
  source_exemptions: { kind: SourceKind; reason: string }[]; questions: ExamAlignmentQuestion[]; mark_scheme_note: string;
}
export interface ExamAlignmentReport { ok: boolean; errors: string[]; warnings: string[]; value?: ExamAlignment }
export interface AnswerMarks { id: string; points: number }

/**
 * The exam follows the syllabus (every question names its syllabus reference and command term), the mark scheme
 * (marks agree with the answer file), and a normal difficulty curve (easy first, hard last, a believable mix).
 */
export function validateExamAlignment(input: unknown, answers: AnswerMarks[]): ExamAlignmentReport {
  const errors: string[] = []; const warnings: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['alignment 必須是物件'], warnings };
  const o = input as Record<string, unknown>;
  if (o.schema !== EXAM_ALIGNMENT_SCHEMA) errors.push(`schema 必須是 "${EXAM_ALIGNMENT_SCHEMA}"`);
  const level = LEVELS.includes(o.level as BlueprintLevel) ? o.level as BlueprintLevel : null;
  if (!level) errors.push('level 必須是 SL、HL、both 或 none');
  const paper = text(o.paper, 2, 120); if (!paper) errors.push('paper 要寫出對應的試卷（例如 "Paper 1A, Sample"）');
  const note = text(o.mark_scheme_note, 20, 600); if (!note) errors.push('mark_scheme_note 要說明給分方式如何對應 mark scheme（20 到 600 字）');
  const sources: BlueprintSource[] = [];
  for (const [index, source] of (list<Record<string, unknown>>(o.sources) ?? []).entries()) {
    const kind = SOURCE_KINDS.includes(source?.kind as SourceKind) ? source.kind as SourceKind : null; const title = text(source?.title, 1, 200); const usedFor = text(source?.used_for, 8, 300);
    const bookId = typeof source?.book_id === 'string' ? source.book_id : undefined; const pages = typeof source?.pages === 'string' ? source.pages.trim() : '';
    if (!kind || !title || !usedFor || (kind !== 'note' && (!bookId || !pages))) errors.push(`sources[${index}] 需要 kind、title、used_for，且非 note 的文件要有 book_id 與讀過的 pages`);
    else sources.push({ kind, book_id: bookId, title, pages, used_for: usedFor, version: typeof source.version === 'string' ? source.version.slice(0, 80) : undefined });
  }
  const exemptions: ExamAlignment['source_exemptions'] = [];
  for (const [index, item] of (list<Record<string, unknown>>(o.source_exemptions) ?? []).entries()) {
    const kind = SOURCE_KINDS.includes(item?.kind as SourceKind) ? item.kind as SourceKind : null; const reason = text(item?.reason, 10, 300);
    if (!kind || !reason) errors.push(`source_exemptions[${index}] 需要 kind 與至少 10 字的 reason`); else exemptions.push({ kind, reason });
  }
  const rows: ExamAlignmentQuestion[] = [];
  const rawRows = list<Record<string, unknown>>(o.questions) ?? [];
  if (!rawRows.length) errors.push('questions 要逐題列出對應的大綱編號、指令詞、分數與難度');
  const wanted = new Map(answers.map(answer => [answer.id, answer.points]));
  const seen = new Set<string>();
  rawRows.forEach((row, index) => {
    const at = `questions[${index}]`;
    const question = text(row?.question, 1, 40); const ref = text(row?.syllabus_ref, 1, 80);
    const term = typeof row?.command_term === 'string' ? row.command_term.trim().toLowerCase() : '';
    const marks = typeof row?.marks === 'number' && row.marks >= 0 ? row.marks : NaN;
    const difficulty = row?.difficulty === 1 || row?.difficulty === 2 || row?.difficulty === 3 ? row.difficulty : null;
    if (!question) return void errors.push(`${at}.question 必填（題號，與答案 JSON 的 id 相同）`);
    if (seen.has(question)) errors.push(`${at}.question「${question}」重複`); seen.add(question);
    if (!wanted.has(question)) errors.push(`${at}: 題號「${question}」不在答案 JSON 裡`);
    if (!ref) errors.push(`${at}（${question}）syllabus_ref 必填`);
    if (level && level !== 'none' && !COMMAND_TERMS.includes(term as (typeof COMMAND_TERMS)[number])) errors.push(`${at}（${question}）command_term「${row?.command_term ?? ''}」不是 IB 指令詞`);
    if (!(marks >= 0)) errors.push(`${at}（${question}）marks 必須是非負數`);
    else if (wanted.has(question) && Math.abs(wanted.get(question)! - marks) > 1e-9) errors.push(`${at}（${question}）marks ${marks} 與答案 JSON 的配分 ${wanted.get(question)} 不同`);
    if (!difficulty) errors.push(`${at}（${question}）difficulty 必須是 1、2 或 3`);
    if (ref && difficulty && marks >= 0) rows.push({ question, syllabus_ref: ref, command_term: term, marks, difficulty, source_pages: typeof row.source_pages === 'string' ? row.source_pages.slice(0, 100) : undefined });
  });
  for (const id of wanted.keys()) if (!seen.has(id)) errors.push(`答案 JSON 的題 ${id} 沒有對應的 alignment 列`);
  // Difficulty curve: easy questions open the paper, hard ones close it, and the mix looks like a real paper.
  if (rows.length >= 5) {
    const total = rows.reduce((sum, row) => sum + row.marks, 0) || rows.length;
    const share = (value: number) => rows.filter(row => row.difficulty === value).reduce((sum, row) => sum + (row.marks || 1), 0) / (total || 1);
    if (share(1) < 0.15) warnings.push('基礎題（difficulty 1）不到 15%：學生一開始就卡住，缺少成功經驗');
    if (share(3) < 0.1) warnings.push('難題（difficulty 3）不到 10%：無法區分高分學生');
    if (share(3) > 0.4) warnings.push('難題超過 40%：整體太難，不像真實試卷');
    const third = Math.ceil(rows.length / 3);
    const avg = (part: ExamAlignmentQuestion[]) => part.reduce((sum, row) => sum + row.difficulty, 0) / (part.length || 1);
    if (avg(rows.slice(0, third)) > avg(rows.slice(-third))) errors.push('題目沒有由易到難：前三分之一的平均難度高於最後三分之一');
  } else if (rows.length) warnings.push('題數少於 5 題，難度分布無法檢查');
  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, errors, warnings, value: { schema: EXAM_ALIGNMENT_SCHEMA, level: level!, paper: paper!, sources, source_exemptions: exemptions, questions: rows, mark_scheme_note: note! } };
}

/** What the worker must verify against the database for a blueprint or an exam alignment. */
export interface AvailableSource { id: string; title: string; kind: SourceKind; ib_level: 'both' | 'SL' | 'HL' | null; /** Uploaded to the chapter this plan is for: the plan must use it. */ required?: boolean }
/** Cited books must be real, readable by the user, of the right kind and level; each kind that exists for the subject must be cited or exempted. */
export function checkSources(cited: BlueprintSource[], exemptions: { kind: SourceKind }[], level: BlueprintLevel, available: AvailableSource[]): { errors: string[]; warnings: string[] } {
  const errors: string[] = []; const warnings: string[] = [];
  const byId = new Map(available.map(source => [source.id, source]));
  for (const source of cited) {
    if (source.kind === 'note') continue;
    const found = source.book_id ? byId.get(source.book_id) : undefined;
    if (!found) errors.push(`來源「${source.title}」的 book_id 不是你可存取（電子書／課綱須屬於此科目）的文件`);
    else if (found.kind !== source.kind) errors.push(`來源「${source.title}」實際是 ${found.kind}，不是 ${source.kind}`);
    else if (found.ib_level && found.ib_level !== 'both' && (level === 'SL' || level === 'HL') && found.ib_level !== level) errors.push(`來源「${source.title}」是 ${found.ib_level} 文件，與 ${level} 層級不符`);
  }
  const exempt = new Set(exemptions.map(item => item.kind));
  const have = new Set(cited.filter(source => source.book_id && byId.get(source.book_id)?.kind === source.kind).map(source => source.kind));
  const labels: Record<string, string> = { ib_syllabus: 'IB syllabus', ib_guide: 'IB guideline', ib_markscheme: 'IB mark scheme', ebook: '電子書', school_syllabus: '學校課綱', chapter_material: '章節教材' };
  // Material the learner uploaded to this chapter is what they want the course built from.
  if (available.some(source => source.kind === 'chapter_material' && source.required) && !have.has('chapter_material') && !exempt.has('chapter_material')) {
    errors.push('這個章節有使用者上傳的教材（get_chapter），但沒有引用：用 get_chapter_material 讀完後列入 sources（kind "chapter_material"，book_id 填 material_id，含段落或頁碼），或在 source_exemptions 寫明不用的理由');
  }
  for (const kind of ['ebook', 'school_syllabus'] as const) {
    if (!available.some(source => source.kind === kind) || have.has(kind) || exempt.has(kind)) continue;
    errors.push(`此科目有可用的${labels[kind]}，但沒有引用：先讀取後列入 sources（含頁碼），或在 source_exemptions 寫明不用的理由`);
  }
  // IB documents are not split by subject: the plan picks the ones that apply, but must cite at least one when any exist.
  const ibKinds = ['ib_syllabus', 'ib_guide', 'ib_markscheme'] as const;
  if (available.some(source => (ibKinds as readonly string[]).includes(source.kind)) && !ibKinds.some(kind => have.has(kind) || exempt.has(kind))) {
    errors.push('有可用的 IB 參考文件（list_ib_resources），但沒有引用任何一份：挑出適用本科目的 IB syllabus／guideline／mark scheme，讀取後列入 sources（含頁碼），或在 source_exemptions 寫明不用的理由');
  }
  return { errors, warnings };
}

const EXAMPLE_BLUEPRINT = {
  schema: BLUEPRINT_SCHEMA, level: 'SL', learner: '高一下學期，已學過國中溫度與熱的基本概念，尚未學過比熱與潛熱計算',
  sources: [
    { kind: 'ib_syllabus', book_id: '<list_ib_resources 的 book_id>', title: 'Physics guide (first assessment 2025)', pages: '28-31', used_for: '決定熱與溫度單元的範圍、學習目標與編號' },
    { kind: 'ebook', book_id: '<list_books 的 id>', title: '課本', pages: '112-130', used_for: '例題、術語與圖示取自課本第 3 章' },
    { kind: 'school_syllabus', book_id: '<list_syllabi 的 book_id>', title: '本學期課綱', pages: '4', used_for: '確認本學期要教到哪一節' },
  ],
  source_exemptions: [],
  chapters: [
    { key: '溫度與內能', summary: '用粒子模型說明溫度、內能與熱傳遞方向', prerequisites: [], minutes: 15, difficulty: 1,
      new_concepts: [{ name: '溫度與平均動能的關係', kind: 'concept' }, { name: '內能', kind: 'term' }],
      objectives: [{ id: 'b1-1-define', text: '定義溫度與內能並區分兩者', command_term: 'Distinguish', syllabus_ref: 'B1.1', bloom: 'understand', source_pages: '28; 112-115' }],
      misconceptions: ['temp-equals-heat'], exam_traps: ['把溫度當成熱量'] },
    { key: '比熱與熱量計算', summary: '用 Q = mcΔT 計算升溫所需熱量', prerequisites: ['溫度與內能'], minutes: 20, difficulty: 2,
      new_concepts: [{ name: 'Q = mcΔT', kind: 'formula' }, { name: '比熱容', kind: 'term' }],
      objectives: [{ id: 'b1-2-calc', text: '計算物體升溫所需的熱量', command_term: 'Calculate', syllabus_ref: 'B1.2', bloom: 'apply', source_pages: '29; 118-122' }],
      misconceptions: ['forgot-delta-t'], exam_traps: ['單位 J 與 kJ 混用'] },
  ],
  assessment: { pretest_plan: '每章 5-6 題：基礎 1-2、核心 2、難題 2，難題對應 mark scheme 常見失分點', checkpoint_plan: '只考已講解內容，3-5 題含 1 題 __d3 遷移題，題目不重複前測', exam_alignment: '指令詞與配分依 Paper 1 的 mark scheme；考試陷阱取自 mark scheme 的常見錯誤' },
};

export const BLUEPRINT_GUIDE = `## STUDY 課程藍圖（強制：先 submit_course_blueprint 經使用者核准，start_openmaic_classroom 才能開始）
先規劃，再生成。藍圖讓課程與課本、IB 文件、學校課綱對齊，並有正常的學習曲線。藍圖只是 validate_course_blueprint 與 submit_course_blueprint 的參數（存成待審藍圖，在 App 視覺化），不另存成重點整理或其他文件；來源筆記只用使用者指定或既有的，不為藍圖另建。步驟：
1. study_overview 取得 subject_id；list_ib_resources（不分科目，會列出全部 IB 參考文件，依名稱／版本自行挑出適用本科目的）、list_syllabi、list_books 找出可用的 IB syllabus、guideline、mark scheme、電子書與本學期課綱。
2. 實際讀取要用的頁面（get_ib_resource 或 get_book_pdf）。只能列出你讀過的頁碼；文件清單不等於已讀。
3. 依下列規則寫出 blueprint（JSON，schema "${BLUEPRINT_SCHEMA}"），先呼叫 validate_course_blueprint 修到通過，再詳細自我審查並 submit_course_blueprint（見「藍圖審核與 yolo 模式」）。章節有上傳教材時（get_chapter），用 get_chapter_material 讀完並以 kind "chapter_material"（book_id 填 material_id）引用。
規則（伺服器逐條檢查，沒通過不會開始生成）：
- sources：引用的文件必須真實存在、你有權限、種類要對（ib_syllabus／ib_guide／ib_markscheme／ebook／school_syllabus；ebook 與 school_syllabus 須屬於這個科目，school_syllabus 只接受本學期；IB 文件不分科目，由你依內容挑選適用的），IB 文件的 SL／HL 要和 level 一致。每個非 note 的來源都要有 book_id 與讀過的 pages。科目有電子書或本學期課綱就必須引用；有 IB 參考文件時至少引用一份適用的；真的不用要在 source_exemptions 寫明理由。
- chapters：2 到 ${MAX_CHAPTERS} 章，依先備知識由淺到深。先備章節只能是排在前面的章節。每章 5 到 40 分鐘、1 到 ${MAX_NEW_CONCEPTS} 個新概念（一次只教一個，多了就拆章）、1 到 6 個學習目標。
- 學習曲線：第一章難度不是 3；相鄰章節難度最多升 1 級；同一章的目標由淺到深（bloom：remember → understand → apply → analyze → evaluate → create）。
- objectives：每個目標有可觀察的文字、IB 指令詞（Define、Explain、Calculate、Evaluate…；level 為 none 的科目不限）、對應的大綱編號 syllabus_ref，以及支持它的 source_pages。
- 章名（key）就是之後的場景標題：不可含冒號、〔〕或｜。每章要有「先測：章名」「檢核：章名」「章名」場景，順序與藍圖相同；教學內容要分多張時，後續場景標題用「章名｜小節」，依序放在「章名」之後、「檢核：章名」之前，補強與精簡版同樣用「章名〔補強〕｜小節」。大綱草稿在 validate_openmaic_core_step 就會比對藍圖，不符要先改；發布前再用 check_openmaic_alignment 檢查。
- 藍圖展開後的生成需求有字數上限：validate_course_blueprint 與 add_long_course_part 超限會直接拒絕，請拆冊或精簡摘要，不要刪減來源。
- misconceptions：每章常見迷思的 id（英文小寫、數字與連字號，例如 temp-equals-heat），同一個迷思整門課用同一個 id，題目 id 會以 __m_<id> 結尾；exam_traps 用一句話寫出考試陷阱。
- assessment：說明前測如何涵蓋基礎／核心／難題、檢核如何只考已講解的內容、題型與指令詞如何對應 mark scheme。
範例（欄位與格式；內容請依實際科目與文件）：
${JSON.stringify(EXAMPLE_BLUEPRINT)}`;

export const EXAM_ALIGNMENT_GUIDE = `## STUDY 模擬試題對齊（create_exam 的 alignment）
模擬試題要和 IB 大綱、mark scheme、課本、正常難度曲線一致。科目有可引用的 IB 文件、電子書或本學期課綱時，create_exam 必須附 alignment（schema "${EXAM_ALIGNMENT_SCHEMA}"）；先讀取要用的頁面，只列讀過的頁碼：
{ "schema": "${EXAM_ALIGNMENT_SCHEMA}", "level": "SL", "paper": "Paper 1A（練習卷）", "sources": [{ "kind": "ib_markscheme", "book_id": "…", "title": "…", "pages": "5-9", "used_for": "題型與給分方式" }, { "kind": "ib_syllabus", … }], "source_exemptions": [], "mark_scheme_note": "每題給分點與指令詞依 mark scheme：Calculate 給方法分與答案分…", "questions": [{ "question": "q1", "syllabus_ref": "B1.2", "command_term": "Calculate", "marks": 2, "difficulty": 1, "source_pages": "29" }, …] }
- 每一題（答案 JSON 的每個 id）都要有一列，marks 必須等於答案 JSON 的配分；syllabus_ref 對應大綱編號；command_term 用 IB 指令詞，題目的問法與配分要符合該指令詞（Define 與 State 通常 1 分，Explain 與 Calculate 依步驟給分）。
- 難度 1 基礎、2 核心、3 難題。像真實試卷：由易到難（前三分之一的平均難度不可高於最後三分之一），基礎約 20 到 40%、難題約 10 到 30%。
- 試題範圍只能涵蓋大綱與課本有的內容，不出超出該層級（SL／HL）的題目；解析要寫出給分點，並指出常見失分的錯誤。
- sources 的 book_id 必須是此科目你有權限的文件，種類要對；科目有哪一種文件就要引用，真的不用要在 source_exemptions 寫明理由。可先用 validate_exam（附 subject_id 與 alignment）檢查。`;
