// App 內建字型庫：全部來自 Google Fonts（SIL Open Font License 1.1、Apache 2.0 或 Ubuntu Font License），
// 可免費用於個人與商業用途、可嵌入文件與匯出檔案。字型檔不打包進 App，用到時才從 Google Fonts 下載
// （中日韓字型依實際用到的字分片下載），下載過的由 Service Worker 快取，離線也能用。
// 名稱都已用 Google Fonts CSS2 API 驗證存在（2026-11-15）。

export type FontCategory = "sans" | "serif" | "display" | "handwriting" | "mono";
export type FontScript = "tc" | "sc" | "jp" | "kr" | "latin";
export type FontLicense = "OFL-1.1" | "Apache-2.0" | "UFL-1.0";

export interface FontEntry {
  /** 字型名稱（CSS font-family，也是 Google Fonts 的名稱） */
  family: string;
  /** 顯示名稱（有中文名稱的用中文） */
  label: string;
  category: FontCategory;
  /** 支援的文字（第一個是主要用途） */
  scripts: FontScript[];
  license: FontLicense;
  /** 可用的字重（沒有列出的瀏覽器會合成粗體） */
  weights: number[];
  /** 可變字型的字重範圍（Google Fonts 用 a..b 一次下載） */
  variable?: [number, number];
}

const OFL: FontLicense = "OFL-1.1";
const APACHE: FontLicense = "Apache-2.0";
const UFL: FontLicense = "UFL-1.0";

const f = (
  family: string,
  label: string,
  category: FontCategory,
  scripts: FontScript[],
  weights: number[] = [400, 700],
  license: FontLicense = OFL,
  variable?: [number, number],
): FontEntry => ({ family, label, category, scripts, weights, license, ...(variable ? { variable } : {}) });

