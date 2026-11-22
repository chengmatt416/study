// AI 範例 Prompt 產生器 + 回覆匯入
// 1. 填寫主題與選項 → 2. 複製 Prompt 到 ChatGPT / Claude / Gemini → 3. 貼回 AI 回覆 → 驗證後建立內容
import { useMemo, useState } from "react";
import { VisibilityPicker } from "../../components/VisibilityPicker";
import { useUser } from "../../lib/auth";
import type { Visibility } from "../../../shared/visibility";
import { useNavigate } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "motion/react";
import { ArrowSquareOut, CheckCircle, ClipboardText, Copy, Sparkle, WarningCircle } from "@phosphor-icons/react";
import { api, errorMessage } from "../../lib/api";
import { Button, inputCls, SubjectSelect, textareaCls, toast, useSubjects } from "../../components/ui";
import { Markdown } from "../../components/Markdown";
import { buildCardsPrompt, buildExamPrompt, buildNotePrompt, parseAiOutput, type CardsPromptOptions, type ExamPromptOptions } from "../../../shared/ai-prompts";
import { crossCheck, validateAnswers } from "../../../shared/exam";
import { stripFrontmatter } from "../../../shared/markdown";
import { parsePastedCards } from "../../../shared/notebooklm";

export type AiKind = "note" | "exam" | "cards";

const EXAM_TYPES: { id: ExamPromptOptions["types"][number]; label: string }[] = [
  { id: "single_choice", label: "單選" },
  { id: "multi_choice", label: "複選" },
  { id: "true_false", label: "是非" },
  { id: "tfng", label: "T/F/NG" },
  { id: "ynng", label: "Y/N/NG" },
  { id: "numeric", label: "數值計算" },
  { id: "fill_blank", label: "填空" },
  { id: "completion", label: "結構填空(表/圖/流程)" },
  { id: "expression", label: "代數式" },
  { id: "text", label: "簡答" },
  { id: "ordering", label: "排序" },
  { id: "matching", label: "配對" },
  { id: "evidence", label: "原文舉證" },
  { id: "multipart", label: "多小題大題" },
  { id: "open", label: "申論/證明" },
];

const CALCS = [
  { id: "scientific", label: "科學計算機" },
  { id: "graphing", label: "圖形計算機" },
  { id: "qalc", label: "進階計算機" },
  { id: "stats1", label: "單變數" },
  { id: "stats2", label: "雙變數" },
];

const AI_SITES = [
  { name: "ChatGPT", url: "https://chatgpt.com/" },
  { name: "Claude", url: "https://claude.ai/new" },
  { name: "Gemini", url: "https://gemini.google.com/app" },
];

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={clsx("rounded-xl px-3 py-1.5 text-xs font-medium transition", on ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "bg-ink-100 text-slate-600 hover:bg-ink-200 dark:bg-white/5 dark:text-slate-300")}>
      {children}
    </button>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="grid h-7 w-7 place-items-center rounded-full bg-ink-900 text-xs font-bold text-white dark:bg-white dark:text-ink-900">{n}</span>
        <h3 className="font-semibold">{title}</h3>
      </div>
      <div className="pl-0 md:pl-9">{children}</div>
    </section>
  );
}

