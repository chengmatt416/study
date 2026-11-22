/**
 * setPointerCapture 在指標已結束時會丟錯（系統中途取消觸控、手掌誤觸被瀏覽器收回、合成事件）。
 * 捕捉失敗不該讓這次書寫或拖曳整個中斷：失敗就照常處理，只是不捕捉。
 */
export function capturePointer(el: Element | null | undefined, pointerId: number): void {
  try {
    el?.setPointerCapture?.(pointerId);
  } catch {
    /* 指標已不在作用中 */
  }
}