export const FONT_CATALOG: readonly FontEntry[] = [
  // ---------- 繁體中文 ----------
  f("Noto Sans TC", "思源黑體（繁）", "sans", ["tc", "latin"], [300, 400, 500, 700, 900], OFL, [100, 900]),
  f("Noto Serif TC", "思源宋體（繁）", "serif", ["tc", "latin"], [400, 600, 700, 900], OFL, [200, 900]),
  f("LXGW WenKai TC", "霞鶩文楷（繁）", "handwriting", ["tc", "latin"], [300, 400, 700]),
  f("LXGW WenKai Mono TC", "霞鶩文楷等寬（繁）", "mono", ["tc", "latin"], [300, 400, 700]),
  f("Chiron Hei HK", "昭源黑體", "sans", ["tc", "latin"], [400, 500, 700], OFL, [200, 900]),
  f("Chiron Sung HK", "昭源宋體", "serif", ["tc", "latin"], [400, 500, 700], OFL, [200, 900]),
  f("Cactus Classical Serif", "仙人掌明體", "serif", ["tc", "latin"], [400]),
  f("Iansui", "芫荽", "handwriting", ["tc", "latin"], [400]),
  f("Huninn", "粉圓", "sans", ["tc", "latin"], [400]),
  f("Bpmf Huninn", "粉圓注音", "sans", ["tc"], [400]),
  f("Bpmf Iansui", "芫荽注音", "handwriting", ["tc"], [400]),
  f("Bpmf Zihi Kai Std", "字咍注音楷書", "handwriting", ["tc"], [400]),
  f("Noto Sans HK", "思源黑體（港）", "sans", ["tc", "latin"], [300, 400, 500, 700, 900], OFL, [100, 900]),
  f("Noto Serif HK", "思源宋體（港）", "serif", ["tc", "latin"], [400, 600, 700, 900], OFL, [200, 900]),
  // ---------- 簡體中文 ----------
  f("Noto Sans SC", "思源黑體（簡）", "sans", ["sc", "latin"], [300, 400, 500, 700, 900], OFL, [100, 900]),
  f("Noto Serif SC", "思源宋體（簡）", "serif", ["sc", "latin"], [400, 600, 700, 900], OFL, [200, 900]),
  f("Ma Shan Zheng", "馬善政楷書", "handwriting", ["sc"], [400]),
  f("Zhi Mang Xing", "志莽行書", "handwriting", ["sc"], [400]),
  f("Liu Jian Mao Cao", "流江毛草", "handwriting", ["sc"], [400]),
  f("Long Cang", "龍藏體", "handwriting", ["sc"], [400]),
  f("ZCOOL XiaoWei", "站酷小薇", "serif", ["sc"], [400]),
  f("ZCOOL KuaiLe", "站酷快樂體", "display", ["sc"], [400]),
  f("ZCOOL QingKe HuangYou", "站酷慶科黃油體", "display", ["sc"], [400]),
  // ---------- 日文 ----------
  f("Noto Sans JP", "Noto Sans JP", "sans", ["jp", "latin"], [300, 400, 500, 700, 900], OFL, [100, 900]),
  f("Noto Serif JP", "Noto Serif JP", "serif", ["jp", "latin"], [400, 600, 700, 900], OFL, [200, 900]),
  f("M PLUS Rounded 1c", "M+ 圓體", "sans", ["jp", "latin"], [400, 500, 700]),
  f("M PLUS 1p", "M+ 1p", "sans", ["jp", "latin"], [400, 500, 700]),
  f("Zen Maru Gothic", "禪丸ゴシック", "sans", ["jp", "latin"], [400, 500, 700]),
  f("Zen Kaku Gothic New", "禪角ゴシック", "sans", ["jp", "latin"], [400, 500, 700]),
  f("Zen Old Mincho", "禪オールド明朝", "serif", ["jp", "latin"], [400, 700]),
  f("Zen Kurenaido", "禪紅藍", "handwriting", ["jp", "latin"], [400]),
  f("Kosugi Maru", "小杉丸", "sans", ["jp", "latin"], [400]),
  f("Sawarabi Mincho", "さわらび明朝", "serif", ["jp", "latin"], [400]),
  f("Sawarabi Gothic", "さわらびゴシック", "sans", ["jp", "latin"], [400]),
  f("Klee One", "Klee One（教科書體）", "handwriting", ["jp", "latin"], [400, 600]),
  f("Yomogi", "よもぎ", "handwriting", ["jp", "latin"], [400]),
  f("Kiwi Maru", "キウイ丸", "serif", ["jp", "latin"], [400, 500]),
  f("Shippori Mincho", "しっぽり明朝", "serif", ["jp", "latin"], [400, 500, 700]),
  f("BIZ UDPGothic", "BIZ UDP ゴシック", "sans", ["jp", "latin"], [400, 700]),
  f("BIZ UDPMincho", "BIZ UDP 明朝", "serif", ["jp", "latin"], [400, 700]),
  f("Dela Gothic One", "デラゴシック", "display", ["jp", "latin"], [400]),
  f("RocknRoll One", "ロックンロール", "display", ["jp", "latin"], [400]),
  f("Reggae One", "レゲエ", "display", ["jp", "latin"], [400]),
  f("Hina Mincho", "ひな明朝", "serif", ["jp", "latin"], [400]),
  f("Yusei Magic", "油性マジック", "handwriting", ["jp", "latin"], [400]),
  f("Hachi Maru Pop", "はちまるポップ", "handwriting", ["jp", "latin"], [400]),
  f("IBM Plex Sans JP", "IBM Plex Sans JP", "sans", ["jp", "latin"], [300, 400, 500, 700]),
  // ---------- 韓文 ----------
  f("Noto Sans KR", "Noto Sans KR", "sans", ["kr", "latin"], [300, 400, 500, 700, 900], OFL, [100, 900]),
  f("Noto Serif KR", "Noto Serif KR", "serif", ["kr", "latin"], [400, 600, 700, 900], OFL, [200, 900]),
  f("Nanum Gothic", "나눔고딕", "sans", ["kr", "latin"], [400, 700, 800]),
  f("Nanum Myeongjo", "나눔명조", "serif", ["kr", "latin"], [400, 700, 800]),
  f("Nanum Pen Script", "나눔손글씨 펜", "handwriting", ["kr", "latin"], [400]),
  f("Nanum Brush Script", "나눔손글씨 붓", "handwriting", ["kr", "latin"], [400]),
  f("Gowun Dodum", "고운돋움", "sans", ["kr", "latin"], [400]),
  f("Gowun Batang", "고운바탕", "serif", ["kr", "latin"], [400, 700]),
  f("Do Hyeon", "도현", "display", ["kr", "latin"], [400]),
  f("Jua", "주아", "display", ["kr", "latin"], [400]),
  f("Black Han Sans", "검은고딕", "display", ["kr", "latin"], [400]),
  f("IBM Plex Sans KR", "IBM Plex Sans KR", "sans", ["kr", "latin"], [300, 400, 500, 700]),
  // ---------- 西文無襯線 ----------
  f("Geist", "Geist", "sans", ["latin"], [300, 400, 500, 600, 700], OFL, [100, 900]),
  f("Inter", "Inter", "sans", ["latin"], [300, 400, 500, 600, 700], OFL, [100, 900]),
  f("Roboto", "Roboto", "sans", ["latin"], [300, 400, 500, 700], OFL, [100, 900]),
  f("Open Sans", "Open Sans", "sans", ["latin"], [300, 400, 600, 700], OFL, [300, 800]),
  f("Lato", "Lato", "sans", ["latin"], [300, 400, 700, 900]),
  f("Montserrat", "Montserrat", "sans", ["latin"], [300, 400, 500, 600, 700], OFL, [100, 900]),
  f("Poppins", "Poppins", "sans", ["latin"], [300, 400, 500, 600, 700]),
  f("Nunito", "Nunito", "sans", ["latin"], [300, 400, 600, 700], OFL, [200, 1000]),
  f("Source Sans 3", "Source Sans 3", "sans", ["latin"], [300, 400, 600, 700], OFL, [200, 900]),
  f("Work Sans", "Work Sans", "sans", ["latin"], [300, 400, 500, 600, 700], OFL, [100, 900]),
  f("DM Sans", "DM Sans", "sans", ["latin"], [400, 500, 700], OFL, [100, 1000]),
  f("Manrope", "Manrope", "sans", ["latin"], [300, 400, 500, 600, 700], OFL, [200, 800]),
  f("IBM Plex Sans", "IBM Plex Sans", "sans", ["latin"], [300, 400, 500, 600, 700], OFL, [100, 700]),
  f("Noto Sans", "Noto Sans", "sans", ["latin"], [300, 400, 500, 700], OFL, [100, 900]),
  f("Raleway", "Raleway", "sans", ["latin"], [300, 400, 500, 700], OFL, [100, 900]),
  f("Rubik", "Rubik", "sans", ["latin"], [300, 400, 500, 700], OFL, [300, 900]),
  f("Outfit", "Outfit", "sans", ["latin"], [300, 400, 500, 700], OFL, [100, 900]),
  f("Figtree", "Figtree", "sans", ["latin"], [300, 400, 500, 700], OFL, [300, 900]),
  f("Plus Jakarta Sans", "Plus Jakarta Sans", "sans", ["latin"], [300, 400, 500, 700], OFL, [200, 800]),
  f("Lexend", "Lexend（易讀）", "sans", ["latin"], [300, 400, 500, 700], OFL, [100, 900]),
  f("Lexend Deca", "Lexend Deca", "sans", ["latin"], [300, 400, 500, 700], OFL, [100, 900]),
  f("Atkinson Hyperlegible", "Atkinson Hyperlegible（低視力易讀）", "sans", ["latin"], [400, 700]),
  f("Arimo", "Arimo（Arial 等寬替代）", "sans", ["latin"], [400, 700], APACHE, [400, 700]),
  f("Carlito", "Carlito（Calibri 等寬替代）", "sans", ["latin"], [400, 700]),
  f("Mulish", "Mulish", "sans", ["latin"], [300, 400, 600, 700], OFL, [200, 1000]),
  f("Karla", "Karla", "sans", ["latin"], [300, 400, 500, 700], OFL, [200, 800]),
  f("Quicksand", "Quicksand", "sans", ["latin"], [300, 400, 500, 700], OFL, [300, 700]),
  f("Barlow", "Barlow", "sans", ["latin"], [300, 400, 500, 600, 700]),
  f("Fira Sans", "Fira Sans", "sans", ["latin"], [300, 400, 500, 700]),
  f("PT Sans", "PT Sans", "sans", ["latin"], [400, 700]),
  f("Ubuntu", "Ubuntu", "sans", ["latin"], [300, 400, 500, 700], UFL),
  f("Cabin", "Cabin", "sans", ["latin"], [400, 500, 700], OFL, [400, 700]),
  f("Hind", "Hind", "sans", ["latin"], [300, 400, 500, 700]),
  f("Josefin Sans", "Josefin Sans", "sans", ["latin"], [300, 400, 600, 700], OFL, [100, 700]),
  f("Archivo", "Archivo", "sans", ["latin"], [300, 400, 500, 700], OFL, [100, 900]),
  f("Public Sans", "Public Sans", "sans", ["latin"], [300, 400, 500, 700], OFL, [100, 900]),
  f("Red Hat Display", "Red Hat Display", "sans", ["latin"], [400, 500, 700], OFL, [300, 900]),
  f("Sora", "Sora", "sans", ["latin"], [300, 400, 600, 700], OFL, [100, 800]),
  f("Urbanist", "Urbanist", "sans", ["latin"], [300, 400, 600, 700], OFL, [100, 900]),
  f("Onest", "Onest", "sans", ["latin"], [300, 400, 500, 700], OFL, [100, 900]),
  // ---------- 西文襯線 ----------
  f("Merriweather", "Merriweather", "serif", ["latin"], [300, 400, 700, 900]),
  f("Lora", "Lora", "serif", ["latin"], [400, 500, 600, 700], OFL, [400, 700]),
  f("Playfair Display", "Playfair Display", "serif", ["latin"], [400, 600, 700, 900], OFL, [400, 900]),
  f("Libre Baskerville", "Libre Baskerville", "serif", ["latin"], [400, 700]),
  f("EB Garamond", "EB Garamond", "serif", ["latin"], [400, 500, 600, 700], OFL, [400, 800]),
  f("Crimson Pro", "Crimson Pro", "serif", ["latin"], [300, 400, 600, 700], OFL, [200, 900]),
  f("Source Serif 4", "Source Serif 4", "serif", ["latin"], [300, 400, 600, 700], OFL, [200, 900]),
  f("PT Serif", "PT Serif", "serif", ["latin"], [400, 700]),
  f("Noto Serif", "Noto Serif", "serif", ["latin"], [400, 600, 700], OFL, [100, 900]),
  f("Literata", "Literata", "serif", ["latin"], [300, 400, 600, 700], OFL, [200, 900]),
  f("Spectral", "Spectral", "serif", ["latin"], [300, 400, 600, 700]),
  f("Cormorant Garamond", "Cormorant Garamond", "serif", ["latin"], [300, 400, 600, 700], OFL, [300, 700]),
  f("Bitter", "Bitter", "serif", ["latin"], [300, 400, 600, 700], OFL, [100, 900]),
  f("Frank Ruhl Libre", "Frank Ruhl Libre", "serif", ["latin"], [300, 400, 500, 700], OFL, [300, 900]),
  f("IBM Plex Serif", "IBM Plex Serif", "serif", ["latin"], [300, 400, 500, 600, 700]),
  f("DM Serif Display", "DM Serif Display", "serif", ["latin"], [400]),
  f("Fraunces", "Fraunces", "serif", ["latin"], [400, 500, 600, 700], OFL, [100, 900]),
  f("Newsreader", "Newsreader", "serif", ["latin"], [300, 400, 600, 700], OFL, [200, 800]),
  f("Alegreya", "Alegreya", "serif", ["latin"], [400, 500, 700], OFL, [400, 900]),
  f("Libre Caslon Text", "Libre Caslon Text", "serif", ["latin"], [400, 700]),
  f("Roboto Slab", "Roboto Slab", "serif", ["latin"], [300, 400, 500, 700], APACHE, [100, 900]),
  f("Zilla Slab", "Zilla Slab", "serif", ["latin"], [300, 400, 500, 700]),
  f("Instrument Serif", "Instrument Serif", "serif", ["latin"], [400]),
  f("Tinos", "Tinos（Times New Roman 等寬替代）", "serif", ["latin"], [400, 700], APACHE, [400, 700]),
  f("Caladea", "Caladea（Cambria 等寬替代）", "serif", ["latin"], [400, 700], APACHE),
  f("Gelasio", "Gelasio（Georgia 等寬替代）", "serif", ["latin"], [400, 500, 600, 700], OFL, [400, 700]),
  f("STIX Two Text", "STIX Two Text（數理）", "serif", ["latin"], [400, 500, 600, 700], OFL, [400, 700]),
  // ---------- 標題與裝飾 ----------
  f("Bebas Neue", "Bebas Neue", "display", ["latin"], [400]),
  f("Oswald", "Oswald", "display", ["latin"], [300, 400, 500, 700], OFL, [200, 700]),
  f("Anton", "Anton", "display", ["latin"], [400]),
  f("Archivo Black", "Archivo Black", "display", ["latin"], [400]),
  f("Abril Fatface", "Abril Fatface", "display", ["latin"], [400]),
  f("Righteous", "Righteous", "display", ["latin"], [400]),
  f("Lobster", "Lobster", "display", ["latin"], [400]),
  f("Pacifico", "Pacifico", "display", ["latin"], [400]),
  f("Bungee", "Bungee", "display", ["latin"], [400]),
  f("Alfa Slab One", "Alfa Slab One", "display", ["latin"], [400]),
  f("Space Grotesk", "Space Grotesk", "display", ["latin"], [300, 400, 500, 700], OFL, [300, 700]),
  f("Syne", "Syne", "display", ["latin"], [400, 500, 700, 800], OFL, [400, 800]),
  f("Unbounded", "Unbounded", "display", ["latin"], [300, 400, 600, 800], OFL, [200, 900]),
  f("Bricolage Grotesque", "Bricolage Grotesque", "display", ["latin"], [300, 400, 600, 800], OFL, [200, 800]),
  f("Chakra Petch", "Chakra Petch", "display", ["latin"], [300, 400, 500, 700]),
  f("Orbitron", "Orbitron", "display", ["latin"], [400, 500, 700, 900], OFL, [400, 900]),
  f("Press Start 2P", "Press Start 2P（像素）", "display", ["latin"], [400]),
  f("Silkscreen", "Silkscreen（像素）", "display", ["latin"], [400, 700]),
  // ---------- 手寫 ----------
  f("Caveat", "Caveat", "handwriting", ["latin"], [400, 500, 700], OFL, [400, 700]),
  f("Patrick Hand", "Patrick Hand", "handwriting", ["latin"], [400]),
  f("Indie Flower", "Indie Flower", "handwriting", ["latin"], [400]),
  f("Shadows Into Light", "Shadows Into Light", "handwriting", ["latin"], [400]),
  f("Kalam", "Kalam", "handwriting", ["latin"], [300, 400, 700]),
  f("Gloria Hallelujah", "Gloria Hallelujah", "handwriting", ["latin"], [400]),
  f("Architects Daughter", "Architects Daughter", "handwriting", ["latin"], [400]),
  f("Permanent Marker", "Permanent Marker", "handwriting", ["latin"], [400], APACHE),
  f("Dancing Script", "Dancing Script", "handwriting", ["latin"], [400, 500, 700], OFL, [400, 700]),
  f("Great Vibes", "Great Vibes", "handwriting", ["latin"], [400]),
  f("Satisfy", "Satisfy", "handwriting", ["latin"], [400], APACHE),
  f("Homemade Apple", "Homemade Apple", "handwriting", ["latin"], [400], APACHE),
  f("Nothing You Could Do", "Nothing You Could Do", "handwriting", ["latin"], [400]),
  f("Reenie Beanie", "Reenie Beanie", "handwriting", ["latin"], [400]),
  f("Rock Salt", "Rock Salt", "handwriting", ["latin"], [400], APACHE),
  f("Covered By Your Grace", "Covered By Your Grace", "handwriting", ["latin"], [400]),
  f("Just Another Hand", "Just Another Hand", "handwriting", ["latin"], [400], APACHE),
  f("Schoolbell", "Schoolbell", "handwriting", ["latin"], [400], APACHE),
  f("Gochi Hand", "Gochi Hand", "handwriting", ["latin"], [400]),
  f("Sacramento", "Sacramento", "handwriting", ["latin"], [400]),
  f("Amatic SC", "Amatic SC", "handwriting", ["latin"], [400, 700]),
  f("Comic Neue", "Comic Neue", "handwriting", ["latin"], [300, 400, 700]),
  f("Itim", "Itim", "handwriting", ["latin"], [400]),
  f("Coming Soon", "Coming Soon", "handwriting", ["latin"], [400], APACHE),
  f("Annie Use Your Telescope", "Annie Use Your Telescope", "handwriting", ["latin"], [400]),
  f("Short Stack", "Short Stack", "handwriting", ["latin"], [400]),
  f("Delius", "Delius", "handwriting", ["latin"], [400]),
  f("Handlee", "Handlee", "handwriting", ["latin"], [400]),
  f("Kaushan Script", "Kaushan Script", "handwriting", ["latin"], [400]),
  f("Courgette", "Courgette", "handwriting", ["latin"], [400]),
  f("Cookie", "Cookie", "handwriting", ["latin"], [400]),
  f("Parisienne", "Parisienne", "handwriting", ["latin"], [400]),
  f("Allura", "Allura", "handwriting", ["latin"], [400]),
  // ---------- 等寬 ----------
  f("Geist Mono", "Geist Mono", "mono", ["latin"], [400, 500, 600], OFL, [100, 900]),
  f("JetBrains Mono", "JetBrains Mono", "mono", ["latin"], [400, 500, 700], OFL, [100, 800]),
  f("Fira Code", "Fira Code", "mono", ["latin"], [400, 500, 700], OFL, [300, 700]),
  f("Source Code Pro", "Source Code Pro", "mono", ["latin"], [400, 500, 700], OFL, [200, 900]),
  f("IBM Plex Mono", "IBM Plex Mono", "mono", ["latin"], [400, 500, 700]),
  f("Roboto Mono", "Roboto Mono", "mono", ["latin"], [400, 500, 700], APACHE, [100, 700]),
  f("Space Mono", "Space Mono", "mono", ["latin"], [400, 700]),
  f("Inconsolata", "Inconsolata", "mono", ["latin"], [400, 500, 700], OFL, [200, 900]),
  f("Ubuntu Mono", "Ubuntu Mono", "mono", ["latin"], [400, 700], UFL),
  f("DM Mono", "DM Mono", "mono", ["latin"], [300, 400, 500]),
  f("Courier Prime", "Courier Prime（Courier 替代）", "mono", ["latin"], [400, 700]),
  f("Cousine", "Cousine（Courier New 等寬替代）", "mono", ["latin"], [400, 700], APACHE),
  f("Noto Sans Mono", "Noto Sans Mono", "mono", ["latin"], [400, 500, 700], OFL, [100, 900]),
  f("Red Hat Mono", "Red Hat Mono", "mono", ["latin"], [400, 500, 700], OFL, [300, 700]),
  f("Noto Sans Math", "Noto Sans Math（數學符號）", "mono", ["latin"], [400]),
];

