import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, Highlighter, Quotes, Trash, X } from "@phosphor-icons/react";
import { Markdown } from "../../components/Markdown";
import type { EvidenceResponse } from "../../../shared/exam";
import type { ExamPassage, ExamPassageBlock, PassageHighlight } from "../../../shared/exam-paper";

interface HighlightSpan {
  startOffset: number;
  endOffset: number;
  kind: "highlight" | "evidence";
}

interface PendingSelection {
  passageId: string;
  blockId: string;
  blockLetter: string;
  startOffset: number;
  endOffset: number;
  quote: string;
}

function getHighlightableTextNodes(root: Element): Text[] {
  const nodes: Text[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      if (parent.closest(".katex-mathml, .exam-passage-letter")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE && (current as Text).data.length > 0) {
      nodes.push(current as Text);
    }
    current = walker.nextNode();
  }
  return nodes;
}

function unwrapMarks(root: Element) {
  const marks = [...root.querySelectorAll("mark.exam-highlight-mark, mark.exam-evidence-mark")];
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
}

function applyMarksToBlock(root: Element, spans: HighlightSpan[]) {
  unwrapMarks(root);
  if (spans.length === 0) return;
  const sorted = [...spans].sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const textNodes = getHighlightableTextNodes(root);
  let cursor = 0;

  for (const textNode of textNodes) {
    const len = textNode.data.length;
    const nodeStart = cursor;
    const nodeEnd = cursor + len;
    cursor = nodeEnd;

    // 找出覆蓋這段文字節點的標記區間
    const overlapping = sorted.filter((s) => s.endOffset > nodeStart && s.startOffset < nodeEnd);
    if (overlapping.length === 0) continue;

    // 切成不重疊片段，若同時有 highlight 與 evidence 則優先以 evidence 樣式呈現
    const boundaries = new Set<number>([nodeStart, nodeEnd]);
    for (const s of overlapping) {
      boundaries.add(Math.max(nodeStart, s.startOffset));
      boundaries.add(Math.min(nodeEnd, s.endOffset));
    }
    const points = [...boundaries].sort((a, b) => a - b);
    const parent = textNode.parentNode;
    if (!parent) continue;
    const frag = root.ownerDocument.createDocumentFragment();
    for (let i = 0; i < points.length - 1; i++) {
      const segStart = points[i];
      const segEnd = points[i + 1];
      const slice = textNode.data.slice(segStart - nodeStart, segEnd - nodeStart);
      if (!slice) continue;
      const active = overlapping.filter((s) => s.startOffset <= segStart && s.endOffset >= segEnd);
      if (active.length === 0) {
        frag.appendChild(root.ownerDocument.createTextNode(slice));
      } else {
        const isEvidence = active.some((s) => s.kind === "evidence");
        const mark = root.ownerDocument.createElement("mark");
        mark.className = isEvidence ? "exam-evidence-mark" : "exam-highlight-mark";
        mark.textContent = slice;
        frag.appendChild(mark);
      }
    }
    parent.replaceChild(frag, textNode);
  }
}

function selectionFromRange(range: Range, passageId: string, container: HTMLElement): PendingSelection | null {
  const startEl = (range.startContainer instanceof Element ? range.startContainer : range.startContainer.parentElement)?.closest<HTMLElement>("[data-block-id]");
  const endEl = (range.endContainer instanceof Element ? range.endContainer : range.endContainer.parentElement)?.closest<HTMLElement>("[data-block-id]");
  if (!startEl || startEl !== endEl || !container.contains(startEl)) return null;
  const blockId = startEl.dataset.blockId;
  if (!blockId) return null;

  const textNodes = getHighlightableTextNodes(startEl);
  let cursor = 0;
  let startOffset = -1;
  let endOffset = -1;
  const pieces: string[] = [];

  for (const t of textNodes) {
    const len = t.data.length;
    const cStart = range.comparePoint(t, 0);
    const cEnd = range.comparePoint(t, len);
    if (cEnd >= 0 && cStart <= 0) {
      const localStart = range.startContainer === t ? range.startOffset : 0;
      const localEnd = range.endContainer === t ? range.endOffset : len;
      const s = Math.max(0, Math.min(len, localStart));
      const e = Math.max(s, Math.min(len, localEnd));
      if (e > s) {
        if (startOffset === -1) startOffset = cursor + s;
        endOffset = cursor + e;
        pieces.push(t.data.slice(s, e));
      }
    }
    cursor += len;
  }

  const quote = pieces.join("").trim() || range.toString().trim();
  if (startOffset < 0 || endOffset <= startOffset || !quote) return null;
  return {
    passageId,
    blockId,
    blockLetter: startEl.dataset.blockLetter ?? "",
    startOffset,
    endOffset,
    quote,
  };
}

