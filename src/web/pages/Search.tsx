import { useEffect, useState } from "react";
import { Books, Exam, MagnifyingGlass, NotePencil } from "@phosphor-icons/react";
import { Link, useSearchParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Button, Card, Empty, ErrorBox, inputCls, Loading } from "../components/ui";
import { Page } from "../layouts/Shell";

interface Results {
  documents: { kind: string; slug: string; title: string; snippet: string }[];
  cards: { id: string; deck_id: string; front: string; back: string; deck_title: string }[];
  books: { id: string; title: string }[];
}

export default function Search() {
  const [params, setParams] = useSearchParams();
  const q = (params.get("q") ?? "").trim();
  const [input, setInput] = useState(q);
  useEffect(() => { setInput(q); }, [q]);
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ["search", q], queryFn: () => api.get<Results>(`/api/search?q=${encodeURIComponent(q)}`), enabled: !!q });
  const total = data ? data.documents.length + data.cards.length + data.books.length : 0;
  return (
    <Page>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const value = input.trim();
          setInput(value);
          setParams(value ? { q: value } : {});
        }}
        className="mb-6 flex gap-2" role="search" aria-label="搜尋教材"
      >
        <input autoFocus type="search" aria-label="搜尋筆記、試題、字卡、書名" className={inputCls + " h-14 min-w-0 flex-1 rounded-3xl px-5 text-base"} placeholder="搜尋筆記、試題、字卡、書名" value={input} onChange={(e) => setInput(e.target.value)} />
        <Button type="submit" className="h-14 shrink-0">搜尋</Button>
      </form>
      {!q && <Empty icon={<MagnifyingGlass size={36} />} title="想學什麼？">輸入關鍵字，搜尋筆記、試題、字卡與書名。</Empty>}
      {error && <Card className="mb-6 space-y-3 p-4"><ErrorBox error={error} /><Button disabled={isFetching} onClick={() => void refetch()}>{isFetching ? "重試中…" : "重新搜尋"}</Button></Card>}
      {isLoading && <Loading />}
      {data && total === 0 && <Empty icon={<MagnifyingGlass size={36} />} title={`找不到「${q}」`} />}
      {data && data.books.length > 0 && (
        <Section title="電子書">
          {data.books.map((b) => (
            <Link key={b.id} to={`/books/${b.id}`} className="block rounded px-4 py-3 [overflow-wrap:anywhere] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-slate-800/50">
              <span className="flex min-w-0 items-center gap-2"><Books size={18} className="shrink-0 text-brand-500" /> <span className="min-w-0">{b.title}</span></span>
            </Link>
          ))}
        </Section>
      )}
      {data && data.documents.length > 0 && (
        <Section title="重點整理與試題">
          {data.documents.map((d) => (
            <Link key={d.slug} to={`/${d.kind === "note" ? "notes" : "exams"}/${d.slug}`} className="block rounded px-4 py-3 [overflow-wrap:anywhere] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-slate-800/50">
              <div className="flex items-center gap-2 font-medium">
                {d.kind === "note" ? <NotePencil size={18} className="shrink-0 text-emerald-500" /> : <Exam size={18} className="shrink-0 text-amber-500" />} <span className="min-w-0">{d.title}</span>
              </div>
              <div className="mt-0.5 line-clamp-2 text-sm text-slate-500">{d.snippet}</div>
            </Link>
          ))}
        </Section>
      )}
      {data && data.cards.length > 0 && (
        <Section title="字卡">
          {data.cards.map((c) => (
            <Link key={c.id} to={`/decks/${c.deck_id}?card=${c.id}`} className="block rounded px-4 py-3 [overflow-wrap:anywhere] hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 dark:hover:bg-slate-800/50">
              <div className="text-xs text-slate-500">{c.deck_title}</div>
              <div className="line-clamp-1 font-medium">{c.front}</div>
              <div className="line-clamp-1 text-sm text-slate-500">{c.back}</div>
            </Link>
          ))}
        </Section>
      )}
    </Page>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-semibold text-slate-500">{title}</h2>
      <Card className="divide-y divide-slate-100 dark:divide-slate-800">{children}</Card>
    </section>
  );
}
