// 全站字型設定（存在這台裝置）：介面、標題、閱讀內文（重點整理、電子書文字、AI 卡片）、程式碼，
// 設定以 CSS 變數套用（--font-sans／--font-display／--font-mono／--font-reading），
// 所以 App 裡每個用到這些變數的地方都會跟著換。
import { useSyncExternalStore } from "react";
import { cssFontStack, linkCatalogFont, loadUserFonts } from "./loader";
import { findCatalogFont } from "./catalog";

export interface FontPrefs {
  /** 介面文字 */
  ui: string | null;
  /** 標題 */
  display: string | null;
  /** 閱讀內文 */
  reading: string | null;
  /** 程式碼、等寬 */
  mono: string | null;
}

export const FONT_PREF_LABELS: Record<keyof FontPrefs, { label: string; hint: string; category: "sans" | "serif" | "mono" | "display" | "handwriting" }> = {
  ui: { label: "介面文字", hint: "選單、按鈕、清單", category: "sans" },
  display: { label: "標題", hint: "頁面與章節標題", category: "serif" },
  reading: { label: "閱讀內文", hint: "重點整理、AI 回答、文件內容", category: "sans" },
  mono: { label: "程式碼", hint: "程式碼與等寬文字", category: "mono" },
};

const KEY = "study-font-prefs-v1";
const EMPTY: FontPrefs = { ui: null, display: null, reading: null, mono: null };

/** 原本的字型（styles.css 的 @theme），選「預設」時還原 */
const DEFAULT_STACKS = {
  "--font-sans": '"Geist", "Inter", "Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif',
  "--font-display": '"Fraunces", "Noto Serif TC", "Songti TC", serif',
  "--font-mono": '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
};

let current: FontPrefs = read();
const subs = new Set<() => void>();

function read(): FontPrefs {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<FontPrefs>;
    const clean = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 120) : null);
    return { ui: clean(parsed.ui), display: clean(parsed.display), reading: clean(parsed.reading), mono: clean(parsed.mono) };
  } catch {
    return { ...EMPTY };
  }
}

export function getFontPrefs(): FontPrefs {
  return current;
}

export function setFontPref(key: keyof FontPrefs, family: string | null): void {
  current = { ...current, [key]: family };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* 私密瀏覽 */
  }
  applyFontPrefs();
  subs.forEach((fn) => fn());
}

export function useFontPrefs(): FontPrefs {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    getFontPrefs,
    getFontPrefs,
  );
}

/** 套用到 :root 的 CSS 變數；App 啟動時呼叫一次，之後每次改設定都會呼叫 */
export function applyFontPrefs(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement.style;
  const p = current;
  const needsUser = Object.values(p).some((v) => v && !findCatalogFont(v));
  if (needsUser) void loadUserFonts();
  for (const fam of Object.values(p)) if (fam) void linkCatalogFont(fam);
  root.setProperty("--font-sans", p.ui ? cssFontStack(p.ui, "sans") : DEFAULT_STACKS["--font-sans"]);
  root.setProperty("--font-display", p.display ? cssFontStack(p.display, "serif") : DEFAULT_STACKS["--font-display"]);
  root.setProperty("--font-mono", p.mono ? cssFontStack(p.mono, "mono") : DEFAULT_STACKS["--font-mono"]);
  if (p.reading) root.setProperty("--font-reading", cssFontStack(p.reading, "sans"));
  else root.removeProperty("--font-reading");
}
