import { expect, test } from 'vitest';
import type { PPTElement } from '@openmaic/dsl';
import { plainText, reflowSlide } from '@/lib/study-classroom/slide-reflow';

const base = { rotate: 0 };
const text = (id: string, top: number, left: number, content: string, textType?: string, height = 60) => ({ ...base, id, type: 'text', top, left, width: 400, height, content, defaultFontName: 'x', defaultColor: '#000', textType }) as unknown as PPTElement;
const shape = (id: string, top: number, left: number, content = '') => ({ ...base, id, type: 'shape', top, left, width: 100, height: 40, viewBox: [1, 1], path: '', fixedRatio: false, fill: '#fff', ...(content ? { text: { content, defaultFontName: 'x', defaultColor: '#000', align: 'middle' } } : {}) }) as unknown as PPTElement;
const image = (id: string, top: number, left: number, over: Record<string, unknown> = {}) => ({ ...base, id, type: 'image', top, left, width: 300, height: 200, fixedRatio: true, src: 'u', ...over }) as unknown as PPTElement;

test('keeps content in reading order, rows left to right, title first', () => {
  const blocks = reflowSlide([
    text('b', 300, 500, '<p>右下</p>'), text('a', 300, 20, '<p>左下</p>'),
    text('t', 250, 20, '<p>本頁主題</p>', 'title'), text('m', 120, 20, '<p>中間</p>'),
  ]);
  expect(blocks.map(block => block.id)).toEqual(['t', 'm', 'a', 'b']);
  expect(blocks[0].kind).toBe('title');
});

test('drops page decoration but keeps text inside shapes', () => {
  const blocks = reflowSlide([
    text('h', 0, 0, '<p>Chapter 1</p>', 'header'), text('f', 540, 0, '<p>12</p>', 'footer'), text('n', 20, 20, '<p>01</p>', 'partNumber'),
    text('e', 100, 20, '<p> &nbsp; </p>'), shape('s0', 10, 10), shape('s1', 200, 10, '<p>流程第一步</p>'),
    { ...base, id: 'l', type: 'line', top: 5, left: 5, width: 50, start: [0, 0], end: [1, 1] } as unknown as PPTElement,
    image('bg', 0, 0, { imageType: 'background' }), image('icon', 10, 10, { width: 20, height: 20 }), image('fig', 400, 20),
  ]);
  expect(blocks.map(block => [block.id, block.kind])).toEqual([['s1', 'text'], ['fig', 'image']]);
});

test('keeps tables, formulas, code, video and charts as blocks and ignores audio', () => {
  const blocks = reflowSlide([
    { ...base, id: 'tb', type: 'table', top: 10, left: 0, width: 400, height: 100, colWidths: [1], cellMinHeight: 1, outline: {}, data: [[{ id: 'c', colspan: 1, rowspan: 1, text: 'x' }]] } as unknown as PPTElement,
    { ...base, id: 'lx', type: 'latex', top: 150, left: 0, width: 200, height: 40, latex: 'a^2', html: '<span>a</span>' } as unknown as PPTElement,
    { ...base, id: 'cd', type: 'code', top: 250, left: 0, width: 200, height: 40, language: 'js', lines: [{ id: '1', content: 'x' }] } as unknown as PPTElement,
    { ...base, id: 'vd', type: 'video', top: 350, left: 0, width: 200, height: 40, autoplay: false, src: 'v' } as unknown as PPTElement,
    { ...base, id: 'ch', type: 'chart', top: 450, left: 0, width: 200, height: 40 } as unknown as PPTElement,
    { ...base, id: 'au', type: 'audio', top: 500, left: 0, width: 20, height: 20 } as unknown as PPTElement,
  ]);
  expect(blocks.map(block => block.kind)).toEqual(['table', 'latex', 'code', 'video', 'chart']);
});

test('reads visible text out of prose html', () => {
  expect(plainText('<p>a&nbsp;<b>b</b></p><p> c </p>')).toBe('a b c');
  expect(plainText('<p><br></p>')).toBe('');
});
