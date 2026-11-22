import { useRegisterSW } from "virtual:pwa-register/react";
import { Sparkle } from "@phosphor-icons/react";
import { Button } from "./ui";

export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      // 每小時檢查一次新版本
      if (reg) setInterval(() => reg.update().catch(() => undefined), 3600_000);
    },
  });
  if (!needRefresh) return null;
  return (
    <div className="fixed inset-x-4 bottom-28 z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink-900/95 p-3 pl-4 text-sm text-white shadow-2xl backdrop-blur-xl md:bottom-8">
      <Sparkle size={18} weight="fill" className="text-white/70" />
      <span className="flex-1">有新版本可用</span>
      <Button size="sm" variant="ghost" className="text-white hover:bg-white/10" onClick={() => setNeedRefresh(false)}>
        稍後
      </Button>
      <Button size="sm" variant="primary" onClick={() => updateServiceWorker(true)}>
        重新載入
      </Button>
    </div>
  );
}
