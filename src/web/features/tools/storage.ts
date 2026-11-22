export const toolStorageKey = (owner: string, key: string) => `study-tools:${encodeURIComponent(owner)}:${key}`;

export function readToolStorage(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function writeToolStorage(key: string, value: string): boolean {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
