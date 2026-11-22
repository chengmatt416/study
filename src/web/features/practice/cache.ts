import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type { PracticeCursor, PracticePage, PracticeSource } from "../../../shared/practice";
import { api } from "../../lib/api";
import type { PracticeLane } from "./plan";

export const firstPracticeCursor: PracticeCursor = { key: "", offset: 0 };

export const practicePageKey = (userId: string) => ["practice-page", userId] as const;
export const practiceSubjectKey = (userId: string) => ["practice-subjects", userId] as const;

export async function resetPracticePages(query: QueryClient, userId: string) {
  const filter = { queryKey: practicePageKey(userId) };
  await query.cancelQueries(filter);
  query.removeQueries(filter);
}

export function practicePageQuery(userId: string, lane: PracticeLane, cursor: PracticeCursor, source: PracticeSource) {
  const query = new URLSearchParams({
    kind: lane.kind, level: lane.level, after: cursor.key, offset: String(cursor.offset), source,
  });
  for (const subject of lane.subjectIds) query.append("subject", subject);
  return queryOptions({
    queryKey: [...practicePageKey(userId), query.toString()],
    queryFn: ({ signal }) => api.get<PracticePage>(`/api/practice/items?${query}`, { signal }),
    staleTime: 90_000,
    gcTime: 120_000,
    retry: false,
  });
}
