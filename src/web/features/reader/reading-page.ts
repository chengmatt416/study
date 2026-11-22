export function clampReadingPage(value: number, total: number): number {
  return Math.min(Math.max(1, Number.isFinite(value) ? Math.trunc(value) : 1), Math.max(1, total));
}

export function initialReadingPage(params: URLSearchParams, lastPage: number | null | undefined, offset: number, total: number): number {
  const printed = params.get("printed");
  const target = printed ? Number(printed) + offset : Number(params.get("page") ?? lastPage ?? 1);
  return clampReadingPage(target, total);
}

export function visibleReadingPage(top: number, viewport: number, pageHeight: number, gap: number, total: number): number {
  return clampReadingPage(Math.floor((top + Math.min(viewport / 3, pageHeight / 2)) / (pageHeight + gap)) + 1, total);
}
