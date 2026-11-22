// A system-level "I don't know" choice for diagnostic quizzes, so learners are not pushed into guessing.
// The chatbot writes ordinary questions; the player adds this choice to choice questions of pretest and
// checkpoint scenes (recognised by their titles). The value shows in the option badge, hence a single character.
import { parseTitle } from './course-map';

export const STUDY_UNSURE = '?';
export const UNSURE_LABEL = '我不會（不確定就選這個，別亂猜）';
type Choice = { label: string; value: string };
type Question = { type: string; options?: Choice[] };

/** Pretest and checkpoint scenes (先測／前測／診斷／檢核) offer it; ordinary in-class quizzes do not. */
export const sceneOffersUnsure = (title: string): boolean => parseTitle(title).role !== 'content';

/** Adds the choice to single and multiple choice questions. Grading still uses the original questions, where it is simply not an answer. */
export function withUnsure<T extends Question>(questions: T[]): T[] {
  return questions.map(question => (question.type === 'single' || question.type === 'multiple') && question.options?.length && !question.options.some(option => option.value === STUDY_UNSURE)
    ? { ...question, options: [...question.options, { label: UNSURE_LABEL, value: STUDY_UNSURE }] }
    : question);
}

export const answeredUnsure = (answer: string | string[] | undefined): boolean => (Array.isArray(answer) ? answer.includes(STUDY_UNSURE) : answer === STUDY_UNSURE);

/** In a multiple choice question "I don't know" excludes every other choice, and picking another choice drops it. */
export function toggleChoice(selected: string[], value: string): string[] {
  if (selected.includes(value)) return selected.filter(item => item !== value);
  return value === STUDY_UNSURE ? [STUDY_UNSURE] : [...selected.filter(item => item !== STUDY_UNSURE), value];
}