const PassageBlockView = memo(function PassageBlockView({
  block,
  spans,
}: {
  block: ExamPassageBlock;
  spans: HighlightSpan[];
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    applyMarksToBlock(el, spans);
  }, [block.md, spans]);

  return (
    <div
      className="exam-passage-block"
      data-block-id={block.blockId}
      data-block-letter={block.letter || undefined}
      data-lettered={block.letter ? "true" : undefined}
      data-highlighted={spans.length > 0 ? "true" : undefined}
    >
      {block.letter && (
        <span className="exam-passage-letter" aria-hidden="true">
          {block.letter}
        </span>
      )}
      <div ref={hostRef}>
        <Markdown md={block.md} mode="exam" />
      </div>
    </div>
  );
});

export interface EvidenceTarget {
  label: string;
  onSelectEvidence: (ev: Extract<EvidenceResponse, { type: "SPAN" }>) => void;
}

export function PassagePane({
  passage,
  sharedStemMd,
  sharedStemTitle,
  highlights,
  activeEvidenceSpans,
  evidenceTarget,
  onAddHighlight,
  onRemoveHighlight,
  onClearHighlights,
  onBackToQuestion,
}: {
  passage: ExamPassage | null;
  sharedStemMd?: string | null;
  sharedStemTitle?: string | null;
  highlights: PassageHighlight[];
  activeEvidenceSpans: { blockId: string; startOffset?: number; endOffset?: number }[];
  evidenceTarget?: EvidenceTarget | null;
  onAddHighlight: (h: Omit<PassageHighlight, "id">) => void;
  onRemoveHighlight: (id: string) => void;
  onClearHighlights: (passageId: string) => void;
  onBackToQuestion?: () => void;
}) {
  const blocksRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<PendingSelection | null>(null);
  const [selectionHint, setSelectionHint] = useState("");
  const [justSaved, setJustSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!justSaved) return;
    const t = window.setTimeout(() => setJustSaved(null), 3500);
    return () => window.clearTimeout(t);
  }, [justSaved]);

  const checkSelection = useCallback(() => {
    const container = blocksRef.current;
    if (!container || !passage) return;
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) return;
    const parsed = selectionFromRange(range, passage.id, container);
    setJustSaved(null);
    setPending(parsed);
    setSelectionHint(parsed ? "" : "請一次選取同一段落內的文字。");
  }, [passage]);

  useEffect(() => {
    document.addEventListener("selectionchange", checkSelection);
    return () => document.removeEventListener("selectionchange", checkSelection);
  }, [checkSelection]);

  // 切換文章時清除殘留選取提示
  useEffect(() => {
    setPending(null);
    setSelectionHint("");
    setJustSaved(null);
  }, [passage?.id]);

  const passageHighlights = useMemo(
    () => (passage ? highlights.filter((h) => h.passageId === passage.id) : []),
    [highlights, passage],
  );

  const spansByBlock = useMemo(() => {
    const map = new Map<string, HighlightSpan[]>();
    for (const h of passageHighlights) {
      const list = map.get(h.blockId) ?? [];
      list.push({ startOffset: h.startOffset, endOffset: h.endOffset, kind: "highlight" });
      map.set(h.blockId, list);
    }
    for (const ev of activeEvidenceSpans) {
      if (ev.startOffset === undefined || ev.endOffset === undefined) continue;
      const list = map.get(ev.blockId) ?? [];
      list.push({ startOffset: ev.startOffset, endOffset: ev.endOffset, kind: "evidence" });
      map.set(ev.blockId, list);
    }
    return map;
  }, [passageHighlights, activeEvidenceSpans]);

  const handleHighlight = () => {
    if (!pending) return;
    onAddHighlight({
      passageId: pending.passageId,
      blockId: pending.blockId,
      startOffset: pending.startOffset,
      endOffset: pending.endOffset,
      quote: pending.quote,
    });
    window.getSelection()?.removeAllRanges();
    setPending(null);
    setSelectionHint("");
    setJustSaved("已加入螢光標記");
  };

  const handleUseEvidence = () => {
    if (!pending || !evidenceTarget) return;
    evidenceTarget.onSelectEvidence({
      type: "SPAN",
      passageId: pending.passageId,
      blockId: pending.blockId,
      startOffset: pending.startOffset,
      endOffset: pending.endOffset,
      quote: pending.quote,
    });
    window.getSelection()?.removeAllRanges();
    setPending(null);
    setSelectionHint("");
    setJustSaved("已引用為作答證據");
  };

  const showBar = Boolean(pending || selectionHint || justSaved);

  return (
    <div className="exam-passage-inner">
      {passage && (
        <article aria-label={passage.title}>
          <header className="exam-passage-header">
            <div>
              <p className="exam-passage-kicker">{passage.kind === "passage" ? "閱讀文章 · 選取文字可螢光標記" : "試題材料"}</p>
              <h2 className="exam-passage-title">{passage.title}</h2>
            </div>
            {passageHighlights.length > 0 && (
              <span className="exam-step-badge">
                <Highlighter size={13} /> {passageHighlights.length} 處標記
              </span>
            )}
          </header>

          <div className="exam-passage-blocks" ref={blocksRef}>
            {passage.blocks.map((block) => (
              <PassageBlockView key={block.blockId} block={block} spans={spansByBlock.get(block.blockId) ?? []} />
            ))}
          </div>

          {passageHighlights.length > 0 && (
            <div className="exam-highlights-panel">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">已標記重點</span>
                <button
                  type="button"
                  onClick={() => onClearHighlights(passage.id)}
                  className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600 dark:text-slate-400"
                >
                  <Trash size={13} /> 清除全部
                </button>
              </div>
              <div className="exam-highlights-list">
                {passageHighlights.map((h) => {
                  const block = passage.blocks.find((b) => b.blockId === h.blockId);
                  return (
                    <span key={h.id} className="exam-highlight-chip">
                      {block?.letter && <strong>{block.letter}</strong>}
                      <span title={h.quote}>{h.quote}</span>
                      <button
                        type="button"
                        aria-label={`移除標記：${h.quote}`}
                        onClick={() => onRemoveHighlight(h.id)}
                        className="rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/15"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </article>
      )}

      {sharedStemMd && sharedStemMd.trim() && (
        <section className={passage ? "exam-shared-stem-card" : undefined} aria-label={sharedStemTitle ?? "題幹材料"}>
          <p className="exam-passage-kicker">{sharedStemTitle ?? "大題題幹與資料"}</p>
          <div className="prose-md">
            <Markdown md={sharedStemMd} mode="exam" />
          </div>
        </section>
      )}

      {showBar && (
        <div
          className="exam-selection-bar"
          onPointerDown={(event) => event.preventDefault()}
          role="region"
          aria-label="文字選取操作"
        >
          <div className="exam-selection-text">
            {justSaved ? (
              <span className="inline-flex items-center gap-1.5 font-semibold">
                <Check size={16} weight="bold" />
                {justSaved}
              </span>
            ) : pending ? (
              <>
                <span className="exam-selection-label">
                  {pending.blockLetter ? `段落 ${pending.blockLetter}` : "已選取文字"}
                </span>
                <q>{pending.quote}</q>
              </>
            ) : (
              <span>{selectionHint}</span>
            )}
          </div>
          {pending && evidenceTarget && (
            <button type="button" className="exam-selection-btn" onClick={handleUseEvidence}>
              <Quotes size={15} weight="bold" />
              {evidenceTarget.label}
            </button>
          )}
          {pending && (
            <button
              type="button"
              className={evidenceTarget ? "exam-selection-btn is-secondary" : "exam-selection-btn"}
              onClick={handleHighlight}
            >
              <Highlighter size={15} weight="bold" />
              螢光標記
            </button>
          )}
          {justSaved && onBackToQuestion && (
            <button type="button" className="exam-selection-btn is-secondary md:hidden" onClick={onBackToQuestion}>
              <ArrowLeft size={14} /> 回到題目
            </button>
          )}
          <button
            type="button"
            aria-label="關閉選取列"
            className="exam-selection-dismiss"
            onClick={() => {
              setPending(null);
              setSelectionHint("");
              setJustSaved(null);
              window.getSelection()?.removeAllRanges();
            }}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
