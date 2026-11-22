import { describe, expect, it } from 'vitest';
import { findSlideQuestions, questionReasons, slideQuestionMessage } from '../src/shared/slide-questions';
import { CHAPTER_FLOW, MODULE_KIT_PROMPT, SLIDE_QUESTION_RULE } from '../src/shared/module-kit-guide';

const slide = (id: string, title: string, ...texts: string[]) => ({ id, type: 'slide', title, content: { type: 'slide', canvas: { elements: texts.map((content, i) => ({ id: id + i, type: 'text', content: `<p>${content}</p>` })) } } });

describe('questions do not belong in slides', () => {
  it('flags multiple choice, exercises, numbered questions and prompts to answer', () => {
    const scenes = [
      slide('s1', '牛頓第二定律', '合力等於質量乘以加速度，F = ma。'),
      slide('s2', '想一想', '下列何者正確？', '(A) 質量越大加速度越大', '(B) 合力為零時速度必為零', '(C) 加速度與合力同方向'),
      slide('s3', '練習題', '一物體質量 2 kg，受力 10 N，求加速度。'),
      slide('s4', '小試身手', 'Q1. 求合力'),
      slide('s5', '課堂提問', '請計算 3 + 4 是多少？'),
    ];
    const found = findSlideQuestions(scenes);
    expect(found.map(v => v.scene_id)).toEqual(['s2', 's3', 's4', 's5']);
    expect(found[0].reasons).toEqual(expect.arrayContaining(['有 (A)(B)(C) 選項']));
    expect(found[1].reasons).toContain('標示為練習題／測驗');
    expect(found[3].reasons).toContain('要學生作答的提問');
    expect(slideQuestionMessage(found)).toContain('先測');
    expect(slideQuestionMessage(found)).toContain('互動模組');
  });

  it('leaves teaching slides alone: definitions, worked examples with their answers, topic lists, and rhetorical headings', () => {
    expect(findSlideQuestions([
      slide('a', '定義', '加速度是速度對時間的變化率。'),
      slide('b', '例題', '一物體質量 2 kg，受力 10 N。解：a = F/m = 5 m/s²。'),
      slide('c', '本章內容', 'A. 力與運動', 'B. 動量', 'C. 能量'),
      slide('d', '為什麼天空是藍色的？', '因為瑞利散射使短波長的光更容易被散射。'),
    ])).toEqual([]);
  });

  it('leaves teaching about the exam and worked examples with their answers alone', () => {
    for (const text of ['計算題常見陷阱：單位要先換算', 'Paper 1 選擇題最常見的失分原因', '接下來進入檢核 quiz', 'See the exercises at the end of Rosen 1.3', 'Problem 1 完整解答：由歸納法假設可得…', '第 2 題的逐步解析：先化簡分母', '考試陷阱：是非題要注意 for all 與 exists', '計算題：先列式。解：a = F/m = 5 m/s²', '請計算 3 + 4 是多少？解：7'])
      expect(questionReasons([text]), text).toEqual([]);
  });

  it('a heading on its own line, a numbered question without an answer, and a blank to fill are still questions', () => {
    for (const text of ['練習題', '練習題 1：判斷下列敘述', 'Quiz: which unit fits', 'Exercise 3', '1. 計算題', 'Q1. 求合力', '第 3 題：求 x', '第 2 題的答案：____', '請計算 3 + 4 是多少？你的答案：'])
      expect(questionReasons([text]).length, text).toBeGreaterThan(0);
  });

  it('only looks at slides: quizzes and interactive scenes may carry questions', () => {
    expect(findSlideQuestions([{ id: 'q', type: 'quiz', title: '先測：力', content: { type: 'quiz' } }, { id: 'i', type: 'interactive', title: '力', content: { type: 'interactive' } }])).toEqual([]);
    expect(questionReasons([])).toEqual([]);
  });

  it('reads text inside shapes and tables too', () => {
    const scene = { id: 'x', type: 'slide', title: '表', content: { type: 'slide', canvas: { elements: [{ type: 'shape', text: { content: '<p>練習題：判斷下列敘述</p>' } }, { type: 'table', data: [[{ text: '請選出正確的一項？' }]] }] } } };
    expect(findSlideQuestions([scene])[0].reasons).toEqual(expect.arrayContaining(['標示為練習題／測驗', '要學生作答的提問']));
  });
});

describe('the chatbot is told where questions go', () => {
  it('states the rule strongly, names the three places and the way to check', () => {
    for (const part of ['強制', '絕對不可以把要學生作答的題目放進投影片', '先測：章名', '檢核：章名', '<sk-choice>', 'check_openmaic_slides', '違反的課程無法發布']) expect(SLIDE_QUESTION_RULE, part).toContain(part);
  });
  it('is part of the chapter flow the chatbot follows', () => {
    expect(CHAPTER_FLOW).toContain('投影片只講解');
    expect(MODULE_KIT_PROMPT.length).toBeLessThan(7200);
  });
});
