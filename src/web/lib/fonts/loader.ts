// 字型載入：內建字型庫（Google Fonts，用到才下載）與使用者自己上傳的字型（只存在這台裝置）。
import { idb } from "../idb";
import { fallbackStack, findCatalogFont, normalizeFamily, type FontEntry } from "./catalog";

const GOOGLE_CSS = "https://fonts.googleapis.com/css2";

/** Google Fonts CSS2 網址（可變字型用範圍、其他列出字重；text 只下載這些字，用於預覽） */
export function googleFontCssUrl(entry: Pick<FontEntry, "family" | "weights" | "variable">, opts: { text?: string; keepAxis?: boolean } = {}): string {
  const fam = entry.family.replace(/ /g, "+");
  let axis = "";
  if (!opts.text || opts.keepAxis) {
    if (entry.variable) axis = `:wght@${entry.variable[0]}..${entry.variable[1]}`;
    else if (entry.weights.length > 1 || entry.weights[0] !== 400) axis = `:wght@${[...entry.weights].sort((a, b) => a - b).join(";")}`;
  }
  const text = opts.text ? `&text=${encodeURIComponent(uniqueChars(opts.text))}` : "";
  return `${GOOGLE_CSS}?family=${fam}${axis}&display=swap${text}`;
}

function uniqueChars(s: string): string {
  return [...new Set([...s])].join("");
}

// ---------- 內建字型庫 ----------

const linked = new Map<string, Promise<void>>();

function injectStylesheet(href: string): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const existing = document.querySelector<HTMLLinkElement>(`link[data-study-font="${CSS.escape(href)}"]`);
  if (existing) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.crossOrigin = "anonymous";
    link.dataset.studyFont = href;
    link.onload = () => resolve();
    link.onerror = () => resolve();
    document.head.appendChild(link);
  });
}

/** 把字型庫裡的字型加入頁面（只加 @font-face 定義；實際檔案等用到的字出現時才下載） */
export function linkCatalogFont(family: string): Promise<void> {
  const entry = findCatalogFont(family);
  if (!entry) return Promise.resolve();
  let p = linked.get(entry.family);
  if (!p) {
    p = injectStylesheet(googleFontCssUrl(entry));
    linked.set(entry.family, p);
  }
  return p;
}

const previewLinked = new Set<string>();
/** 字型選單的預覽：只下載預覽文字用到的字（中文字型完整檔很大） */
export function linkFontPreview(family: string, text: string): void {
  const entry = findCatalogFont(family);
  if (!entry || linked.has(entry.family)) return;
  const href = googleFontCssUrl(entry, { text });
  if (previewLinked.has(href)) return;
  previewLinked.add(href);
  void injectStylesheet(href);
}

/** CSS font-family：選定的字型 + 依類別的備用字型 */
export function cssFontStack(family: string | null | undefined, fallbackCategory?: FontEntry["category"]): string {
  if (!family) return fallbackStack(fallbackCategory);
  const fam = normalizeFamily(family);
  const entry = findCatalogFont(fam);
  const first = `"${fam.replace(/"/g, "")}"`;
  const rest = fallbackStack(entry?.category ?? fallbackCategory)
    .split(", ")
    .filter((f) => f !== first);
  return [first, ...rest].join(", ");
}

// ---------- 使用者上傳的字型（只存在這台裝置，不上傳伺服器） ----------

export interface UserFont {
  family: string;
  fileName: string;
  size: number;
  addedAt: number;
}

interface StoredUserFont extends UserFont {
  data: ArrayBuffer;
}

const USER_FONTS_KEY = "user-fonts-v1";
let userFontsLoad: Promise<UserFont[]> | null = null;
let userFontsCache: UserFont[] = [];
const userFontSubs = new Set<() => void>();

/** 讀出這台裝置上的使用者字型並加入頁面（只做一次） */
export function loadUserFonts(): Promise<UserFont[]> {
  if (!userFontsLoad) {
    userFontsLoad = (async () => {
      const stored = (await idb.get<StoredUserFont[]>(USER_FONTS_KEY)) ?? [];
      for (const f of stored) await registerFontFace(f.family, f.data);
      userFontsCache = stored.map(({ data: _data, ...meta }) => meta);
      return userFontsCache;
    })().catch(() => []);
  }
  return userFontsLoad;
}

export function userFonts(): UserFont[] {
  return userFontsCache;
}

export function subscribeUserFonts(fn: () => void): () => void {
  userFontSubs.add(fn);
  return () => userFontSubs.delete(fn);
}

async function registerFontFace(family: string, data: ArrayBuffer): Promise<void> {
  if (typeof FontFace === "undefined" || typeof document === "undefined") return;
  const face = new FontFace(family, data.slice(0));
  await face.load();
  document.fonts.add(face);
}

const FONT_EXT = /\.(ttf|otf|woff2?|ttc)$/i;
export const USER_FONT_ACCEPT = ".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2";
const MAX_USER_FONT = 40 * 1024 * 1024;

/**
 * 加入一個字型檔（TTF／OTF／WOFF／WOFF2）。名稱優先讀字型檔內的家族名稱，讀不到用檔名。
 * family 可指定（例如替換匯入文件的缺字型時，直接以文件裡的名稱註冊）。
 */
