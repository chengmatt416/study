// 防誤觸引擎的判斷核心：手掌、筆剛離開、筆尖附近、追溯丟掉
import { describe, expect, it } from "vitest";
import { inPalmZone, judgeOnPenDown, judgeTouch, type PenState } from "../src/web/lib/mistouch";

const pen = (over: Partial<PenState> = {}): PenState => ({ down: false, x: 500, y: 500, lastContactAt: 0, lastHoverAt: 0, ...over });
const finger = (x: number, y: number, radius = 12, onInkSurface = true) => ({ x, y, radius, onInkSurface });

describe("防誤觸：新的接觸", () => {
  it("筆壓著時所有接觸都丟掉（關閉防誤觸也一樣）", () => {
    expect(judgeTouch(finger(100, 100), pen({ down: true }), 1000, "standard")).toEqual({ reject: true, reason: "pen-down" });
    expect(judgeTouch(finger(100, 100), pen({ down: true }), 1000, "off")).toEqual({ reject: true, reason: "pen-down" });
  });

  it("沒有在用筆：手指照常可用，再大的接觸也不擋", () => {
    expect(judgeTouch(finger(520, 540, 60), pen(), 1000, "standard").reject).toBe(false);
    // 很久以前用過筆
    expect(judgeTouch(finger(520, 540, 60), pen({ lastContactAt: 1000 }), 60_000, "standard").reject).toBe(false);
  });

  it("書寫中：接觸面很大的是手掌，不管落在哪裡", () => {
    const p = pen({ lastContactAt: 10_000 });
    expect(judgeTouch(finger(100, 900, 44), p, 12_000, "standard")).toEqual({ reject: true, reason: "palm-size" });
    expect(judgeTouch(finger(100, 900, 44, false), p, 12_000, "standard")).toEqual({ reject: true, reason: "palm-size" });
    // 一般手指大小不算
    expect(judgeTouch(finger(100, 100, 18), p, 12_000, "standard").reject).toBe(false);
  });

  it("筆剛離開：筆尖旁邊、下方的小接觸是手掌或小指；筆尖上方遠處的是另一隻手", () => {
    const p = pen({ lastContactAt: 10_000 });
    expect(judgeTouch(finger(620, 640), p, 10_300, "standard")).toEqual({ reject: true, reason: "palm-zone" });
    expect(judgeTouch(finger(520, 200), p, 10_300, "standard").reject).toBe(false);
    expect(judgeTouch(finger(60, 520), p, 10_300, "standard").reject).toBe(false);
    // 過了寬限時間就可以用手指捲動
    expect(judgeTouch(finger(620, 640), p, 11_200, "standard").reject).toBe(false);
  });

  it("筆懸在螢幕上方時，筆尖附近的接觸也算手掌", () => {
    const p = pen({ lastContactAt: 1000, lastHoverAt: 19_950 });
    expect(judgeTouch(finger(600, 600), p, 20_000, "standard")).toEqual({ reject: true, reason: "palm-zone" });
  });

  it("按鈕與面板上的小接觸是真的要點（另一隻手換工具）", () => {
    const p = pen({ lastContactAt: 10_000 });
    expect(judgeTouch(finger(620, 640, 12, false), p, 10_300, "standard").reject).toBe(false);
    expect(judgeTouch(finger(620, 640, 12, false), p, 10_300, "strict").reject).toBe(false);
  });

  it("加強模式：筆剛離開的一小段時間，書寫區不接受任何新接觸；範圍與時間也更大", () => {
    const p = pen({ lastContactAt: 10_000 });
    expect(judgeTouch(finger(60, 60), p, 10_200, "strict")).toEqual({ reject: true, reason: "lockout" });
    expect(judgeTouch(finger(60, 60), p, 10_600, "strict").reject).toBe(false);
    expect(judgeTouch(finger(900, 700), p, 11_200, "strict")).toEqual({ reject: true, reason: "palm-zone" });
    expect(judgeTouch(finger(100, 900, 32), p, 40_000, "strict")).toEqual({ reject: true, reason: "palm-size" });
  });

  it("關閉：只有筆壓著時才擋", () => {
    const p = pen({ lastContactAt: 10_000 });
    expect(judgeTouch(finger(620, 640, 50), p, 10_100, "off").reject).toBe(false);
  });
});

describe("防誤觸：筆落下時已經在螢幕上的接觸", () => {
  it("標準與加強：全部追溯丟掉（先放手掌再下筆）", () => {
    expect(judgeOnPenDown({ ...finger(100, 100), startedAt: 0 }, { x: 500, y: 500 }, 5000, "standard")).toBe(true);
    expect(judgeOnPenDown({ ...finger(100, 100), startedAt: 0 }, { x: 500, y: 500 }, 5000, "strict")).toBe(true);
  });
  it("關閉：只丟掉剛放下的、很大的、或在筆尖旁邊的", () => {
    const at = { x: 500, y: 500 };
    expect(judgeOnPenDown({ ...finger(100, 100), startedAt: 0 }, at, 5000, "off")).toBe(false);
    expect(judgeOnPenDown({ ...finger(100, 100), startedAt: 4800 }, at, 5000, "off")).toBe(true);
    expect(judgeOnPenDown({ ...finger(100, 100, 50), startedAt: 0 }, at, 5000, "off")).toBe(true);
    expect(judgeOnPenDown({ ...finger(600, 620), startedAt: 0 }, at, 5000, "off")).toBe(true);
  });
  it("手掌範圍：筆尖周圍，但不含正上方", () => {
    expect(inPalmZone({ x: 600, y: 600 }, { x: 500, y: 500 }, 380)).toBe(true);
    expect(inPalmZone({ x: 500, y: 300 }, { x: 500, y: 500 }, 380)).toBe(false);
    expect(inPalmZone({ x: 1000, y: 500 }, { x: 500, y: 500 }, 380)).toBe(false);
  });
});
