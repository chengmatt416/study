// 字型選擇器：搜尋、依類別與文字篩選、每個字型用自己的字型預覽（只下載預覽文字），
// 「我的字型」可以上傳 TTF／OTF／WOFF（只存在這台裝置）。用在全站字型設定、筆記文字方塊、匯入文件的缺字型替換。
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { clsx } from "clsx";
import { Check, MagnifyingGlass, TextAa, Trash, UploadSimple } from "@phosphor-icons/react";
import {
  CATEGORY_LABELS,
  FONT_CATALOG,
  LICENSE_LABELS,
  SCRIPT_LABELS,
  findCatalogFont,
  type FontCategory,
  type FontEntry,
  type FontScript,
} from "../lib/fonts/catalog";
import {
  addUserFont,
  cssFontStack,
  linkFontPreview,
  loadUserFonts,
  removeUserFont,
  subscribeUserFonts,
  userFonts,
  USER_FONT_ACCEPT,
} from "../lib/fonts/loader";
import { Sheet, inputCls, toast } from "./ui";

type Filter = "all" | FontCategory | `script:${FontScript}` | "mine";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "script:tc", label: "繁中" },
  { value: "handwriting", label: "手寫" },
  { value: "sans", label: "黑體" },
  { value: "serif", label: "明體" },
  { value: "display", label: "標題" },
  { value: "mono", label: "等寬" },
  { value: "script:sc", label: "簡中" },
  { value: "script:jp", label: "日文" },
  { value: "script:kr", label: "韓文" },
  { value: "mine", label: "我的字型" },
];

function previewText(entry: Pick<FontEntry, "scripts" | "label" | "family">): string {
  const s = entry.scripts[0];
  if (s === "tc") return `${entry.label} 永和九年 Aa123`;
  if (s === "sc") return `${entry.label} 永和九年 Aa123`;
  if (s === "jp") return `${entry.label} あいうえお 永 Aa`;
  if (s === "kr") return `${entry.label} 가나다라 Aa`;
  return `${entry.family} — The quick brown fox 123`;
}

function useUserFonts() {
  useEffect(() => {
    void loadUserFonts();
  }, []);
  return useSyncExternalStore(subscribeUserFonts, userFonts, userFonts);
}

