export interface QalcReply { id: number; ok: boolean; input?: string; output?: string; messages?: string; error?: string }
interface QalcPort {
  onmessage: ((event: MessageEvent<QalcReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onmessageerror: ((event: MessageEvent) => void) | null;
  postMessage(value: unknown): void;
  terminate(): void;
}

export class QalcClient {
  private worker: QalcPort | null = null;
  private owner: string | null = null;
  private seq = 0;
  private pending = new Map<number, { type: string; resolve: (value: QalcReply) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  constructor(private create: () => QalcPort, private startupTimeout = 45_000, private calculationTimeout = 10_000) {}

  reset(message = "計算機已重新啟動，請再試一次") {
    this.worker?.terminate(); this.worker = null;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(message)); }
    this.pending.clear();
  }

  call(owner: string, type: "calc" | "option" | "init", expr?: string): Promise<QalcReply> {
    if (this.owner !== owner) { this.reset("帳號已變更，先前的計算已取消"); this.owner = owner; }
    if (!this.worker) {
      try { this.worker = this.create(); }
      catch { return Promise.reject(new Error("計算機暫時無法啟動，請重新載入")); }
      this.worker.onmessage = ({ data }) => {
        const pending = this.pending.get(data?.id);
        if (!pending) return;
        clearTimeout(pending.timer); this.pending.delete(data.id);
        if (typeof data.ok !== "boolean" || data.ok && pending.type === "calc" && typeof data.output !== "string") pending.reject(new Error("計算回應不完整，請重新載入計算機"));
        else pending.resolve({ ...data, ok: data.ok && !(pending.type === "calc" && /^\s*Error:/mi.test(data.messages ?? "")) });
      };
      this.worker.onerror = (event) => { event.preventDefault(); this.reset("計算機連線中斷，輸入與紀錄已保留"); };
      this.worker.onmessageerror = () => this.reset("計算回應無法讀取，請重新載入計算機");
    }
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.reset("計算機回應逾時，輸入與紀錄已保留"), type === "init" ? this.startupTimeout : this.calculationTimeout);
      this.pending.set(id, { type, resolve, reject, timer });
      try { this.worker!.postMessage({ id, type, expr }); }
      catch { this.reset("無法傳送計算，請重新載入計算機"); }
    });
  }
}
