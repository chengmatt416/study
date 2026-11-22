import { describe, expect, it } from 'vitest';
import { capContextText, extractSceneContext, htmlToPlainText } from '../overlay/lib/study-classroom/scene-context';

const CONTEXT_LIMIT = 6000;

describe('scene text extraction and 6000-char cap', () => {
  it('strips HTML markup and decodes common entities', () => {
    expect(htmlToPlainText('<p>Hello &amp; <b>world</b><br/>Line &lt;2&gt;</p>')).toBe('Hello & world\nLine <2>');
  });

  it('extracts sorted slide content while skipping chrome elements', () => {
    const context = extractSceneContext({
      id: 's1',
      title: '牛頓第二定律',
      type: 'slide',
      content: {
        type: 'slide',
        canvas: {
          elements: [
            { type: 'text', textType: 'footer', top: 900, left: 10, content: '<p>頁尾頁碼 3</p>' },
            { type: 'text', textType: 'header', top: 10, left: 10, content: '<p>頁首標題</p>' },
            { type: 'text', top: 200, left: 50, content: '<p>F = m a</p>' },
            { type: 'text', textType: 'title', top: 50, left: 50, content: '<h1>力與加速度</h1>' },
            {
              type: 'table',
              top: 300,
              left: 50,
              data: [
                [{ text: '物理量' }, { text: '單位' }],
                [{ text: '力' }, { text: '牛頓 (N)' }],
              ],
            },
            { type: 'latex', top: 350, left: 50, latex: 'a = \\frac{F}{m}' },
            {
              type: 'chart',
              top: 400,
              left: 50,
              data: { labels: ['1N', '2N'], series: [{ name: '加速度' }] },
            },
            { type: 'image', top: 450, left: 50, imageType: 'background', name: 'ignored-bg' },
            { type: 'image', top: 460, left: 50, name: '實驗裝置示意圖' },
          ],
          script: '當質量固定時，加速度與外力成正比。',
        },
      },
    });

    expect(context).not.toContain('頁尾頁碼');
    expect(context).not.toContain('頁首標題');
    expect(context).not.toContain('ignored-bg');
    expect(context.indexOf('力與加速度')).toBeLessThan(context.indexOf('F = m a'));
    expect(context).toContain('物理量 | 單位');
    expect(context).toContain('a = \\frac{F}{m}');
    expect(context).toContain('1N, 2N | 加速度');
    expect(context).toContain('實驗裝置示意圖');
    expect(context).toContain('當質量固定時，加速度與外力成正比。');
  });

  it('extracts quiz questions and options and pbl milestones', () => {
    const quizContext = extractSceneContext({
      title: '隨堂測驗',
      content: {
        type: 'quiz',
        questions: [
          {
            question: '下列何者正確？',
            options: [
              { value: 'A', label: '速度不變' },
              { value: 'B', label: '加速度與淨力同向' },
            ],
          },
        ],
      },
    });
    expect(quizContext).toContain('下列何者正確？');
    expect(quizContext).toContain('B. 加速度與淨力同向');

    const pblContext = extractSceneContext({
      title: '專題',
      content: {
        type: 'pbl',
        projectV2: {
          title: '設計緩衝裝置',
          description: '減少撞擊力',
          milestones: [{ title: '原型測試', description: '記錄加速度峰值' }],
        },
      },
    });
    expect(pblContext).toContain('設計緩衝裝置');
    expect(pblContext).toContain('原型測試: 記錄加速度峰值');
  });

  it('caps context at 6000 chars without splitting a UTF-16 surrogate pair', () => {
    const prefix = 'a'.repeat(CONTEXT_LIMIT - 1);
    const capped = capContextText(`${prefix}😀tail`);
    expect(capped.length).toBe(CONTEXT_LIMIT - 1);
    expect(capped).toBe(prefix);

    const longScene = extractSceneContext({
      title: '長頁面',
      content: {
        type: 'slide',
        canvas: { elements: [{ type: 'text', top: 0, left: 0, content: `<p>${'字'.repeat(8000)}</p>` }] },
      },
    });
    expect(longScene.length).toBe(CONTEXT_LIMIT);
  });
});
