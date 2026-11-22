// Reflows a slide for a phone. A slide is a 1000x562 canvas of absolutely placed elements, so on a phone it only
// shrinks to unreadable text. The reader keeps the content, in reading order, and drops page decoration.
import type { PPTElement } from '@openmaic/dsl';

export type ReflowKind = 'title' | 'subtitle' | 'text' | 'image' | 'table' | 'latex' | 'code' | 'video' | 'chart';
export interface ReflowBlock { id: string; kind: ReflowKind; element: PPTElement; html?: string }

/** Text a reader would actually see in some prose HTML. */
export const plainText = (html: string): string => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

const CHROME_TEXT = new Set(['header', 'footer', 'partNumber', 'itemNumber']);
const MIN_IMAGE = 40;

function toBlock(element: PPTElement): ReflowBlock | null {
  switch (element.type) {
    case 'text': {
      if (element.textType && CHROME_TEXT.has(element.textType)) return null;
      if (!plainText(element.content)) return null;
      const kind: ReflowKind = element.textType === 'title' ? 'title' : element.textType === 'subtitle' ? 'subtitle' : 'text';
      return { id: element.id, kind, element, html: element.content };
    }
    case 'shape': {
      const html = element.text?.content ?? '';
      if (!plainText(html)) return null;
      return { id: element.id, kind: 'text', element, html };
    }
    case 'image':
      if (element.imageType === 'background' || element.width < MIN_IMAGE || element.height < MIN_IMAGE) return null;
      return { id: element.id, kind: 'image', element };
    case 'table': return { id: element.id, kind: 'table', element };
    case 'latex': return element.html || element.latex ? { id: element.id, kind: 'latex', element } : null;
    case 'code': return element.lines.length ? { id: element.id, kind: 'code', element } : null;
    case 'video': return { id: element.id, kind: 'video', element };
    case 'chart': return { id: element.id, kind: 'chart', element };
    default: return null; // lines, audio and anything else decorative
  }
}

interface Placed { element: Exclude<PPTElement, { type: 'line' }>; block: ReflowBlock }

/** Rows by vertical position (elements that overlap vertically share a row), left to right inside a row; titles first. */
export function reflowSlide(elements: readonly PPTElement[]): ReflowBlock[] {
  const placed: Placed[] = [];
  for (const element of elements) {
    if (element.type === 'line') continue;
    const block = toBlock(element);
    if (block) placed.push({ element, block });
  }
  placed.sort((a, b) => a.element.top - b.element.top || a.element.left - b.element.left);
  const rows: { bottom: number; items: Placed[] }[] = [];
  for (const item of placed) {
    const row = rows[rows.length - 1];
    if (row && item.element.top < row.bottom - 8) { row.items.push(item); row.bottom = Math.max(row.bottom, item.element.top + item.element.height); }
    else rows.push({ bottom: item.element.top + item.element.height, items: [item] });
  }
  const blocks: ReflowBlock[] = [];
  for (const row of rows) for (const item of row.items.sort((a, b) => a.element.left - b.element.left)) blocks.push(item.block);
  return [...blocks.filter(block => block.kind === 'title'), ...blocks.filter(block => block.kind !== 'title')];
}