export const CATEGORY_LABELS: Record<FontCategory, string> = {
  sans: "黑體／無襯線",
  serif: "明體／襯線",
  display: "標題",
  handwriting: "手寫",
  mono: "等寬",
};

export const SCRIPT_LABELS: Record<FontScript, string> = {
  tc: "繁中",
  sc: "簡中",
  jp: "日文",
  kr: "韓文",
  latin: "西文",
};

export const LICENSE_LABELS: Record<FontLicense, string> = {
  "OFL-1.1": "SIL Open Font License 1.1",
  "Apache-2.0": "Apache License 2.0",
  "UFL-1.0": "Ubuntu Font License 1.0",
};

const BY_FAMILY = new Map(FONT_CATALOG.map((e) => [e.family.toLowerCase(), e]));

export function findCatalogFont(family: string | null | undefined): FontEntry | undefined {
  if (!family) return undefined;
  return BY_FAMILY.get(normalizeFamily(family).toLowerCase());
}

/** 去掉引號與多餘空白：`"Noto Sans TC"` → `Noto Sans TC` */
export function normalizeFamily(family: string): string {
  return family.trim().replace(/^['"]|['"]$/g, "").replace(/\s+/g, " ").trim();
}

/** 依類別的備用字型（字型還沒下載好或缺字時）：中文優先用思源 */
export function fallbackStack(category: FontCategory | undefined): string {
  switch (category) {
    case "serif":
      return '"Noto Serif TC", "Songti TC", "PMingLiU", serif';
    case "mono":
      return '"Geist Mono", ui-monospace, "Noto Sans TC", monospace';
    case "handwriting":
      return '"LXGW WenKai TC", "Kaiti TC", "DFKai-SB", cursive';
    default:
      return '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", sans-serif';
  }
}
