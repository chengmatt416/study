import { useState } from "react";
import { Confetti, Export, SignOut } from "@phosphor-icons/react";
import { Link } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { isIOS, isStandalone } from "../lib/device";
import { fmtDate } from "../lib/format";
import { Button, Card, ErrorBox, Loading, PageHeader, toast } from "../components/ui";
import { Page } from "../layouts/Shell";
import { FontSettings } from "../components/FontSettings";

interface Stats {
  daily: { day: string; n: number; again: number }[];
  exams: { attempt_id?: string; title: string; slug: string; score: number | null; max_score: number | null; submitted_at: number }[];
}
interface Mistake {
  slug: string;
  title: string;
  attempt_id: string;
  question: string;
  score: number;
  max: number;
}

function Heatmap({ daily }: { daily: Stats["daily"] }) {
  const map = new Map(daily.map((d) => [d.day, d.n]));
  const days: { day: string; n: number }[] = [];
  for (let i = 83; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000 + 8 * 3600000).toISOString().slice(0, 10);
    days.push({ day: d, n: map.get(d) ?? 0 });
  }
  const max = Math.max(1, ...days.map((d) => d.n));
  return (
    <div className="grid grid-flow-col grid-rows-7 gap-1" role="img" aria-label="近 12 週複習熱度">
      {days.map((d) => (
        <div key={d.day} title={`${d.day}：${d.n} 張`} className="h-3.5 w-3.5 rounded-[4px] transition hover:scale-125" style={{ background: d.n ? `rgba(99,102,241,${0.25 + (0.75 * d.n) / max})` : "rgb(148 163 184 / .18)" }} />
      ))}
    </div>
  );
}

export default function Me() {
  const user = useUser();
  const qc = useQueryClient();
  const stats = useQuery({ queryKey: ["me-stats"], queryFn: () => api.get<Stats>("/api/me/stats") });
  const mistakes = useQuery({ queryKey: ["mistakes"], queryFn: () => api.get<{ mistakes: Mistake[] }>("/api/me/mistakes") });
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  const [logoutBusy, setLogoutBusy] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const total = (stats.data?.daily ?? []).reduce((s, d) => s + d.n, 0);
  const again = (stats.data?.daily ?? []).reduce((s, d) => s + d.again, 0);

  return (
    <Page>
      <PageHeader
        title={user.name ?? user.email}
        subtitle={`${user.email} · ${user.role === "admin" ? "管理員" : "成員"}`}
        actions={
          <Button
            disabled={logoutBusy}
            onClick={async () => {
              setLogoutBusy(true); setLogoutError("");
              try {
                await api.post("/api/auth/logout");
                qc.clear();
                try { await caches.delete("classroom-media"); } catch { /* cache storage unavailable */ }
                location.href = "/login";
              } catch (error) { setLogoutError(errorMessage(error)); setLogoutBusy(false); }
            }}
          >
            <SignOut size={18} /> {logoutBusy ? "正在登出…" : "登出"}
          </Button>
        }
      />
      {logoutError && <p role="alert" className="mb-4 text-sm text-rose-600">登出尚未完成：{logoutError}。請再試一次。</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {stats.error && <div className="space-y-2 md:col-span-2"><ErrorBox error={stats.error} /><Button onClick={() => void stats.refetch()}>重試學習統計</Button></div>}
        <Card className="p-5">
          <h2 className="mb-3 font-semibold">字卡複習（近 90 天）</h2>
          {stats.data ? <><div className="mb-3 flex gap-6 text-sm">
            <div>
              <div className="text-2xl font-bold">{total}</div>
              <div className="text-slate-500">次複習</div>
            </div>
            <div>
              <div className="text-2xl font-bold">{total ? Math.round(((total - again) / total) * 100) : 0}%</div>
              <div className="text-slate-500">記得率</div>
            </div>
          </div>
          <Heatmap daily={stats.data.daily} /></> : stats.isPending ? <Loading /> : <p className="text-sm text-slate-500">複習統計暫時無法讀取。</p>}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">最近模擬考</h2>
          {!stats.data ? <p className="text-sm text-slate-500">{stats.isPending ? "正在讀取作答紀錄…" : "作答紀錄暫時無法讀取。"}</p> : stats.data.exams.length === 0 && <div className="text-sm text-slate-500">尚無作答紀錄</div>}
          <div className="space-y-2">
            {stats.data?.exams.slice(0, 6).map((e) => (
              <Link key={e.attempt_id ?? e.submitted_at} to={e.attempt_id ? `/attempts/${e.attempt_id}` : `/exams/${e.slug}`} className="flex min-h-11 items-center gap-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                <span className="font-mono">
                  {e.score === null ? "待完成評分" : `${e.score}/${e.max_score ?? 0}`}
                </span>
                <span className="text-xs text-slate-500">{fmtDate(e.submitted_at).slice(5, 10)}</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card className="p-5 md:col-span-2">
          <h2 className="mb-3 font-semibold">錯題本</h2>
          {mistakes.error && <div className="mb-3 space-y-2"><ErrorBox error={mistakes.error} /><Button onClick={() => void mistakes.refetch()}>重試錯題本</Button></div>}
          {!mistakes.data ? mistakes.isPending ? <Loading /> : null : mistakes.data.mistakes.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-slate-500"><Confetti size={18} className="text-brand-500" /> 目前沒有錯題</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {mistakes.data?.mistakes.map((m) => (
                <Link key={`${m.slug}-${m.question}`} to={`/attempts/${m.attempt_id}#q-${m.question}`} className="flex items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                  <span className="min-w-0 flex-1 truncate">
                    {m.title} · {m.question}
                  </span>
                  <span className="text-red-600">
                    {m.score}/{m.max}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">顯示</h2>
          <label className="flex items-center justify-between text-sm">
            深色模式
            <input
              type="checkbox"
              className="h-5 w-5"
              checked={dark}
              onChange={(e) => {
                setDark(e.target.checked);
                document.documentElement.classList.toggle("dark", e.target.checked);
                try { localStorage.setItem("theme", e.target.checked ? "dark" : "light"); }
                catch { toast("已套用於此分頁；瀏覽器未允許保存顯示設定"); }
              }}
            />
          </label>
        </Card>

        <Card className="p-5">
          <h2 className="mb-3 font-semibold">字型</h2>
          <FontSettings />
        </Card>

        {!isStandalone() && (
          <Card className="p-5">
            <h2 className="mb-2 font-semibold">安裝成 App</h2>
            {isIOS() ? (
              <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                <li>用 Safari 開啟本網站</li>
                <li className="flex items-center gap-1">點下方「分享」按鈕 <Export size={16} /></li>
                <li>選「加入主畫面」</li>
              </ol>
            ) : (
              <p className="text-sm text-slate-600 dark:text-slate-300">在 Chrome / Edge 網址列右側點「安裝」圖示，或選單中的「安裝應用程式」。</p>
            )}
          </Card>
        )}
      </div>
      <div className="mt-8 flex justify-center gap-4 text-xs text-slate-500">
        <Link to="/privacy" className="hover:text-brand-600">隱私權政策</Link>
        <span>·</span>
        <Link to="/terms" className="hover:text-brand-600">服務條款</Link>
      </div>
    </Page>
  );
}
