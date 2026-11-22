export function mergeSearchParams(values: Record<string, string>, defaults: Record<string, string> = {}): URLSearchParams {
  // Navigation can update the URL before React commits the previous filter.
  const next = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) value === (defaults[key] ?? "") ? next.delete(key) : next.set(key, value);
  return next;
}
