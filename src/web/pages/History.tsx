import { useState } from "react";
import { motion } from "motion/react";
import { ArrowLeft } from "@phosphor-icons/react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { api, errorMessage } from "../lib/api";
import { useUser } from "../lib/auth";
import { useDevice } from "../lib/device";
import { fmtDate } from "../lib/format";
import { Badge, Button, Card, Loading, PageHeader, toast } from "../components/ui";
import { Markdown } from "../components/Markdown";
import { Page } from "../layouts/Shell";

interface Rev {
  id: string;
  author_name: string | null;
  author_email: string | null;
  message: string | null;
  source: string;
  created_at: number;
  size: number;
}

const SOURCE: Record<string, string> = { manual: "手動儲存", autosave: "自動儲存", import: "建立/匯入", revert: "回復", baseline: "原版" };

export default function History() {
  const { slug } = useParams();
  const loc = useLocation();
  const base = loc.pathname.startsWith("/exams") ? "/exams" : "/notes";
  const user = useUser();
  const device = useDevice();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data, refetch } = useQuery({ queryKey: ["revisions", slug], queryFn: () => api.get<{ revisions: Rev[]; baselineId: string; currentId: string }>(`/api/documents/${slug}/revisions`) });
  const [selected, setSelected] = useState<string | null>(null);
  const [compareTo, setCompareTo] = useState<"previous" | "baseline" | "current">("previous");

  const revs = data?.revisions ?? [];
  const sel = selected ?? revs[0]?.id;
  const idx = revs.findIndex((r) => r.id === sel);
  const otherId = compareTo === "previous" ? revs[idx + 1]?.id : compareTo === "baseline" ? data?.baselineId : data?.currentId;
  const a = useQuery({ queryKey: ["rev", slug, sel], queryFn: () => api.get<{ revision: { body_md: string } }>(`/api/documents/${slug}/revisions/${sel}`), enabled: !!sel });
  const b = useQuery({ queryKey: ["rev", slug, otherId], queryFn: () => api.get<{ revision: { body_md: string } }>(`/api/documents/${slug}/revisions/${otherId}`), enabled: !!otherId && otherId !== sel });

  const act = async (path: string, body: unknown, msg: string) => {
    try {
      await api.post(`/api/documents/${slug}/${path}`, body);
      toast(msg);
      void refetch();
      qc.invalidateQueries({ queryKey: ["doc", slug] });
    } catch (e) {
      toast(errorMessage(e), "err");
    }
  };

  if (!data) return <Loading />;
  return (
    <Page wide>
      <PageHeader
        title="修訂歷史"
        actions={
          <Button variant="ghost" onClick={() => navigate(`${base}/${slug}`)}>
            <ArrowLeft size={18} /> 返回
          </Button>
        }
      />
      <div className={clsx("grid gap-4", device === "phone" ? "grid-cols-1" : "grid-cols-[320px_minmax(0,1fr)]")}>
        <Card className="max-h-[75vh] divide-y divide-slate-100 overflow-auto dark:divide-slate-800">
          {revs.map((r) => (
            <button key={r.id} onClick={() => setSelected(r.id)} className={clsx("relative block w-full px-4 py-3 text-left text-sm transition-colors", sel === r.id ? "bg-brand-50/80 dark:bg-brand-900/30" : "hover:bg-slate-50 dark:hover:bg-white/5")}>
              {sel === r.id && <motion.span layoutId="rev-sel" className="absolute inset-y-2 left-0 w-1 rounded-full bg-aurora" />}
              <div className="flex items-center gap-1.5">
                <span className="font-medium">{r.author_name ?? r.author_email ?? "系統"}</span>
                {r.id === data.currentId && <Badge color="brand">目前</Badge>}
                {r.id === data.baselineId && <Badge color="green">原版</Badge>}
              </div>
              <div className="text-xs text-slate-500">
                {fmtDate(r.created_at)} · {SOURCE[r.source] ?? r.source}
              </div>
              {r.message && <div className="mt-0.5 truncate text-xs">{r.message}</div>}
            </button>
          ))}
        </Card>
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
            比較對象：
            {(["previous", "baseline", "current"] as const).map((k) => (
              <button key={k} onClick={() => setCompareTo(k)} className={clsx("rounded-xl px-3 py-1 transition", compareTo === k ? "bg-aurora text-on-accent shadow-[var(--shadow-glow)]" : "bg-slate-900/5 dark:bg-white/10")}>
                {{ previous: "上一版", baseline: "原版", current: "目前版" }[k]}
              </button>
            ))}
            {user.role === "admin" && sel && (
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => confirm("將此版本設為原版？") && act("baseline", { revision_id: sel }, "已設為原版")}>
                  設為原版
                </Button>
                <Button size="sm" variant="danger" onClick={() => confirm("回復到此版本？（會新增一筆修訂，原有歷史保留）") && act("revert", { revision_id: sel }, "已回復")}>
                  回復到此版
                </Button>
              </div>
            )}
          </div>
          <Card className="p-4 md:p-6">
            {a.isLoading ? <Loading /> : a.data && <Markdown md={a.data.revision.body_md} baseline={otherId && otherId !== sel ? b.data?.revision.body_md ?? null : null} mode="exam-review" />}
          </Card>
          <p className="mt-2 text-xs text-slate-500">
            螢光顯示從「{{ previous: "上一版", baseline: "原版", current: "目前版" }[compareTo]}」到「所選版本」的差異。<Link to={`${base}/${slug}`} className="underline">返回文件</Link>
          </p>
        </div>
      </div>
    </Page>
  );
}
