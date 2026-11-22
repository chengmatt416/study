import { expect, test } from 'vitest';
import { createElement } from '@/node_modules/react';
import { renderToStaticMarkup } from '@/node_modules/react-dom/server';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { LaserLayer, StudySlideReaderView } from '@/components/study/StudySlideReader';
import type { Slide } from '@openmaic/dsl';
import type { AimView } from '@/lib/study-classroom/slide-aim';

const el = (over: Record<string, unknown>) => ({ rotate: 0, ...over });
const slide = {
  id: 's', viewportSize: 1000, viewportRatio: 0.5625, theme: {}, background: { type: 'solid', color: '#14213d' },
  elements: [
    el({ id: 'n', type: 'text', top: 20, left: 40, width: 120, height: 30, textType: 'partNumber', content: '<p>01</p>', defaultFontName: 'x', defaultColor: '#fff' }),
    el({ id: 'shape', type: 'shape', top: 0, left: 0, width: 1000, height: 90, viewBox: [1, 1], path: '', fixedRatio: false, fill: '#fca311' }),
    el({ id: 't', type: 'text', top: 30, left: 60, width: 880, height: 80, textType: 'title', defaultFontName: 'Microsoft YaHei', defaultColor: '#fff', content: '<p style="font-size:44px;color:#ffffff;font-family:Microsoft YaHei;line-height:1.2;width:880px"><strong>牛頓第二定律與動量守恆：從受力分析到碰撞問題的完整推導 Newton’s Second Law</strong></p>' }),
    el({ id: 'b', type: 'text', top: 140, left: 60, width: 520, height: 260, defaultFontName: 'x', defaultColor: '#fff', content: '<ul><li><p style="font-size:26px;color:#e5e5e5">合力等於質量乘以加速度 F = ma，向量方程式要分量處理。</p></li><li><p style="font-size:26px;color:#e5e5e5">supercalifragilisticexpialidocious_unbreakable_identifier_example_that_is_long</p></li><li><p style="font-size:26px">碰撞前後總動量相等（孤立系統）。</p></li></ul>' }),
    el({ id: 'img', type: 'image', top: 140, left: 620, width: 340, height: 260, fixedRatio: true, src: 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22340%22 height=%22260%22><rect width=%22340%22 height=%22260%22 fill=%22%23ccc%22/><text x=%2220%22 y=%22140%22 font-size=%2224%22>示意圖</text></svg>', name: '受力示意圖' }),
    el({ id: 'tbl', type: 'table', top: 420, left: 60, width: 880, height: 100, colWidths: [0.3, 0.7], cellMinHeight: 36, outline: {}, data: [[{ id: 'a', colspan: 1, rowspan: 1, text: '<p style="font-size:20px">物理量</p>' }, { id: 'b', colspan: 1, rowspan: 1, text: '<p style="font-size:20px">定義與單位（SI）：動量 p = mv，單位 kg·m/s</p>' }]] }),
    el({ id: 'lx', type: 'latex', top: 530, left: 60, width: 500, height: 40, latex: 'F=ma', html: '<span class="katex">F = ma = m\\frac{dv}{dt}</span>' }),
  ],
} as unknown as Slide;

test('renders a phone reader without fixed widths or the slide chrome', () => {
  const html = renderToStaticMarkup(createElement(StudySlideReaderView, { slide }));
  expect(html).toContain('study-reader');
  expect(html).toContain('牛頓第二定律');
  expect(html).not.toContain('01</p>');
  expect(html.indexOf('牛頓第二定律')).toBeLessThan(html.indexOf('合力等於質量'));
  expect(html).toContain('受力示意圖');
  expect(html).toContain('<table');
  expect(html).not.toMatch(/position:\s*absolute/);
  const css = readFileSync(new URL('../../../../integrations/openmaic/cloudflare/overlay/components/study/classroom.css', import.meta.url), 'utf8');
  mkdirSync(process.env.READER_PREVIEW_DIR ?? '/tmp', { recursive: true });
  if (process.env.READER_PREVIEW_DIR) writeFileSync(process.env.READER_PREVIEW_DIR + '/index.html', `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;height:100dvh;font-family:'Noto Sans TC',system-ui,sans-serif}${css}</style></head><body><div style="height:100dvh">${html}</div></body></html>`);
});

const render = (aim: AimView) => renderToStaticMarkup(createElement(StudySlideReaderView, { slide, aim }));

test('spotlight dims the other blocks and rings the target, with its own timing', () => {
  const html = render({ spotlight: { blockId: 'b', dim: 0.6, ms: 300 }, highlight: [] });
  expect(html).toContain('data-aim="spot"');
  expect(html).toContain('--aim-dim:0.6');
  expect(html).toContain('id="screen-element-b"');
  expect(html).toMatch(/id="screen-element-b"[^>]*data-aim="target"/);
  expect(html).not.toMatch(/id="screen-element-t"[^>]*data-aim=/);
});

test('a region spotlight draws a cut-out inside the block', () => {
  const html = render({ spotlight: { blockId: 'img', dim: 0.5, ms: 300, region: { x: 50, y: 10, w: 40, h: 60 } }, highlight: [] });
  expect(html).toContain('study-aim-region');
  expect(html).toContain('left:50%;top:10%;width:40%;height:60%');
});

test('laser aims at a block: the block is marked and the reader carries the laser color', () => {
  const html = render({ laser: { blockId: 'b', color: '#ff0000' }, highlight: [] });
  expect(html).toMatch(/id="screen-element-b"[^>]*data-aim="pointed"/);
  expect(html).toContain('--laser:#ff0000');
  expect(html).not.toContain('data-aim="spot"');
  expect(render({ laser: { blockId: 'b', color: 'url(javascript:alert(1))' }, highlight: [] })).toContain('--laser:#ff1f2d');
});

test('the laser dot is a layered red pointer with a trail and exits cleanly', () => {
  const html = renderToStaticMarkup(createElement(LaserLayer, { x: 120, y: 64, color: '#ff1f2d', out: false }));
  for (const part of ['study-laser-layer', 'study-laser-core', 'study-laser-halo', 'study-laser-ring study-laser-ring-2', 'study-laser-tail']) expect(html).toContain(part);
  expect((html.match(/study-laser-tail/g) ?? []).length).toBe(3);
  expect(html).toContain('--lx:120px');
  expect(html).toContain('--ly:64px');
  expect(html).not.toContain('data-out');
  expect(renderToStaticMarkup(createElement(LaserLayer, { x: 0, y: 0, color: '#f00', out: true }))).toContain('data-out="true"');
});

test('highlight marks blocks without dimming the others', () => {
  const html = render({ highlight: ['t', 'tbl'] });
  expect((html.match(/data-aim="highlight"/g) ?? []).length).toBe(2);
  expect(html).not.toContain('data-aim="spot"');
});

test('no aim leaves the reader untouched', () => {
  const html = renderToStaticMarkup(createElement(StudySlideReaderView, { slide }));
  expect(html).not.toContain('data-aim=');
  expect(html).not.toContain('study-aim-');
});

test('writes aiming previews for a visual check', () => {
  if (!process.env.READER_PREVIEW_DIR) return;
  const css = readFileSync(new URL('../overlay/components/study/classroom.css', import.meta.url), 'utf8');
  const page = (body: string) => `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*,*::before,*::after{box-sizing:border-box}button{border:0;background:transparent;font:inherit;color:inherit;padding:0}body{margin:0;font-family:Geist,Inter,"Noto Sans TC",system-ui,sans-serif}${css}*{animation:none!important;transition:none!important}html,body{height:100%}.phone{height:100dvh}</style></head><body><div class="study-classroom phone">${body}</div></body></html>`;
  const dir = process.env.READER_PREVIEW_DIR;
  writeFileSync(dir + '/aim-spot.html', page(render({ spotlight: { blockId: 'b', dim: 0.6, ms: 300 }, highlight: [] })));
  writeFileSync(dir + '/aim-region.html', page(render({ spotlight: { blockId: 'img', dim: 0.6, ms: 300, region: { x: 45, y: 25, w: 50, h: 45 } }, highlight: [] })));
  const laserPage = page(render({ laser: { blockId: 'b', color: '#ff0000' }, highlight: ['tbl'] }) + '');
  const layer = renderToStaticMarkup(createElement(LaserLayer, { x: 0, y: 0, color: '#ff0000', out: false }));
  writeFileSync(dir + '/aim-laser.html', laserPage.replace('</article>', layer + '</article>').replace('</body>', `<script>(function(){var r=document.querySelector('.study-reader'),n=document.getElementById('screen-element-b'),l=document.querySelector('.study-laser-layer');var b=n.getBoundingClientRect(),c=r.getBoundingClientRect();l.style.setProperty('--lx',Math.round(b.left-c.left+r.scrollLeft+b.width-11)+'px');l.style.setProperty('--ly',Math.round(b.top-c.top+r.scrollTop+28)+'px')})()</script></body>`));
});
