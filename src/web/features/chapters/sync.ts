// Chapters show up in several places (the chapter list, a chapter page, the content picker, the content library, the
// blueprint review). Every change to a chapter or to content that can sit in one refreshes all of them together, so no
// screen keeps showing a chapter or an item that was renamed, made private or deleted elsewhere.
import type { QueryClient } from "@tanstack/react-query";

const KEYS = [["chapters"], ["chapter"], ["content-pick"], ["content"], ["content-folders"], ["blueprints"], ["documents"], ["decks"]] as const;
export const refreshChapterData = (qc: QueryClient) => Promise.all(KEYS.map((queryKey) => qc.invalidateQueries({ queryKey: [...queryKey] })));
/** Chapter lists are cheap and change from other screens and from chatbots, so they never show a cached copy on open. */
export const ALWAYS_FRESH = { staleTime: 0, refetchOnMount: "always" as const, refetchOnWindowFocus: true };
