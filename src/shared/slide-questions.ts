// Questions belong in 先測, 檢核 or an interactive module, never in a slide. This finds slides that carry an exercise,
// so a course that does is not published. Pure: it reads the scene list the Core stores for a classroom.
export interface SlideViolation { scene_id: string; title: string; reasons: string[]; excerpt: string }
interface SceneLike { id?: string; type?: string; title?: string; content?: { type?: string; canvas?: { elements?: ElementLike[] } } }
interface ElementLike { type?: string; content?: string; text?: { content?: string }; data?: { text?: string }[][]; lines?: unknown }

const plain = (html: string): string => html.replace(/<br\s*\/?>|<\/p>|<\/li>|<\/div>/gi, '\n').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[ \t]+/g, ' ').trim();

/** All the text a learner can read on a slide, one entry per element, in no particular order. */
export function slideTexts(scene: SceneLike): string[] {
  const elements = scene.content?.canvas?.elements ?? [];
  return elements.flatMap<string>(element => {
    if (element.type === 'text' && typeof element.content === 'string') return [plain(element.content)];
    if (element.type === 'shape' && typeof element.text?.content === 'string') return [plain(element.text.content)];
    if (element.type === 'table' && Array.isArray(element.data)) return [element.data.flat().map(cell => plain(String((cell as { text?: string }).text ?? ''))).join(' ')];
    return [];
  }).filter(Boolean);
}

// A label on its own or opening a line ("練習題", "練習題 1：判斷下列敘述", "Quiz:"). Prose that only mentions the word ("計算題常見陷阱", "Paper 1 選擇題的失分原因") teaches about the exam and stays.
const HEADING = /^\s*(?:[0-9一二三四五六七八九十]+\s*[、.．)）]\s*)?(?:練習題|習題|小測驗|隨堂測驗|隨堂練習|課堂練習|自我檢測|自我測驗|選擇題|是非題|填充題|計算題|簡答題|問答題|quiz|exercises?|practice\s+(?:questions?|problems?)|self[- ]?check)\s*[0-9一二三四五六七八九十]*\s*(?:$|[：:.．、)）])/im;
const NUMBERED = /(?:^|[\s>（(【\[])(?:Q\s*\d+\s*[.:：、)）]|Question\s*\d+|Problem\s*\d+|第\s*[0-9一二三四五六七八九十]+\s*題)/i;
const ASKS = /(請(?:你)?(?:選出|選擇|回答|作答|計算|判斷|填入|填寫|寫出|說明為什麼)|下列(?:何者|敘述|哪)|何者(?:正確|錯誤|為真)|是否正確|試回答|你的答案|which of the following|choose the (?:correct|best)|select the (?:correct|best))/i;
const OPTION = /(?:^|[\s>])[（(]?\s*([A-E])\s*[)）.、．:：]\s*\S/g;
// A worked example carries its answer on the slide, which the rule allows. A blank to fill in is still a question.
const SOLVED = /(解\s*[：:]|解答|詳解|解析|答案|正解|證明|\bsolution\b|\banswer\b|\bproof\b)/i;
const BLANK = /_{2,}|＿{2,}|[（(]\s*[）)]|你的答案/;
// A worked example may go step by step on a slide, but it must not stop and hand the computing to the learner, answer or not.
const SELF_WORK = /(試著?(?:算算|計算|算出|求出|推導|解解)看?|自己(?:先)?(?:算|試算|計算|求|解)|動手算|換你(?:算|計算|解|試試)|先別看答案|暫停.{0,6}(?:計算|算一算)|try (?:calculating|to calculate|to solve|it yourself)|work it out yourself|your turn to (?:calculate|solve))/i;

/** Why a block of slide text reads as an exercise for the learner to answer, or an empty list if it does not. */
export function questionReasons(texts: readonly string[]): string[] {
  const joined = texts.join('\n');
  const reasons: string[] = [];
  const letters = new Set<string>();
  for (const text of texts) for (const match of text.matchAll(OPTION)) letters.add(match[1].toUpperCase());
  for (const match of joined.matchAll(OPTION)) letters.add(match[1].toUpperCase());
  // A topic list labelled A. B. C. is not a question; options are, when something is being asked or left blank.
  const asking = /[？?]/.test(joined) || ASKS.test(joined) || /_{2,}|＿{2,}|[（(]\s*[）)]/.test(joined);
  if (letters.has('A') && letters.has('B') && letters.has('C') && asking) reasons.push('有 (A)(B)(C) 選項');
  const solved = SOLVED.test(joined) && !BLANK.test(joined);
  if (HEADING.test(joined) && !solved) reasons.push('標示為練習題／測驗');
  if (NUMBERED.test(joined) && !solved) reasons.push('有題號（Q1／第 1 題）');
  if (ASKS.test(joined) && /[？?]/.test(joined) && !solved) reasons.push('要學生作答的提問');
  if (SELF_WORK.test(joined)) reasons.push('要學生自行計算');
  return reasons;
}

/** Slides in a classroom that contain questions, with the reason and a short excerpt to quote back to the chatbot. */
export function findSlideQuestions(scenes: readonly SceneLike[]): SlideViolation[] {
  const found: SlideViolation[] = [];
  for (const scene of scenes) {
    if (scene.type !== 'slide' && scene.content?.type !== 'slide') continue;
    const texts = [...(scene.title ? [scene.title] : []), ...slideTexts(scene)];
    const reasons = questionReasons(texts);
    if (!reasons.length) continue;
    const hit = texts.find(text => HEADING.test(text) || NUMBERED.test(text) || ASKS.test(text) || SELF_WORK.test(text) || /[（(]\s*[A-E]\s*[)）]/.test(text)) ?? texts[0] ?? '';
    found.push({ scene_id: scene.id ?? '', title: scene.title ?? '', reasons, excerpt: hit.replace(/\s+/g, ' ').slice(0, 80) });
  }
  return found;
}

export const slideQuestionMessage = (violations: readonly SlideViolation[]): string =>
  `有 ${violations.length} 張投影片放了要學生作答的題目：${violations.slice(0, 6).map(v => `「${v.title || v.scene_id}」（${v.reasons.join('、')}）`).join('、')}。` +
  '題目只能放在「先測：章名」、「檢核：章名」測驗場景，或互動模組的 <sk-*> 題型裡，投影片只講解。請把這些題目移出投影片後重新生成。';
