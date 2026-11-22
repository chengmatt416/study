// 浮動卡片的擺放規則：永遠完整留在畫面裡
import { describe, expect, it } from "vitest";
import { computePlacement, type Placement, type Rect } from "../src/web/lib/floating";

const vp: Rect = { left: 0, top: 0, width: 1024, height: 768 };
const size = { width: 400, height: 500 };
const inside = (p: Placement, h = Math.min(size.height, p.maxHeight), view = vp, margin = 12) => {
  expect(p.left).toBeGreaterThanOrEqual(view.left + margin - 0.01);
  expect(p.top).toBeGreaterThanOrEqual(view.top + margin - 0.01);
  expect(p.left + p.width).toBeLessThanOrEqual(view.left + view.width - margin + 0.01);
  expect(p.top + h).toBeLessThanOrEqual(view.top + view.height - margin + 0.01);
};
const overlaps = (p: Placement, a: Rect, h = size.height) => p.left < a.left + a.width && p.left + p.width > a.left && p.top < a.top + a.height && p.top + h > a.top;

describe("浮動卡片擺放", () => {
  it("右邊放得下就放右邊，不蓋住錨點", () => {
    const anchor = { left: 200, top: 200, width: 120, height: 80 };
    const p = computePlacement({ anchor, size, viewport: vp });
    expect(p.side).toBe("right");
    expect(p.fits).toBe(true);
    expect(p.left).toBe(200 + 120 + 12);
    expect(overlaps(p, anchor)).toBe(false);
    inside(p);
  });

  it("錨點在右邊緣：改放左邊；在下邊緣：往上移到放得下", () => {
    const anchor = { left: 880, top: 700, width: 120, height: 50 };
    const p = computePlacement({ anchor, size, viewport: vp });
    expect(p.side).toBe("left");
    expect(overlaps(p, anchor)).toBe(false);
    inside(p);
  });

  it("左右都放不下：放上面或下面", () => {
    const anchor = { left: 300, top: 40, width: 500, height: 60 };
    const p = computePlacement({ anchor, size, viewport: vp });
    expect(p.side).toBe("bottom");
    expect(overlaps(p, anchor)).toBe(false);
    inside(p);
  });

  it("四邊都放不下完整大小：選空間最大的一邊並縮小，高度不夠就內部捲動", () => {
    const anchor = { left: 150, top: 250, width: 724, height: 200 };
    const p = computePlacement({ anchor, size, viewport: vp, minHeight: 200 });
    expect(["top", "bottom"]).toContain(p.side);
    expect(p.fits).toBe(false);
    expect(p.maxHeight).toBeLessThan(size.height);
    expect(p.maxHeight).toBeGreaterThanOrEqual(200);
    expect(overlaps(p, anchor, p.maxHeight)).toBe(false);
    inside(p);
  });

  it("錨點佔滿畫面：疊在畫面裡，仍然完整可見", () => {
    const anchor = { left: 0, top: 0, width: 1024, height: 768 };
    const p = computePlacement({ anchor, size, viewport: vp });
    expect(p.side).toBe("overlay");
    inside(p);
  });

  it("錨點捲出畫面：卡片貼在靠近它的邊緣，不會跟著出去", () => {
    for (const anchor of [
      { left: 300, top: -900, width: 100, height: 60 },
      { left: 300, top: 2000, width: 100, height: 60 },
      { left: -700, top: 300, width: 100, height: 60 },
      { left: 3000, top: 300, width: 100, height: 60 },
    ]) {
      const p = computePlacement({ anchor, size, viewport: vp });
      inside(p);
    }
    const above = computePlacement({ anchor: { left: 300, top: -900, width: 100, height: 60 }, size: { width: 300, height: 200 }, viewport: vp, prefer: ["bottom", "top"] });
    // 錨點夾到上緣變成一條線：卡片貼著上緣（邊距 12）
    expect(above.top).toBe(12);
  });

  it("很小的畫面（手機、螢幕鍵盤彈出）：寬高都縮到畫面內", () => {
    const small: Rect = { left: 0, top: 0, width: 360, height: 300 };
    const p = computePlacement({ anchor: { left: 100, top: 100, width: 80, height: 40 }, size, viewport: small });
    expect(p.width).toBeLessThanOrEqual(360 - 24);
    expect(p.maxHeight).toBeLessThanOrEqual(300 - 24);
    inside(p, Math.min(size.height, p.maxHeight), small);
  });

  it("可用範圍不從 0 開始（螢幕鍵盤、工具列）也照樣留在範圍內", () => {
    const view: Rect = { left: 20, top: 110, width: 900, height: 420 };
    const p = computePlacement({ anchor: { left: 760, top: 480, width: 120, height: 40 }, size, viewport: view });
    inside(p, Math.min(size.height, p.maxHeight), view);
  });

  it("已經選好一邊：內容變長也不換邊（只要還放得下最小尺寸）", () => {
    const anchor = { left: 300, top: 430, width: 200, height: 60 };
    const first = computePlacement({ anchor, size: { width: 320, height: 200 }, viewport: vp, prefer: ["bottom", "top"] });
    expect(first.side).toBe("bottom");
    const grown = computePlacement({ anchor, size: { width: 320, height: 400 }, viewport: vp, prefer: ["bottom", "top"], stickySide: first.side, minHeight: 160 });
    expect(grown.side).toBe("bottom");
    expect(grown.maxHeight).toBeLessThan(400);
    // 沒有上一次的方向時，會選放得下的上面
    expect(computePlacement({ anchor, size: { width: 320, height: 400 }, viewport: vp, prefer: ["bottom", "top"] }).side).toBe("top");
  });

  it("對齊：靠右的按鈕，面板右緣對齊按鈕", () => {
    const anchor = { left: 960, top: 60, width: 40, height: 36 };
    const p = computePlacement({ anchor, size: { width: 340, height: 300 }, viewport: vp, prefer: ["bottom", "top"], align: "end", gap: 8, margin: 8 });
    expect(p.side).toBe("bottom");
    expect(p.left + p.width).toBe(1000);
    expect(p.top).toBe(104);
  });

  it("按鈕在畫面底部：面板往上開，不會超出下緣（舊版會超出）", () => {
    const anchor = { left: 500, top: 700, width: 40, height: 36 };
    const p = computePlacement({ anchor, size: { width: 340, height: 420 }, viewport: vp, prefer: ["bottom", "top"], gap: 8, margin: 8 });
    expect(p.side).toBe("top");
    inside(p, 420, vp, 8);
  });
});
