// 防誤觸引擎的判斷核心（純函式，沒有 DOM）：一個新的手指／手掌接觸要不要當成誤觸丟掉。
// 事件的攔截在 inkGuard.ts。
//
// 判斷依據（由強到弱）：
// 1. 筆正壓在螢幕上：其他接觸都是手掌或握筆的手。
// 2. 書寫中（剛用過筆）而且接觸面很大：手掌、手腕、掌緣。
// 3. 筆剛離開或正懸在螢幕上方，接觸落在「手掌會放的位置」（筆尖附近、不在筆尖上方）。
// 4. 加強模式：筆剛離開的短時間內，書寫區的任何新接觸都不算。
// 被丟掉的接觸到它離開螢幕為止都不算（手掌放著、筆抬起來換行時，手掌的移動不會變成捲動或縮放）。

export type GuardLevel = "off" | "standard" | "strict";

export interface GuardConfig {
  /** 接觸半徑（CSS px）超過這個值就當成手掌 */
  palmRadius: number;
  /** 筆離開後多久內還算「正在書寫」（看接觸面積用） */
  sessionMs: number;
  /** 筆離開後多久內，筆尖附近的接觸算手掌 */
  graceMs: number;
  /** 筆尖周圍多遠算手掌會放的範圍（CSS px） */
  palmZone: number;
  /** 筆離開後多久內書寫區不接受任何新接觸（0＝不啟用） */
  lockoutMs: number;
}

export const GUARD_CONFIG: Record<Exclude<GuardLevel, "off">, GuardConfig> = {
  standard: { palmRadius: 36, sessionMs: 8000, graceMs: 650, palmZone: 380, lockoutMs: 0 },
  strict: { palmRadius: 30, sessionMs: 60_000, graceMs: 1500, palmZone: 520, lockoutMs: 450 },
};

export interface PenState {
  /** 筆尖壓在螢幕上 */
  down: boolean;
  /** 筆最近的位置（接觸或懸停），CSS px */
  x: number;
  y: number;
  /** 最後一次接觸螢幕的時間（放開時更新）；沒用過為 0 */
  lastContactAt: number;
  /** 最後一次偵測到懸停的時間；不支援懸停的裝置為 0 */
  lastHoverAt: number;
}

export interface TouchSample {
  x: number;
  y: number;
  /** 接觸半徑（CSS px）；裝置沒有回報時為 0 */
  radius: number;
  /** 落在書寫區（頁面、畫布）裡，而不是按鈕或面板上 */
  onInkSurface: boolean;
}

export type RejectReason = "pen-down" | "palm-size" | "palm-zone" | "lockout";
export type Verdict = { reject: false } | { reject: true; reason: RejectReason };

const ACCEPT: Verdict = { reject: false };

/** 筆懸停在螢幕上方多久內算「筆還在」 */
export const HOVER_PRESENT_MS = 260;

/** 接觸是不是落在手掌會放的位置：筆尖附近，而且不在筆尖正上方（寫字時手在筆尖的下方或側邊） */
export function inPalmZone(t: { x: number; y: number }, pen: { x: number; y: number }, zone: number): boolean {
  const dx = t.x - pen.x;
  const dy = t.y - pen.y;
  if (Math.hypot(dx, dy) > zone) return false;
  // 筆尖上方 40px 以上的接觸通常是另一隻手在操作（工具列在上面）
  return dy > -40;
}

/** 新的接觸要不要丟掉 */
export function judgeTouch(touch: TouchSample, pen: PenState, now: number, level: GuardLevel): Verdict {
  // 筆壓著：一律丟掉（關閉防誤觸時也一樣，否則手掌會捲動頁面、打斷筆畫）
  if (pen.down) return { reject: true, reason: "pen-down" };
  if (level === "off") return ACCEPT;
  const cfg = GUARD_CONFIG[level];
  const sinceContact = pen.lastContactAt > 0 ? now - pen.lastContactAt : Infinity;
  const hovering = pen.lastHoverAt > 0 && now - pen.lastHoverAt <= HOVER_PRESENT_MS;
  const inSession = hovering || sinceContact <= cfg.sessionMs;
  if (!inSession) return ACCEPT;

  if (touch.radius >= cfg.palmRadius) return { reject: true, reason: "palm-size" };
  // 以下只管書寫區：按鈕與面板上的小接觸是真的要點（另一隻手換工具）
  if (!touch.onInkSurface) return ACCEPT;
  if (cfg.lockoutMs > 0 && sinceContact <= cfg.lockoutMs) return { reject: true, reason: "lockout" };
  if ((hovering || sinceContact <= cfg.graceMs) && inPalmZone(touch, pen, cfg.palmZone)) return { reject: true, reason: "palm-zone" };
  return ACCEPT;
}

/**
 * 筆落下時，已經在螢幕上的接觸要不要追溯丟掉。
 * 筆落下的那一刻還壓著的接觸幾乎都是手掌（先放手掌再下筆）；
 * 例外：很久以前就按著、而且離筆很遠的小接觸（例如另一隻手按住頁面），關閉防誤觸時才保留。
 */
export function judgeOnPenDown(touch: TouchSample & { startedAt: number }, pen: { x: number; y: number }, now: number, level: GuardLevel): boolean {
  if (level !== "off") return true;
  const cfg = GUARD_CONFIG.standard;
  return touch.radius >= cfg.palmRadius || now - touch.startedAt < 400 || inPalmZone(touch, pen, cfg.palmZone);
}
