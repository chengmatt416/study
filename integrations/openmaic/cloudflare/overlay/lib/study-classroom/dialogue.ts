/** Split narration without breaking math, decimals, inline code or code fences. */
export function splitDialogue(text: string): string[] {
  const protectedText = text.replace(/```[\s\S]*?```|`[^`\n]*`|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\n])+\$/g, match => '字'.repeat(match.length));
  const segmenter = new Intl.Segmenter('zh-TW', { granularity: 'sentence' });
  const result = [...segmenter.segment(protectedText)]
    .map(segment => text.slice(segment.index, segment.index + segment.segment.length).trim())
    .filter(Boolean);
  return result.length ? result : [''];
}

/** A sentence that tells the learner to do something with the module, so the dock can say "your turn" even when no pointer action came with it. */
export function needsOperation(sentence: string): boolean {
  return /(請你?|換你|試試|試著|現在|接下來|動手|你可以).{0,14}(拖曳|拖到|拖進|點擊|點選|按住|按下|旋開|調整|轉動|操作|放入|放到|倒入|滴入|接線|連接|開啟|打開|對焦|記錄|讀出|讀取)/.test(sentence);
}

/** Elements that already use Space for themselves: typing, pressing, toggling, sliding. */
const OWN_SPACE = 'input, textarea, select, button, a[href], summary, label, [contenteditable=""], [contenteditable="true"], [role=button], [role=slider], [role=radio], [role=checkbox], [role=switch], [role=tab], [role=option], [role=menuitem], [role=textbox], [role=combobox], [role=dialog], [tabindex]:not([tabindex="-1"])';
type KeyLike = { key: string; repeat?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; defaultPrevented?: boolean; isComposing?: boolean; target: EventTarget | null };

/** Space moves the lesson on, but only when the key press is not meant for something else on the page. */
export function spaceContinues(event: KeyLike): boolean {
  if (event.key !== ' ' || event.repeat || event.defaultPrevented || event.isComposing) return false;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false;
  const target = event.target as { closest?: (selector: string) => Element | null } | null;
  return !(target && typeof target.closest === 'function' && target.closest(OWN_SPACE));
}
