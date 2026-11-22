import { useState } from "react";
import { BookOpen, Books as BooksIcon, FileText, Folder, GearSix, UploadSimple } from "@phosphor-icons/react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { api } from "../lib/api";
import { useUser } from "../lib/auth";
import { useDevice } from "../lib/device";
import { fmtBytes } from "../lib/format";
import { mergeSearchParams } from "../lib/search-params";
import type { Book } from "../lib/types";
import { Badge, Button, Card, Empty, ErrorBox, inputCls, Loading, PageHeader, Sheet, Stagger, StaggerItem, SubjectDot, SubjectSelect, toast } from "../components/ui";
import { Page } from "../layouts/Shell";
import { UploadSheet } from "../features/reader/UploadSheet";

export default function Books() {
  const user = useUser();
  const device = useDevice();
  const [params, setParams] = useSearchParams();
  const subject = params.get("subject_id") ?? "";
  const resume = params.get("resume") === "1";
  const filter = (values: Record<string, string>) => setParams(mergeSearchParams(values));
  const [uploadOpen, setUploadOpen] = useState(false);
  const [editing, setEditing] = useState<Book | null>(null);
  const booksQuery = useQuery({ queryKey: ["books"], queryFn: () => api.get<{ books: Book[] }>("/api/books"), enabled: user.access?.features.ebooks !== false });
  const books = (booksQuery.data?.books ?? []).filter((b) => (!subject || b.subject_id === subject) && (!resume || !!b.last_page && b.status === "ready"));
  const booklets = useQuery({ queryKey: ["booklets"], queryFn: () => api.get<{ books: Book[] }>("/api/books?kind=booklet"), enabled: user.access?.features.booklets !== false });
  const [bookletUpload, setBookletUpload] = useState(false);
  const bookletList = (booklets.data?.books ?? []).filter((b) => !subject || b.subject_id === subject);

  return (
    <Page wide>
      <PageHeader
        title={user.access?.features.ebooks === false ? "資料手冊" : resume ? "繼續閱讀" : "電子書"}
        subtitle="閱讀、標注，數學科可同時開啟計算機"
        actions={
          <>
            <Link to="/content?kind=book" className="inline-flex h-10 items-center gap-2 rounded-2xl px-3 text-sm font-medium text-slate-600 hover:bg-slate-900/5 dark:text-slate-300"><Folder size={18} />整理內容</Link>
            <label><span className="sr-only">篩選科目</span><SubjectSelect value={subject} onChange={(value) => filter({ subject_id: value })} allowAll /></label>
            {(resume || subject) && <Button variant="ghost" onClick={() => filter({ resume: "", subject_id: "" })}>查看全部書籍</Button>}
            {user.role === "admin" && user.access?.features.ebooks !== false && (
              <Button variant="primary" onClick={() => setUploadOpen(true)}>
                <UploadSimple size={18} weight="bold" /> 上傳 PDF
              </Button>
            )}
          </>
        }
      />
      {user.access?.features.ebooks !== false && <>
      {booksQuery.error && <Card className="mb-4 space-y-3 p-4"><ErrorBox error={booksQuery.error} /><Button disabled={booksQuery.isFetching} onClick={() => void booksQuery.refetch()}>{booksQuery.isFetching ? "重試中…" : "重新載入書架"}</Button></Card>}
      {booksQuery.isLoading ? (
        <Loading />
      ) : !booksQuery.data ? null : books.length === 0 ? (
        <Empty icon={<BooksIcon size={36} />} title={resume ? "還沒有閱讀紀錄" : subject ? "這個科目還沒有書籍" : "書架是空的"}>{resume ? "打開一本書後，可在這裡接續上次的頁碼。" : user.role === "admin" && "點右上角「上傳 PDF」新增"}</Empty>
      ) : (
        <Stagger className={clsx("grid gap-5", device === "phone" ? "grid-cols-2" : device === "tablet" ? "grid-cols-4" : "grid-cols-5")}>
          {books.map((b) => (
            <StaggerItem key={b.id} className="group">
              <Link to={`/books/${b.id}${b.last_page ? `?page=${b.last_page}` : ""}`} className="block">
                <div className="relative aspect-[3/4] overflow-hidden rounded-2xl border border-black/[0.04] bg-slate-200 shadow-[var(--shadow-soft)] transition duration-200 ease-out group-hover:-translate-y-1 group-hover:shadow-[var(--shadow-lift)] dark:border-white/[0.06] dark:bg-ink-800">
                  {b.has_cover ? <img src={`/api/books/${b.id}/cover`} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center bg-slate-100 text-slate-700 dark:bg-white/10 dark:text-slate-200"><BookOpen size={44} /></div>}
                  {b.status !== "ready" && <div className="absolute inset-0 grid place-items-center bg-black/60 text-xs font-semibold text-white">上傳未完成</div>}
                  {b.last_page && b.page_count && (
                    <div className="absolute inset-x-0 bottom-0 h-1 bg-black/20">
                      <div className="h-full bg-aurora" style={{ width: `${(b.last_page / b.page_count) * 100}%` }} />
                    </div>
                  )}
                </div>
                <div className="mt-2 line-clamp-2 text-sm font-medium">{b.title}</div>
              </Link>
              <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                <SubjectDot subjectId={b.subject_id} />
                {b.has_text_layer === 0 && <Badge color="yellow">掃描檔</Badge>}
                {user.role === "admin" && (
                  <button className="ml-auto grid min-h-11 min-w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-900/5 hover:text-brand-600 focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => setEditing(b)} aria-label={`設定 ${b.title}`}>
                    <GearSix size={16} />
                  </button>
                )}
              </div>
            </StaggerItem>
          ))}
        </Stagger>
      )}</>}
      {user.access?.features.booklets !== false && <section className="mt-12">
        <div className="mb-4 flex items-center gap-2">
          <FileText size={22} />
          <h2 className="flex-1 font-display text-2xl font-semibold">資料手冊</h2>
          {user.access?.defaults.booklets !== false && <Button size="sm" onClick={() => setBookletUpload(true)}>
            <UploadSimple size={16} weight="bold" /> 上傳資料手冊
          </Button>}
        </div>
        {booklets.error && <Card className="mb-4 space-y-3 p-4"><ErrorBox error={booklets.error} /><Button disabled={booklets.isFetching} onClick={() => void booklets.refetch()}>{booklets.isFetching ? "重試中…" : "重新載入資料手冊"}</Button></Card>}
        {booklets.isLoading ? <Loading /> : !booklets.data ? null : bookletList.length === 0 ? (
          <p className="text-sm text-slate-500">IB Data Booklet、公式表等，可連結到模擬試題，作答時在旁邊開啟查閱。</p>
        ) : (
          <div className={clsx("grid gap-3", device === "phone" ? "grid-cols-1" : "grid-cols-3")}>
            {bookletList.map((b) => (
              <div key={b.id} className="hairline flex items-center gap-3 rounded-2xl bg-white/90 p-3 shadow-[var(--shadow-soft)] transition hover:-translate-y-0.5 dark:bg-ink-900/80">
              <Link to={`/books/${b.id}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2">
                <span className="grid h-12 w-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-ink-100 dark:bg-white/10">
                  {b.has_cover ? <img src={`/api/books/${b.id}/cover`} alt="" className="h-full w-full object-cover" /> : <FileText size={20} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{b.title}</div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <SubjectDot subjectId={b.subject_id} />
                    {b.page_count ? `${b.page_count} 頁` : ""}
                  </div>
                </div>
                </Link>
                {user.role === "admin" && (
                  <button className="grid min-h-11 min-w-11 place-items-center rounded-lg text-slate-400 hover:bg-slate-900/5 focus-visible:outline-2 focus-visible:outline-offset-2" onClick={() => setEditing(b)} aria-label={`設定 ${b.title}`}>
                    <GearSix size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>}
      <UploadSheet open={uploadOpen} onClose={() => setUploadOpen(false)} />
      <UploadSheet open={bookletUpload} onClose={() => setBookletUpload(false)} kind="booklet" />
      {editing && <BookSettings book={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function BookSettings({ book, onClose }: { book: Book; onClose: () => void }) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(book.title);
  const [subject, setSubject] = useState(book.subject_id ?? "");
  const [offset, setOffset] = useState(String(book.page_offset));
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const refresh = () => Promise.all(["books", "booklets", "syllabi", "content"].map((key) => qc.invalidateQueries({ queryKey: [key] })).concat(qc.invalidateQueries({ queryKey: ["book", book.id] })));
  const save = async () => {
    if (busy || !title.trim()) return;
    setBusy(true); setError(null);
    try {
      await api.put(`/api/books/${book.id}`, { title, subject_id: subject || null, page_offset: Number(offset) || 0 });
      await refresh();
      toast("已儲存");
      onClose();
    } catch (e) {
      setError(e);
    } finally { setBusy(false); }
  };
  const remove = async () => {
    if (busy) return;
    if (!confirm(`確定刪除「${book.title}」？所有人的標注也會一併刪除，無法復原。`)) return;
    setBusy(true); setError(null);
    try {
      await api.del(`/api/books/${book.id}`);
      await refresh(); onClose();
    } catch (cause) { setError(cause); }
    finally { setBusy(false); }
  };
  return (
    <Sheet open onClose={() => { if (!busy) onClose(); }} title="書籍設定">
      <fieldset disabled={busy} className="space-y-3 p-4">
        <label className="block text-sm">
          書名
          <input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="block text-sm">
          科目
          <div>
            <SubjectSelect value={subject} onChange={setSubject} />
          </div>
        </label>
        <label className="block text-sm">
          頁碼偏移（PDF 頁數 = 課本印刷頁碼 + 偏移）
          <input className={inputCls} type="number" value={offset} onChange={(e) => setOffset(e.target.value)} />
          <span className="text-xs text-slate-500">例：課本第 1 頁在 PDF 第 9 頁 → 偏移填 8。重點整理中的 [P58](book:{book.id}#58) 會自動跳到正確頁。</span>
        </label>
        {error ? <ErrorBox error={error} /> : null}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button variant="primary" disabled={busy || !title.trim()} onClick={save}>
            {busy ? "處理中…" : "儲存"}
          </Button>
          <Button disabled={busy} onClick={() => setReplace(true)}>替換 PDF 檔</Button>
          <Button variant="danger" disabled={busy} className="ml-auto" onClick={remove}>
            刪除
          </Button>
        </div>
        <div className="text-xs text-slate-500">
          ID：<code>{book.id}</code> · {fmtBytes(book.size_bytes)} · {book.page_count ?? "?"} 頁
        </div>
      </fieldset>
      <UploadSheet open={replace} onClose={() => setReplace(false)} replace={book} />
    </Sheet>
  );
}
