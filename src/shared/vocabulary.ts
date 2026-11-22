// Flashcards are English → Chinese vocabulary chosen from the chapter. Before writing cards the chatbot assesses which terms
// matter for this chapter (vocabulary plan); the server checks the cards against that plan. The learner flips a deck in the
// review screen (正反面對調), so a reversed Chinese → English copy of a card is a duplicate and is refused.
import { z } from "zod";

export const VOCABULARY_SCHEMA = "vocabulary-plan/v1";
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
export const vocabularyPlanSchema = z.object({
  schema: z.literal(VOCABULARY_SCHEMA),
  chapter: text(1, 200).describe("章節名稱或範圍"),
  sources: z.array(z.object({ title: text(1, 200), where: text(1, 200).describe("讀過的頁碼、投影片或段落") })).min(1).max(20),
  terms: z.array(z.object({
    term: text(1, 120).describe("英文詞彙（卡片正面）"),
    zh: text(1, 200).describe("中文名稱（卡片背面開頭）"),
    importance: z.enum(["core", "supporting"]).describe("core：本章必考／必會；supporting：理解 core 需要的輔助詞"),
    reason: text(8, 300).describe("為什麼這個詞對本章重要（例如出現在大綱目標、mark scheme 關鍵字、常見混淆）"),
    syllabus_ref: text(1, 80).optional(),
  })).min(5).max(300),
});
export type VocabularyPlan = z.infer<typeof vocabularyPlanSchema>;
export interface VocabularyCard { front: string; back: string }

const CJK = /[㐀-鿿豈-﫿]/;
const LATIN = /[A-Za-z]/;
/** The visible words of a side: no Markdown emphasis, LaTeX delimiters or case differences. */
export const normalizeTerm = (value: string) => value.replace(/\$+|\\\(|\\\)|[*_`#>~]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export function vocabularyProblems(cards: VocabularyCard[], plan?: VocabularyPlan | null, existing: VocabularyCard[] = []): string[] {
  const errors: string[] = [];
  const fronts = new Map<string, number>();
  const all = [...existing, ...cards];
  const backs = new Set(all.map((card) => normalizeTerm(card.back.split("\n")[0] ?? "")));
  const existingFronts = new Set(existing.map((card) => normalizeTerm(card.front)));
  cards.forEach((card, index) => {
    const at = `cards[${index}]「${card.front.slice(0, 40)}」`;
    const front = normalizeTerm(card.front);
    if (CJK.test(card.front) || !LATIN.test(card.front)) errors.push(`${at}：正面必須是英文詞彙（只做英→中；要中→英請在複習時用「正反面對調」，不要另做反向卡）`);
    if (!CJK.test(card.back)) errors.push(`${at}：背面必須有中文名稱`);
    if (fronts.has(front) || existingFronts.has(front)) errors.push(`${at}：與其他卡片正面重複`);
    fronts.set(front, index);
    if (backs.has(front)) errors.push(`${at}：是另一張卡片的反向重複`);
  });
  if (plan) {
    const terms = new Map(plan.terms.map((term) => [normalizeTerm(term.term), term]));
    cards.forEach((card, index) => { if (!terms.has(normalizeTerm(card.front))) errors.push(`cards[${index}]「${card.front.slice(0, 40)}」不在 vocabulary_plan.terms 裡：先評估它的重要性並列入，或刪掉這張卡`); });
    const made = new Set([...existing, ...cards].map((card) => normalizeTerm(card.front)));
    for (const term of plan.terms) if (term.importance === "core" && !made.has(normalizeTerm(term.term))) errors.push(`core 詞彙「${term.term}」沒有卡片`);
    const seen = new Set<string>();
    for (const term of plan.terms) { const key = normalizeTerm(term.term); if (seen.has(key)) errors.push(`vocabulary_plan 重複列出「${term.term}」`); seen.add(key); }
  }
  return errors;
}

export const VOCABULARY_GUIDE = `## 字卡：先評估重要詞彙，只做英→中（強制）
1. 讀章節的重點整理、上傳教材（get_chapter_material）與適用的 IB syllabus／guideline／mark scheme。
2. 寫 vocabulary_plan（schema "${VOCABULARY_SCHEMA}"）：列出本章重要詞彙，每個詞註明 importance（core 必考必會／supporting 輔助）、為什麼重要（大綱目標、mark scheme 關鍵字、常見混淆）與 syllabus_ref。不要收錄日常字或與本章無關的詞。
3. 每個詞做一張卡：正面只放英文詞彙，背面第一行是中文名稱，之後可加一句中文定義、單位或易混淆的詞。
4. 只做英→中。不要另做中→英的反向卡：學生在複習畫面用「正反面對調」就能反向練習，反向卡會被拒絕。
5. create_deck 附 vocabulary_plan 與 chapter_id；伺服器檢查每張卡都在計畫裡、core 詞彙都有卡、正反面方向正確且沒有重複。`;
