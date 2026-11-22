// Markdown 編輯器：CodeMirror 6 + Yjs 即時協作（Durable Object 房間）+ LaTeX 工具列 + 即時預覽。
import { useEffect, useRef, useState } from "react";
import { ImageSquare } from "@phosphor-icons/react";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { yCollab, yUndoManagerKeymap } from "y-codemirror.next";
import { clsx } from "clsx";
import { api, errorMessage } from "../../lib/api";
import { toast } from "../../components/ui";

const COLORS = ["#0d9488", "#2563eb", "#db2777", "#ea580c", "#7c3aed", "#16a34a", "#ca8a04"];

export interface Peer {
  clientId: number;
  name: string;
  color: string;
}

interface Props {
  slug: string;
  userName: string;
  onChange: (text: string) => void;
  onPeers?: (peers: Peer[]) => void;
  onStatus?: (s: "connecting" | "connected" | "disconnected") => void;
  editorRef?: React.MutableRefObject<EditorView | null>;
  className?: string;
}

export function MdEditor({ slug, userName, onChange, onPeers, onStatus, editorRef, className }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const cb = useRef({ onChange, onPeers, onStatus });
  cb.current = { onChange, onPeers, onStatus };

  useEffect(() => {
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText("md");
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const provider = new WebsocketProvider(`${proto}://${location.host}/api/documents/${encodeURIComponent(slug)}`, "collab", ydoc, { maxBackoffTime: 5000 });
    const color = COLORS[Math.abs(hash(userName)) % COLORS.length];
    provider.awareness.setLocalStateField("user", { name: userName, color, colorLight: color + "33" });
    provider.on("status", (e: { status: "connecting" | "connected" | "disconnected" }) => cb.current.onStatus?.(e.status));
    const emitPeers = () => {
      const peers: Peer[] = [];
      provider.awareness.getStates().forEach((st, id) => {
        const u = (st as { user?: { name: string; color: string } }).user;
        if (u && id !== ydoc.clientID) peers.push({ clientId: id, name: u.name, color: u.color });
      });
      cb.current.onPeers?.(peers);
    };
    provider.awareness.on("change", emitPeers);
    const undoManager = new Y.UndoManager(ytext);
    const view = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: ytext.toString(),
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          bracketMatching(),
          highlightSelectionMatches(),
          syntaxHighlighting(defaultHighlightStyle),
          markdown(),
          EditorView.lineWrapping,
          placeholder("開始撰寫…（支援 Markdown 與 LaTeX：$x^2$、$$\\frac{a}{b}$$、$\\ce{H2O}$）"),
          keymap.of([...yUndoManagerKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          yCollab(ytext, provider.awareness, { undoManager }),
          EditorView.updateListener.of((u) => u.docChanged && cb.current.onChange(u.state.doc.toString())),
          EditorView.theme({
            "&": { height: "100%", fontSize: "14px" },
            ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.6" },
            ".cm-content": { paddingBottom: "40vh" },
          }),
        ],
      }),
    });
    if (editorRef) editorRef.current = view;
    // 首次同步完成後通知內容
    provider.once("sync", () => cb.current.onChange(ytext.toString()));
    return () => {
      provider.awareness.off("change", emitPeers);
      view.destroy();
      provider.destroy();
      ydoc.destroy();
      if (editorRef) editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  return <div ref={host} className={clsx("h-full overflow-hidden bg-white dark:bg-slate-900 dark:[&_.cm-gutters]:bg-slate-900 dark:[&_.cm-content]:text-slate-100", className)} />;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** 在游標處插入文字；包含 | 時游標停在 | 的位置，選取文字會放在 | 處 */
export function insertSnippet(view: EditorView | null, snippet: string) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const idx = snippet.indexOf("|");
  const text = idx >= 0 ? snippet.slice(0, idx) + selected + snippet.slice(idx + 1) : snippet;
  const cursor = idx >= 0 ? from + idx + selected.length : from + text.length;
  view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: cursor } });
  view.focus();
}

