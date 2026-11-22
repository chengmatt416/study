import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";
import { acceptsLessonProgress, lessonFlowPrelude, lessonStepsSchema } from "../src/shared/lesson-flow";
import { moduleOutput } from "./fixtures/course-generation";
import { STUDY_MOTION } from "../src/shared/motion";

describe("使用者事件逐步揭露", () => {
  it("拒絕錯誤 channel、跳步、重播及未知步驟", () => {
    const steps = lessonStepsSchema.parse(moduleOutput.lesson_steps);
    const message = { type: "study:lesson-progress", channel: "channel", index: 1, step_id: "observe" };
    expect(acceptsLessonProgress(message, "channel", steps, 0)).toBe(true);
    expect(acceptsLessonProgress(message, "other", steps, 0)).toBe(false);
    expect(acceptsLessonProgress(message, "channel", steps, 1)).toBe(false);
    expect(acceptsLessonProgress({ ...message, index: 2 }, "channel", steps, 0)).toBe(false);
    expect(acceptsLessonProgress({ ...message, step_id: "missing" }, "channel", steps, 0)).toBe(false);
  });

  it("iframe 與其他區域共享動態節奏，舊內容不重播，減少動態時立即顯示", () => {
    const prelude = lessonFlowPrelude(lessonStepsSchema.parse(moduleOutput.lesson_steps), "channel");
    expect(prelude).toContain(`--study-motion-reveal:${STUDY_MOTION.reveal * 1000}ms`);
    expect(prelude).toContain("prefers-reduced-motion:reduce");
    expect(prelude).toContain("animation:none");
    expect(prelude).toContain("firstReveal");
  });

  it.each(["input", "pointerup", "drop"] as const)("實際執行 iframe bridge (%s)：合成事件、錯誤值、同一手勢不推進", async (event) => {
    const steps = lessonStepsSchema.parse(moduleOutput.lesson_steps);
    steps[1].reveal_on!.event = event;
    steps.push({ ...steps[1], id: "explain", title: "應用", reveal_on: { event, selector: "#m", value: "4" } });
    const listeners: Record<string, ((e: Record<string, unknown>) => void)[]> = {};
    const windowListeners: Record<string, (e: Record<string, unknown>) => void> = {};
    const messages: unknown[] = [];
    class Element {
      value = "1";
      hidden = false;
      attributes = new Map<string, string>();
      reveals: string[] = [];
      style = { setProperty: (_name: string, value: string) => this.reveals.push(value) };
      constructor(attributes: Record<string, string> = {}) { Object.entries(attributes).forEach(([name, value]) => this.attributes.set(name, value)); }
      getAttribute(name: string) { return this.attributes.get(name) ?? null; }
      hasAttribute(name: string) { return this.attributes.has(name); }
      setAttribute(name: string, value: string) { this.attributes.set(name, value); }
      removeAttribute(name: string) { this.attributes.delete(name); }
      closest(selector: string) { return selector === "#m" ? this : null; }
    }
    const target = new Element();
    const content = [new Element({ "data-lesson-content": "predict" }), new Element({ "data-lesson-content": "observe" })];
    const instructions = [new Element({ "data-lesson-instruction": "predict" }), new Element({ "data-lesson-instruction": "observe" })];
    const parent = { postMessage: (data: unknown) => messages.push(data) };
    const root = { parent, addEventListener: (name: string, fn: (e: Record<string, unknown>) => void) => { windowListeners[name] = fn; } };
    const document = { readyState: "complete", querySelectorAll: () => [...content, ...instructions], addEventListener: (name: string, fn: (e: Record<string, unknown>) => void) => { (listeners[name] ??= []).push(fn); } };
    const prelude = lessonFlowPrelude(steps, "test-channel");
    const script = prelude.match(/<script>([\s\S]*)<\/script>/)![1];
    runInNewContext(script, { window: root, document, Element, queueMicrotask });
    expect(content.every((el) => el.hidden)).toBe(true);
    windowListeners.message({ source: {}, data: { type: "study:lesson-sync", channel: "test-channel", index: 0 } });
    const emit = async (type: string, trusted: boolean, timestamp: number) => {
      for (const listener of listeners[type] ?? []) listener({ type, isTrusted: trusted, timeStamp: timestamp, target });
      await Promise.resolve();
    };
    await emit(event, true, 1000);
    expect(messages).toHaveLength(0);
    windowListeners.message({ source: parent, data: { type: "study:lesson-sync", channel: "test-channel", index: 0 } });
    expect(content.map((el) => el.hidden)).toEqual([false, true]);
    target.value = "4";
    await emit(event, false, 1100);
    expect(messages).toHaveLength(0);
    target.value = "2";
    await emit("pointerdown", true, 1200); await emit(event, true, 1300);
    expect(messages).toHaveLength(0);
    target.value = "4";
    await emit(event, true, 1500);
    expect(messages).toHaveLength(1);
    expect(content.map((el) => el.hidden)).toEqual([false, false]);
    expect(instructions.map((el) => el.hidden)).toEqual([true, false]);
    expect(content[0].reveals).toHaveLength(1);
    windowListeners.message({ source: parent, data: { type: "study:lesson-sync", channel: "test-channel", index: 1 } });
    expect(content[0].reveals).toHaveLength(1);
    expect(content[1].reveals).toHaveLength(1);
    await emit(event, true, 1900);
    expect(messages).toHaveLength(1);
    await emit("pointerdown", true, 2100); await emit(event, true, 2300);
    expect(messages).toHaveLength(2);
  });
});
