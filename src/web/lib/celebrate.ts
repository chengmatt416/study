import confetti from "canvas-confetti";

/** 完成時的彩帶動畫（尊重「減少動態效果」設定） */
export function celebrate(intensity: "small" | "big" = "big") {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const colors = ["#0a0a0a", "#3f3f46", "#71717a", "#a1a1aa", "#d4d4d8", "#ffffff"];
  if (intensity === "small") {
    void confetti({ particleCount: 60, spread: 70, origin: { y: 0.7 }, colors, scalar: 0.9 });
    return;
  }
  const end = Date.now() + 900;
  const frame = () => {
    void confetti({ particleCount: 6, angle: 60, spread: 70, origin: { x: 0, y: 0.75 }, colors });
    void confetti({ particleCount: 6, angle: 120, spread: 70, origin: { x: 1, y: 0.75 }, colors });
    if (Date.now() < end) requestAnimationFrame(frame);
  };
  frame();
  setTimeout(() => void confetti({ particleCount: 140, spread: 100, startVelocity: 45, origin: { y: 0.6 }, colors }), 250);
}
