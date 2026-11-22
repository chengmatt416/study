/// <reference lib="webworker" />
// Qalculate!（libqalculate WebAssembly，GPL-2.0+）在 Web Worker 中執行，避免卡住畫面。
declare function importScripts(...urls: string[]): void;
declare const createQalculate: (opts: { locateFile: (f: string) => string }) => Promise<QalcModule>;

interface Calculation {
  input: string;
  output: string;
  messages: string;
  delete?: () => void;
}
interface QalcModule {
  calculate: (expr: string, timeout: number, flags: number) => Calculation;
  set_option: (opt: string) => void;
  version: () => number;
}

let mod: QalcModule | null = null;
let ready: Promise<QalcModule> | null = null;

function init(): Promise<QalcModule> {
  if (!ready) {
    ready = (async () => {
      importScripts("/vendor/qalculate/calc.js");
      mod = await createQalculate({ locateFile: (f) => `/vendor/qalculate/${f}` });
      return mod;
    })();
  }
  return ready;
}

self.onmessage = async (e: MessageEvent<{ id: number; type: "calc" | "option" | "init"; expr?: string }>) => {
  const { id, type, expr } = e.data;
  try {
    const m = await init();
    if (type === "init") return postMessage({ id, ok: true });
    if (type === "option") {
      m.set_option(expr ?? "");
      return postMessage({ id, ok: true });
    }
    const r = m.calculate(expr ?? "", 2000, 0);
    postMessage({ id, ok: true, input: r.input, output: r.output, messages: r.messages });
    r.delete?.();
  } catch (err) {
    postMessage({ id, ok: false, error: String((err as Error)?.message ?? err) });
  }
};