const SNIPPETS: { label: string; s: string; title: string }[] = [
  { label: "$x$", s: "$|$", title: "行內公式" },
  { label: "$$", s: "\n$$\n|\n$$\n", title: "獨立公式" },
  { label: "a/b", s: "\\frac{|}{}", title: "分數" },
  { label: "√", s: "\\sqrt{|}", title: "根號" },
  { label: "xⁿ", s: "^{|}", title: "上標" },
  { label: "xₙ", s: "_{|}", title: "下標" },
  { label: "π", s: "\\pi", title: "pi" },
  { label: "θ", s: "\\theta", title: "theta" },
  { label: "Δ", s: "\\Delta ", title: "Delta" },
  { label: "≤", s: "\\le ", title: "小於等於" },
  { label: "⟶", s: "\\rightarrow ", title: "箭頭" },
  { label: "⇌", s: "\\rightleftharpoons ", title: "可逆" },
  { label: "\\ce", s: "$\\ce{|}$", title: "化學式（mhchem）" },
  { label: "B", s: "**|**", title: "粗體" },
  { label: "重點框", s: "\n:::key[核心重點]\n|\n:::\n", title: "重點提示框" },
  { label: "陷阱", s: "\n:::warning[易錯陷阱]\n|\n:::\n", title: "警告框" },
  { label: "範例", s: "\n:::example[難題範例]\n|\n:::\n", title: "範例框" },
  { label: "解析", s: "\n:::solution\n|\n:::\n", title: "可折疊解析" },
  { label: "課本頁", s: "[課本 P|](book:書籍ID#頁碼)", title: "連到電子書頁面" },
];

const EXAM_SNIPPETS: { label: string; s: string; title: string }[] = [
  { label: "閱讀文章", s: "\n::::passage{#p1 title=\"Reading Passage\"}\n|\n::::\n", title: "閱讀理解文章（左側分欄顯示並自動標註段落 A/B/C）" },
  { label: "選擇題", s: "\n::::question{#q}\n|題幹\n\n:::choices\n- (A) \n- (B) \n- (C) \n- (D) \n:::\n::::\n", title: "選擇題" },
  { label: "T/F/NG", s: "\n::::question{#q passage=\"p1\"}\n|敘述句\n::::\n", title: "閱讀判斷題（True/False/Not Given 或 Yes/No/Not Given）" },
  { label: "填空題", s: "\n::::question{#q}\n|題幹 :blank{#a}\n::::\n", title: "填空題" },
  { label: "計算題", s: "\n::::question{#q}\n|題幹\n::::\n", title: "數值/簡答題" },
  { label: "多小題", s: "\n::::question{#q}\n|題幹\n:::part{#a}\n(a) \n:::\n:::part{#b}\n(b) \n:::\n::::\n", title: "含 (a)(b) 小題" },
  { label: "空格", s: ":blank{#|}", title: "填空格" },
];

export function SnippetBar({ getView, exam, onImage }: { getView: () => EditorView | null; exam?: boolean; onImage: () => void }) {
  return (
    <div className="no-scrollbar flex shrink-0 gap-0.5 overflow-x-auto border-b border-slate-200/80 bg-slate-50/80 px-2 py-1 dark:border-white/10 dark:bg-white/5">
      {[...(exam ? EXAM_SNIPPETS : []), ...SNIPPETS].map((x) => (
        <button key={x.label + x.s} title={x.title} onMouseDown={(e) => e.preventDefault()} onClick={() => insertSnippet(getView(), x.s)} className="h-8 shrink-0 rounded-lg px-2 font-mono text-xs text-slate-600 transition hover:bg-white hover:text-brand-700 hover:shadow-sm dark:text-slate-300 dark:hover:bg-white/10">
          {x.label}
        </button>
      ))}
      <button title="插入圖片" onClick={onImage} className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg px-2 text-xs hover:bg-white dark:hover:bg-white/10">
        <ImageSquare size={16} /> 圖片
      </button>
    </div>
  );
}

export function useImageUpload(view: () => EditorView | null) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const el = document.createElement("input");
    el.type = "file";
    el.accept = "image/*";
    el.onchange = async () => {
      const f = el.files?.[0];
      el.value = "";
      if (!f) return;
      setBusy(true);
      try {
        const r = await api.post<{ url: string }>("/api/assets", f, { headers: { "content-type": f.type } });
        insertSnippet(view(), `![${f.name.replace(/\.[^.]+$/, "")}](${r.url})`);
      } catch (e) {
        toast(errorMessage(e), "err");
      } finally {
        setBusy(false);
      }
    };
    input.current = el;
  }, [view]);
  return { pick: () => input.current?.click(), busy };
}
