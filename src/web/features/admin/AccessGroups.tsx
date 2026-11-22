import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FEATURES, type AccessResource, type AccessRule, type ResourceType } from "../../../shared/access";
import { api, errorMessage } from "../../lib/api";
import { Button, Card, ErrorBox, inputCls, Loading, toast } from "../../components/ui";

interface Group { id: string; name: string; description: string; version: number; members: string[]; rules: AccessRule[] }
interface Data { groups: Group[]; users: { email: string; name: string | null; role: string }[]; resources: AccessResource[] }

export function AccessGroups() {
  const query = useQuery({ queryKey: ["access-groups"], queryFn: () => api.get<Data>("/api/admin/access-groups"), refetchOnWindowFocus: false });
  const [selected, setSelected] = useState("");
  if (query.isLoading) return <Loading />;
  if (query.error || !query.data) return <ErrorBox error={query.error} />;
  const group = query.data.groups.find((g) => g.id === selected);
  return <div className="space-y-4">
    <Card className="space-y-3 p-5">
      <h2 className="text-xl font-semibold">使用者群組與內容存取</h2>
      <p className="text-sm leading-6 text-slate-500">未設定規則時維持開放。停用「共享內容寫入」可保留個人複習、作答及私人內容，但禁止修改共享教材、字卡、課程及標注。私人內容僅建立者可見，不列入群組內容覆寫。電子書、資料手冊與學期課綱分開控制；個別內容可覆寫同群組的功能預設。使用者屬於多個群組時，任一群組的有效拒絕優先。管理員不受群組限制。</p>
      <label className="block text-sm">編輯群組<select className={`${inputCls} mt-2 w-full`} value={selected} onChange={(e) => setSelected(e.target.value)}><option value="">建立新群組</option>{query.data.groups.map((g) => <option key={g.id} value={g.id}>{g.name} · {g.members.length} 位成員</option>)}</select></label>
    </Card>
    <GroupEditor key={`${group?.id ?? "new"}-${group?.version ?? 0}`} group={group} data={query.data} onSaved={setSelected} reload={() => query.refetch()} />
  </div>;
}

function GroupEditor({ group, data, onSaved, reload }: { group?: Group; data: Data; onSaved: (id: string) => void; reload: () => Promise<unknown> }) {
  const qc = useQueryClient();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [members, setMembers] = useState(group?.members ?? []);
  const [rules, setRules] = useState<Pick<AccessRule, "resource_type" | "resource_id" | "allowed">[]>(group?.rules ?? []);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const update = (type: ResourceType, id: string, value: string) => setRules((old) => [
    ...old.filter((r) => r.resource_type !== type || r.resource_id !== id),
    ...(value === "inherit" ? [] : [{ resource_type: type, resource_id: id, allowed: Number(value) }]),
  ]);
  const permission = (type: ResourceType, id: string, label: string) => <label key={`${type}:${id}`} className="flex items-center justify-between gap-3 border-b border-black/5 py-3 text-sm dark:border-white/10">
    <span className="min-w-0 flex-1 break-words">{label}</span>
    <select aria-label={`${label} 存取權限`} className={`${inputCls} w-32 shrink-0`} value={rules.find((r) => r.resource_type === type && r.resource_id === id)?.allowed ?? "inherit"} onChange={(e) => update(type, id, e.target.value)}>
      <option value="inherit">{type === "feature" ? "預設開放" : "繼承功能"}</option><option value="1">允許</option><option value="0">拒絕</option>
    </select>
  </label>;
  return <div className="space-y-4">
    <Card className="space-y-4 p-5">
      <label className="block text-sm">群組名稱<input className={`${inputCls} mt-1 w-full`} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} /></label>
      <label className="block text-sm">說明<textarea className={`${inputCls} mt-1 w-full`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} /></label>
      <fieldset><legend className="mb-2 font-semibold">群組成員</legend><div className="grid max-h-72 gap-2 overflow-auto sm:grid-cols-2">{data.users.map((u) => <label key={u.email} className="flex items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={members.includes(u.email)} onChange={(e) => setMembers(e.target.checked ? [...members, u.email] : members.filter((m) => m !== u.email))} /><span className="break-all">{u.name ?? u.email}<span className="block text-xs text-slate-500">{u.email}{u.role === "admin" ? " · 管理員不受限制" : ""}</span></span></label>)}</div></fieldset>
    </Card>
    <Card className="p-5"><h3 className="font-semibold">功能預設</h3>{Object.entries(FEATURES).map(([id, label]) => permission("feature", id, label))}</Card>
    <Card className="space-y-3 p-5"><h3 className="font-semibold">個別內容覆寫</h3><input aria-label="搜尋個別內容" className={`${inputCls} w-full`} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="搜尋 INS、課程名稱、書名或 ID" /><div className="max-h-[32rem] overflow-auto">{data.resources.filter((r) => `${r.title} ${r.id} ${FEATURES[r.feature]}`.toLowerCase().includes(filter.toLowerCase())).map((r) => permission(r.type, r.id, `${FEATURES[r.feature]} · ${r.title}`))}</div></Card>
    <div className="flex flex-wrap gap-3">
      <Button variant="primary" disabled={busy || !name.trim()} onClick={async () => {
        setBusy(true);
        try {
          const body = { name, description, members, rules, expected_version: group?.version };
          const result = group ? await api.put<{ id: string }>(`/api/admin/access-groups/${group.id}`, body) : await api.post<{ id: string }>("/api/admin/access-groups", body);
          await reload(); await qc.invalidateQueries({ queryKey: ["me"] }); onSaved(result.id); toast("群組權限已儲存，後續線上請求將套用新規則");
        } catch (e) { toast(errorMessage(e), "err"); } finally { setBusy(false); }
      }}>儲存群組與權限</Button>
      {group && <Button variant="danger" disabled={busy} onClick={async () => {
        if (!confirm(`刪除「${group.name}」會移除其成員與限制規則，可能重新開放內容。確定繼續？`)) return;
        setBusy(true);
        try { await api.del(`/api/admin/access-groups/${group.id}`); await reload(); onSaved(""); toast("群組已刪除"); }
        catch (e) { toast(errorMessage(e), "err"); } finally { setBusy(false); }
      }}>刪除群組</Button>}
    </div>
  </div>;
}
