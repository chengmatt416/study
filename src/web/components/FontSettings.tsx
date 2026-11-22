// 「我的」頁的字型設定：介面、標題、閱讀內文、程式碼，各自選字型（存在這台裝置）。
import { FONT_PREF_LABELS, setFontPref, useFontPrefs, type FontPrefs } from "../lib/fonts/prefs";
import { FontPickerButton } from "./FontPicker";

const ORDER: (keyof FontPrefs)[] = ["ui", "display", "reading", "mono"];

export function FontSettings() {
  const prefs = useFontPrefs();
  return (
    <div className="space-y-2.5">
      {ORDER.map((key) => {
        const meta = FONT_PREF_LABELS[key];
        return (
          <div key={key} className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] items-center gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">{meta.label}</div>
              <div className="truncate text-[11px] text-slate-500 dark:text-slate-400">{meta.hint}</div>
            </div>
            <FontPickerButton
              value={prefs[key]}
              onChange={(family) => setFontPref(key, family)}
              title={`${meta.label}字型`}
              allowDefault
              initialFilter={key === "mono" ? "mono" : "all"}
            />
          </div>
        );
      })}
      <p className="pt-1 text-[11px] text-slate-500 dark:text-slate-400">字型用到才下載，下載過的離線也能用。設定只套用在這台裝置。</p>
    </div>
  );
}
