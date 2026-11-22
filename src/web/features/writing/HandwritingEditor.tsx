import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type MouseEvent } from "react";
import { useReducedMotion } from "motion/react";
import { WRITING_MAX_LENGTH, type WritingLanguage } from "../../../shared/writing-practice";

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const INK_MS = 260;

export const blockTransfer = (event: ClipboardEvent | DragEvent | MouseEvent) => event.preventDefault();
const blockedInput = (type: string) => ["insertFromPaste", "insertFromPasteAsQuotation", "insertFromDrop", "deleteByCut", "deleteByDrag"].includes(type);

interface Arrival { id: number; start: number; end: number; until: number }
interface Erasure { id: number; text: string; x: number; y: number; width: number; height: number; until: number }

function changedRange(previous: string, next: string) {
  let start = 0;
  while (start < Math.min(previous.length, next.length) && previous[start] === next[start]) start++;
  // Keep surrogate pairs together when two characters share the same high surrogate.
  const code = previous.charCodeAt(start - 1);
  if (code >= 0xd800 && code <= 0xdbff) start--;
  let end = previous.length;
  let nextEnd = next.length;
  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) {
    end--;
    nextEnd--;
  }
  return { start, end, added: next.slice(start, nextEnd) };
}

function textRange(root: HTMLElement, start: number, length: number) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let at = 0, started = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const end = at + (node.textContent?.length ?? 0);
    if (!started && start < end) {
      range.setStart(node, start - at);
      started = true;
    }
    if (started && start + length <= end) {
      range.setEnd(node, start + length - at);
      return range;
    }
    at = end;
  }
  return null;
}

