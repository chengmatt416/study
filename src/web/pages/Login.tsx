import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { inAppBrowser, isIOS } from "../lib/device";
import { motion } from "motion/react";
import { ArrowSquareOut, Copy, ShieldCheck } from "@phosphor-icons/react";
import { Button, inputCls, softSpring } from "../components/ui";
import { Wordmark } from "../layouts/Shell";

const ERRORS: Record<string, string> = {
  not_allowed: "此 Google 帳號不在授權名單中，請聯絡管理員加入。",
  cancelled: "已取消登入。",
  state_expired: "登入逾時，請再試一次。",
  token_exchange: "與 Google 交換憑證失敗，請再試一次。",
  invalid_token: "登入憑證無效，請再試一次。",
  email_unverified: "此 Google 帳號的 email 尚未驗證。",
  oauth_not_configured: "伺服器尚未設定 Google OAuth（GOOGLE_CLIENT_ID）。",
};

export default function Login() {
  const [params] = useSearchParams();
  const redirect = params.get("redirect") ?? "/";
  const error = params.get("error");
  const { data: cfg } = useQuery({ queryKey: ["auth-config"], queryFn: () => api.get<{ appName: string; google: boolean; devLogin: boolean }>("/api/auth/config") });
  const [devEmail, setDevEmail] = useState("");
  const inApp = inAppBrowser();

  const openExternal = () => {
    const url = new URL(location.href);
    if (inApp === "line") {
      url.searchParams.set("openExternalBrowser", "1");
      location.href = url.toString();
    } else {
      navigator.clipboard?.writeText(location.origin).catch(() => undefined);
      alert("已複製網址，請貼到 Safari 或 Chrome 開啟");
    }
  };

  return (
    <div className="safe-top relative grid min-h-full place-items-center overflow-hidden bg-ink-950 p-6">
      <div className="aurora-blob -top-40 -left-32 h-[34rem] w-[34rem] bg-white/20" />
      <div className="aurora-blob -right-40 top-1/3 h-[30rem] w-[30rem] bg-zinc-500/40 [animation-delay:-6s]" />
      <div className="aurora-blob -bottom-48 left-1/4 h-[28rem] w-[28rem] bg-zinc-300/20 [animation-delay:-11s]" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(rgba(255,255,255,.06)_1px,transparent_1px)] [background-size:22px_22px]" />
      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.96, filter: "blur(10px)" }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
        transition={{ ...softSpring, delay: 0.1 }}
        className="relative w-full max-w-sm rounded-[32px] border border-white/15 bg-white/10 p-8 text-center text-white shadow-2xl backdrop-blur-2xl"
      >
        <motion.div className="mx-auto mb-6 flex justify-center" initial={{ scale: 0.6, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 260, damping: 14, delay: 0.25 }}>
          <Wordmark light />
        </motion.div>
        <h1 className="font-display text-3xl font-semibold tracking-tight">歡迎回來</h1>
        <p className="mt-2 text-sm text-white/60">電子書 · 重點整理 · 模擬試題 · 字卡</p>

        {error && <div className="mt-5 rounded-2xl border border-rose-400/30 bg-rose-500/15 p-3 text-left text-sm text-rose-100">{ERRORS[error] ?? "登入失敗"}{params.get("email") && <div className="mt-1 text-xs opacity-80">{params.get("email")}</div>}</div>}

        {inApp ? (
          <div className="mt-6 space-y-3 text-left text-sm">
            <div className="rounded-2xl border border-amber-300/30 bg-amber-400/15 p-3 text-amber-100">
              目前在 {inApp === "line" ? "LINE" : inApp === "fb" ? "Facebook" : inApp === "ig" ? "Instagram" : "App"} 內建瀏覽器中，Google 不允許在此登入。
            </div>
            <Button variant="primary" size="lg" className="w-full" onClick={openExternal}>
              {inApp === "line" ? <><ArrowSquareOut size={18} /> 用外部瀏覽器開啟</> : <><Copy size={18} /> 複製網址</>}
            </Button>
            <p className="text-xs text-white/50">或點右上角「⋯」選擇「{isIOS() ? "在 Safari 中開啟" : "在瀏覽器中開啟"}」。</p>
          </div>
        ) : (
          <a href={`/api/auth/google/start?redirect=${encodeURIComponent(redirect)}`} className="group mt-8 flex h-12 w-full items-center justify-center gap-3 rounded-2xl bg-white font-semibold text-slate-900 shadow-lg transition duration-150 hover:-translate-y-0.5 hover:shadow-xl active:scale-[.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-ink-950">
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
              <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
              <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
              <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
              <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
            </svg>
            使用 Google 帳號登入
          </a>
        )}

        {cfg?.devLogin && (
          <form
            className="mt-6 space-y-2 border-t border-dashed border-white/20 pt-4 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              location.href = `/api/auth/dev?email=${encodeURIComponent(devEmail)}&redirect=${encodeURIComponent(redirect)}`;
            }}
          >
            <div className="text-xs font-medium text-white/50">本機開發登入（僅 localhost）</div>
            <input className={inputCls + " text-slate-900"} type="email" placeholder="email（需在授權名單）" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} required />
            <Button type="submit" className="w-full">
              開發登入
            </Button>
          </form>
        )}
        <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-white/40">
          <ShieldCheck size={14} /> 僅限授權名單內的帳號使用
        </p>
        <p className="mt-3 text-xs text-white/50">
          登入即表示你同意
          <Link to="/terms" className="mx-1 underline decoration-white/30 underline-offset-2 hover:text-white">服務條款</Link>
          與
          <Link to="/privacy" className="mx-1 underline decoration-white/30 underline-offset-2 hover:text-white">隱私權政策</Link>
        </p>
      </motion.div>
    </div>
  );
}
