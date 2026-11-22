import type { ReactNode } from "react";
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from "motion/react";
import { STUDY_MOTION } from "../../shared/motion";

function TransitionBody({ children, direction }: { children: ReactNode; direction: number }) {
  const reduced = useReducedMotion();
  const present = useIsPresent();
  return <motion.div inert={!present} aria-hidden={!present || undefined} initial={reduced ? false : { opacity: 0, x: direction * STUDY_MOTION.travel }} animate={{ opacity: 1, x: 0, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -4, transition: { duration: 0.1, ease: STUDY_MOTION.exitEase } }} transition={{ duration: reduced ? 0 : STUDY_MOTION.scene, ease: STUDY_MOTION.ease }} className="min-w-0">{children}</motion.div>;
}

/** Changes the presentation without remounting content on ordinary state updates. */
export function ContentTransition({ id, children, direction = 1 }: { id: string | number; children: ReactNode; direction?: number }) {
  return <AnimatePresence initial={false} mode="wait"><TransitionBody key={id} direction={direction}>{children}</TransitionBody></AnimatePresence>;
}