export function HandwritingEditor({ id, value, onChange, language, describedBy, disabled, allowTransfer = false, autoFocus = false }: {
  id: string;
  value: string;
  onChange: (text: string) => void;
  language: WritingLanguage;
  describedBy?: string;
  disabled: boolean;
  allowTransfer?: boolean;
  autoFocus?: boolean;
}) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const last = useRef(value);
  const composing = useRef(false);
  const serial = useRef(0);
  const [nativeComposition, setNativeComposition] = useState(false);
  const [arrivals, setArrivals] = useState<Arrival[]>([]);
  const [erasures, setErasures] = useState<Erasure[]>([]);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!arrivals.length && !erasures.length) return;
    const timer = window.setTimeout(() => { setArrivals([]); setErasures([]); }, INK_MS);
    return () => clearTimeout(timer);
  }, [arrivals, erasures]);

  function syncScroll() {
    if (mirror.current && textarea.current) mirror.current.scrollTop = textarea.current.scrollTop;
  }
  useLayoutEffect(syncScroll, [value, nativeComposition]);

  function commit(next: string, edit = changedRange(last.current, next), animate = true) {
    const previous = last.current;
    if (previous === next) return;
    const { start, end, added } = edit;
    if (!reduce && animate) {
      const now = performance.now();
      if (stack.current && mirror.current && end > start) {
        const origin = stack.current.getBoundingClientRect();
        const ghosts: Erasure[] = [];
        for (const { segment, index } of segmenter.segment(previous.slice(start, end))) {
          if (ghosts.length >= 40) break;
          if (!segment.trim()) continue;
          const rect = textRange(mirror.current, start + index, segment.length)?.getBoundingClientRect();
          if (rect?.width && rect.height) ghosts.push({
            id: ++serial.current, text: segment, x: rect.left - origin.left, y: rect.top - origin.top,
            width: rect.width, height: rect.height, until: now + INK_MS,
          });
        }
        setErasures((items) => [...items.filter((item) => item.until > now), ...ghosts]);
      }

      const shift = start + added.length - end;
      const fresh: Arrival[] = [];
      for (const { segment, index } of segmenter.segment(added)) {
        if (fresh.length >= 40) break;
        if (segment.trim()) fresh.push({ id: ++serial.current, start: start + index, end: start + index + segment.length, until: now + INK_MS });
      }
      setArrivals((items) => [
        ...items.filter((item) => item.until > now && (item.end <= start || item.start >= end)).map((item) =>
          item.start < end ? item : { ...item, start: item.start + shift, end: item.end + shift }),
        ...fresh,
      ].sort((a, b) => a.start - b.start));
    } else {
      setArrivals([]);
      setErasures([]);
    }
    last.current = next;
    onChange(next);
  }

  const beforeInput = useEffectEvent((field: HTMLTextAreaElement, event: InputEvent) => {
    const type = event.inputType;
    if ((!allowTransfer && blockedInput(type)) || (language === "en" && type === "insertReplacementText")) {
      event.preventDefault();
      return;
    }
    if (allowTransfer || language === "zh" || !event.cancelable || event.isComposing || composing.current) return;
    const previous = field.value;
    let start = field.selectionStart, end = field.selectionEnd;
    let added = "";
    if (type === "insertText" && event.data !== null) added = event.data;
    else if (type === "insertLineBreak" || type === "insertParagraph") added = "\n";
    else if (type === "deleteContentBackward" || type === "deleteContentForward") {
      if (start === end && type === "deleteContentBackward" && start > 0) {
        start = segmenter.segment(previous).containing(start - 1)?.index ?? start - 1;
      } else if (start === end && type === "deleteContentForward" && end < previous.length) {
        const segment = segmenter.segment(previous).containing(end);
        end = segment ? segment.index + segment.segment.length : end + 1;
      }
    } else return;

    event.preventDefault();
    if (previous.length - (end - start) + added.length > WRITING_MAX_LENGTH) return;
    const caretAtEnd = end === previous.length;
    field.setRangeText(added, start, end, "end");
    if (caretAtEnd) field.scrollTop = field.scrollHeight;
    commit(field.value, { start, end, added });
  });

  useLayoutEffect(() => {
    const field = textarea.current;
    if (!field) return;
    const onBeforeInput = (event: InputEvent) => beforeInput(field, event);
    field.addEventListener("beforeinput", onBeforeInput);
    return () => field.removeEventListener("beforeinput", onBeforeInput);
  }, []);

  function onNativeChange(event: ChangeEvent<HTMLTextAreaElement>) {
    const inputType = (event.nativeEvent as InputEvent).inputType;
    if ((!allowTransfer && blockedInput(inputType)) || (language === "en" && inputType === "insertReplacementText")) {
      event.target.value = last.current;
      return;
    }
    if (composing.current) onChange(event.target.value);
    else commit(event.target.value, undefined, !blockedInput(inputType));
  }

  const paper: React.ReactNode[] = [];
  let from = 0;
  for (const { id: key, start, end } of arrivals) {
    paper.push(value.slice(from, start), <span key={key} className="writing-letter">{value.slice(start, end)}</span>);
    from = end;
  }
  paper.push(value.slice(from), "\u200b");

  const transfer = allowTransfer ? undefined : blockTransfer;
  return <div ref={stack} className="writing-input-stack writing-hand" data-composing={nativeComposition} lang={language === "zh" ? "zh-Hant" : "en"} onDragStart={transfer} onDrop={transfer}>
    <div ref={mirror} className="writing-paper writing-mirror" aria-hidden="true">{paper}</div>
    <textarea ref={textarea} id={id} className="writing-paper writing-capture" aria-describedby={describedBy}
      value={value} disabled={disabled} autoFocus={autoFocus} maxLength={WRITING_MAX_LENGTH} spellCheck={false}
      autoCorrect="off" autoCapitalize="off" autoComplete="off" onChange={onNativeChange} onScroll={syncScroll}
      onCopy={transfer} onCut={transfer} onPaste={transfer} onContextMenu={transfer}
      onCompositionStart={() => { composing.current = true; setNativeComposition(true); setArrivals([]); setErasures([]); }}
      onCompositionEnd={(event) => {
        composing.current = false;
        setNativeComposition(false);
        commit(event.currentTarget.value);
      }} />
    <div className="writing-erasures" aria-hidden="true">
      {erasures.map(({ id: key, text, x, y, width, height }) => <span key={key} className="writing-erasure" style={{ left: x, top: y, width, height }}>
        {text}
        <svg viewBox="0 0 100 32" preserveAspectRatio="none"><path pathLength={1} d="M1 22 L94 5 L7 28 L99 13 L16 30" /></svg>
      </span>)}
    </div>
  </div>;
}
