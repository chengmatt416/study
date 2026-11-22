import { useEffect } from "react";

/** 輸入欄位與公式框（含 Shadow DOM 的 math-field）在輸入時不攔截快捷鍵。 */
const TYPING_FIELD =
  "input:not([type='radio'], [type='checkbox']), textarea, select, math-field, [contenteditable='true']";

export function hasOpenModalDialog(): boolean {
  return Boolean(document.querySelector("dialog[open], [role='dialog'][aria-modal='true']"));
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest(TYPING_FIELD)) return true;
  const active = document.activeElement;
  if (active instanceof Element && active.closest(TYPING_FIELD)) return true;
  return false;
}

export function isInteractiveTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(
    target.closest(
      "input, textarea, select, button, a[href], summary, dialog, math-field, [contenteditable='true'], [role='button'], [role='separator'], [role='tab']",
    ),
  );
}

/**
 * Typeform 風格按鍵快選：按選項鍵（A, B, C… 或 1, 2, 3…）直接選取。
 * 在輸入文字、組字（注音/拼音）、按住修飾鍵、焦點在 MathLive 公式框或對話框開啟時自動停用。
 */
export function useOptionShortcuts(
  keys: readonly (string | null)[],
  pick: ((index: number) => void) | null,
  aliases?: readonly (readonly string[])[],
) {
  useEffect(() => {
    if (!pick) return;
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.defaultPrevented ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing ||
        event.keyCode === 229 ||
        isTypingTarget(event.target) ||
        hasOpenModalDialog()
      ) {
        return;
      }
      const pressed = event.key.toLowerCase();
      let index = keys.findIndex((key) => key?.toLowerCase() === pressed);
      if (index < 0 && aliases) {
        index = aliases.findIndex((group) => group.some((alias) => alias.toLowerCase() === pressed));
      }
      if (index < 0) return;
      event.preventDefault();
      pick?.(index);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [keys, pick, aliases]);
}
