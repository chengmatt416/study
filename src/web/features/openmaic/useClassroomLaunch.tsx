import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useIsPresent } from "motion/react";
import { errorMessage } from "../../lib/api";
import { runClassroomLaunch, submitSessionForm, type LaunchSession } from "./classroom-launch";
import { prepareClassroomServiceWorker } from "./service-worker";

interface LaunchCoordinator {
  busy: boolean;
  reserve: (controller: AbortController) => boolean;
  release: (controller: AbortController) => void;
}
const LaunchContext = createContext<LaunchCoordinator | null>(null);

export function ClassroomLaunchProvider({ children }: { children: ReactNode }) {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const reserve = useCallback((controller: AbortController) => {
    if (active.current) return false;
    active.current = controller; setBusy(true); return true;
  }, []);
  const release = useCallback((controller: AbortController) => {
    if (active.current !== controller) return;
    active.current = null; setBusy(false);
  }, []);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const value = useMemo(() => ({ busy, reserve, release }), [busy, reserve, release]);
  return <LaunchContext.Provider value={value}>{children}</LaunchContext.Provider>;
}

export function useClassroomLaunch() {
  const coordinator = useContext(LaunchContext);
  const present = useIsPresent();
  const release = coordinator?.release;
  const active = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  useLayoutEffect(() => {
    if (present || !active.current) return;
    const controller = active.current;
    controller.abort(); active.current = null; release?.(controller);
    setBusy(false); setError(null);
  }, [present, release]);
  useEffect(() => () => {
    const controller = active.current;
    controller?.abort(); active.current = null;
    if (controller) release?.(controller);
  }, [release]);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  const cancel = () => {
    const controller = active.current;
    controller?.abort(); active.current = null;
    if (controller) release?.(controller);
    setBusy(false); setError(null);
    const target = trigger.current;
    requestAnimationFrame(() => { if (target?.isConnected && document.activeElement === document.body) target.focus(); });
  };
  const launch = async (getSession: (signal: AbortSignal) => Promise<LaunchSession>) => {
    if (active.current) return;
    const controller = new AbortController();
    if (coordinator && !coordinator.reserve(controller)) return;
    active.current = controller;
    trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sourcePage = window.location.pathname + window.location.search;
    setStep(0); setElapsed(0); setBusy(true); setError(null);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(120_000)]);
    try {
      await runClassroomLaunch(getSession, current => { if (active.current === controller) setStep(current); }, signal, {
        prepare: prepareClassroomServiceWorker,
        navigate: path => window.location.assign(path),
        form: submitSessionForm,
        isCurrent: () => {
          if (window.location.pathname + window.location.search === sourcePage) return true;
          controller.abort(); return false;
        },
      });
    } catch (cause) {
      if (active.current !== controller) return;
      setError(controller.signal.aborted ? null : signal.aborted ? "課堂開啟逾時，可以重試或稍後再開啟。" : errorMessage(cause));
      active.current = null; release?.(controller); setBusy(false);
    }
  };
  return { busy, blocked: !!coordinator?.busy && !busy, error, step, elapsed, launch, cancel };
}