export async function addUserFont(file: File, opts: { family?: string } = {}): Promise<UserFont> {
  if (!FONT_EXT.test(file.name)) throw new Error("請選擇 TTF、OTF、WOFF 或 WOFF2 字型檔");
  if (file.size > MAX_USER_FONT) throw new Error("字型檔超過 40 MB");
  const data = await file.arrayBuffer();
  const family = normalizeFamily(opts.family || readSfntFamilyName(data) || file.name.replace(FONT_EXT, ""));
  try {
    await registerFontFace(family, data);
  } catch {
    throw new Error("這個檔案不是瀏覽器能使用的字型");
  }
  const meta: UserFont = { family, fileName: file.name, size: file.size, addedAt: Date.now() };
  await idb.update<StoredUserFont[]>(USER_FONTS_KEY, (cur) => [...(cur ?? []).filter((f) => f.family !== family), { ...meta, data }]);
  userFontsCache = [...userFontsCache.filter((f) => f.family !== family), meta];
  userFontSubs.forEach((fn) => fn());
  return meta;
}

export async function removeUserFont(family: string): Promise<void> {
  await idb.update<StoredUserFont[]>(USER_FONTS_KEY, (cur) => (cur ?? []).filter((f) => f.family !== family));
  userFontsCache = userFontsCache.filter((f) => f.family !== family);
  if (typeof document !== "undefined") for (const face of [...document.fonts]) if (face.family.replace(/"/g, "") === family) document.fonts.delete(face);
  userFontSubs.forEach((fn) => fn());
}

/** 從 TTF／OTF 的 name 表讀家族名稱（nameID 16 優先，其次 1；中文名稱優先）。WOFF 壓縮過，讀不到回傳 null。 */
export function readSfntFamilyName(buf: ArrayBuffer): string | null {
  try {
    const dv = new DataView(buf);
    const tag = dv.getUint32(0);
    // 0x00010000（TrueType）、'OTTO'（CFF）、'true'
    if (tag !== 0x00010000 && tag !== 0x4f54544f && tag !== 0x74727565) return null;
    const numTables = dv.getUint16(4);
    let nameOffset = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (dv.getUint32(rec) === 0x6e616d65) nameOffset = dv.getUint32(rec + 8);
    }
    if (nameOffset < 0) return null;
    const count = dv.getUint16(nameOffset + 2);
    const strOffset = nameOffset + dv.getUint16(nameOffset + 4);
    const found: { id: number; lang: number; text: string }[] = [];
    for (let i = 0; i < count; i++) {
      const r = nameOffset + 6 + i * 12;
      const platform = dv.getUint16(r);
      const lang = dv.getUint16(r + 4);
      const id = dv.getUint16(r + 6);
      const len = dv.getUint16(r + 8);
      const off = dv.getUint16(r + 10);
      if (id !== 1 && id !== 16) continue;
      const bytes = new Uint8Array(buf, strOffset + off, len);
      let text = "";
      if (platform === 3 || platform === 0) {
        for (let j = 0; j + 1 < bytes.length; j += 2) text += String.fromCharCode((bytes[j] << 8) | bytes[j + 1]);
      } else if (platform === 1) {
        text = String.fromCharCode(...bytes);
      } else continue;
      if (text.trim()) found.push({ id, lang, text: text.trim() });
    }
    if (!found.length) return null;
    // 0x0404 繁中（台灣）、0x0C04 香港、0x0804 簡中、0x0409 英文
    const rank = (x: { id: number; lang: number }) => (x.id === 16 ? 0 : 10) + ([0x0404, 0x0c04, 0x0409, 0x0804].indexOf(x.lang) + 1 || 5);
    found.sort((a, b) => rank(a) - rank(b));
    return found[0].text;
  } catch {
    return null;
  }
}

// ---------- 這台裝置裝了哪些字型 ----------

let measureCanvas: CanvasRenderingContext2D | null = null;
const BASES = ["monospace", "serif", "sans-serif"] as const;
const PROBE = "mmmmmmmmmmlli 永字八法 ÅBCxyz 0123";
const localCache = new Map<string, boolean>();

/** 用量字寬的方法判斷系統是否裝了這個字型（瀏覽器的隱私保護可能讓部分系統字型看起來沒裝） */
export function isFontInstalledLocally(family: string): boolean {
  const fam = normalizeFamily(family);
  const hit = localCache.get(fam);
  if (hit !== undefined) return hit;
  if (typeof document === "undefined") return false;
  if (!measureCanvas) measureCanvas = document.createElement("canvas").getContext("2d");
  const ctx = measureCanvas;
  if (!ctx) return false;
  let installed = false;
  for (const base of BASES) {
    ctx.font = `72px ${base}`;
    const w0 = ctx.measureText(PROBE).width;
    ctx.font = `72px "${fam.replace(/"/g, "")}", ${base}`;
    const w1 = ctx.measureText(PROBE).width;
    if (Math.abs(w1 - w0) > 0.5) {
      installed = true;
      break;
    }
  }
  localCache.set(fam, installed);
  return installed;
}

export type FontAvailability = "library" | "user" | "local" | "generic" | "missing";

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "math", "emoji", "inherit", "initial"]);

/** 某個字型能不能用：字型庫有、使用者上傳過、系統有、通用名稱，或缺少 */
export function fontAvailability(family: string): FontAvailability {
  const fam = normalizeFamily(family);
  if (!fam) return "generic";
  if (GENERIC.has(fam.toLowerCase())) return "generic";
  if (findCatalogFont(fam)) return "library";
  if (userFontsCache.some((f) => f.family.toLowerCase() === fam.toLowerCase())) return "user";
  return isFontInstalledLocally(fam) ? "local" : "missing";
}
