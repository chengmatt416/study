import { useCallback } from "react";
import { useReducedMotion } from "motion/react";

/** Focus new reading content when it mounts, without interrupting answers or iframe gestures. */
export function useLessonFocus() {
  const reduced = useReducedMotion();
  return useCallback((node: HTMLElement | null) => {
    if (!node) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: "nearest", behavior: reduced ? "instant" : "smooth" });
  }, [reduced]);
}