export function PromptBuilder({ kind, deckId, onDone }: { kind: AiKind; deckId?: string; onDone?: () => void }) {
  const user = useUser();
  const [visibility, setVisibility] = useState<Visibility>(user.access?.features.shared_write === false ? "private" : "shared");
  const chosenVisibility = user.access?.features.shared_write === false ? "private" : visibility;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const subjects = useSubjects();
  const [subjectId, setSubjectId] = useState("");
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState("IB DP");
  // null: the user has not chosen. A paper is then in English; notes and flashcards are bilingual.
  const [language, setLanguage] = useState<"zh" | "en" | "bilingual" | null>(null);
  const [source, setSource] = useState("");
  const [count, setCount] = useState(kind === "cards" ? 30 : 10);
  const [minutes, setMinutes] = useState(40);
  const [difficulty, setDifficulty] = useState<ExamPromptOptions["difficulty"]>("standard");
  const [types, setTypes] = useState<ExamPromptOptions["types"]>(["single_choice", "numeric", "fill_blank", "multipart"]);
  const [calcs, setCalcs] = useState<string[]>(["scientific", "graphing"]);
  const [style, setStyle] = useState<CardsPromptOptions["style"]>("vocabulary");
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);

  const subjectName = subjects.data?.find((s) => s.id === subjectId)?.name.split(" ").pop() ?? "（科目）";
  const prompt = useMemo(() => {
    const base = { subject: subjectName, topic: topic || "（請填寫主題/章節）", level, source, language: language ?? (kind === "exam" ? undefined : "bilingual") };
    if (kind === "note") return buildNotePrompt(base);
    if (kind === "exam") return buildExamPrompt({ ...base, count, minutes, difficulty, types, calculators: calcs });
    return buildCardsPrompt({ ...base, count, style });
  }, [kind, subjectName, topic, level, language, source, count, minutes, difficulty, types, calcs, style]);

  const parsed = useMemo(() => (reply.trim() ? parseAiOutput(reply) : null), [reply]);
  const check = useMemo(() => {
    if (!parsed) return null;
    const errors: string[] = [];
    if (kind === "cards") {
      const cards = parsePastedCards(parsed.cards ?? reply);
      if (!cards.length) errors.push("沒有解析到卡片：請確認回覆含有 ===CARDS=== 區塊，或「正面 / === / 背面 / ---」格式");
      return { errors, cards };
    }
    if (!parsed.markdown) errors.push("找不到 ===MARKDOWN=== 區塊（或 ```markdown 圍欄）");
    if (kind === "exam") {
      if (parsed.jsonError) errors.push(parsed.jsonError);
      else if (!parsed.json) errors.push("找不到 ===JSON=== 答案區塊");
      else {
        const v = validateAnswers(parsed.json);
        if (!v.ok) errors.push(...v.errors);
        else if (parsed.markdown) errors.push(...crossCheck(parsed.markdown, v.value));
      }
    }
    return { errors, cards: [] };
  }, [parsed, kind, reply]);

  const titleOf = (md: string) => {
    const { data, body } = stripFrontmatter(md);
    return String(data.title ?? body.match(/^#\s+(.+)$/m)?.[1] ?? topic ?? "AI 生成內容").trim();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      toast("已複製 Prompt");
    } catch {
      toast("無法存取剪貼簿，請手動選取複製", "err");
    }
  };

  const create = async () => {
    if (!parsed || !check || check.errors.length) return;
    setBusy(true);
    try {
      if (kind === "cards") {
        const r = await api.post<{ deckId: string; added: number }>("/api/decks/import/commit", { ...(deckId ? {} : { visibility: chosenVisibility }), text: parsed.cards ?? reply, deck_id: deckId, title: topic || "AI 字卡", subject_id: subjectId || undefined });
        toast(`已匯入 ${r.added} 張卡片`);
        qc.invalidateQueries({ queryKey: ["decks"] });
        qc.invalidateQueries({ queryKey: ["deck"] });
        onDone?.();
        if (!deckId) navigate(`/decks/${r.deckId}`);
        return;
      }
      const md = parsed.markdown!;
      const doc = await api.post<{ slug: string }>("/api/documents", { kind, visibility: chosenVisibility, title: titleOf(md), subject_id: subjectId || undefined, body_md: md });
      if (kind === "exam") await api.post(`/api/exams/${encodeURIComponent(doc.slug)}/answers`, { answers: parsed.json, message: "AI 生成" });
      qc.invalidateQueries({ queryKey: ["documents"] });
      toast(kind === "exam" ? "已建立試卷（含答案）" : "已建立重點整理");
      onDone?.();
      navigate(kind === "exam" ? `/exams/${doc.slug}` : `/notes/${doc.slug}`);
    } catch (e) {
      toast(errorMessage(e), "err");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <Step n={1} title="設定內容">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-slate-500">
            科目
            <div className="mt-1">
              <SubjectSelect value={subjectId} onChange={setSubjectId} />
            </div>
          </label>
          <label className="text-xs text-slate-500">
            程度
            <select className={inputCls + " mt-1"} value={level} onChange={(e) => setLevel(e.target.value)}>
              {["IB DP", "IB DP HL", "IB DP SL", "IB MYP", "高中", "國中"].map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-slate-500 sm:col-span-2">
            主題 / 章節範圍
            <input className={inputCls + " mt-1"} placeholder="例：Chapter 1 Straight Lines；S1.2 Atomic structure" value={topic} onChange={(e) => setTopic(e.target.value)} />
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          語言
          {(
            [
              ["bilingual", "中英對照"],
              ["zh", "繁體中文"],
              ["en", "English"],
            ] as const
          ).map(([v, l]) => (
            <Chip key={v} on={language === v} onClick={() => setLanguage(v)}>
              {l}
            </Chip>
          ))}
          {language === null && <span className="text-slate-400">未選擇：考卷為英文，重點整理與字卡為中英對照</span>}
        </div>

        {kind === "exam" && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <label className="text-xs text-slate-500">
                題數
                <input type="number" min={1} max={50} className={inputCls + " mt-1"} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} />
              </label>
              <label className="text-xs text-slate-500">
                作答分鐘
                <input type="number" min={5} max={240} className={inputCls + " mt-1"} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 30)} />
              </label>
              <label className="col-span-2 text-xs text-slate-500 sm:col-span-1">
                難度
                <select className={inputCls + " mt-1"} value={difficulty} onChange={(e) => setDifficulty(e.target.value as ExamPromptOptions["difficulty"])}>
                  <option value="basic">基礎</option>
                  <option value="standard">標準（段考）</option>
                  <option value="challenging">進階（IB Paper 2）</option>
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              題型
              {EXAM_TYPES.map((t) => (
                <Chip key={t.id} on={types.includes(t.id)} onClick={() => setTypes((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))}>
                  {t.label}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
              可用工具
              {CALCS.map((c) => (
                <Chip key={c.id} on={calcs.includes(c.id)} onClick={() => setCalcs((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))}>
                  {c.label}
                </Chip>
              ))}
            </div>
          </div>
        )}

        {kind === "cards" && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-500">
              張數
              <input type="number" min={5} max={200} className={inputCls + " mt-1"} value={count} onChange={(e) => setCount(Number(e.target.value) || 10)} />
            </label>
            <label className="text-xs text-slate-500">
              風格
              <select className={inputCls + " mt-1"} value={style} onChange={(e) => setStyle(e.target.value as CardsPromptOptions["style"])}>
                <option value="vocabulary">英→中詞彙卡（複習時可對調）</option>
                <option value="term-definition">名詞＋定義</option>
                <option value="qa">觀念問答</option>
                <option value="formula">公式卡</option>
              </select>
            </label>
          </div>
        )}

        <label className="mt-4 block text-xs text-slate-500">
          參考資料（選填，強烈建議）：貼上課本段落、你的筆記或 NotebookLM 摘要，AI 只會根據這些內容出題，較不會出錯
          <textarea className={textareaCls + " mt-1 h-28 font-sans"} value={source} onChange={(e) => setSource(e.target.value)} placeholder="貼上教材內容…" />
        </label>
      </Step>

      <Step n={2} title="複製 Prompt 到 AI">
        <div className="relative">
          <textarea readOnly className={textareaCls + " h-56 text-xs leading-5"} value={prompt} onFocus={(e) => e.target.select()} />
          <Button size="sm" variant="primary" className="absolute top-3 right-3" onClick={copy}>
            <Copy size={16} /> 複製
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {AI_SITES.map((s) => (
            <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-ink-100 px-3 text-xs font-medium hover:bg-ink-200 dark:bg-white/5 dark:hover:bg-white/10">
              開啟 {s.name} <ArrowSquareOut size={14} />
            </a>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">建議使用較強的模型；數學題務必檢查答案。AI 生成內容匯入後仍可在編輯器修改。</p>
      </Step>

      <Step n={3} title="貼回 AI 的回覆">
        <textarea className={textareaCls + " h-44 text-xs"} value={reply} onChange={(e) => setReply(e.target.value)} placeholder={kind === "exam" ? "貼上包含 ===MARKDOWN=== 與 ===JSON=== 的完整回覆" : kind === "cards" ? "貼上包含 ===CARDS=== 的完整回覆" : "貼上包含 ===MARKDOWN=== 的完整回覆"} />
        <AnimatePresence>
          {check && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-3 space-y-3">
              {check.errors.length ? (
                <div className="flex gap-2 rounded-2xl bg-rose-50 p-3 text-xs whitespace-pre-wrap text-rose-800 dark:bg-rose-950/40 dark:text-rose-200">
                  <WarningCircle size={18} className="shrink-0" />
                  <div>
                    格式需要修正（可把以下訊息貼回給 AI 請它修正）：
                    {"\n• " + check.errors.join("\n• ")}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-2xl bg-emerald-50 p-3 text-xs text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                  <CheckCircle size={18} weight="fill" />
                  {kind === "cards" ? `解析到 ${check.cards.length} 張卡片` : kind === "exam" ? "題目與答案格式正確且一致" : "格式正確"}
                </div>
              )}
              {kind !== "cards" && parsed?.markdown && (
                <details className="rounded-2xl border border-black/5 p-3 dark:border-white/10">
                  <summary className="cursor-pointer text-xs font-semibold text-slate-500">
                    <ClipboardText size={14} className="mr-1 inline" />
                    預覽
                  </summary>
                  <div className="mt-3 max-h-96 overflow-auto">
                    <Markdown md={parsed.markdown} mode={kind === "exam" ? "exam-review" : "note"} />
                  </div>
                </details>
              )}
              {kind === "cards" && check.cards.length > 0 && (
                <div className="max-h-48 space-y-1 overflow-auto rounded-2xl border border-black/5 p-3 text-xs dark:border-white/10">
                  {check.cards.slice(0, 30).map((c, i) => (
                    <div key={i} className="grid grid-cols-2 gap-2 border-b border-black/5 py-1 last:border-0 dark:border-white/5">
                      <span className="line-clamp-2">{c.front}</span>
                      <span className="line-clamp-2 text-slate-500">{c.back}</span>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        {!deckId && <div className="mt-4"><VisibilityPicker value={visibility} onChange={setVisibility} /></div>}
        <Button variant="primary" className="mt-4 w-full" size="lg" disabled={!check || check.errors.length > 0 || busy} onClick={create}>
          <Sparkle size={18} weight="fill" />
          {busy ? "建立中…" : kind === "exam" ? "建立試卷（含答案）" : kind === "cards" ? (deckId ? "匯入到此字卡組" : "建立字卡組") : "建立重點整理"}
        </Button>
      </Step>
    </div>
  );
}
