// GeoGebra（自架於 /vendor/geogebra，非商業授權；原始碼 EUPL-1.2）
import { useEffect, useId, useRef, useState } from "react";
import { Button, Spinner } from "../../components/ui";
import { useUser } from "../../lib/auth";
import { readToolStorage, toolStorageKey, writeToolStorage } from "./storage";
import { LegacyToolRestore } from "./LegacyToolRestore";

export type GgbApp = "graphing" | "scientific" | "classic" | "3d" | "cas" | "geometry" | "probability";

declare global {
  interface Window {
    GGBApplet?: new (params: Record<string, unknown>, html5NoWebSimple?: boolean) => {
      setHTML5Codebase: (path: string, offline?: boolean) => void;
      inject: (id: string) => void;
    };
  }
}

export interface GgbApi {
  evalCommand: (cmd: string) => boolean;
  setSize: (w: number, h: number) => void;
  getBase64: (cb?: (b64: string) => void) => string;
  setBase64: (b64: string, cb?: () => void) => void;
  reset: () => void;
  remove?: () => void;
}

const BASE = "/vendor/geogebra";
let loader: Promise<void> | null = null;

function loadDeploy(): Promise<void> {
  if (window.GGBApplet) return Promise.resolve();
  if (!loader)
    loader = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      const timer = setTimeout(() => { s.remove(); reject(new Error("圖形工具載入逾時，請重新讀取")); }, 20_000);
      s.src = `${BASE}/deployggb.js`;
      s.onload = () => { clearTimeout(timer); typeof window.GGBApplet === "function" ? resolve() : reject(new Error("圖形工具暫時無法啟動")); };
      s.onerror = () => {
        clearTimeout(timer); s.remove();
        reject(new Error("圖形工具暫時無法載入，請檢查連線後重試"));
      };
      document.head.appendChild(s);
    }).catch((error: unknown) => { loader = null; throw error; });
  return loader;
}

interface Props {
  app: GgbApp;
  /** localStorage 鍵：保留上次的作圖 */
  persistKey?: string;
  onReady?: (api: GgbApi) => void;
  className?: string;
}

