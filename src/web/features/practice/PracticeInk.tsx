import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { practiceStrokePath, StrokeBuilder } from "./stroke";
import { INK_GUARD_CANCEL_EVENT, isPenActive } from "../../lib/inkGuard";
import { capturePointer } from "../../lib/pointerCapture";

type Gesture = {
  pointerId: number;
  startTime: number;
  pressure: number;
  builder: StrokeBuilder;
};

function addSamples(gesture: Gesture, surface: SVGSVGElement, events: PointerEvent[]) {
  const rect = surface.getBoundingClientRect();
  for (const event of events) {
    gesture.pressure = event.pressure || gesture.pressure;
    gesture.builder.add({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
      pressure: gesture.pressure,
      t: event.timeStamp - gesture.startTime,
    });
  }
}

function touchCenter(touches: Map<number, number>) {
  if (touches.size < 2) return null;
  const [first, second] = touches.values();
  return (first + second) / 2;
}

export function PracticeInk({ active, penOnly, onPen, onPan, strokes, onStroke }: {
  active: boolean;
  penOnly: boolean;
  onPen: () => void;
  onPan: (distance: number) => void;
  strokes: { id: string; path: string }[];
  onStroke: (path: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const gesture = useRef<Gesture | null>(null);
  const touches = useRef(new Map<number, number>());
  const scrollMark = useRef<number | null>(null);
  const frame = useRef(0);
  const clearGesture = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    gesture.current = null;
    setDraft("");
  }, []);

  useEffect(() => {
    if (!active) {
      touches.current.clear();
      scrollMark.current = null;
      clearGesture();
    }
  }, [active, clearGesture]);
  useEffect(() => {
    function rejectTouch(event: Event) {
      const id = gesture.current?.pointerId;
      const { pointerIds } = (event as CustomEvent<{ pointerIds: number[] }>).detail;
      for (const pointerId of pointerIds) touches.current.delete(pointerId);
      scrollMark.current = touchCenter(touches.current);
      if (id !== undefined && pointerIds.includes(id)) clearGesture();
    }
    window.addEventListener(INK_GUARD_CANCEL_EVENT, rejectTouch);
    return () => {
      window.removeEventListener(INK_GUARD_CANCEL_EVENT, rejectTouch);
      cancelAnimationFrame(frame.current);
    };
  }, [clearGesture]);

  function start(event: ReactPointerEvent<SVGSVGElement>) {
    if (!active || event.button !== 0) return;
    const kind = event.pointerType;
    if (kind !== "pen" && kind !== "mouse" && kind !== "touch") return;
    if (kind === "touch" && (penOnly || isPenActive() || (gesture.current && !touches.current.has(gesture.current.pointerId)))) return;
    if (kind === "pen") {
      onPen();
      if (touches.current.size) {
        touches.current.clear();
        scrollMark.current = null;
        clearGesture();
      }
    }
    event.preventDefault();
    capturePointer(event.currentTarget, event.pointerId);
    if (kind === "touch") {
      touches.current.set(event.pointerId, event.clientY);
      if (touches.current.size >= 2) {
        clearGesture();
        scrollMark.current = touchCenter(touches.current);
        return;
      }
    }
    if (gesture.current) return;
    const current = {
      pointerId: event.pointerId, startTime: event.timeStamp, pressure: 0.5,
      builder: new StrokeBuilder({ kind }),
    };
    gesture.current = current;
    addSamples(current, event.currentTarget, [event.nativeEvent]);
    setDraft(practiceStrokePath(current.builder.points()));
  }

  function move(event: ReactPointerEvent<SVGSVGElement>) {
    if (!active) return;
    if (touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, event.clientY);
      const center = touchCenter(touches.current);
      if (center !== null) {
        if (scrollMark.current !== null) onPan(scrollMark.current - center);
        scrollMark.current = center;
        return;
      }
    }
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const samples = event.nativeEvent.getCoalescedEvents?.();
    addSamples(current, event.currentTarget, samples?.length ? samples : [event.nativeEvent]);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      setDraft(practiceStrokePath(current.builder.points()));
    });
  }

  function end(event: ReactPointerEvent<SVGSVGElement>) {
    if (touches.current.delete(event.pointerId)) scrollMark.current = touchCenter(touches.current);
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (active && event.type === "pointerup") {
      addSamples(current, event.currentTarget, [event.nativeEvent]);
      const path = practiceStrokePath(current.builder.finish());
      if (path) onStroke(path);
    }
    clearGesture();
  }

  return <svg className="practice-ink" aria-hidden="true" data-ink="" data-ink-zone="" data-active={active}
    style={{ touchAction: penOnly ? "pan-y" : "none" }}
    onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
    {strokes.map(stroke => <path key={stroke.id} d={stroke.path} />)}
    {draft && <path d={draft} />}
  </svg>;
}