/** 單一列：進入畫面才下載預覽用的字 */
function FontRow({ family, label, meta, selected, onPick, onRemove }: { family: string; label: string; meta: string; selected: boolean; onPick: () => void; onRemove?: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const entry = findCatalogFont(family);
  const sample = entry ? previewText(entry) : `${label} 永和九年 Aa123`;
  useEffect(() => {
    const el = ref.current;
    if (!el || !entry) return;
    const io = new IntersectionObserver(
      (items) => {
        if (items.some((i) => i.isIntersecting)) {
          linkFontPreview(family, sample);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [family, sample, entry]);
  return (
    <div className="group relative">
      <button
        ref={ref}
        type="button"
        onClick={onPick}
        aria-pressed={selected}
        className={clsx(
          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors",
          selected ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "hover:bg-slate-900/[0.04] dark:hover:bg-white/[0.06]",
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-lg leading-snug" style={{ fontFamily: cssFontStack(family) }}>
            {sample}
          </span>
          <span className={clsx("block truncate text-[11px]", selected ? "text-white/70 dark:text-ink-900/60" : "text-slate-500 dark:text-slate-400")}>{meta}</span>
        </span>
        {selected && <Check size={16} weight="bold" className="shrink-0" />}
      </button>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`刪除字型 ${label}`}
          className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-500 opacity-0 transition-opacity hover:bg-red-500/10 hover:text-red-600 focus:opacity-100 group-hover:opacity-100"
        >
          <Trash size={15} />
        </button>
      )}
    </div>
  );
}

export interface FontPickerSheetProps {
  open: boolean;
  onClose: () => void;
  value: string | null;
  onChange: (family: string | null) => void;
  title?: string;
  /** 顯示「預設」選項（值為 null） */
  allowDefault?: boolean;
  defaultLabel?: string;
  /** 一開始的篩選 */
  initialFilter?: Filter;
  /** 上傳字型時直接用這個名稱註冊（替換匯入文件裡缺少的字型） */
  uploadAs?: string;
}

export function FontPickerSheet({ open, onClose, value, onChange, title = "選擇字型", allowDefault, defaultLabel = "預設", initialFilter = "all", uploadAs }: FontPickerSheetProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const mine = useUserFonts();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FONT_CATALOG.filter((e) => {
      if (filter === "mine") return false;
      if (filter.startsWith("script:")) {
        if (!e.scripts.includes(filter.slice(7) as FontScript)) return false;
      } else if (filter !== "all" && e.category !== filter) return false;
      if (!q) return true;
      return e.family.toLowerCase().includes(q) || e.label.toLowerCase().includes(q);
    });
  }, [query, filter]);

  const mineFiltered = mine.filter((f) => !query.trim() || f.family.toLowerCase().includes(query.trim().toLowerCase()));

  const pick = (family: string | null) => {
    onChange(family);
    onClose();
  };

  const upload = async (file: File) => {
    setUploading(true);
    try {
      const font = await addUserFont(file, { family: uploadAs });
      toast(`已加入字型「${font.family}」（只存在這台裝置）`, "ok");
      pick(font.family);
    } catch (err) {
      toast((err as Error).message || "加入字型失敗", "err");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={title} wide>
      <div className="flex max-h-[70dvh] min-h-[50dvh] flex-col gap-3">
        <label className="relative block shrink-0">
          <MagnifyingGlass size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜尋字型名稱（例如 楷、Noto、Caveat）"
            className={clsx(inputCls, "pl-9")}
            aria-label="搜尋字型"
          />
        </label>
        <div className="-mx-1 flex shrink-0 gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="字型分類">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={clsx(
                "h-8 shrink-0 rounded-full px-3 text-xs font-semibold transition-colors",
                filter === f.value ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "bg-slate-900/[0.05] text-slate-600 hover:bg-slate-900/10 dark:bg-white/10 dark:text-slate-300",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {allowDefault && !query && filter === "all" && (
            <FontRow family="" label={defaultLabel} meta="使用 App 的預設字型" selected={!value} onPick={() => pick(null)} />
          )}
          {(filter === "mine" || filter === "all") && mineFiltered.length > 0 && (
            <>
              <p className="px-3 pb-1 pt-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">我的字型（只在這台裝置）</p>
              {mineFiltered.map((f) => (
                <FontRow
                  key={f.family}
                  family={f.family}
                  label={f.family}
                  meta={`${f.fileName}・${(f.size / 1024 / 1024).toFixed(1)} MB`}
                  selected={value === f.family}
                  onPick={() => pick(f.family)}
                  onRemove={() => void removeUserFont(f.family)}
                />
              ))}
            </>
          )}
          {filter === "mine" ? (
            <div className="space-y-3 px-3 py-4 text-sm text-slate-600 dark:text-slate-300">
              {mineFiltered.length === 0 && <p>還沒有自己的字型。</p>}
              <p className="text-xs text-slate-500 dark:text-slate-400">
                上傳你有使用權的字型檔（TTF、OTF、WOFF、WOFF2），只存在這台裝置、不會上傳。匯出的 PDF、圖片會用它畫出來；
                Word、PowerPoint 檔只記字型名稱，別台電腦要裝了同一個字型才會一樣。
              </p>
            </div>
          ) : (
            <>
              {list.length === 0 && <p className="px-3 py-6 text-center text-sm text-slate-500">找不到符合的字型</p>}
              {list.map((e) => (
                <FontRow
                  key={e.family}
                  family={e.family}
                  label={e.label}
                  meta={`${CATEGORY_LABELS[e.category]}・${e.scripts.map((s) => SCRIPT_LABELS[s]).join("／")}・${LICENSE_LABELS[e.license]}`}
                  selected={value === e.family}
                  onPick={() => pick(e.family)}
                />
              ))}
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200/70 pt-3 dark:border-white/10">
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900/[0.05] px-3 text-xs font-semibold text-slate-700 hover:bg-slate-900/10 disabled:opacity-50 dark:bg-white/10 dark:text-slate-200"
          >
            <UploadSimple size={15} />
            {uploading ? "加入中…" : uploadAs ? `上傳「${uploadAs}」字型檔` : "上傳自己的字型"}
          </button>
          <span className="text-[11px] text-slate-500 dark:text-slate-400">字型庫 {FONT_CATALOG.length} 款，全部為開源授權、可免費商用與嵌入。</span>
          <input
            ref={fileRef}
            type="file"
            accept={USER_FONT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void upload(file);
            }}
          />
        </div>
      </div>
    </Sheet>
  );
}

/** 按鈕：顯示目前字型（用該字型顯示名稱），點開選擇器 */
export function FontPickerButton({
  value,
  onChange,
  title,
  allowDefault,
  defaultLabel = "預設",
  className,
  initialFilter,
  compact,
  uploadAs,
}: Omit<FontPickerSheetProps, "open" | "onClose"> & { className?: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const entry = findCatalogFont(value);
  const label = value ? entry?.label ?? value : defaultLabel;
  useEffect(() => {
    if (value && entry) linkFontPreview(value, label);
  }, [value, entry, label]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${title ?? "字型"}：${label}`}
        className={clsx(
          "inline-flex min-w-0 items-center gap-1.5 rounded-xl text-left transition-colors",
          compact ? "h-8 px-2 text-xs" : "h-10 w-full px-3 text-sm",
          "bg-slate-900/[0.05] text-slate-800 hover:bg-slate-900/10 dark:bg-white/10 dark:text-slate-100 dark:hover:bg-white/15",
          className,
        )}
      >
        <TextAa size={compact ? 14 : 16} className="shrink-0 text-slate-500" />
        <span className="min-w-0 flex-1 truncate" style={value ? { fontFamily: cssFontStack(value) } : undefined}>
          {label}
        </span>
      </button>
      <FontPickerSheet
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        onChange={onChange}
        title={title}
        allowDefault={allowDefault}
        defaultLabel={defaultLabel}
        initialFilter={initialFilter}
        uploadAs={uploadAs}
      />
    </>
  );
}