export function GeoGebra({ app, persistKey, onReady, className }: Props) {
  const owner = useUser().id;
  const storageKey = persistKey ? toolStorageKey(owner, persistKey) : null;
  const legacyMarker = persistKey ? toolStorageKey(owner, persistKey + "-legacy-restored") : null;
  const baseId = "ggb-" + useId().replace(/:/g, "");
  const host = useRef<HTMLDivElement>(null);
  const apiRef = useRef<GgbApi | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [err, setErr] = useState("");
  const [attempt, setAttempt] = useState(0), [notice, setNotice] = useState("");
  const id = `${baseId}-${attempt}`;

  useEffect(() => {
    let disposed = false;
    let ready = false, blockedSave = false;
    const el = host.current!;
    setState("loading"); setErr(""); setNotice("");
    const readyTimer = setTimeout(() => { if (!disposed) { setErr("圖形工具仍未準備好，可重新讀取。已儲存的作圖會保留。"); setState("error"); } }, 45_000);
    const persist = () => {
      if (!storageKey || !apiRef.current || !ready || blockedSave) return;
      try {
        const value = apiRef.current.getBase64();
        if (typeof value === "string" && value && !writeToolStorage(storageKey, value) && !disposed) setNotice("此裝置無法儲存作圖，請保持頁面開啟並複製重要內容。");
      } catch { if (!disposed) setNotice("目前作圖尚未儲存，請保持頁面開啟。"); }
    };
    loadDeploy()
      .then(() => {
        if (disposed) return;
        const { width, height } = el.getBoundingClientRect();
        const params: Record<string, unknown> = {
          appName: app,
          width: Math.max(300, Math.floor(width)),
          height: Math.max(300, Math.floor(height)),
          language: "zh-TW",
          showToolBar: app === "classic" || app === "geometry",
          showAlgebraInput: true,
          showMenuBar: false,
          showResetIcon: true,
          enableLabelDrags: true,
          enableShiftDragZoom: true,
          enableRightClick: true,
          enableFileFeatures: false,
          showLogging: false,
          useBrowserForJS: false,
          appletOnLoad: (api: GgbApi) => {
            if (disposed) { api.remove?.(); return; }
            apiRef.current = api;
            const finishReady = () => {
              if (disposed || apiRef.current !== api || ready) return;
              ready = true; clearTimeout(readyTimer); setState("ready"); onReady?.(api);
            };
            if (storageKey) {
              const saved = readToolStorage(storageKey);
              if (saved) {
                try {
                  api.setBase64(saved, finishReady);
                  return;
                } catch {
                  blockedSave = true;
                  setNotice("先前作圖暫時無法還原，原資料仍保留。本次作圖不會覆寫原檔，請先複製重要內容。");
                }
              }
            }
            finishReady();
          },
        };
        const applet = new window.GGBApplet!(params, true);
        applet.setHTML5Codebase(`${BASE}/HTML5/5.0/web3d/`);
        applet.inject(id);
      })
      .catch((e: Error) => {
        if (disposed) return;
        clearTimeout(readyTimer);
        setErr(e instanceof Error ? e.message : "圖形工具暫時無法啟動");
        setState("error");
      });

    const ro = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (apiRef.current && width > 0 && height > 0) apiRef.current.setSize(Math.floor(width), Math.floor(height));
      else if (apiRef.current) persist();
    });
    ro.observe(el);
    const saveTimer = setInterval(persist, 10_000);
    const hide = () => { if (document.visibilityState === "hidden") persist(); };
    window.addEventListener("pagehide", persist);
    document.addEventListener("visibilitychange", hide);
    return () => {
      disposed = true;
      clearTimeout(readyTimer); clearInterval(saveTimer);
      window.removeEventListener("pagehide", persist); document.removeEventListener("visibilitychange", hide);
      ro.disconnect();
      persist();
      apiRef.current?.remove?.();
      apiRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, storageKey, attempt]);

  const restoreLegacy = async () => {
    const value = persistKey ? readToolStorage(persistKey) : null, api = apiRef.current;
    if (!value || !api || !storageKey || !legacyMarker) return false;
    return new Promise<boolean>((resolve) => {
      let done = false;
      const finish = (ok: boolean) => { if (!done) { done = true; clearTimeout(timer); resolve(ok); } };
      const timer = setTimeout(() => finish(false), 20_000);
      try {
        api.setBase64(value, () => {
          if (done || api !== apiRef.current) { finish(false); return; }
          finish(writeToolStorage(storageKey, value) && writeToolStorage(legacyMarker, "1"));
        });
      } catch { finish(false); }
    });
  };

  return (
    <div data-tool="geogebra" data-state={state} aria-busy={state === "loading"} className={className ?? "relative h-full w-full"}>
      <div ref={host} className="absolute inset-0">
        <div key={id} id={id} />
      </div>
      {state === "loading" && (
        <div className="absolute inset-0 grid place-items-center bg-white/70 dark:bg-slate-900/70">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Spinner /> 載入 GeoGebra…
          </div>
        </div>
      )}
      {state === "error" && <div role="alert" className="absolute inset-0 z-10 grid place-items-center bg-white/95 p-6 text-center text-sm dark:bg-ink-900/95"><div className="space-y-3"><p>{err}</p><Button onClick={() => setAttempt((value) => value + 1)}>重新載入圖形工具</Button></div></div>}
      {notice && <p role="status" className="absolute inset-x-3 top-3 z-10 rounded-xl bg-white/95 p-3 text-xs text-amber-700 dark:bg-ink-900/95 dark:text-amber-300">{notice}</p>}
      {persistKey && legacyMarker && <div className="absolute right-2 bottom-6 z-10 rounded-xl bg-white/90 dark:bg-ink-900/90"><LegacyToolRestore available={!!readToolStorage(persistKey) && readToolStorage(legacyMarker) !== "1"} disabled={state !== "ready"} onRestore={restoreLegacy} replace /></div>}
      <div className="pointer-events-none absolute right-2 bottom-1 text-[10px] text-slate-400">Made with GeoGebra®</div>
    </div>
  );
}
