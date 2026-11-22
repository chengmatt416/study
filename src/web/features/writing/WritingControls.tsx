import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CornersIn, CornersOut, Timer } from "@phosphor-icons/react";
import { IconButton } from "../../components/ui";

function readElapsed(key: string) {
  try {
    const saved = Number(sessionStorage.getItem(key));
    return Number.isFinite(saved) && saved > 0 ? saved : 0;
  } catch {
    return 0;
  }
}

function WritingTimer({ storageKey, running }: { storageKey: string; running: boolean }) {
  const [elapsed, setElapsed] = useState(() => readElapsed(storageKey));
  const saved = useRef(elapsed);

  useEffect(() => {
    if (!running) {
      setElapsed(saved.current);
      return;
    }
    const start = performance.now();
    const elapsedNow = () => saved.current + (performance.now() - start);
    const persist = (value: number) => {
      try { sessionStorage.setItem(storageKey, String(value)); } catch { /* The clock works without storage. */ }
    };
    const checkpoint = () => persist(elapsedNow());
    const interval = window.setInterval(() => setElapsed(elapsedNow()), 1000);
    window.addEventListener("pagehide", checkpoint);
    return () => {
      saved.current = elapsedNow();
      persist(saved.current);
      window.clearInterval(interval);
      window.removeEventListener("pagehide", checkpoint);
    };
  }, [running, storageKey]);

  const seconds = Math.floor(elapsed / 1000);
  const time = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  return <span className="writing-timer" role="timer" aria-label="累計作答時間">
    <Timer size={15} aria-hidden="true" />{time}
  </span>;
}

function FullscreenWritingButton() {
  const [focused, setFocused] = useState(() =>
    typeof document !== "undefined" && document.fullscreenElement === document.documentElement,
  );

  useEffect(() => {
    const sync = () => setFocused(document.fullscreenElement === document.documentElement);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useLayoutEffect(() => {
    if (!focused) return;
    const root = document.documentElement;
    root.setAttribute("data-writing-focus", "");
    const exitFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented && document.fullscreenElement !== root) setFocused(false);
    };
    window.addEventListener("keydown", exitFocus);
    return () => {
      root.removeAttribute("data-writing-focus");
      window.removeEventListener("keydown", exitFocus);
      if (document.fullscreenElement === root) {
        // Entering fullscreen can change the responsive shell. Keep native fullscreen if the writer remounts.
        requestAnimationFrame(() => {
          if (document.fullscreenElement === root && !root.hasAttribute("data-writing-focus")) {
            void document.exitFullscreen().catch(() => {});
          }
        });
      }
    };
  }, [focused]);

  function toggle() {
    const root = document.documentElement;
    if (focused) {
      if (document.fullscreenElement === root) void document.exitFullscreen().catch(() => {});
      else setFocused(false);
    } else {
      setFocused(true);
      if (document.fullscreenEnabled) void root.requestFullscreen?.({ navigationUI: "hide" }).catch(() => {});
    }
  }

  return <IconButton type="button" label={focused ? "離開全螢幕" : "全螢幕作答"} active={focused}
    className="h-10 w-10" onClick={toggle}>
    {focused ? <CornersIn size={18} /> : <CornersOut size={18} />}
  </IconButton>;
}

export function WritingControls({ storageKey, running }: { storageKey: string; running: boolean }) {
  return <div className="exam-bar-tools">
    <WritingTimer storageKey={storageKey} running={running} />
    <FullscreenWritingButton />
  </div>;
}
