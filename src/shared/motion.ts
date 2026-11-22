// Shared by the website, sandboxed lesson CSS and the external chatbot brief.
export const STUDY_MOTION = {
  spring: { type: "spring", stiffness: 420, damping: 32, mass: 0.8 },
  softSpring: { type: "spring", stiffness: 220, damping: 26 },
  ease: [0.22, 1, 0.36, 1],
  exitEase: [0.4, 0, 1, 1],
  feedback: 0.16,
  instruction: 0.26,
  reveal: 0.46,
  scene: 0.38,
  stagger: 0.04,
  maxStagger: 0.16,
  travel: 12,
} as const;

export const motionBrief = {
  language: "與 STUDY 的按鈕、清單、側欄與頁面轉場使用同一套克制的彈簧及減速節奏，避免每個區域各自使用不同動畫。",
  sequence: "同一使用者事件：控制項立即回饋 → 指令於 0–80ms 內切換 → 對應教材與數值於 80–160ms 內依序揭露 → 進度/完成狀態收尾。這些延遲只控制視覺呈現，不得自動推進步驟或阻擋輸入。",
  timings: { feedback_ms: 160, instruction_ms: 260, reveal_ms: 460, scene_ms: 380, stagger_ms: 40, max_stagger_ms: 160, ease: "cubic-bezier(.22,1,.36,1)", spring: "stiffness:420, damping:32, mass:.8" },
  regions: "畫布、指令、側欄教材、數值回饋與進度須回應同一個事件，使用一致的方向與視覺焦點；新教材不能讓畫布忽然縮窄。above 區優先用於開場或固定高度標題，後續揭露放在側欄/下方，避免使用者拖曳時控制項移位。只有新解鎖內容進場，舊教材不重播；返回、重設、快速連續操作也須正確。",
  restraint: "主要動畫只用 transform/opacity，位移通常 8–16px、縮放幅度不超過 2%；只在有意義的點使用低強度灰白光暈。不做大幅彈跳、打字機逐字、整頁模糊、永久呼吸燈、閃爍或無止境動畫。真實物理模擬與即時指標不得為了裝飾而扭曲數值或時間。",
  accessibility: "prefers-reduced-motion 時取消位移、縮放、交錯延遲與持續裝飾；內容仍即時出現，焦點與可操作性不變。動畫不是解鎖條件，不能讓使用者等動畫結束才能操作。",
} as const;
