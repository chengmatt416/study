// STUDY module kit: pre-designed interactive components injected into generated interactive modules.
// Spec: docs/module-kit.md. The chatbot writes short <sk-*> markup instead of CSS, JS and the postMessage
// boilerplate. The CSS/JS strings must not contain backticks or ${ so they stay valid inside String.raw.
import { STUDY_LAB_CSS, STUDY_LAB_JS, hasStudyLab } from './module-lab';
export const MODULE_KIT_VERSION = 'study-kit/v1';

export const STUDY_KIT_CSS = String.raw`
:root{--sk-bg:#fafafa;--sk-card:rgb(255 255 255/.9);--sk-card-solid:#fff;--sk-line:rgb(15 23 42/.06);--sk-edge:#e4e4e7;--sk-ink:#0f172a;--sk-mute:#64748b;--sk-chip:rgb(15 23 42/.05);--sk-from:#0a0a0a;--sk-to:#3f3f46;--sk-on:#fff;--sk-focus:#0a0a0a;--sk-ok:#047857;--sk-ok-bg:#ecfdf5;--sk-bad:#be123c;--sk-bad-bg:#fff1f2;--sk-soft:0 1px 3px 0 rgb(0 0 0/.03),0 6px 16px -4px rgb(0 0 0/.05);--sk-lift:0 4px 6px -1px rgb(0 0 0/.04),0 16px 28px -6px rgb(0 0 0/.08);--sk-glow:0 8px 24px -6px rgb(0 0 0/.22);--sk-sheen:inset 0 1px 0 rgb(255 255 255/.7);--sk-ambient:rgb(0 0 0/.035);--sk-ease:cubic-bezier(.22,1,.36,1);--sk-control:160ms;--sk-command:260ms;--sk-reveal:460ms;--sk-r-btn:16px;--sk-r-card:24px}
@media (prefers-color-scheme:dark){:root{--sk-bg:#09090b;--sk-card:rgb(18 18 20/.8);--sk-card-solid:#121214;--sk-line:rgb(255 255 255/.08);--sk-edge:rgb(255 255 255/.12);--sk-ink:#f1f5f9;--sk-mute:#94a3b8;--sk-chip:rgb(255 255 255/.05);--sk-from:#fff;--sk-to:#d4d4d8;--sk-on:#0a0a0a;--sk-focus:#fff;--sk-ok:#6ee7b7;--sk-ok-bg:rgb(16 185 129/.15);--sk-bad:#fda4af;--sk-bad-bg:rgb(244 63 94/.15);--sk-soft:0 1px 3px 0 rgb(0 0 0/.35),0 6px 18px -4px rgb(0 0 0/.5);--sk-lift:0 4px 8px -1px rgb(0 0 0/.45),0 20px 32px -6px rgb(0 0 0/.6);--sk-glow:0 8px 24px -8px rgb(255 255 255/.14);--sk-sheen:inset 0 1px 0 rgb(255 255 255/.06);--sk-ambient:rgb(255 255 255/.05)}}
[hidden]{display:none!important}
body{margin:0;background:var(--sk-bg) radial-gradient(70rem 40rem at 50% -20%,var(--sk-ambient),transparent 70%) fixed;color:var(--sk-ink);font:16px/1.7 'Geist','Inter','Noto Sans TC','PingFang TC','Microsoft JhengHei',system-ui,sans-serif;font-feature-settings:'cv11','ss01','ss03','tnum';-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
sk-module,sk-split,sk-stack,sk-tabs,sk-tab,sk-controls,sk-callout,sk-figure,sk-plot,sk-steps,sk-step,sk-reveal,sk-hints,sk-choice,sk-numeric,sk-order,sk-match,sk-slider,sk-segmented,sk-toggle,sk-readout,sk-progress,sk-record,sk-sort,sk-label,sk-pick,sk-fill,sk-balance,sk-tune,sk-knob,sk-text{display:block}
sk-observe,sk-option,sk-hint,sk-explain,sk-wrong,sk-item,sk-pair,sk-col,sk-bucket,sk-card,sk-term{display:none}
sk-module{max-width:1080px;margin:0 auto;padding:clamp(16px,3vw,32px)}
.sk-title{margin:0 0 4px;font:600 clamp(22px,2.6vw,30px)/1.3 'Fraunces','Noto Serif TC','Songti TC',serif;letter-spacing:-.015em;text-wrap:balance}
.sk-goal{margin:0 0 20px;color:var(--sk-mute);max-width:64ch;text-wrap:pretty}
sk-split{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:clamp(16px,3vw,32px);align-items:start}
sk-stack>*+*{margin-top:16px}
sk-controls,sk-choice,sk-numeric,sk-order,sk-match,sk-figure,sk-plot,sk-callout,sk-record,sk-sort,sk-label,sk-pick,sk-fill,sk-balance,sk-tune,sk-knob{border:1px solid var(--sk-line);border-radius:var(--sk-r-card);background:var(--sk-card);box-shadow:var(--sk-soft),var(--sk-sheen);backdrop-filter:blur(8px)}
sk-controls{display:grid;gap:14px;padding:18px}
sk-figure,sk-plot{padding:12px}
@media (max-width:700px){sk-split{grid-template-columns:minmax(0,1fr)}}
.sk-label{display:flex;justify-content:space-between;gap:12px;font-size:14px;font-weight:550}
.sk-value{font-variant-numeric:tabular-nums;color:var(--sk-mute);font-weight:450}
sk-slider input[type=range]{width:100%;height:44px;margin:0;background:transparent;accent-color:var(--sk-from);touch-action:pan-y}
.sk-btn{position:relative;isolation:isolate;min-height:44px;padding:8px 16px;border:1px solid var(--sk-line);border-radius:var(--sk-r-btn);background:var(--sk-card);color:var(--sk-ink);font:inherit;font-size:14px;font-weight:500;box-shadow:var(--sk-soft);cursor:pointer;user-select:none;transition:background-color var(--sk-control) ease,box-shadow var(--sk-control) ease,color var(--sk-control) ease,transform var(--sk-control) var(--sk-ease)}
@media (hover:hover){.sk-btn:hover:not(:disabled):not(.sk-primary):not([aria-checked=true]){background:var(--sk-card-solid)}.sk-primary:hover:not(:disabled){filter:brightness(1.12)}}
.sk-btn:active:not(:disabled){transform:scale(.97)}.sk-btn:disabled{opacity:.4;cursor:default}
.sk-btn.sk-primary,sk-segmented .sk-btn[aria-checked=true],sk-toggle .sk-btn[aria-checked=true]{overflow:hidden;border-color:transparent;background:linear-gradient(135deg,var(--sk-from) 0%,var(--sk-to) 100%);color:var(--sk-on);box-shadow:var(--sk-glow)}
.sk-btn.sk-primary::before,sk-segmented .sk-btn[aria-checked=true]::before,sk-toggle .sk-btn[aria-checked=true]::before{content:"";position:absolute;inset:0;z-index:-1;background:linear-gradient(to bottom,rgb(255 255 255/.15),transparent);pointer-events:none}
:where(.sk-btn,input,select,[tabindex],summary):focus-visible{outline:2px solid var(--sk-focus);outline-offset:2px;border-radius:var(--sk-r-btn)}
sk-segmented .sk-group{display:flex;flex-wrap:wrap;gap:8px}
sk-readout{position:relative;padding:12px 18px 12px 20px;border:1px solid var(--sk-line);border-radius:var(--sk-r-btn);background:var(--sk-card);box-shadow:var(--sk-soft),var(--sk-sheen)}
sk-readout::before{content:"";position:absolute;left:0;top:12px;bottom:12px;width:3px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,var(--sk-from),var(--sk-to))}
sk-readout .sk-rv{display:block;font-size:clamp(22px,3vw,30px);font-variant-numeric:tabular-nums;font-weight:600;line-height:1.3}
sk-readout .sk-rl{font-size:13px;color:var(--sk-mute)}
sk-readout .sk-rv.sk-tick{animation:sk-tick var(--sk-control) var(--sk-ease)}
@keyframes sk-tick{from{opacity:.45;transform:translateY(3px)}to{opacity:1;transform:none}}
sk-figure svg,sk-plot svg{display:block;width:100%;height:auto;max-height:70vh}
sk-figure svg *{transition:transform var(--sk-command) var(--sk-ease),opacity var(--sk-command) var(--sk-ease)}
.sk-cap{margin:6px 4px 0;font-size:13px;color:var(--sk-mute)}
.sk-axis{stroke:var(--sk-mute);stroke-width:1}.sk-grid{stroke:var(--sk-line);stroke-width:1}.sk-tick{fill:var(--sk-mute);font-size:11px}
.sk-line{fill:none;stroke:var(--sk-from);stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}.sk-line.sk-alt{stroke:var(--sk-mute);stroke-dasharray:6 5}
.sk-line.sk-draw{stroke-dasharray:var(--sk-len);stroke-dashoffset:var(--sk-len);animation:sk-draw var(--sk-reveal) var(--sk-ease) forwards}
@keyframes sk-draw{to{stroke-dashoffset:0}}
.sk-dot{fill:var(--sk-from);stroke:var(--sk-bg);stroke-width:2}
sk-callout{padding:14px 18px;border-left:3px solid var(--sk-mute);border-radius:var(--sk-r-btn)}
sk-callout[kind=warn]{border-left-color:var(--sk-bad)}sk-callout[kind=worked],sk-callout[kind=example]{border-left-color:var(--sk-from)}
sk-callout>.sk-ct{display:block;margin-bottom:4px;font-size:12px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--sk-mute)}
sk-steps .sk-nav,.sk-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:12px}
sk-steps .sk-count{margin-right:auto;font-size:13px;color:var(--sk-mute);font-variant-numeric:tabular-nums}
.sk-in{animation:sk-in var(--sk-reveal) var(--sk-ease)}@keyframes sk-in{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
sk-step>h3,.sk-q{margin:0 0 6px;font-size:17px;font-weight:600;line-height:1.5}
sk-reveal>.sk-body,sk-hints .sk-hl{margin-top:10px;padding:14px 16px;border:1px solid var(--sk-line);border-radius:var(--sk-r-btn);background:var(--sk-chip)}
sk-hints .sk-hl{margin-top:8px}
sk-choice,sk-numeric,sk-order,sk-match,sk-sort,sk-label,sk-pick,sk-fill,sk-balance,sk-tune,sk-knob{padding:18px}.sk-bw{min-width:0}.sk-pool{margin:10px 0}
.sk-opts{display:grid;gap:8px;margin:10px 0}
.sk-opt{display:flex;gap:12px;align-items:flex-start;min-height:44px;padding:10px 14px;border:1px solid var(--sk-line);border-radius:var(--sk-r-btn);background:var(--sk-card);box-shadow:var(--sk-soft);cursor:pointer;transition:transform var(--sk-command) var(--sk-ease),box-shadow var(--sk-command) ease,border-color var(--sk-control) ease,background-color var(--sk-control) ease}
@media (hover:hover){.sk-opt:hover{transform:translateY(-1px);box-shadow:var(--sk-lift);border-color:var(--sk-edge)}}
.sk-opt:active{transform:scale(.99)}.sk-opt:has(input:checked){border-color:var(--sk-from);box-shadow:var(--sk-soft),0 0 0 1px var(--sk-from)}.sk-opt input{margin-top:6px;accent-color:var(--sk-from)}
.sk-opt.sk-right{border-color:var(--sk-ok);box-shadow:0 0 0 1px var(--sk-ok)}.sk-opt.sk-wrong{border-color:var(--sk-bad);box-shadow:0 0 0 1px var(--sk-bad)}
.sk-fb{margin:10px 0 0;padding:12px 14px;border:1px solid var(--sk-line);border-radius:var(--sk-r-btn);background:var(--sk-chip);font-size:15px}
.sk-fb.sk-ok{border-color:var(--sk-ok);background:var(--sk-ok-bg);color:var(--sk-ok)}.sk-fb.sk-no{height:auto;min-width:0;justify-content:flex-start;border-color:var(--sk-bad);border-radius:var(--sk-r-btn);background:var(--sk-bad-bg);color:var(--sk-bad);font-size:15px}
sk-numeric input,sk-match select{min-height:44px;padding:6px 14px;border:1px solid var(--sk-edge);border-radius:var(--sk-r-btn);background:var(--sk-card);box-shadow:var(--sk-soft);color:var(--sk-ink);font:inherit;max-width:100%;transition:border-color var(--sk-control) ease,box-shadow var(--sk-control) ease}
sk-numeric input:focus,sk-match select:focus{outline:none;border-color:var(--sk-mute);box-shadow:var(--sk-soft),0 0 0 4px rgb(113 113 122/.15)}
sk-numeric input{width:min(220px,100%);font-variant-numeric:tabular-nums}
.sk-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0}
.sk-chip{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:8px 14px;border:1px solid var(--sk-line);border-radius:var(--sk-r-btn);background:var(--sk-card-solid);color:var(--sk-ink);font:inherit;font-size:15px;text-align:left;box-shadow:var(--sk-soft);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none}
.sk-chip:active{transform:scale(.98)}
.sk-chip.sk-sel,.sk-blankbtn.sk-sel,.sk-ol-i.sk-sel{border-color:var(--sk-from);box-shadow:var(--sk-soft),0 0 0 2px var(--sk-from)}
.sk-chip.sk-dragging{opacity:.35}
.sk-ghost{position:fixed;left:0;top:0;z-index:10001;pointer-events:none;box-shadow:var(--sk-lift);cursor:grabbing}
.sk-chip.sk-bad,.sk-blankbtn.sk-bad{border-color:var(--sk-bad);background:var(--sk-bad-bg);color:var(--sk-bad)}
.sk-over{outline:2px dashed var(--sk-from);outline-offset:2px}
.sk-pool{display:flex;flex-wrap:wrap;gap:8px;min-height:52px;margin:8px 0;padding:8px;border:1px dashed var(--sk-edge);border-radius:var(--sk-r-btn)}
.sk-buckets{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.sk-bt{margin:0 0 4px;font-size:13px;font-weight:600;color:var(--sk-mute)}
.sk-bucket{display:flex;flex-wrap:wrap;gap:8px;align-content:flex-start;min-height:92px;padding:8px;border:1px solid var(--sk-edge);border-radius:var(--sk-r-btn);background:var(--sk-chip)}
.sk-cols{display:grid;grid-template-columns:1fr 1fr;gap:10px}.sk-col{display:grid;gap:8px;align-content:start}.sk-col .sk-chip{cursor:pointer;touch-action:manipulation}
.sk-no{display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:11px;background:var(--sk-chip);font-size:12px}
.sk-ol{list-style:none;margin:10px 0;padding:0;display:grid;gap:8px}
.sk-ol-i{display:flex;align-items:center;gap:10px;min-height:48px;padding:6px 10px;border:1px solid var(--sk-line);border-radius:var(--sk-r-btn);background:var(--sk-card-solid);box-shadow:var(--sk-soft);cursor:grab;touch-action:none}.sk-ol-t{flex:1}
.sk-labfig svg{display:block;width:100%;height:auto;max-height:46dvh}
.sk-pin{cursor:pointer}.sk-pin-hit{fill:transparent}.sk-pin-c{fill:var(--sk-card-solid);stroke:var(--sk-ink);stroke-width:1.4}.sk-pin-t{font:700 10px/1 system-ui;fill:var(--sk-ink)}.sk-pin.sk-filled .sk-pin-c{fill:var(--sk-ink)}.sk-pin.sk-bad .sk-pin-c{stroke:var(--sk-bad);stroke-width:2.4}
.sk-ll{margin:8px 0;padding:0;list-style:none;display:grid;gap:4px;font-size:15px}.sk-ll i{color:var(--sk-mute)}
.sk-hot{cursor:pointer}.sk-hot:focus-visible{outline:none;stroke:var(--sk-focus);stroke-width:2.5}.sk-picked{stroke:var(--sk-ink)!important;stroke-width:3!important;filter:drop-shadow(0 0 3px rgb(0 0 0/.35))}
sk-text{line-height:2.4;font-size:16px}
.sk-blankbtn{display:inline-block;min-width:76px;min-height:36px;margin:0 4px;padding:2px 12px;border:0;border-bottom:2px solid var(--sk-ink);border-radius:8px 8px 0 0;background:var(--sk-chip);color:var(--sk-ink);font:inherit;cursor:pointer;vertical-align:baseline}
.sk-eq{display:flex;flex-wrap:wrap;align-items:center;gap:10px 6px;margin:10px 0;font-size:18px}.sk-stepper{display:inline-flex;align-items:center;gap:2px;margin-right:4px}.sk-step{min-height:36px;min-width:36px;padding:0}.sk-coef{display:inline-block;min-width:26px;text-align:center;font-weight:700;font-variant-numeric:tabular-nums}.sk-term{display:inline-flex;align-items:center}
.sk-atoms{display:flex;flex-wrap:wrap;gap:6px 14px;margin:6px 0;font-size:14px}.sk-eqok{color:var(--sk-ok)}.sk-eqno{color:var(--sk-bad)}
.sk-knobrow{display:flex;align-items:center;justify-content:center;gap:12px}.sk-dial{width:88px;height:88px;touch-action:none;cursor:grab;outline:none}.sk-dial:focus-visible{outline:2px solid var(--sk-focus);outline-offset:2px;border-radius:50%}
.sk-dial-track{fill:none;stroke:var(--sk-edge);stroke-width:3}.sk-dial-face{fill:var(--sk-card-solid);stroke:var(--sk-ink);stroke-width:1.2}.sk-dial-tick{stroke:var(--sk-mute);stroke-width:1}.sk-dial-ind{stroke:var(--sk-ink);stroke-width:3;stroke-linecap:round}
.sk-tune-out{margin:10px 0;font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}
sk-record{padding:14px 16px;margin:12px 0}
.sk-rec-t{margin-bottom:8px;font-weight:600}
sk-record table{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}
sk-record th,sk-record td{padding:6px 8px;border-bottom:1px solid var(--sk-line);text-align:left}
sk-record th{color:var(--sk-mute);font-weight:500}
sk-record .sk-good{color:var(--sk-ok)}sk-record .sk-bad{color:var(--sk-bad)}
.sk-rec-n{margin:8px 0 0;color:var(--sk-mute);font-size:14px}
.sk-rec-in{display:flex;flex-wrap:wrap;gap:8px 12px;margin:0 0 10px}
.sk-rec-in label{display:flex;flex-direction:column;gap:2px;font-size:13px;color:var(--sk-mute);flex:1 1 130px}
.sk-rec-in input{min-height:44px;padding:6px 12px;border:1px solid var(--sk-line);border-radius:var(--sk-r-btn);background:var(--sk-card-solid);color:var(--sk-ink);font:inherit;font-size:16px}
sk-order ol{list-style:none;margin:10px 0;padding:0;display:grid;gap:8px}
sk-order li{display:flex;gap:8px;align-items:center;padding:8px 12px;border:1px solid var(--sk-line);border-radius:var(--sk-r-btn);background:var(--sk-card);box-shadow:var(--sk-soft);transition:transform var(--sk-command) var(--sk-ease)}
sk-order li span{flex:1}
sk-progress{height:4px;border-radius:2px;background:var(--sk-chip);overflow:hidden}sk-progress i{display:block;height:100%;width:0;border-radius:2px;background:linear-gradient(90deg,var(--sk-from),var(--sk-to));transition:width var(--sk-reveal) var(--sk-ease)}
.sk-hl-target{outline:2px solid var(--sk-from);outline-offset:4px;transition:outline-color var(--sk-command) var(--sk-ease)}
.sk-spot{position:fixed;z-index:9998;pointer-events:none;border-radius:18px;box-shadow:0 0 0 100vmax rgb(0 0 0/.46),0 0 0 2px rgb(255 255 255/.9),0 0 28px 6px rgb(255 255 255/.28);animation:sk-in var(--sk-command) var(--sk-ease)}
.sk-spot.sk-spot-wide{box-shadow:0 0 0 2px rgb(255 255 255/.9),0 0 0 4px rgb(10 10 10/.4)}
.sk-laser{position:fixed;left:0;top:0;z-index:9999;pointer-events:none;transition:transform 560ms cubic-bezier(.22,1,.36,1)}
.sk-laser i{position:absolute;left:-6px;top:-6px;width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 0 2px #0a0a0a,0 0 16px 5px rgb(255 255 255/.85)}
.sk-laser b{position:absolute;left:-20px;top:-20px;width:40px;height:40px;border-radius:50%;border:2px solid #fff;opacity:0;animation:sk-ping 1.3s ease-out infinite}
@keyframes sk-ping{0%{transform:scale(.3);opacity:.9}100%{transform:scale(1.5);opacity:0}}
.sk-ann{position:fixed;z-index:10000;max-width:min(280px,82vw);padding:10px 14px;border-radius:14px;background:#0a0a0a;color:#fff;font-size:14px;line-height:1.5;font-weight:500;box-shadow:0 12px 32px -8px rgb(0 0 0/.55);pointer-events:none;animation:sk-in var(--sk-command) var(--sk-ease)}
.sk-ann::before{content:'換你操作';display:block;margin-bottom:2px;font-size:11px;letter-spacing:.1em;opacity:.65}
.sk-spot.sk-out,.sk-laser.sk-out,.sk-ann.sk-out{opacity:0;transition:opacity 220ms}
@media (prefers-reduced-motion:reduce){.sk-laser{transition:none}.sk-laser b{animation:none;opacity:.7;transform:scale(.8)}}
sk-tabs>.sk-tabbar{position:relative;display:flex;gap:2px;margin:0 0 12px;padding:4px;border-radius:var(--sk-r-btn);background:var(--sk-chip)}
.sk-tabbar .sk-tab-pill{position:absolute;top:4px;bottom:4px;left:0;width:0;border-radius:12px;background:var(--sk-card-solid);box-shadow:var(--sk-soft);transition:transform var(--sk-command) var(--sk-ease),width var(--sk-command) var(--sk-ease)}
.sk-tabbar .sk-btn{position:relative;z-index:1;flex:1;min-height:40px;padding:4px 12px;border:0;border-radius:12px;background:transparent;box-shadow:none;color:var(--sk-mute);font-size:13px}
.sk-tabbar .sk-btn[aria-selected=true]{color:var(--sk-ink)}
@media (max-width:700px){
sk-module{padding:10px 12px}.sk-title{margin:0 0 2px;font-size:19px}.sk-goal{margin:0 0 8px;font-size:13px;line-height:1.5}
sk-split{display:flex;flex-direction:column;align-items:stretch;gap:8px}sk-split>sk-stack{display:contents}
sk-split sk-figure,sk-split sk-plot{order:-1;position:sticky;top:0;z-index:3;padding:6px}
sk-split sk-figure svg,sk-split sk-plot svg{max-height:34dvh}
sk-controls,sk-choice,sk-numeric,sk-order,sk-match,sk-figure,sk-plot,sk-record{border-radius:20px}
sk-controls{gap:2px;padding:6px 14px}.sk-label{font-size:13px}sk-slider input[type=range]{height:40px}
sk-slider{display:grid;grid-template-columns:minmax(3.5em,auto) minmax(0,1fr) minmax(3.2em,auto);align-items:center;gap:8px}
sk-slider>.sk-label{display:contents}sk-slider>.sk-label>span:first-child{order:1}sk-slider>input{order:2}sk-slider>.sk-label>.sk-value{order:3;text-align:right}
sk-segmented{display:flex;align-items:center;gap:8px;flex-wrap:wrap}sk-segmented>.sk-label{flex:none}
sk-segmented .sk-btn,sk-toggle .sk-btn{min-height:40px;padding:4px 12px}
sk-readout{display:flex;justify-content:space-between;align-items:baseline;gap:12px;padding:6px 14px 6px 18px}sk-readout::before{top:8px;bottom:8px}sk-readout .sk-rv{font-size:20px}
sk-callout{padding:8px 14px;font-size:14px}sk-choice,sk-numeric,sk-order,sk-match,sk-sort,sk-label,sk-pick,sk-fill,sk-balance,sk-tune{padding:12px}.sk-q{font-size:16px}
.sk-opt{padding:8px 12px}sk-tabs>.sk-tabbar{margin-bottom:8px;position:sticky;top:0;z-index:4;backdrop-filter:blur(12px)}
sk-split sk-figure,sk-split sk-plot{top:56px}
}
@media (max-width:700px) and (max-height:640px){.sk-goal{display:none}.sk-title{font-size:16px}sk-split sk-figure svg,sk-split sk-plot svg{max-height:30dvh}}
/* ---- question polish: indicators, result marks, drop targets, shake, completion ---- */
:is(sk-choice,sk-numeric,sk-order,sk-match,sk-sort,sk-label,sk-pick,sk-fill,sk-balance,sk-tune){position:relative;transition:border-color var(--sk-command) ease,box-shadow var(--sk-command) ease}
:is(sk-choice,sk-numeric,sk-order,sk-match,sk-sort,sk-label,sk-pick,sk-fill,sk-balance,sk-tune)[data-state=ok]{border-color:color-mix(in srgb,var(--sk-ok) 50%,var(--sk-line));box-shadow:var(--sk-soft),var(--sk-sheen),0 0 0 3px color-mix(in srgb,var(--sk-ok) 12%,transparent)}
:is(sk-choice,sk-numeric,sk-order,sk-match,sk-sort,sk-label,sk-pick,sk-fill,sk-balance,sk-tune)[data-state=no]{border-color:color-mix(in srgb,var(--sk-bad) 40%,var(--sk-line))}
.sk-shake{animation:sk-shake 380ms cubic-bezier(.36,.07,.19,.97)}
@keyframes sk-shake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(2px)}30%,50%,70%{transform:translateX(-4px)}40%,60%{transform:translateX(4px)}}
@keyframes sk-pop{0%{opacity:0;transform:scale(.4)}60%{opacity:1;transform:scale(1.12)}100%{opacity:1;transform:none}}
@keyframes sk-ring{from{box-shadow:0 0 0 0 color-mix(in srgb,var(--sk-ok) 38%,transparent)}to{box-shadow:0 0 0 10px transparent}}
@keyframes sk-bump{0%{transform:scale(.9)}60%{transform:scale(1.04)}100%{transform:none}}
.sk-bump{animation:sk-bump var(--sk-command) var(--sk-ease)}
.sk-opt input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px;margin:0}
.sk-opt{position:relative;align-items:center}
.sk-opt::before{content:"";flex:none;width:20px;height:20px;box-sizing:border-box;border:1.5px solid var(--sk-edge);border-radius:50%;background:var(--sk-from);box-shadow:inset 0 0 0 10px var(--sk-card-solid);transition:box-shadow var(--sk-control) var(--sk-ease),border-color var(--sk-control) ease,background-color var(--sk-control) ease,color var(--sk-control) ease}
.sk-opt:has(input:checked)::before{border-color:var(--sk-from);box-shadow:inset 0 0 0 4px var(--sk-card-solid)}
sk-choice[type=multiple] .sk-opt::before{content:"✓";display:grid;place-items:center;border-radius:6px;font:700 13px/1 system-ui;color:transparent;background:var(--sk-card-solid);box-shadow:none}
sk-choice[type=multiple] .sk-opt:has(input:checked)::before{background:var(--sk-from);border-color:var(--sk-from);color:var(--sk-on);box-shadow:none}
.sk-opt:has(input:focus-visible){outline:2px solid var(--sk-focus);outline-offset:2px}
.sk-opt:has(input:checked){background:var(--sk-card-solid)}
.sk-opt.sk-right:has(input){border-color:var(--sk-ok);box-shadow:0 0 0 1px var(--sk-ok);background:var(--sk-ok-bg)}.sk-opt.sk-wrong:has(input){border-color:var(--sk-bad);box-shadow:0 0 0 1px var(--sk-bad);background:var(--sk-bad-bg);animation:sk-shake 380ms cubic-bezier(.36,.07,.19,.97)}
.sk-opt.sk-right::before{border-color:var(--sk-ok)}.sk-opt.sk-wrong::before{border-color:var(--sk-bad)}
.sk-opt.sk-right::after,.sk-opt.sk-wrong::after{flex:none;display:grid;place-items:center;width:22px;height:22px;margin-left:auto;border-radius:50%;font:700 12px/1 system-ui;color:var(--sk-card-solid);animation:sk-pop 360ms var(--sk-ease)}
.sk-opt.sk-right::after{content:"✓";background:var(--sk-ok)}.sk-opt.sk-wrong::after{content:"✗";background:var(--sk-bad)}
.sk-opt:has(input:disabled){cursor:default}.sk-opt:has(input:disabled:not(:checked)){opacity:.55}
@media (hover:hover){.sk-opt:has(input:disabled):hover{transform:none;box-shadow:var(--sk-soft);border-color:var(--sk-line)}}
.sk-fb{display:flex;gap:10px;align-items:flex-start;line-height:1.6}
.sk-fbt{flex:1;min-width:0}.sk-fbt>:first-child{margin-top:0}.sk-fbt>:last-child{margin-bottom:0}
.sk-fi{flex:none;display:grid;place-items:center;width:22px;height:22px;margin-top:1px;border:1.5px solid currentColor;border-radius:50%;font:700 12px/1 system-ui}
.sk-fb.sk-ok .sk-fi{animation:sk-pop 360ms var(--sk-ease)}
.sk-fb.sk-ok.sk-in{animation:sk-in var(--sk-reveal) var(--sk-ease),sk-ring 700ms ease-out}
.sk-fb.sk-nudge{background:var(--sk-chip);color:var(--sk-mute);font-size:14px}
.sk-btn.sk-primary.sk-solved:disabled{opacity:1;border-color:var(--sk-ok);background:var(--sk-ok-bg);color:var(--sk-ok);box-shadow:none}
.sk-btn.sk-primary.sk-solved::before{display:none}
sk-numeric input[data-s=ok]{border-color:var(--sk-ok);background:var(--sk-ok-bg);color:var(--sk-ok)}
sk-numeric input[data-s=no]{border-color:var(--sk-bad);background:var(--sk-bad-bg);animation:sk-shake 380ms cubic-bezier(.36,.07,.19,.97)}
sk-numeric .sk-row>span{color:var(--sk-mute)}
.sk-chip{transition:transform var(--sk-command) var(--sk-ease),box-shadow var(--sk-control) ease,border-color var(--sk-control) ease,background-color var(--sk-control) ease,color var(--sk-control) ease}
@media (hover:hover){.sk-chip:not(.sk-ghost):not(.sk-dragging):hover{transform:translateY(-1px);box-shadow:var(--sk-lift)}}
.sk-chip.sk-sel,.sk-blankbtn.sk-sel,.sk-ol-i.sk-sel{transform:translateY(-2px);box-shadow:var(--sk-lift),0 0 0 2px var(--sk-from)}
.sk-ghost{transition:none!important;opacity:.96;box-shadow:var(--sk-lift),0 0 0 1px var(--sk-from)}
.sk-chip.sk-dragging,.sk-ol-i.sk-dragging{opacity:.3;transform:none}
.sk-chip:focus-visible,.sk-blankbtn:focus-visible,.sk-ol-i:focus-visible{outline:2px solid var(--sk-focus);outline-offset:2px}
.sk-pool,.sk-bucket,.sk-blankbtn{transition:background-color var(--sk-control) ease,border-color var(--sk-control) ease,box-shadow var(--sk-control) ease}
.sk-over{outline:none;border-color:var(--sk-from);border-style:solid;background:color-mix(in srgb,var(--sk-from) 9%,var(--sk-chip));box-shadow:inset 0 0 0 1px var(--sk-from)}
.sk-armed :is(.sk-bucket,.sk-pool,.sk-blankbtn){border-color:var(--sk-mute);border-style:dashed;cursor:pointer}
.sk-bucket:empty::after{content:"放到這裡";margin:auto;color:var(--sk-mute);font-size:13px;opacity:.7}
.sk-pool[data-zone]:empty::after{content:"都分好了 ✓";margin:auto;color:var(--sk-mute);font-size:13px}
.sk-chip.sk-good,.sk-blankbtn.sk-good{border-color:var(--sk-ok);background:var(--sk-ok-bg);color:var(--sk-ok)}
.sk-chip.sk-bad,.sk-blankbtn.sk-bad{animation:sk-shake 380ms cubic-bezier(.36,.07,.19,.97) both;animation-delay:var(--sk-d,0ms)}
.sk-chip.sk-good{animation:sk-bump var(--sk-command) var(--sk-ease) both;animation-delay:var(--sk-d,0ms)}
.sk-mk{display:inline-grid;place-items:center;width:20px;height:20px;border-radius:50%;background:currentColor;font-style:normal}
.sk-mk>i{color:var(--sk-card-solid);font:700 11px/1 system-ui;font-style:normal}
.sk-blankbtn.sk-has{background:var(--sk-card-solid);border-bottom-color:var(--sk-from)}
.sk-ol-i::before{content:"";flex:none;width:10px;height:18px;background:radial-gradient(circle,var(--sk-mute) 1.3px,transparent 1.7px) 0 0/5px 6px;opacity:.55}
.sk-ol-i>b{flex:none;display:grid;place-items:center;width:26px;height:26px;border-radius:50%;background:var(--sk-chip);font-size:12px;font-variant-numeric:tabular-nums}
.sk-ol-i{transition:transform var(--sk-command) var(--sk-ease),box-shadow var(--sk-control) ease,border-color var(--sk-control) ease,background-color var(--sk-control) ease}
.sk-ol-i .sk-btn{min-height:36px;min-width:36px;padding:0;border-radius:12px;font-size:15px;touch-action:manipulation}
.sk-ol-i.sk-good{border-color:var(--sk-ok);background:var(--sk-ok-bg)}.sk-ol-i.sk-bad{border-color:var(--sk-bad);background:var(--sk-bad-bg)}
.sk-no.sk-on{background:var(--sk-from);color:var(--sk-on);font-weight:700}.sk-no.sk-x{background:var(--sk-bad);color:var(--sk-card-solid)}.sk-no.sk-pop{animation:sk-pop 300ms var(--sk-ease)}
.sk-col .sk-chip.sk-sel{background:var(--sk-card-solid)}
.sk-pin-c{transition:fill var(--sk-control) ease,stroke var(--sk-control) ease}
.sk-pin.sk-filled .sk-pin-c{transform-box:fill-box;transform-origin:center;animation:sk-pop 300ms var(--sk-ease)}
.sk-pin.sk-good .sk-pin-c{fill:var(--sk-ok);stroke:var(--sk-ok)}
.sk-hot{transition:stroke-width var(--sk-control) ease,filter var(--sk-control) ease,opacity var(--sk-control) ease}
@media (hover:hover){.sk-hot:hover{opacity:.82}}
.sk-atom{padding:2px 10px;border-radius:999px;background:var(--sk-chip);transition:background-color var(--sk-control) ease,color var(--sk-control) ease}
.sk-atom.sk-eqok{background:var(--sk-ok-bg)}.sk-atom.sk-eqno{background:var(--sk-bad-bg)}
.sk-coef.sk-bump{animation:sk-bump var(--sk-control) var(--sk-ease)}
.sk-step{border-radius:50%}
.sk-dial-g{transform-box:view-box;transform-origin:0 0;transition:transform var(--sk-control) var(--sk-ease)}.sk-dial.sk-grab .sk-dial-g{transition:none}.sk-dial.sk-grab{cursor:grabbing}
.sk-reset{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:0 14px;border-color:transparent;background:transparent;color:var(--sk-mute);box-shadow:none}
.sk-reset svg{flex:none;width:16px;height:16px}
.sk-reset.sk-spin svg{animation:sk-rotate 520ms var(--sk-ease)}
@keyframes sk-rotate{to{transform:rotate(-360deg)}}
@media (hover:hover){.sk-reset:hover:not(:disabled){background:var(--sk-chip);color:var(--sk-ink)}}
.sk-reset.sk-confirm{border-color:var(--sk-bad);background:var(--sk-bad-bg);color:var(--sk-bad);animation:sk-in var(--sk-control) var(--sk-ease)}
.sk-reset:disabled{display:none}
sk-lab.lab-rebuilt .lab-svg{animation:sk-in var(--sk-reveal) var(--sk-ease)}
.sk-done-toast{position:fixed;left:50%;bottom:max(16px,env(safe-area-inset-bottom));z-index:10002;display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;background:linear-gradient(135deg,var(--sk-from),var(--sk-to));color:var(--sk-on);font-size:14px;font-weight:600;box-shadow:var(--sk-glow);pointer-events:none;opacity:0;transform:translate(-50%,12px);transition:opacity var(--sk-command) var(--sk-ease),transform var(--sk-command) var(--sk-ease)}
.sk-done-toast.sk-show{opacity:1;transform:translate(-50%,0)}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:1ms!important;animation-delay:0s!important;transition-duration:1ms!important}.sk-line.sk-draw{stroke-dasharray:none;stroke-dashoffset:0}.sk-btn:active:not(:disabled),.sk-opt:active{transform:none}.sk-shake,.sk-bump,.sk-fb.sk-ok.sk-in{animation:none}.sk-chip.sk-sel,.sk-ol-i.sk-sel{transform:none}}

/* iOS zooms the page into a focused field under 16px and keeps it zoomed: fields are 16px on touch screens. */
.sk-pen{display:block;width:15px;height:15px;overflow:visible}.sk-pen path{fill:none;stroke:currentColor;stroke-width:2.6;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:1;opacity:0;animation:sk-pen 380ms var(--sk-ease) 180ms forwards}.sk-pen path+path{animation-delay:440ms}
@keyframes sk-pen{from{opacity:1;stroke-dashoffset:1}to{opacity:1;stroke-dashoffset:0}}
/* ---- graph, table, mark, reflect, flashcards ---- */
sk-graph,sk-table,sk-mark,sk-reflect,sk-flashcards{display:block;position:relative;padding:18px;border:1px solid var(--sk-line);border-radius:var(--sk-r-card);background:var(--sk-card);box-shadow:var(--sk-soft),var(--sk-sheen);backdrop-filter:blur(8px);transition:border-color var(--sk-command) ease,box-shadow var(--sk-command) ease}
:is(sk-graph,sk-table,sk-mark,sk-reflect)[data-state=ok]{border-color:color-mix(in srgb,var(--sk-ok) 50%,var(--sk-line));box-shadow:var(--sk-soft),var(--sk-sheen),0 0 0 3px color-mix(in srgb,var(--sk-ok) 12%,transparent)}
:is(sk-graph,sk-table,sk-mark,sk-reflect)[data-state=no]{border-color:color-mix(in srgb,var(--sk-bad) 40%,var(--sk-line))}
sk-tr,sk-point,sk-flash{display:none}
.sk-graph{display:block;width:100%;max-width:min(100%,46dvh);aspect-ratio:1;margin:8px auto 0;border:1px solid var(--sk-line);border-radius:16px;background:var(--sk-card-solid);touch-action:none;user-select:none;-webkit-user-select:none;cursor:crosshair}
.sk-gg line{stroke:var(--sk-edge);stroke-width:1}.sk-gg .sk-ax{stroke:var(--sk-mute);stroke-width:1.5}.sk-gg text{fill:var(--sk-mute);font-size:10px}
.sk-gl{stroke:var(--sk-ink);stroke-width:2.5;stroke-linecap:round;pointer-events:none}
.sk-gp{fill:var(--sk-ink);stroke:var(--sk-card-solid);stroke-width:2;cursor:grab;transition:r var(--sk-control) ease}.sk-gp.sk-sel{stroke:var(--sk-focus);stroke-width:4}.sk-gp:focus-visible{outline:none;stroke:var(--sk-focus);stroke-width:4}
.sk-gread{margin:6px 0 0;color:var(--sk-mute);font-size:14px;text-align:center;font-variant-numeric:tabular-nums}
.sk-tblw{margin:8px 0 0;overflow-x:auto}.sk-tbl{width:100%;border-collapse:collapse;table-layout:fixed;font-size:15px}
.sk-tbl th,.sk-tbl td{padding:6px 8px;border:1px solid var(--sk-edge);text-align:center;vertical-align:middle;overflow-wrap:anywhere}.sk-tbl th{background:var(--sk-chip);font-weight:600}
.sk-tbl input{width:100%;min-height:40px;box-sizing:border-box;padding:4px;border:1px solid var(--sk-edge);border-radius:10px;background:var(--sk-card-solid);color:var(--sk-ink);font:inherit;text-align:center}
.sk-tbl input[data-s=ok]{border-color:var(--sk-ok);background:var(--sk-ok-bg);color:var(--sk-ok)}.sk-tbl input[data-s=no]{border-color:var(--sk-bad);background:var(--sk-bad-bg)}
sk-mark sk-text{display:block;margin-top:6px;font-size:16px;line-height:2.2}
.sk-mspot{padding:3px 4px;border-bottom:2px dotted var(--sk-mute);border-radius:6px;cursor:pointer;transition:background-color var(--sk-control) ease,border-color var(--sk-control) ease}
.sk-mspot.sk-on{border-bottom:2px solid var(--sk-ink);background:var(--sk-chip);font-weight:600}
.sk-mspot.sk-mgood{border-bottom-color:var(--sk-ok);background:var(--sk-ok-bg)}.sk-mspot.sk-mbad{border-bottom-color:var(--sk-bad);background:var(--sk-bad-bg)}
.sk-mspot.sk-mgood::after{content:' ✓'}.sk-mspot.sk-mbad::after{content:' ✗'}.sk-mspot:focus-visible{outline:2px solid var(--sk-focus);outline-offset:2px}
sk-reflect textarea{display:block;width:100%;min-height:88px;box-sizing:border-box;margin:8px 0 0;padding:10px 12px;border:1px solid var(--sk-edge);border-radius:var(--sk-r-btn);background:var(--sk-card-solid);color:var(--sk-ink);font:inherit;resize:vertical}
.sk-model{margin-top:10px;padding:12px 14px;border:1px solid var(--sk-line);border-radius:var(--sk-r-btn);background:var(--sk-chip);font-size:15px}.sk-model .sk-opt{margin-top:6px}.sk-note{margin:8px 0 2px;color:var(--sk-mute);font-size:14px}
.sk-flash{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;width:100%;min-height:150px;box-sizing:border-box;margin-top:6px;padding:18px;border:1px solid var(--sk-line);border-radius:var(--sk-r-card);background:var(--sk-card-solid);color:var(--sk-ink);font:inherit;text-align:center;box-shadow:var(--sk-soft);cursor:pointer;transition:transform var(--sk-command) var(--sk-ease),background-color var(--sk-control) ease}
.sk-flash.sk-back{background:var(--sk-chip)}.sk-flash:active{transform:scale(.99)}.sk-flash:focus-visible{outline:2px solid var(--sk-focus);outline-offset:2px}
.sk-side,.sk-tip{color:var(--sk-mute);font-size:12px;letter-spacing:.04em}.sk-termf{font-size:22px;font-weight:600;line-height:1.4}.sk-def{font-size:16px;line-height:1.6}
.sk-giveup{display:block;margin-top:8px}.sk-gate{color:var(--sk-mute);font-size:13px}
@media (max-width:700px){sk-graph,sk-table,sk-mark,sk-reflect,sk-flashcards{padding:12px;border-radius:20px}.sk-flash{min-height:120px}}
@media (hover:none) and (pointer:coarse){input:not([type=checkbox]):not([type=radio]):not([type=range]),select,textarea{font-size:max(16px,1em)!important}}
`;

export const STUDY_KIT_JS = String.raw`
(function(){
if(window.StudyKit)return;
var VERSION='study-kit/v1',values={},listeners=[],renders=[],computes={},plots={},t0=Date.now();
var stats={controls:0,hints:0,answers:0,wrong:0,retries:0,steps:0},sent={},count=0;
var reduce=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function $(s,r){return (r||document).querySelector(s)}function $$(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))}
function h(tag,attrs,kids){var e=document.createElement(tag);for(var k in (attrs||{})){var v=attrs[k];if(v===false||v==null)continue;if(k==='text')e.textContent=v;else if(k==='class')e.className=v;else e.setAttribute(k,v===true?'':v)}(kids||[]).forEach(function(c){e.appendChild(typeof c==='string'?document.createTextNode(c):c)});return e}
function attr(e,n,d){var v=e.getAttribute(n);return v==null?d:v}
function num(e,n,d){var v=parseFloat(e.getAttribute(n));return isFinite(v)?v:d}
function fmt(v,d){if(typeof v!=='number'||!isFinite(v))return String(v);return d!=null?v.toFixed(d):String(Math.round(v*1000)/1000)}
var uid=0;function id(p){return p+'-'+(++uid)}
function slug(s){return String(s||'').replace(/[^A-Za-z0-9.:-]+/g,'-').slice(0,64)}
function emit(kind,data){
  var ev=data||{};ev.kind=kind;
  if(count>=200)return;count++;
  try{window.parent.postMessage({source:'study-kit',v:1,event:ev},'*')}catch(e){}
}
var restoring=false;
function change(name,value){values[name]=value;if(!restoring)stats.controls++;run()}
function run(){listeners.forEach(function(f){try{f(values)}catch(e){}});renders.forEach(function(f){try{f(values)}catch(e){}})}
function live(){var l=$('#sk-live');if(!l){l=h('div',{id:'sk-live','aria-live':'polite',style:'position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden'});document.body.appendChild(l)}return l}
function say(t){live().textContent='';setTimeout(function(){live().textContent=t},30)}
function animIn(e){if(reduce)return;e.classList.remove('sk-in');void e.offsetWidth;e.classList.add('sk-in')}
function shake(e){if(reduce)return;e.classList.remove('sk-shake');void e.offsetWidth;e.classList.add('sk-shake')}
function bump(e){if(reduce||!e)return;e.classList.remove('sk-bump');void e.offsetWidth;e.classList.add('sk-bump')}
function nudge(box,t){box.className='sk-fb sk-nudge';box.textContent=t;box.hidden=false;animIn(box);say(t)}
function solved(b){var rb=b.parentNode&&b.parentNode.querySelector('.sk-reset');if(rb)rb.disabled=true;b.disabled=true;b.classList.add('sk-solved');b.textContent='✓ 已完成'}
var RESET_ICON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
/* A quiet reset button: the arrow turns once when it is pressed; with confirm, the first press arms it and the second one resets. */
function resetBtn(label,fn,confirm){
  var b=h('button',{type:'button','class':'sk-btn sk-reset'}),armed=false,tm;
  b.innerHTML=RESET_ICON+'<span></span>';var t=b.lastChild;t.textContent=label;
  function disarm(){clearTimeout(tm);armed=false;b.classList.remove('sk-confirm');t.textContent=label}
  b.addEventListener('click',function(){
    if(confirm&&!armed){armed=true;b.classList.add('sk-confirm');t.textContent='再按一次確認';say('再按一次確認重設');tm=setTimeout(disarm,2600);return}
    disarm();if(!reduce){b.classList.remove('sk-spin');void b.offsetWidth;b.classList.add('sk-spin')}
    if(fn)fn()});
  b.addEventListener('blur',function(){if(armed)disarm()});
  return b;
}
function wipe(e,fb){fb.hidden=true;e.removeAttribute('data-state')}
function silentSolved(e,fb,go,html){fb.className='sk-fb sk-ok';fb.innerHTML='<span class="sk-fi" aria-hidden="true">✓</span><div class="sk-fbt"><b>'+(revealing?'這是解答。':'先前已答對。')+'</b>'+(html?' '+html:'')+'</div>';fb.hidden=false;e.setAttribute('data-state','ok');e.dataset.done='1';if(go)solved(go)}
function toast(t){var n=h('div',{class:'sk-done-toast','aria-hidden':'true',text:t});document.body.appendChild(n);void n.offsetWidth;n.classList.add('sk-show');setTimeout(function(){n.classList.remove('sk-show');setTimeout(function(){n.remove()},400)},2600)}
var dropFrom=null;
function keyOf(el){return el.getAttribute('data-k')||el.getAttribute('data-c')||el.getAttribute('data-t')||el.getAttribute('data-w')}
/* Moves between layouts glide: remember where each keyed chip or row was, run the change, then play it from there to its new place. */
function flip(root,fn){
  if(reduce||!root.animate){fn();return}
  var first={},from=dropFrom;dropFrom=null;
  $$('.sk-chip,.sk-ol-i',root).forEach(function(el){var k=keyOf(el);if(k&&!el.hidden)first[k]=el.getBoundingClientRect()});
  fn();
  $$('.sk-chip,.sk-ol-i',root).forEach(function(el){var k=keyOf(el),dropped=from&&from.key===k,f=dropped?from.rect:first[k];if(!k||!f||el.hidden)return;
    var r=el.getBoundingClientRect(),dx=f.left-r.left,dy=f.top-r.top;if(Math.abs(dx)<1&&Math.abs(dy)<1)return;
    el.animate([{transform:'translate('+dx+'px,'+dy+'px)'+(dropped?' scale(1.05)':'')},{transform:'none'}],{duration:260,easing:'cubic-bezier(.22,1,.36,1)'})})
}

var inits={};
function define(tag,fn){inits[tag]=fn}
var savers=[];
function upgrade(root){Object.keys(inits).forEach(function(tag){$$(tag,root).concat(root.matches&&root.matches(tag)?[root]:[]).forEach(function(e){if(e.__sk)return;e.__sk=1;try{inits[tag](e)}catch(err){console.error('study-kit',tag,err)}if(e.__snap||e.__solve){e.__key=tag+'-'+$$(tag).indexOf(e);savers.push(e)}})})}

define('sk-module',function(e){
  var t=attr(e,'heading','');if(t)e.insertBefore(h('h1',{class:'sk-title',text:t}),e.firstChild);
  var g=attr(e,'goal','');if(g&&t)e.insertBefore(h('p',{class:'sk-goal',text:g}),e.children[1]||null);
});
define('sk-slider',function(e){
  var name=attr(e,'name','x'),min=num(e,'min',0),max=num(e,'max',100),step=num(e,'step',(max-min)/100),unit=attr(e,'unit',''),dg=e.hasAttribute('digits')?num(e,'digits',0):(String(step).split('.')[1]||'').length;
  var val=num(e,'value',min),inp=h('input',{type:'range',id:name+'-slider','data-var':name,min:min,max:max,step:step,value:val,'aria-label':attr(e,'label',name)}),out=h('span',{class:'sk-value'});
  function show(){out.textContent=fmt(parseFloat(inp.value),dg)+unit}
  inp.addEventListener('input',function(){show();change(name,parseFloat(inp.value))});
  e.appendChild(h('div',{class:'sk-label'},[h('span',{text:attr(e,'label',name)}),out]));e.appendChild(inp);values[name]=val;show();
  e.__set=function(v){inp.value=v;show();change(name,parseFloat(inp.value))};
});
define('sk-segmented',function(e){
  var name=attr(e,'name','x'),opts=$$('sk-option',e),group=h('div',{class:'sk-group',role:'radiogroup','aria-label':attr(e,'label',name)}),btns=[];
  var cur=attr(e,'value',opts[0]&&opts[0].getAttribute('value'));
  function set(v,fire){cur=v;btns.forEach(function(b){b.setAttribute('aria-checked',String(b.dataset.v===v));b.tabIndex=b.dataset.v===v?0:-1});if(fire)change(name,v);else values[name]=v}
  opts.forEach(function(o,i){var b=h('button',{type:'button',class:'sk-btn',role:'radio','data-v':o.getAttribute('value'),id:name+'-'+o.getAttribute('value')+'-btn',text:o.textContent.trim()});
    b.addEventListener('click',function(){set(b.dataset.v,true)});
    b.addEventListener('keydown',function(ev){var d=ev.key==='ArrowRight'||ev.key==='ArrowDown'?1:ev.key==='ArrowLeft'||ev.key==='ArrowUp'?-1:0;if(!d)return;ev.preventDefault();var n=btns[(i+d+btns.length)%btns.length];n.focus();set(n.dataset.v,true)});
    btns.push(b);group.appendChild(b)});
  e.appendChild(h('div',{class:'sk-label',text:attr(e,'label',name)}));e.appendChild(group);set(cur,false);e.__set=function(v){set(String(v),true)};
});
define('sk-toggle',function(e){
  var name=attr(e,'name','x'),on=e.hasAttribute('checked'),b=h('button',{type:'button',class:'sk-btn',role:'switch',id:name+'-toggle',text:attr(e,'label',name)});
  function set(v,fire){on=v;b.setAttribute('aria-checked',String(on));if(fire)change(name,on);else values[name]=on}
  b.addEventListener('click',function(){set(!on,true)});e.appendChild(b);set(on,false);e.__set=function(v){set(!!v,true)};
});
define('sk-readout',function(e){
  var of=attr(e,'of',''),cp=attr(e,'compute',''),unit=attr(e,'unit',''),dg=e.hasAttribute('digits')?num(e,'digits',2):2;
  var v=h('span',{class:'sk-rv',id:(of||cp||id('readout'))+'-display'}),l=h('span',{class:'sk-rl',text:attr(e,'label','')});e.appendChild(l);e.appendChild(v);
  var prev;function upd(vals){var x=cp&&computes[cp]?computes[cp](vals):vals[of];var t=fmt(x,typeof x==='number'?dg:null)+unit;if(t!==prev){v.textContent=t;if(prev!==undefined&&!reduce){v.classList.remove('sk-tick');void v.offsetWidth;v.classList.add('sk-tick')}prev=t}}
  listeners.push(upd);setTimeout(function(){upd(values)},0);
});
define('sk-callout',function(e){var t=attr(e,'heading','');if(t)e.insertBefore(h('span',{class:'sk-ct',text:t}),e.firstChild)});
define('sk-figure',function(e){
  var svg=$('svg',e);if(svg){svg.setAttribute('role','img');svg.setAttribute('aria-label',attr(e,'label','圖解'));if(!svg.getAttribute('viewBox'))svg.setAttribute('viewBox','0 0 400 240')}
  var c=attr(e,'caption','');if(c)e.appendChild(h('p',{class:'sk-cap',text:c}));
});
define('sk-plot',function(e){
  var pid=e.id||id('plot'),W=480,H=300,m={l:46,r:16,t:16,b:38},x0=num(e,'xmin',0),x1=num(e,'xmax',10),y0=num(e,'ymin',0),y1=num(e,'ymax',10),N=Math.round(num(e,'samples',120));
  var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 '+W+' '+H);svg.setAttribute('role','img');svg.setAttribute('aria-label',attr(e,'label',attr(e,'heading','圖表')));
  function X(x){return m.l+(x-x0)/(x1-x0)*(W-m.l-m.r)}function Y(y){return H-m.b-(y-y0)/(y1-y0)*(H-m.t-m.b)}
  function ns(t,a){var n=document.createElementNS('http://www.w3.org/2000/svg',t);for(var k in a)n.setAttribute(k,a[k]);return n}
  for(var i=0;i<=5;i++){var gx=x0+(x1-x0)*i/5,gy=y0+(y1-y0)*i/5;
    svg.appendChild(ns('line',{x1:X(gx),x2:X(gx),y1:m.t,y2:H-m.b,class:'sk-grid'}));svg.appendChild(ns('line',{x1:m.l,x2:W-m.r,y1:Y(gy),y2:Y(gy),class:'sk-grid'}));
    var tx=ns('text',{x:X(gx),y:H-m.b+16,'text-anchor':'middle',class:'sk-tick'});tx.textContent=fmt(gx,1);svg.appendChild(tx);
    var ty=ns('text',{x:m.l-6,y:Y(gy)+4,'text-anchor':'end',class:'sk-tick'});ty.textContent=fmt(gy,1);svg.appendChild(ty)}
  svg.appendChild(ns('line',{x1:m.l,x2:W-m.r,y1:H-m.b,y2:H-m.b,class:'sk-axis'}));svg.appendChild(ns('line',{x1:m.l,x2:m.l,y1:m.t,y2:H-m.b,class:'sk-axis'}));
  var xl=attr(e,'xlabel',''),yl=attr(e,'ylabel','');
  if(xl){var a=ns('text',{x:(m.l+W-m.r)/2,y:H-4,'text-anchor':'middle',class:'sk-tick'});a.textContent=xl;svg.appendChild(a)}
  if(yl){var b=ns('text',{x:12,y:(m.t+H-m.b)/2,'text-anchor':'middle',class:'sk-tick',transform:'rotate(-90 12 '+(m.t+H-m.b)/2+')'});b.textContent=yl;svg.appendChild(b)}
  var layer=ns('g',{});svg.appendChild(layer);e.appendChild(svg);var t=attr(e,'heading','');if(t)e.insertBefore(h('div',{class:'sk-label',text:t}),svg);
  var first=true;
  function draw(vals){
    var series=plots[pid]||[];while(layer.firstChild)layer.removeChild(layer.firstChild);
    series.forEach(function(s,k){
      if(s.points){s.points(vals).forEach(function(p){layer.appendChild(ns('circle',{cx:X(p[0]),cy:Y(p[1]),r:5,class:'sk-dot'}))});return}
      var d='';for(var i=0;i<=N;i++){var x=x0+(x1-x0)*i/N,y=s.fn(x,vals);if(!isFinite(y))continue;y=Math.max(y0-(y1-y0),Math.min(y1+(y1-y0),y));d+=(d?'L':'M')+X(x).toFixed(1)+' '+Y(y).toFixed(1)}
      var p=ns('path',{d:d,class:'sk-line'+(k?' sk-alt':'')});layer.appendChild(p);
      if(first&&!reduce){var len=p.getTotalLength?p.getTotalLength():0;if(len){p.style.setProperty('--sk-len',len);p.classList.add('sk-draw')}}
    });first=false;
  }
  renders.push(draw);setTimeout(function(){draw(values)},0);
});
define('sk-steps',function(e){
  var steps=$$('sk-step',e),i=0,sid=e.id||id('steps'),start=Date.now(),nav=h('div',{class:'sk-nav'}),count=h('span',{class:'sk-count'}),prev=h('button',{type:'button',class:'sk-btn',text:'上一步'}),next=h('button',{type:'button',class:'sk-btn sk-primary',text:'下一步'});
  nav.appendChild(count);nav.appendChild(prev);nav.appendChild(next);e.appendChild(nav);
  steps.forEach(function(s){var t=attr(s,'heading','');if(t&&!s.querySelector(':scope>h3'))s.insertBefore(h('h3',{text:t,tabindex:'-1'}),s.firstChild)});
  var gated=e.hasAttribute('gated');
  /* gated: a worked example done together. The next step opens only when this step's questions are answered (or their answers were shown). */
  function open(k){return !gated||$$(QS,steps[k]).every(function(q){return q.querySelector('.sk-fb.sk-ok')})}
  function lock(){var last=i===steps.length-1,shut=!last&&!open(i);next.disabled=last||shut;next.textContent=last?'完成':shut?'先完成這一步':'下一步'}
  if(gated)e.addEventListener('click',function(){setTimeout(lock,90)});
  function show(n,focus){i=n;steps.forEach(function(s,k){s.hidden=k!==i});count.textContent=(i+1)+' / '+steps.length;prev.disabled=i===0;lock();
    animIn(steps[i]);if(focus){var hh=steps[i].querySelector('h3');if(hh)hh.focus({preventScroll:true})}say('第 '+(i+1)+' 步，共 '+steps.length+' 步')}
  next.addEventListener('click',function(){if(i<steps.length-1){stats.steps++;emit('step',{id:slug(sid),index:i+1,total:steps.length,ms:Date.now()-start});start=Date.now();show(i+1,true)}});
  prev.addEventListener('click',function(){show(Math.max(0,i-1),true)});
  e.__goto=function(s){var k=steps.indexOf(s);if(k>=0&&k!==i)show(k,false)};
  steps.forEach(function(s){s.hidden=true});show(0,false);e.__progress=function(){return steps.length?(i+1)/steps.length:1};
  e.__snap=function(){return i>0?{i:i}:undefined};e.__restore=function(st){var n=+st.i;if(n>=0&&n<steps.length)show(n,false);if(gated)setTimeout(lock,200)};
});
define('sk-reveal',function(e){
  var rid=e.id||id('reveal'),body=h('div',{class:'sk-body',hidden:true}),kids=Array.prototype.slice.call(e.childNodes),b=h('button',{type:'button',class:'sk-btn','aria-expanded':'false',text:attr(e,'label','不懂，拆開說明')}),done=false;
  kids.forEach(function(k){body.appendChild(k)});e.appendChild(b);e.appendChild(body);
  b.addEventListener('click',function(){var open=body.hidden;body.hidden=!open;b.setAttribute('aria-expanded',String(open));if(open){animIn(body);if(!done){done=true;stats.hints++;emit('hint',{id:slug(rid),level:1})}}});
  e.__snap=function(){return body.hidden?undefined:{o:1}};e.__restore=function(st){if(st.o){body.hidden=false;b.setAttribute('aria-expanded','true');done=true}};
});
define('sk-hints',function(e){
  var hid=e.id||id('hints'),items=$$('sk-hint',e),list=h('div'),b=h('button',{type:'button',class:'sk-btn'}),n=0;
  e.appendChild(list);e.appendChild(b);function label(){b.textContent=n<items.length?'給我提示（'+(n+1)+' / '+items.length+'）':'已顯示全部提示';b.disabled=n>=items.length}label();
  b.addEventListener('click',function(){if(n>=items.length)return;var box=h('div',{class:'sk-hl'});box.innerHTML=items[n].innerHTML;list.appendChild(box);animIn(box);n++;stats.hints++;emit('hint',{id:slug(hid),level:n});label();say('提示 '+n)});
  e.__snap=function(){return n>0?{n:n}:undefined};e.__restore=function(st){var k=Math.min(+st.n||0,items.length);while(n<k){var bx=h('div',{class:'sk-hl'});bx.innerHTML=items[n].innerHTML;list.appendChild(bx);n++}label()};
});

function question(e){var q=attr(e,'question','');var qe=h('p',{class:'sk-q'});qe.innerHTML=q;return qe}
var revealing=false;
/* The mark on an answer is drawn the way a teacher's pen makes it: the tick in one stroke, the cross in two. */
var PEN_OK='<svg class="sk-pen" viewBox="0 0 24 24"><path pathLength="1" d="M5.5 12.8c1.6 1.4 2.8 2.8 4 4.6 2.2-4.4 4.8-7.8 9-11"/></svg>';
var PEN_NO='<svg class="sk-pen" viewBox="0 0 24 24"><path pathLength="1" d="M7 7.2c3.4 3 6.6 6.2 10 9.8"/><path pathLength="1" d="M17.2 6.8c-3.6 3.2-6.8 6.4-10.4 10.4"/></svg>';
/* A learner who has missed twice is never left stuck: the answer and its explanation are one press away, and it counts as a hint. */
function giveUp(box,card){
  var b=h('button',{type:'button','class':'sk-btn sk-giveup',text:'看解答'});
  b.addEventListener('click',function(){stats.hints++;emit('hint',{id:slug(card.id||card.__key||'q'),level:3});revealing=true;try{card.__solve()}finally{revealing=false}check();say('已顯示解答')});
  var t=box.querySelector('.sk-fbt');if(t){t.appendChild(h('span',{'class':'sk-gate',text:' 卡住了也沒關係，可以先看解答，弄懂再往下。'}));t.appendChild(b)}
}
function feedback(box,ok,html,leads){
  var card=box.closest?box.closest(QS):null,missed=card?card.__miss||0:0;
  var lead=leads?leads[ok?0:1]:ok?(missed?'答對了，修正得很好。':'答對了。'):'還不正確。';
  box.className='sk-fb '+(ok?'sk-ok':'sk-no');
  box.innerHTML='<span class="sk-fi" aria-hidden="true">'+(ok?PEN_OK:PEN_NO)+'</span><div class="sk-fbt"><b>'+lead+'</b>'+(html?' '+html:'')+'</div>';
  box.hidden=false;animIn(box);say(ok?'答對了':'還不正確');
  if(card&&!ok){card.__miss=missed+1;if(card.__miss>=2&&card.__solve&&!card.__noReveal)giveUp(box,card)}
  if(card){card.setAttribute('data-state',ok?'ok':'no');if(!ok)shake(card)}
  try{box.scrollIntoView({block:'nearest',behavior:reduce?'auto':'smooth'})}catch(e){}
}
function report(qid,ok,mis,attempt){stats.answers++;if(!ok)stats.wrong++;emit('answer',{id:slug(qid),correct:ok,misconception:ok?null:(mis?slug(mis):null),attempt:attempt});check()}
define('sk-choice',function(e){
  var qid=e.id||id('choice'),multi=attr(e,'type','single')==='multiple',opts=$$('sk-option',e),explain=$('sk-explain',e),attempt=1,box=h('div',{class:'sk-opts',role:multi?'group':'radiogroup'}),fb=h('div',{class:'sk-fb','aria-live':'polite',hidden:true}),rows=[];
  e.insertBefore(question(e),e.firstChild);
  opts.forEach(function(o,i){var inp=h('input',{type:multi?'checkbox':'radio',name:qid,value:o.getAttribute('value')||String(i)}),lab=h('label',{class:'sk-opt'},[inp]);var s=h('span');s.innerHTML=o.innerHTML;lab.appendChild(s);rows.push({o:o,inp:inp,lab:lab});box.appendChild(lab)});
  var go=h('button',{type:'button',class:'sk-btn sk-primary',text:'檢查答案'}),again=resetBtn('再試一次',null),act=h('div',{class:'sk-actions'},[go,again]);again.hidden=true;
  e.appendChild(box);e.appendChild(act);e.appendChild(fb);
  e.__solve=function(){rows.forEach(function(r){var good=r.o.hasAttribute('correct');r.inp.checked=good;r.lab.classList.toggle('sk-right',good);r.inp.disabled=true});again.hidden=true;silentSolved(e,fb,go,explain?explain.innerHTML:'')};
  go.addEventListener('click',function(){
    var picked=rows.filter(function(r){return r.inp.checked});if(!picked.length){nudge(fb,'先選一個答案。');return}
    var ok=rows.every(function(r){return r.inp.checked===r.o.hasAttribute('correct')}),mis=null,notes=[];
    rows.forEach(function(r){r.lab.classList.remove('sk-right','sk-wrong');if(r.inp.checked){var good=r.o.hasAttribute('correct');r.lab.classList.add(good?'sk-right':'sk-wrong');if(!good&&!mis)mis=r.o.getAttribute('misconception');var f=r.o.getAttribute('feedback');if(f)notes.push(f)}});
    var html=notes.join(' ');if(ok&&explain)html=(html?html+' ':'')+explain.innerHTML;feedback(fb,ok,html);report(qid,ok,mis,attempt);
    rows.forEach(function(r){r.inp.disabled=ok});if(ok)solved(go);again.hidden=ok;e.dataset.done=ok?'1':'';
  });
  function retry(wipe){rows.forEach(function(r){if(wipe)r.inp.checked=false;r.lab.classList.remove('sk-right','sk-wrong')});fb.hidden=true;again.hidden=true;e.removeAttribute('data-state');attempt++;stats.retries++;emit('retry',{id:slug(qid)})}
  again.addEventListener('click',function(){retry(true)});
  rows.forEach(function(r){r.inp.addEventListener('change',function(){if(!again.hidden)retry(false)})});
});
define('sk-numeric',function(e){
  var qid=e.id||id('numeric'),ans=num(e,'answer',0),tol=num(e,'tolerance',0.01),unit=attr(e,'unit',''),wrongs=$$('sk-wrong',e),attempt=1,explain=$('sk-explain',e);
  e.insertBefore(question(e),e.firstChild);
  var inp=h('input',{type:'text',inputmode:'decimal',autocomplete:'off','aria-label':'你的答案'}),go=h('button',{type:'button',class:'sk-btn sk-primary',text:'檢查答案'}),fb=h('div',{class:'sk-fb','aria-live':'polite',hidden:true});
  e.appendChild(h('div',{class:'sk-row'},[inp,h('span',{text:unit}),go]));e.appendChild(fb);
  inp.addEventListener('input',function(){inp.removeAttribute('data-s')});
  inp.addEventListener('keydown',function(ev){if(ev.key==='Enter'&&!go.disabled){ev.preventDefault();go.click()}});
  e.__solve=function(){inp.value=String(ans);inp.disabled=true;inp.setAttribute('data-s','ok');silentSolved(e,fb,go,explain?explain.innerHTML:'')};
  go.addEventListener('click',function(){
    var v=parseFloat(String(inp.value).replace(/,/g,'').trim());if(!isFinite(v)){nudge(fb,'請輸入數字。');return}
    var ok=Math.abs(v-ans)<=tol,mis=null,note='';
    if(!ok)wrongs.some(function(w){var wt=parseFloat(w.getAttribute('tolerance')||tol);if(Math.abs(v-parseFloat(w.getAttribute('value')))<=wt){mis=w.getAttribute('misconception');note=w.getAttribute('feedback')||'';return true}return false});
    inp.setAttribute('data-s',ok?'ok':'no');feedback(fb,ok,ok&&explain?explain.innerHTML:note);report(qid,ok,mis,attempt);attempt++;if(!ok)stats.retries++;if(ok){inp.disabled=true;solved(go)}
  });
});
function shuffled(arr,seed){var a=arr.slice(),s=0;for(var i=0;i<seed.length;i++)s=(s*31+seed.charCodeAt(i))>>>0;for(var j=a.length-1;j>0;j--){s=(s*1664525+1013904223)>>>0;var k=s%(j+1),t=a[j];a[j]=a[k];a[k]=t}return a}
var QS='sk-choice,sk-numeric,sk-order,sk-match,sk-sort,sk-label,sk-pick,sk-fill,sk-balance,sk-tune,sk-graph,sk-table,sk-mark,sk-reflect';
var dragAt=0,NS='http://www.w3.org/2000/svg';
function sv(tag,a,kids){var n=document.createElementNS(NS,tag);for(var k in (a||{}))n.setAttribute(k,a[k]);(kids||[]).forEach(function(c){n.appendChild(c)});return n}
function box(e){return h('div',{'class':'sk-fb','aria-live':'polite',hidden:true})}
function dnd(root,itemSel,zoneSel,place,noclick){
  var sel=null;
  function setSel(i){if(sel)sel.classList.remove('sk-sel');sel=i;if(i)i.classList.add('sk-sel');root.classList.toggle('sk-armed',!!i)}
  if(!noclick)root.addEventListener('click',function(ev){
    if(Date.now()-dragAt<300)return;var b=ev.target.closest('button');if(b&&!b.hasAttribute('data-item'))return;
    var it=ev.target.closest(itemSel),z=ev.target.closest(zoneSel);
    if(sel){
      if(it&&it!==sel&&itemSel!==zoneSel&&sel.closest(zoneSel)===it.closest(zoneSel)){setSel(it);return}
      if(z&&z!==sel&&!sel.contains(z)){var s=sel;setSel(null);place(s,z);return}
    }
    if(it&&root.contains(it))setSel(sel===it?null:it);
  });
  root.addEventListener('pointerdown',function(ev){
    var it=ev.target.closest(itemSel);if(!it||!root.contains(it)||(ev.button&&ev.button>0))return;
    var b0=ev.target.closest('button');if(b0&&!b0.hasAttribute('data-item'))return;
    var sx=ev.clientX,sy=ev.clientY,ghost=null,over=null,ox=24,oy=22;
    function zoneAt(e){var t=document.elementFromPoint(e.clientX,e.clientY),z=t&&t.closest?t.closest(zoneSel):null;return z&&root.contains(z)&&z!==it&&!it.contains(z)?z:null}
    function mv(e){if(!ghost){if(Math.abs(e.clientX-sx)+Math.abs(e.clientY-sy)<8)return;var r0=it.getBoundingClientRect();ox=sx-r0.left;oy=sy-r0.top;ghost=it.cloneNode(true);ghost.className='sk-chip sk-ghost';ghost.style.width=r0.width+'px';ghost.style.boxSizing='border-box';document.body.appendChild(ghost);it.classList.add('sk-dragging');setSel(null)}
      ghost.style.transform='translate('+(e.clientX-ox)+'px,'+(e.clientY-oy)+'px) scale(1.04) rotate(-1.2deg)';var z=zoneAt(e);if(over!==z){if(over)over.classList.remove('sk-over');over=z;if(z)z.classList.add('sk-over')}}
    function up(e){document.removeEventListener('pointermove',mv);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',up);
      if(!ghost)return;var z=e.type==='pointerup'?zoneAt(e):null,gr=ghost.getBoundingClientRect();ghost.remove();it.classList.remove('sk-dragging');if(over)over.classList.remove('sk-over');dragAt=Date.now();dropFrom={key:keyOf(it),rect:gr};if(z)place(it,z);else flip(root,function(){});dropFrom=null}
    document.addEventListener('pointermove',mv);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',up);
  });
  return {sel:function(){return sel},clear:function(){setSel(null)}};
}
function clearMark(c){c.classList.remove('sk-bad','sk-good');c.style.removeProperty('--sk-d');var m=c.querySelector('.sk-mk');if(m)m.remove()}
function chip(html,extra){var b=h('button',{type:'button','class':'sk-chip','data-item':''});b.innerHTML=html;if(extra)for(var k in extra)b.setAttribute(k,extra[k]);return b}
function finish(e,fb,ok,html,mis,qid,attempt,go){feedback(fb,ok,html);report(qid,ok,mis,attempt);if(ok)solved(go)}

/* ---- 排序：可拖曳，也可點選後點目標位置，或用上下按鈕 ---- */
define('sk-order',function(e){
  var qid=e.id||id('order'),items=$$('sk-item',e).map(function(x,i){return{key:i,html:x.innerHTML}}),cur=shuffled(items,qid),attempt=1,ol=h('ol',{'class':'sk-ol'}),fb=box();
  if(cur.every(function(x,i){return x.key===i})&&cur.length>1)cur.push(cur.shift());
  e.insertBefore(question(e),e.firstChild);
  function move(from,to){if(from===to||from<0||to<0)return;flip(ol,function(){var t=cur.splice(from,1)[0];cur.splice(to,0,t);paint()})}
  function paint(){while(ol.firstChild)ol.removeChild(ol.firstChild);cur.forEach(function(it,i){var s=h('span',{'class':'sk-ol-t'});s.innerHTML=it.html;var up=h('button',{type:'button','class':'sk-btn','aria-label':'上移',text:'↑',disabled:i===0}),dn=h('button',{type:'button','class':'sk-btn','aria-label':'下移',text:'↓',disabled:i===cur.length-1});
    up.addEventListener('click',function(){move(i,i-1);var b=ol.children[Math.max(0,i-1)].querySelector('button');if(b&&!b.disabled)b.focus()});
    dn.addEventListener('click',function(){move(i,i+1);var bs=ol.children[Math.min(cur.length-1,i+1)].querySelectorAll('button');if(bs[1]&&!bs[1].disabled)bs[1].focus()});
    var li=h('li',{'data-k':String(it.key),'class':'sk-ol-i'},[h('b',{text:String(i+1),'aria-hidden':'true'}),s,up,dn]);ol.appendChild(li)})}
  paint();var go=h('button',{type:'button','class':'sk-btn sk-primary',text:'檢查順序'});e.appendChild(ol);e.appendChild(h('div',{'class':'sk-actions'},[go,resetBtn('重來',function(){flip(ol,function(){cur=shuffled(items,qid);if(cur.every(function(x,i){return x.key===i})&&cur.length>1)cur.push(cur.shift());paint()});wipe(e,fb)})]));e.appendChild(fb);
  function idx(el){return cur.findIndex(function(x){return String(x.key)===el.getAttribute('data-k')})}
  dnd(ol,'li','li',function(a,b){move(idx(a),idx(b))});
  e.__solve=function(){cur.sort(function(a,b){return a.key-b.key});paint();silentSolved(e,fb,go)};
  go.addEventListener('click',function(){var ok=cur.every(function(x,i){return x.key===i});Array.prototype.forEach.call(ol.children,function(li,i){li.classList.remove('sk-good','sk-bad');li.classList.add(cur[i].key===i?'sk-good':'sk-bad')});feedback(fb,ok,ok?'':(attr(e,'feedback','')));report(qid,ok,attr(e,'misconception',null),attempt);attempt++;if(!ok)stats.retries++;if(ok)solved(go)});
});

/* ---- 配對：點左邊再點右邊；已配對的兩邊有相同的編號 ---- */
define('sk-match',function(e){
  var qid=e.id||id('match'),pairs=$$('sk-pair',e).map(function(p){return{l:p.getAttribute('left'),r:p.getAttribute('right'),mis:p.getAttribute('misconception'),fb:p.getAttribute('feedback')||''}}),order=shuffled(pairs.map(function(p,i){return i}),qid),link=pairs.map(function(){return -1}),selL=-1,attempt=1,fb=box(),wrong={},seen={};
  e.insertBefore(question(e),e.firstChild);
  var L=h('div',{'class':'sk-col'}),R=h('div',{'class':'sk-col'}),cols=h('div',{'class':'sk-cols'},[L,R]);
  function paint(){L.textContent='';R.textContent='';
    pairs.forEach(function(p,i){var n=link[i]>=0,pop=n&&seen['L'+i]!==link[i],b=chip('<b class="sk-no'+(n?' sk-on':'')+(wrong[i]?' sk-x':'')+(pop?' sk-pop':'')+'">'+(n?(i+1):'')+(wrong[i]?'✗':'')+'</b><span>'+p.l+'</span>');seen['L'+i]=link[i];if(i===selL)b.classList.add('sk-sel');b.setAttribute('aria-pressed',String(i===selL));
      b.addEventListener('click',function(){if(link[i]>=0){link[i]=-1;selL=-1}else selL=selL===i?-1:i;wrong={};paint()});L.appendChild(b)});
    order.forEach(function(j){var from=link.indexOf(j),pop=from>=0&&seen['R'+j]!==from,b=chip('<b class="sk-no'+(from>=0?' sk-on':'')+(from>=0&&wrong[from]?' sk-x':'')+(pop?' sk-pop':'')+'">'+(from>=0?(from+1):'')+(from>=0&&wrong[from]?'✗':'')+'</b><span>'+pairs[j].r+'</span>');seen['R'+j]=from;
      b.addEventListener('click',function(){if(selL>=0){var o=link.indexOf(j);if(o>=0)link[o]=-1;link[selL]=j;selL=-1;wrong={};paint()}else if(from>=0){link[from]=-1;wrong={};paint()}});R.appendChild(b)})}
  paint();var go=h('button',{type:'button','class':'sk-btn sk-primary',text:'檢查配對'});e.appendChild(cols);e.appendChild(h('div',{'class':'sk-actions'},[go,resetBtn('重來',function(){link=pairs.map(function(){return -1});selL=-1;wrong={};paint();wipe(e,fb)})]));e.appendChild(fb);
  e.__solve=function(){for(var i=0;i<pairs.length;i++)link[i]=i;selL=-1;wrong={};paint();silentSolved(e,fb,go)};
  go.addEventListener('click',function(){if(link.some(function(x){return x<0})){nudge(fb,'請完成所有配對（點左邊的項目，再點它對應的右邊）。');return}
    wrong={};var mis=null,notes=[];pairs.forEach(function(p,i){if(link[i]!==i){wrong[i]=1;if(!mis)mis=pairs[i].mis;if(pairs[i].fb)notes.push(pairs[i].fb)}});
    var ok=!Object.keys(wrong).length;paint();feedback(fb,ok,ok?'':(notes.join(' ')||attr(e,'feedback','')));report(qid,ok,mis||attr(e,'misconception',null),attempt);attempt++;if(!ok)stats.retries++;if(ok)solved(go)});
});

/* ---- 分類：把卡片放進分類（拖曳，或點卡片再點分類） ---- */
define('sk-sort',function(e){
  var qid=e.id||id('sort'),bk=$$('sk-bucket',e).map(function(b){return{name:b.getAttribute('name')||b.textContent,label:b.getAttribute('label')||b.getAttribute('name')||b.textContent}}),cards=$$('sk-card',e).map(function(c){return{html:c.innerHTML,bucket:c.getAttribute('bucket'),mis:c.getAttribute('misconception'),fb:c.getAttribute('feedback')||''}}),attempt=1,fb=box();
  e.insertBefore(question(e),e.firstChild);
  var pool=h('div',{'class':'sk-pool','data-zone':'','aria-label':'待分類'}),grid=h('div',{'class':'sk-buckets'}),zones={};
  bk.forEach(function(b){var z=h('div',{'class':'sk-bucket','data-zone':b.name,role:'group','aria-label':b.label}),t=h('div',{'class':'sk-bt',text:b.label});zones[b.name]=z;grid.appendChild(h('div',{'class':'sk-bw'},[t,z]))});
  var els=shuffled(cards.map(function(c,i){return i}),qid).map(function(i){var b=chip(cards[i].html,{'data-c':String(i)});pool.appendChild(b);return b});
  e.appendChild(pool);e.appendChild(grid);
  var go=h('button',{type:'button','class':'sk-btn sk-primary',text:'檢查分類'});e.appendChild(h('div',{'class':'sk-actions'},[go,resetBtn('重來',function(){flip(e,function(){els.forEach(function(c){pool.appendChild(c);clearMark(c)})});wipe(e,fb)})]));e.appendChild(fb);
  dnd(e,'.sk-chip[data-c]','.sk-pool,.sk-bucket',function(c,z){flip(e,function(){z.appendChild(c)});clearMark(c);say(c.textContent+' 放入 '+(z.getAttribute('aria-label')||'待分類'))});
  e.__solve=function(){els.forEach(function(c){var i=+c.getAttribute('data-c');zones[cards[i].bucket].appendChild(c);clearMark(c)});silentSolved(e,fb,go)};
  go.addEventListener('click',function(){
    if(els.some(function(c){return c.parentNode===pool})){nudge(fb,'還有卡片沒有分類。');return}
    var mis=null,notes=[];els.forEach(function(c,n){var i=+c.getAttribute('data-c'),ok=c.parentNode.getAttribute('data-zone')===cards[i].bucket;clearMark(c);void c.offsetWidth;c.classList.add(ok?'sk-good':'sk-bad');c.style.setProperty('--sk-d',Math.min(n*40,160)+'ms');c.insertBefore(h('span',{'class':'sk-mk','aria-label':ok?'正確':'錯誤'},[h('i',{text:ok?'✓':'✗'})]),c.firstChild);if(!ok){if(!mis)mis=cards[i].mis;if(cards[i].fb)notes.push(cards[i].fb)}});
    var ok=!els.some(function(c){return c.classList.contains('sk-bad')});feedback(fb,ok,ok?'':notes.join(' '));report(qid,ok,mis,attempt);attempt++;if(!ok)stats.retries++;if(ok)solved(go)});
});

/* ---- 圖解標示：把名稱放到圖上的位置 ---- */
define('sk-label',function(e){
  var qid=e.id||id('label'),svg=$('svg',e),terms=$$('sk-term',e).map(function(t){return{html:t.innerHTML,part:t.getAttribute('part'),mis:t.getAttribute('misconception'),fb:t.getAttribute('feedback')||''}}),attempt=1,fb=box();
  if(!svg)return;e.insertBefore(question(e),e.firstChild);
  var names=[];$$('[data-part]',svg).forEach(function(p){var n=p.getAttribute('data-part');if(names.indexOf(n)<0)names.push(n)});
  var wrap=h('div',{'class':'sk-labfig'});svg.parentNode.insertBefore(wrap,svg);wrap.appendChild(svg);
  var assign={},pins={},tray=h('div',{'class':'sk-pool','aria-label':'名稱'}),list=h('ol',{'class':'sk-ll'}),chips=terms.map(function(t,i){var b=chip(t.html,{'data-t':String(i)});tray.appendChild(b);return b});
  names.forEach(function(n,i){var g=sv('g',{'class':'sk-pin','data-part':n,role:'button',tabindex:'0','aria-label':'位置 '+(i+1)},[sv('circle',{r:17,'class':'sk-pin-hit'}),sv('circle',{r:9,'class':'sk-pin-c'})]);var t=sv('text',{'class':'sk-pin-t','text-anchor':'middle',y:3.4});t.textContent=String(i+1);g.appendChild(t);svg.appendChild(g);pins[n]=g});
  function pinAt(){
    var rs=[],a=svg.getScreenCTM&&svg.getScreenCTM();if(!a)return;
    names.forEach(function(n){var part=$('[data-part="'+n+'"]:not(.sk-pin)',svg);if(!part||!part.getScreenCTM)return;var b=part.getScreenCTM(),bb;if(!b)return;try{bb=part.getBBox()}catch(x){return}if(!bb.width&&!bb.height)return;
      var m=a.inverse().multiply(b),cx=bb.x+bb.width/2,cy=bb.y+bb.height/2,x=m.a*cx+m.c*cy+m.e,y=m.b*cx+m.d*cy+m.f,w=bb.width*Math.abs(m.a),hh=bb.height*Math.abs(m.d);rs.push({n:n,x:x,y:y,w:w,h:hh})});
    rs.forEach(function(r){if(rs.some(function(o){return o!==r&&Math.abs(o.x-r.x)<r.w/2&&Math.abs(o.y-r.y)<r.h/2&&o.w*o.h<r.w*r.h}))r.y=r.y-r.h/2+14});
    var placed=[];rs.forEach(function(r){var tries=0;while(tries++<8&&placed.some(function(o){return Math.hypot(o.x-r.x,o.y-r.y)<20}))r.y+=20;placed.push(r);pins[r.n].setAttribute('transform','translate('+r.x.toFixed(1)+' '+r.y.toFixed(1)+')')})}
  var keep=false;
  function paint(){names.forEach(function(n,i){if(!keep)pins[n].classList.remove('sk-bad','sk-good');pins[n].classList.toggle('sk-filled',assign[n]!=null);var t=pins[n].querySelector('.sk-pin-t');t.textContent=assign[n]!=null?'':String(i+1)});
    chips.forEach(function(c,i){var used=false;for(var n in assign)if(assign[n]===i)used=true;c.hidden=used});
    list.textContent='';names.forEach(function(n,i){var li=h('li',{});li.innerHTML='<b>'+(i+1)+'.</b> '+(assign[n]!=null?terms[assign[n]].html:'<i>點選名稱，再點圖上的位置</i>');list.appendChild(li)});pinAt()}
  e.appendChild(tray);e.appendChild(list);
  var go=h('button',{type:'button','class':'sk-btn sk-primary',text:'檢查標示'});e.appendChild(h('div',{'class':'sk-actions'},[go,resetBtn('重來',function(){assign={};api.clear();paint();wipe(e,fb)})]));e.appendChild(fb);
  var api=dnd(e,'.sk-chip[data-t]','[data-part]',function(c,z){var n=z.getAttribute('data-part'),i=+c.getAttribute('data-t');for(var k in assign)if(assign[k]===i)delete assign[k];assign[n]=i;paint();say(c.textContent+' 放到位置 '+(names.indexOf(n)+1))});
  e.addEventListener('click',function(ev){if(Date.now()-dragAt<300||api.sel())return;var p=ev.target.closest('.sk-pin');if(p&&assign[p.getAttribute('data-part')]!=null){delete assign[p.getAttribute('data-part')];paint()}});
  e.addEventListener('keydown',function(ev){if(ev.key!=='Enter'&&ev.key!==' ')return;var p=ev.target.closest&&ev.target.closest('.sk-pin');if(!p)return;ev.preventDefault();var s=api.sel();if(s){var n=p.getAttribute('data-part'),i=+s.getAttribute('data-t');for(var k in assign)if(assign[k]===i)delete assign[k];assign[n]=i;api.clear();paint()}else if(assign[p.getAttribute('data-part')]!=null){delete assign[p.getAttribute('data-part')];paint()}});
  if(window.ResizeObserver)new ResizeObserver(pinAt).observe(svg);paint();
  e.__solve=function(){assign={};terms.forEach(function(t,i){assign[t.part]=i});paint();names.forEach(function(n){pins[n].classList.add('sk-good')});silentSolved(e,fb,go)};
  go.addEventListener('click',function(){
    if(names.some(function(n){return assign[n]==null})){nudge(fb,'還有位置沒有標示。');return}
    var mis=null,notes=[],ok=true;names.forEach(function(n,i){var t=terms[assign[n]],good=t.part===n;pins[n].classList.toggle('sk-bad',!good);pins[n].classList.toggle('sk-good',good);var li=list.children[i];li.insertAdjacentHTML('beforeend',' <b>'+(good?'✓':'✗')+'</b>');if(!good){ok=false;if(!mis)mis=t.mis;if(t.fb)notes.push(t.fb)}});
    feedback(fb,ok,ok?'':notes.join(' '));report(qid,ok,mis,attempt);attempt++;if(!ok){stats.retries++;keep=true;paint();keep=false}else solved(go)});
});

/* ---- 點選圖上的部位 ---- */
define('sk-pick',function(e){
  var qid=e.id||id('pick'),svg=$('svg',e),answers=attr(e,'answer','').split('|').filter(Boolean),wrongs=$$('sk-wrong',e),explain=$('sk-explain',e),multi=answers.length>1,picked=[],attempt=1,fb=box();
  if(!svg)return;e.insertBefore(question(e),e.firstChild);
  var wrap=h('div',{'class':'sk-labfig'});svg.parentNode.insertBefore(wrap,svg);wrap.appendChild(svg);
  function toggle(p){var n=p.getAttribute('data-part'),i=picked.indexOf(n);if(i>=0)picked.splice(i,1);else{if(!multi)picked=[];picked.push(n)}$$('[data-part]',svg).forEach(function(x){x.classList.toggle('sk-picked',picked.indexOf(x.getAttribute('data-part'))>=0)});say(i>=0?'取消選取':'已選取')}
  $$('[data-part]',svg).forEach(function(p){p.setAttribute('tabindex','0');p.setAttribute('role','button');p.setAttribute('aria-label',p.getAttribute('data-label')||p.getAttribute('data-part'));p.classList.add('sk-hot');
    p.addEventListener('click',function(){toggle(p)});p.addEventListener('keydown',function(ev){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();toggle(p)}})});
  var go=h('button',{type:'button','class':'sk-btn sk-primary',text:'檢查答案'});e.appendChild(h('div',{'class':'sk-actions'},[go,resetBtn('重來',function(){picked=[];$$('[data-part]',svg).forEach(function(x){x.classList.remove('sk-picked')});wipe(e,fb)})]));e.appendChild(fb);
  e.__solve=function(){picked=answers.slice();$$('[data-part]',svg).forEach(function(x){x.classList.toggle('sk-picked',picked.indexOf(x.getAttribute('data-part'))>=0)});silentSolved(e,fb,go,explain?explain.innerHTML:'')};
  go.addEventListener('click',function(){if(!picked.length){nudge(fb,'先點選圖上的部位。');return}
    var ok=picked.length===answers.length&&answers.every(function(a){return picked.indexOf(a)>=0}),mis=null,note='';
    if(!ok)wrongs.some(function(w){if(picked.indexOf(w.getAttribute('part'))>=0){mis=w.getAttribute('misconception');note=w.getAttribute('feedback')||'';return true}return false});
    feedback(fb,ok,ok&&explain?explain.innerHTML:note);report(qid,ok,mis,attempt);attempt++;if(!ok)stats.retries++;if(ok)solved(go)});
});

/* ---- 填空：把詞放進空格 ---- */
define('sk-fill',function(e){
  var qid=e.id||id('fill'),tx=$('sk-text',e),blanks=$$('sk-blank',tx),meta=blanks.map(function(b){return{ans:b.getAttribute('answer'),mis:b.getAttribute('misconception'),fb:b.getAttribute('feedback')||''}}),extra=attr(e,'distractors','').split('|').filter(Boolean),fills=meta.map(function(){return -1}),attempt=1,fb=box(),explain=$('sk-explain',e);
  e.insertBefore(question(e),e.firstChild);
  var words=meta.map(function(m){return m.ans}).concat(extra),order=shuffled(words.map(function(w,i){return i}),qid),bank=h('div',{'class':'sk-pool','aria-label':'詞庫'}),cur=-1,bs=[];
  var chips=order.map(function(i){var c=chip(words[i],{'data-w':String(i)});bank.appendChild(c);return c});
  blanks.forEach(function(b,i){var btn=h('button',{type:'button','class':'sk-blankbtn','data-blank':String(i),'aria-label':'第 '+(i+1)+' 格'});b.parentNode.replaceChild(btn,b);bs.push(btn)});
  e.appendChild(bank);
  function paint(){bs.forEach(function(b,i){b.textContent=fills[i]>=0?words[fills[i]]:'＿＿＿';b.classList.toggle('sk-sel',i===cur);b.classList.toggle('sk-has',fills[i]>=0);b.classList.remove('sk-bad','sk-good')});chips.forEach(function(c){c.hidden=fills.indexOf(+c.getAttribute('data-w'))>=0})}
  function put(i,w){var o=fills.indexOf(w);if(o>=0)fills[o]=-1;fills[i]=w;cur=-1;paint();bump(bs[i])}
  bs.forEach(function(b,i){b.addEventListener('click',function(){if(fills[i]>=0){fills[i]=-1;cur=i}else cur=cur===i?-1:i;paint()})});
  chips.forEach(function(c){c.addEventListener('click',function(){if(Date.now()-dragAt<300)return;var w=+c.getAttribute('data-w'),t=cur>=0?cur:fills.indexOf(-1);if(t>=0)put(t,w)})});
  dnd(e,'.sk-chip[data-w]','.sk-blankbtn',function(c,z){put(+z.getAttribute('data-blank'),+c.getAttribute('data-w'))},true);
  paint();var go=h('button',{type:'button','class':'sk-btn sk-primary',text:'檢查答案'});e.appendChild(h('div',{'class':'sk-actions'},[go,resetBtn('重來',function(){fills=meta.map(function(){return -1});cur=-1;paint();wipe(e,fb)})]));e.appendChild(fb);
  e.__solve=function(){var used={};meta.forEach(function(m,i){for(var w=0;w<words.length;w++){if(words[w]===m.ans&&!used[w]){used[w]=1;fills[i]=w;break}}});cur=-1;paint();bs.forEach(function(b){b.classList.add('sk-good')});silentSolved(e,fb,go,explain?explain.innerHTML:'')};
  go.addEventListener('click',function(){if(fills.some(function(x){return x<0})){nudge(fb,'還有空格沒填。');return}
    var mis=null,notes=[],ok=true;meta.forEach(function(m,i){var good=words[fills[i]]===m.ans;bs[i].classList.toggle('sk-bad',!good);bs[i].classList.toggle('sk-good',good);if(!good){ok=false;if(!mis)mis=m.mis;if(m.fb)notes.push(m.fb)}});
    feedback(fb,ok,ok&&explain?explain.innerHTML:notes.join(' '));report(qid,ok,mis,attempt);attempt++;if(!ok)stats.retries++;if(ok)solved(go)});
});

/* ---- 配平化學式：調整係數，即時顯示兩邊原子數 ---- */
function atoms(f){var st=[{}],m,re=/([A-Z][a-z]?)(\d*)|(\()|\)(\d*)/g;while((m=re.exec(f))){var top=st[st.length-1];if(m[1])top[m[1]]=(top[m[1]]||0)+(m[2]?+m[2]:1);else if(m[3])st.push({});else{var t=st.pop(),k=m[4]?+m[4]:1,p=st[st.length-1];for(var a in t)p[a]=(p[a]||0)+t[a]*k}}return st[0]}
function gcd(a,b){return b?gcd(b,a%b):a}
define('sk-balance',function(e){
  var qid=e.id||id('balance'),eq=attr(e,'equation','').split(/->|→|=/),sides=eq.map(function(s){return s.split('+').map(function(x){return x.trim()}).filter(Boolean)}),terms=[],attempt=1,fb=box();
  if(sides.length<2)return;e.insertBefore(question(e),e.firstChild);
  var row=h('div',{'class':'sk-eq'}),table=h('div',{'class':'sk-atoms','aria-live':'polite'});
  sides.forEach(function(side,si){if(si){row.appendChild(h('span',{'class':'sk-arrow',text:'→'}))}side.forEach(function(f,ti){
    if(ti)row.appendChild(h('span',{'class':'sk-plus',text:'+'}));
    var t={f:f,side:si,n:1,atoms:atoms(f)},num=h('output',{'class':'sk-coef'}),mi=h('button',{type:'button','class':'sk-btn sk-step','aria-label':'減少 '+f+' 的係數',text:'−'}),pl=h('button',{type:'button','class':'sk-btn sk-step','aria-label':'增加 '+f+' 的係數',text:'＋'}),fm=h('span',{'class':'sk-formula'});fm.innerHTML=f.replace(/(\D)(\d+)/g,'$1<sub>$2</sub>');
    t.num=num;terms.push(t);
    mi.addEventListener('click',function(){if(t.n>1){t.n--;paint();bump(num)}});pl.addEventListener('click',function(){if(t.n<12){t.n++;paint();bump(num)}});
    row.appendChild(h('span',{'class':'sk-term'},[h('span',{'class':'sk-stepper'},[mi,num,pl]),fm]))})});
  function counts(){var tot=[{},{}];terms.forEach(function(t){for(var a in t.atoms)tot[t.side][a]=(tot[t.side][a]||0)+t.atoms[a]*t.n});return tot}
  function paint(){var tot=counts(),els=Object.keys(tot[0]).concat(Object.keys(tot[1]).filter(function(a){return !(a in tot[0])}));table.textContent='';
    terms.forEach(function(t){t.num.textContent=String(t.n)});
    els.forEach(function(a){var l=tot[0][a]||0,r=tot[1][a]||0;table.appendChild(h('span',{'class':'sk-atom'+(l===r?' sk-eqok':' sk-eqno')},[h('b',{text:a}),document.createTextNode(' '+l+' ＝ '+r+(l===r?' ✓':' ✗'))]))})}
  paint();e.appendChild(row);e.appendChild(table);
  var go=h('button',{type:'button','class':'sk-btn sk-primary',text:'檢查配平'});e.appendChild(h('div',{'class':'sk-actions'},[go,resetBtn('重來',function(){terms.forEach(function(t){t.n=1});paint();$$('.sk-coef',e).forEach(bump);wipe(e,fb)})]));e.appendChild(fb);
  e.__snap=function(){return fb.classList.contains('sk-ok')?{ok:1,n:terms.map(function(t){return t.n})}:undefined};
  e.__restore=function(st){if(Array.isArray(st.n))terms.forEach(function(t,i){var x=+st.n[i];if(x>=1&&x<=12)t.n=x});paint();silentSolved(e,fb,go)};
  go.addEventListener('click',function(){var tot=counts(),els=Object.keys(tot[0]).concat(Object.keys(tot[1])),bal=els.every(function(a){return (tot[0][a]||0)===(tot[1][a]||0)}),g=terms.reduce(function(x,t){return gcd(x,t.n)},0),ok=bal&&g===1;
    var mis=null,note='';if(!bal){mis=attr(e,'misconception','unbalanced-equation');note='兩邊的原子數還沒相等，看上面標 ✗ 的元素。'}else if(g>1){mis='not-lowest-terms';note='已經平衡，但係數還能約分成最簡整數比。'}
    finish(e,fb,ok,ok?($('sk-explain',e)?$('sk-explain',e).innerHTML:''):note,mis,qid,attempt,go);attempt++;if(!ok)stats.retries++});
});

/* ---- 旋鈕：拖曳旋轉、點 −／＋ 或用方向鍵調整數值 ---- */
define('sk-knob',function(e){
  var name=attr(e,'name','x'),min=num(e,'min',0),max=num(e,'max',100),step=num(e,'step',1),unit=attr(e,'unit',''),dg=e.hasAttribute('digits')?num(e,'digits',0):(String(step).split('.')[1]||'').length;
  function snap(v){v=Math.round((v-min)/step)*step+min;return Math.max(min,Math.min(max,parseFloat(v.toFixed(6))))}
  var val=snap(num(e,'value',min)),out=h('span',{'class':'sk-value'}),ind=sv('g',{'class':'sk-dial-g'}),dial=sv('svg',{viewBox:'-44 -44 88 88','class':'sk-dial',role:'slider',tabindex:'0','aria-label':attr(e,'label',name),'aria-valuemin':min,'aria-valuemax':max}),drag=false;
  dial.appendChild(sv('circle',{r:36,'class':'sk-dial-track'}));
  for(var i=0;i<=10;i++){var a=(-135+i*27)*Math.PI/180;dial.appendChild(sv('line',{x1:(Math.sin(a)*38).toFixed(1),y1:(-Math.cos(a)*38).toFixed(1),x2:(Math.sin(a)*(i%5?41:43)).toFixed(1),y2:(-Math.cos(a)*(i%5?41:43)).toFixed(1),'class':'sk-dial-tick'}))}
  dial.appendChild(sv('circle',{r:26,'class':'sk-dial-face'}));ind.appendChild(sv('line',{x1:0,y1:-8,x2:0,y2:-24,'class':'sk-dial-ind'}));dial.appendChild(ind);
  var mi=h('button',{type:'button','class':'sk-btn sk-step','aria-label':'減少',text:'−'}),pl=h('button',{type:'button','class':'sk-btn sk-step','aria-label':'增加',text:'＋'});
  function show(){ind.style.transform='rotate('+(-135+270*(max>min?(val-min)/(max-min):0)).toFixed(1)+'deg)';out.textContent=fmt(val,dg)+unit;dial.setAttribute('aria-valuenow',val);dial.setAttribute('aria-valuetext',fmt(val,dg)+unit)}
  function set(v,fire){v=snap(v);if(v===val&&fire!==false)return;val=v;show();if(fire!==false)change(name,val)}
  function fromPointer(ev){var r=dial.getBoundingClientRect(),dx=ev.clientX-(r.left+r.width/2),dy=ev.clientY-(r.top+r.height/2),ang=Math.atan2(dx,-dy)*180/Math.PI;if(ang>135)ang=135;if(ang<-135)ang=-135;set(min+(ang+135)/270*(max-min))}
  dial.addEventListener('pointerdown',function(ev){drag=true;dial.classList.add('sk-grab');try{dial.setPointerCapture(ev.pointerId)}catch(x){}fromPointer(ev)});
  dial.addEventListener('pointermove',function(ev){if(drag)fromPointer(ev)});dial.addEventListener('pointerup',function(){drag=false;dial.classList.remove('sk-grab')});dial.addEventListener('pointercancel',function(){drag=false;dial.classList.remove('sk-grab')});
  dial.addEventListener('keydown',function(ev){var d=ev.key==='ArrowRight'||ev.key==='ArrowUp'?1:ev.key==='ArrowLeft'||ev.key==='ArrowDown'?-1:ev.key==='PageUp'?10:ev.key==='PageDown'?-10:0;if(ev.key==='Home'){ev.preventDefault();set(min);return}if(ev.key==='End'){ev.preventDefault();set(max);return}if(!d)return;ev.preventDefault();set(val+d*step)});
  mi.addEventListener('click',function(){set(val-step)});pl.addEventListener('click',function(){set(val+step)});
  e.appendChild(h('div',{'class':'sk-label'},[h('span',{text:attr(e,'label',name)}),out]));e.appendChild(h('div',{'class':'sk-knobrow'},[mi,dial,pl]));
  values[name]=val;show();e.__set=function(v){set(v)};
});
define('sk-tune',function(e){
  var qid=e.id||id('tune'),cname=attr(e,'compute',''),target=num(e,'target',0),tol=num(e,'tolerance',.1),unit=attr(e,'unit',''),dg=num(e,'digits',2),wrongs=$$('sk-wrong',e),explain=$('sk-explain',e),attempt=1,fb=box();
  e.insertBefore(question(e),e.firstChild);
  var out=h('div',{'class':'sk-tune-out','aria-live':'polite'}),go=h('button',{type:'button','class':'sk-btn sk-primary',text:'檢查'});
  function cur(){var f=computes[cname];if(!f)return NaN;try{return f(values)}catch(x){return NaN}}
  function show(){var v=cur();out.textContent=attr(e,'label','目前')+'：'+(isFinite(v)?fmt(v,dg):'—')+unit}
  listeners.push(show);show();
  e.appendChild(out);e.appendChild(h('div',{'class':'sk-actions'},[go]));e.appendChild(fb);
  e.__solve=function(){silentSolved(e,fb,go,explain?explain.innerHTML:'')};
  go.addEventListener('click',function(){var v=cur(),ok=isFinite(v)&&Math.abs(v-target)<=tol,mis=null,note='';
    if(!ok)wrongs.some(function(w){var wt=parseFloat(w.getAttribute('tolerance')||tol);if(Math.abs(v-parseFloat(w.getAttribute('value')))<=wt){mis=w.getAttribute('misconception');note=w.getAttribute('feedback')||'';return true}return false});
    feedback(fb,ok,ok&&explain?explain.innerHTML:note);report(qid,ok,mis,attempt);attempt++;if(!ok)stats.retries++;if(ok)solved(go)});
});
define('sk-tabs',function(e){
  var tid=e.id||id('tabs'),tabs=$$('sk-tab',e),bar=h('div',{class:'sk-tabbar',role:'tablist'}),btns=[],cur=0,start=Date.now();
  tabs.forEach(function(t,i){t.id=tid+'-p'+i;t.setAttribute('role','tabpanel');var b=h('button',{type:'button',class:'sk-btn',role:'tab',id:tid+'-t'+i,'aria-controls':t.id,text:attr(t,'heading','第 '+(i+1)+' 頁')});
    b.addEventListener('click',function(){show(i,true)});
    b.addEventListener('keydown',function(ev){var d=ev.key==='ArrowRight'?1:ev.key==='ArrowLeft'?-1:0;if(!d)return;ev.preventDefault();show((i+d+btns.length)%btns.length,true);btns[cur].focus()});
    btns.push(b);bar.appendChild(b)});
  var pill=h('span',{class:'sk-tab-pill','aria-hidden':'true'});bar.insertBefore(pill,bar.firstChild);e.insertBefore(bar,e.firstChild);
  function place(){var b=btns[cur];if(!b)return;pill.style.width=b.offsetWidth+'px';pill.style.transform='translateX('+b.offsetLeft+'px)'}
  window.addEventListener('resize',place);if(window.ResizeObserver)new ResizeObserver(place).observe(bar);
  function show(i,fire){cur=i;tabs.forEach(function(t,k){t.hidden=k!==i;btns[k].setAttribute('aria-selected',String(k===i));btns[k].tabIndex=k===i?0:-1});place();animIn(tabs[i]);if(fire){stats.steps++;emit('step',{id:slug(tid),index:i+1,total:tabs.length,ms:Date.now()-start});start=Date.now();say(attr(tabs[i],'heading','')+'，第 '+(i+1)+' 頁')}}
  pill.style.transition='none';show(0,false);void pill.offsetWidth;pill.style.transition='';
  e.__goto=function(t){var k=tabs.indexOf(t);if(k>=0&&k!==cur)show(k,false)};
  e.__snap=function(){return cur>0?{i:cur}:undefined};e.__restore=function(st){var n=+st.i;if(n>=0&&n<tabs.length){pill.style.transition='none';show(n,false);void pill.offsetWidth;pill.style.transition=''}};
});
var recs={};
define('sk-record',function(e){
  var rid=e.id||id('rec'),min=num(e,'min',1),cap=Math.max(1,Math.floor(num(e,'max-rows',12))),rows=[],cols=$$('sk-col',e).map(function(c){return{n:attr(c,'name',''),l:attr(c,'label',''),u:attr(c,'unit',''),d:num(c,'digits',null),lo:num(c,'low',-Infinity),hi:num(c,'high',Infinity),m:attr(c,'misconception',''),f:attr(c,'feedback',''),man:c.hasAttribute('manual'),tol:num(c,'tol',.5),inp:null}});
  var head=h('tr',{},cols.map(function(c){return h('th',{scope:'col',text:c.l+(c.u?'（'+c.u+'）':'')})}).concat([h('th',{scope:'col',text:'檢核'})])),body=h('tbody'),
    go=h('button',{type:'button',class:'sk-btn sk-primary',text:'記錄這一筆'}),undo=h('button',{type:'button',class:'sk-btn',text:'刪除最後一筆'}),stat=h('p',{class:'sk-rec-n','aria-live':'polite'}),fb=h('div',{class:'sk-fb','aria-live':'polite',hidden:true});
  recs[rid]=rows;e.insertBefore(h('div',{class:'sk-rec-t',text:attr(e,'heading','實驗紀錄')}),e.firstChild);
  var ins=cols.filter(function(c){return c.man});if(ins.length){var form=h('div',{class:'sk-rec-in'});ins.forEach(function(c){c.inp=h('input',{type:'text',inputmode:'decimal',autocomplete:'off','aria-label':c.l});form.appendChild(h('label',{},[h('span',{text:'你讀到的「'+c.l+'」'+(c.u?'（'+c.u+'）':'')}),c.inp]))});e.appendChild(form)}
  e.appendChild(h('table',{},[h('thead',{},[head]),body]));e.appendChild(h('div',{class:'sk-actions'},[go,undo]));e.appendChild(stat);e.appendChild(fb);
  function paint(){stat.textContent='已記錄 '+rows.length+' 筆'+(min>1?'，至少需要 '+min+' 筆':'');e.dataset.done=rows.length>=min&&rows.every(function(r){return r.ok})?'1':'';undo.disabled=!rows.length;go.disabled=rows.length>=cap}
  function append(row,animate){rows.push(row);var tr=h('tr',{},cols.map(function(c){return h('td',{text:fmt(row.v[c.n],c.d)})}).concat([h('td',{class:row.ok?'sk-good':'sk-bad',text:row.ok?'✓ 合理':'✗ 檢查操作'})]));body.appendChild(tr);if(animate)animIn(tr)}
  function signature(){return cols.map(function(c){return[c.n,c.u,isFinite(c.lo)?c.lo:null,isFinite(c.hi)?c.hi:null,c.man?c.tol:null]})}
  e.__snap=function(){return rows.length?{n:signature(),r:rows.map(function(row){return[row.ok?1:0].concat(cols.map(function(c){return row.v[c.n]}))})}:undefined};
  e.__restore=function(st){
    if(!Array.isArray(st.r))return;
    if(JSON.stringify(st.n)!==JSON.stringify(signature())){nudge(fb,'實驗欄位或檢核方式已更新，請依新教材重新記錄。');return}
    rows.length=0;body.textContent='';fb.hidden=true;
    st.r.slice(0,cap).forEach(function(data){
      if(!Array.isArray(data)||data.length!==cols.length+1||(data[0]!==0&&data[0]!==1))return;
      var row={ok:data[0]===1,v:{}};
      for(var i=0;i<cols.length;i++){var c=cols[i],x=data[i+1];if(typeof x!=='number'||!isFinite(x))return;row.v[c.n]=x;if(x<c.lo||x>c.hi)row.ok=false}
      append(row,false);
    });paint();
  };
  go.addEventListener('click',function(){
    var row={ok:true,v:{}},bad=null;
    for(var i=0;i<cols.length;i++){var c=cols[i],x=values[c.n];if(typeof x==='string'&&x.trim()!=='')x=Number(x);if(typeof x!=='number'||!isFinite(x)){nudge(fb,'先操作器材，讓「'+c.l+'」有讀數再記錄。');return}
      if(c.man){var y=parseFloat(String(c.inp.value).replace(/,/g,'').trim());if(!isFinite(y)){nudge(fb,'請先輸入你讀到的「'+c.l+'」。');return}
        if(Math.abs(y-x)>c.tol&&!bad){bad=c;row.ok=false;if(!c.f)c.f='讀數和刻度對不上，再看一次刻度（液面看彎月面最低點）。'}x=y}
      row.v[c.n]=x;if((x<c.lo||x>c.hi)&&!bad){bad=c;row.ok=false}}
    append(row,true);
    if(row.ok){fb.hidden=true}else{fb.className='sk-fb sk-no';fb.hidden=false;fb.textContent='✗ 「'+bad.l+'」的讀數不合理。'+bad.f}
    report(rid+'-row',row.ok,bad?bad.m:null,rows.length);paint();say(row.ok?'已記錄':'讀數不合理')});
  undo.addEventListener('click',function(){if(!rows.length)return;rows.pop();body.removeChild(body.lastChild);fb.hidden=true;paint()});
  paint();
});
/* ---- more ways to answer: plot on a graph, complete a table, mark a text, explain in your own words; flashcards to recall terms ---- */
function norm(t){return String(t==null?'':t).replace(/\s+/g,' ').trim().toLowerCase()}
function pairs(t){return String(t||'').split(';').map(function(p){var a=p.split(',');return [parseFloat(a[0]),parseFloat(a[1])]}).filter(function(p){return isFinite(p[0])&&isFinite(p[1])})}
function lineOf(t){var a=String(t||'').split(',').map(parseFloat);return a.length===2&&isFinite(a[0])&&isFinite(a[1])?a:null}
define('sk-graph',function(e){
  var qid=e.id||id('graph'),x0=num(e,'xmin',-5),x1=num(e,'xmax',5),y0=num(e,'ymin',-5),y1=num(e,'ymax',5),st=num(e,'step',1),want=pairs(attr(e,'points','')),line=lineOf(attr(e,'line','')),tol=num(e,'tolerance',line?0.01:st/2),wrongs=$$('sk-wrong',e),explain=$('sk-explain',e),attempt=1,fb=box();
  if(!(x1>x0&&y1>y0&&st>0)||(!want.length&&!line))return;
  e.insertBefore(question(e),e.firstChild);
  var W=300,H=300,P=24,sel=-1,drag=-1,moved=false;
  function snap(v,a,b){return Math.min(b,Math.max(a,Math.round(v/st)*st))}
  function sx(x){return P+(x-x0)/(x1-x0)*(W-2*P)}function sy(y){return H-P-(y-y0)/(y1-y0)*(H-2*P)}
  function start(){return line?[[snap(x0+(x1-x0)*.25,x0,x1),snap(y0+(y1-y0)*.25,y0,y1)],[snap(x0+(x1-x0)*.75,x0,x1),snap(y0+(y1-y0)*.25,y0,y1)]]:[]}
  var pts=start(),svg=sv('svg',{viewBox:'0 0 '+W+' '+H,'class':'sk-graph',role:'group','aria-label':attr(e,'label','座標圖')}),grid=sv('g',{'class':'sk-gg'}),layer=sv('g'),read=h('p',{'class':'sk-gread','aria-live':'polite'});
  function step(a,b){var g=st;while((b-a)/g>20)g*=2;return g}
  var gx=step(x0,x1),gy=step(y0,y1),v;
  for(v=Math.ceil(x0/gx)*gx;v<=x1+1e-9;v+=gx)grid.appendChild(sv('line',{x1:sx(v),y1:sy(y0),x2:sx(v),y2:sy(y1),'class':Math.abs(v)<1e-9?'sk-ax':''}));
  for(v=Math.ceil(y0/gy)*gy;v<=y1+1e-9;v+=gy)grid.appendChild(sv('line',{x1:sx(x0),y1:sy(v),x2:sx(x1),y2:sy(v),'class':Math.abs(v)<1e-9?'sk-ax':''}));
  function label(x,y,t,anchor){var n=sv('text',{x:x,y:y,'text-anchor':anchor||'middle'});n.textContent=t;grid.appendChild(n)}
  label(sx(x0),H-8,fmt(x0));label(sx(x1),H-8,fmt(x1)+(attr(e,'xlabel','')?' '+attr(e,'xlabel',''):''),'end');label(6,sy(y0),fmt(y0),'start');label(6,sy(y1)+4,fmt(y1)+(attr(e,'ylabel','')?' '+attr(e,'ylabel',''):''),'start');
  var clip=id('skclip'),cp=sv('clipPath',{id:clip},[sv('rect',{x:P,y:P,width:W-2*P,height:H-2*P})]);
  svg.appendChild(cp);svg.appendChild(grid);svg.appendChild(layer);
  function at(ev){var r=svg.getBoundingClientRect();return [snap(x0+((ev.clientX-r.left)/r.width*W-P)/(W-2*P)*(x1-x0),x0,x1),snap(y0+(H-P-(ev.clientY-r.top)/r.height*H)/(H-2*P)*(y1-y0),y0,y1)]}
  function find(p){for(var k=0;k<pts.length;k++)if(Math.abs(pts[k][0]-p[0])<1e-9&&Math.abs(pts[k][1]-p[1])<1e-9)return k;return -1}
  function describe(){return pts.length?pts.map(function(p){return '('+fmt(p[0])+', '+fmt(p[1])+')'}).join('、'):''}
  function paint(focus){
    while(layer.firstChild)layer.removeChild(layer.firstChild);
    if(line&&pts.length===2&&(pts[0][0]!==pts[1][0]||pts[0][1]!==pts[1][1])){var a=pts[0],b=pts[1],dx=b[0]-a[0],dy=b[1]-a[1],k=(x1-x0+y1-y0)*2/Math.sqrt(dx*dx+dy*dy||1);
      layer.appendChild(sv('line',{x1:sx(a[0]-dx*k),y1:sy(a[1]-dy*k),x2:sx(a[0]+dx*k),y2:sy(a[1]+dy*k),'class':'sk-gl','clip-path':'url(#'+clip+')'}))}
    pts.forEach(function(p,k){var c=sv('circle',{cx:sx(p[0]),cy:sy(p[1]),r:9,'class':'sk-gp'+(k===sel?' sk-sel':''),tabindex:'0',role:'button','data-k':k,'aria-label':(line?'控制點 ':'點 ')+(k+1)+'，位置 ('+fmt(p[0])+', '+fmt(p[1])+')，用方向鍵移動'+(line?'':'，Delete 移除')});layer.appendChild(c);if(focus===k)try{c.focus({preventScroll:true})}catch(x){}});
    read.textContent=line?(pts.length===2?'直線通過 '+describe()+'。拖曳控制點，或點一個控制點再點新位置':''):(pts.length?'已標 '+pts.length+' 點：'+describe():'點一下格線交點來標點，再點一次移除');
  }
  function locked(){return e.dataset.done==='1'}
  svg.addEventListener('pointerdown',function(ev){if(locked())return;var c=ev.target.closest?ev.target.closest('.sk-gp'):null;moved=false;
    if(c){drag=+c.getAttribute('data-k');try{svg.setPointerCapture(ev.pointerId)}catch(x){}ev.preventDefault();return}
    var p=at(ev);if(line){if(sel<0)sel=0;pts[sel]=p;stats.controls++;sel=sel===0?1:0;paint();wipe(e,fb);return}
    var k=find(p);if(k>=0)pts.splice(k,1);else if(pts.length<12)pts.push(p);stats.controls++;paint();wipe(e,fb);say(k>=0?'已移除':'已標點 ('+fmt(p[0])+', '+fmt(p[1])+')')});
  svg.addEventListener('pointermove',function(ev){if(drag<0||locked())return;var p=at(ev);if(p[0]!==pts[drag][0]||p[1]!==pts[drag][1]){pts[drag]=p;moved=true;sel=drag;paint()}});
  function drop(){if(drag<0)return;var k=drag;drag=-1;if(moved){stats.controls++;wipe(e,fb)}else if(!line){pts.splice(k,1);stats.controls++;wipe(e,fb)}else sel=k;paint(moved||line?k:undefined)}
  svg.addEventListener('pointerup',drop);svg.addEventListener('pointercancel',drop);
  svg.addEventListener('keydown',function(ev){var c=ev.target.closest?ev.target.closest('.sk-gp'):null;if(!c||locked())return;var k=+c.getAttribute('data-k'),d={ArrowLeft:[-st,0],ArrowRight:[st,0],ArrowUp:[0,st],ArrowDown:[0,-st]}[ev.key];
    if(d){ev.preventDefault();pts[k]=[snap(pts[k][0]+d[0],x0,x1),snap(pts[k][1]+d[1],y0,y1)];sel=k;stats.controls++;wipe(e,fb);paint(k)}
    else if(!line&&(ev.key==='Delete'||ev.key==='Backspace')){ev.preventDefault();pts.splice(k,1);paint();wipe(e,fb)}});
  var go=h('button',{type:'button','class':'sk-btn sk-primary',text:'檢查答案'}),add=h('button',{type:'button','class':'sk-btn',text:'加一個點'}),acts=[go];
  if(!line){add.addEventListener('click',function(){if(locked()||pts.length>=12)return;var p=[snap((x0+x1)/2,x0,x1),snap((y0+y1)/2,y0,y1)];while(find(p)>=0&&p[0]+st<=x1)p=[p[0]+st,p[1]];pts.push(p);paint(pts.length-1);wipe(e,fb)});acts.push(add)}
  acts.push(resetBtn('重來',function(){pts=start();sel=-1;paint();wipe(e,fb)}));
  e.appendChild(svg);e.appendChild(read);e.appendChild(h('div',{'class':'sk-actions'},acts));e.appendChild(fb);
  function samePts(a,b){return a.length===b.length&&b.every(function(w){return a.some(function(p){return Math.abs(p[0]-w[0])<=tol&&Math.abs(p[1]-w[1])<=tol})})}
  function sameLine(l){if(pts.length!==2||pts[0][0]===pts[1][0])return false;var m=(pts[1][1]-pts[0][1])/(pts[1][0]-pts[0][0]),c=pts[0][1]-m*pts[0][0];return Math.abs(m-l[0])<=tol&&Math.abs(c-l[1])<=tol}
  e.__solve=function(){if(line){var on=[];for(var x=x0;x<=x1+1e-9;x+=st){var y=line[0]*x+line[1];if(y>=y0-1e-9&&y<=y1+1e-9)on.push([x,y])}pts=on.length>1?[on[0],on[on.length-1]]:pts}else pts=want.map(function(p){return p.slice()});sel=-1;e.dataset.done='1';add.disabled=true;paint();silentSolved(e,fb,go,explain?explain.innerHTML:'')};
  e.__snap=function(){return {p:pts,ok:e.querySelector('.sk-fb.sk-ok')?1:0}};
  e.__restore=function(st2){if(st2.ok){e.__solve();return}if(Array.isArray(st2.p)){pts=st2.p.filter(function(p){return Array.isArray(p)&&isFinite(p[0])&&isFinite(p[1])}).slice(0,12).map(function(p){return [snap(+p[0],x0,x1),snap(+p[1],y0,y1)]});if(line&&pts.length!==2)pts=start();paint()}};
  go.addEventListener('click',function(){
    if(!line&&!pts.length){nudge(fb,'先在圖上標出點。');return}
    if(line&&pts[0][0]===pts[1][0]&&pts[0][1]===pts[1][1]){nudge(fb,'兩個控制點要在不同位置。');return}
    var ok=line?sameLine(line):samePts(pts,want),mis=null,note='';
    if(!ok)wrongs.some(function(w){var wl=lineOf(w.getAttribute('line')),wp=pairs(w.getAttribute('points'));if(line&&wl?sameLine(wl):(!line&&wp.length&&samePts(pts,wp))){mis=w.getAttribute('misconception');note=w.getAttribute('feedback')||'';return true}return false});
    if(!ok&&!note&&!line&&pts.length!==want.length)note='需要標出 '+want.length+' 個點，現在有 '+pts.length+' 個。';
    feedback(fb,ok,ok&&explain?explain.innerHTML:note);report(qid,ok,mis,attempt);attempt++;if(!ok)stats.retries++;if(ok){e.dataset.done='1';add.disabled=true;solved(go)}});
  paint();
});
define('sk-table',function(e){
  var qid=e.id||id('table'),rows=$$('sk-tr',e),tol=num(e,'tolerance',0.01),wrongs=$$('sk-wrong',e),explain=$('sk-explain',e),attempt=1,fb=box(),cells=[],table=h('table',{'class':'sk-tbl'});
  if(!rows.length)return;e.insertBefore(question(e),e.firstChild);
  rows.forEach(function(r,ri){var head=r.hasAttribute('head'),tr=h('tr');
    r.innerHTML.split('|').forEach(function(c,ci){var t=c.trim(),m=/^\[([^\]]*)\]$/.exec(t),cell=h(head||(ci===0&&e.hasAttribute('rowhead'))?'th':'td');
      if(m&&!head){var a=m[1].trim(),isNum=/^-?\d+(\.\d+)?$/.test(a),inp=h('input',{type:'text',autocomplete:'off',inputmode:isNum?'decimal':false,'aria-label':'第 '+(ri+1)+' 列第 '+(ci+1)+' 欄'});
        inp.addEventListener('input',function(){inp.removeAttribute('data-s')});cells.push({inp:inp,a:a,n:isNum?parseFloat(a):null});cell.appendChild(inp)}
      else cell.innerHTML=t;
      tr.appendChild(cell)});
    table.appendChild(tr)});
  if(!cells.length)return;
  function good(c,v){return c.n!==null?Math.abs(parseFloat(String(v).replace(/,/g,''))-c.n)<=tol:norm(v)===norm(c.a)}
  var go=h('button',{type:'button','class':'sk-btn sk-primary',text:'檢查答案'});
  e.appendChild(h('div',{'class':'sk-tblw'},[table]));e.appendChild(h('div',{'class':'sk-actions'},[go,resetBtn('重來',function(){cells.forEach(function(c){c.inp.value='';c.inp.removeAttribute('data-s')});wipe(e,fb)})]));e.appendChild(fb);
  table.addEventListener('keydown',function(ev){if(ev.key==='Enter'&&!go.disabled){ev.preventDefault();go.click()}});
  e.__solve=function(){cells.forEach(function(c){c.inp.value=c.a;c.inp.disabled=true;c.inp.setAttribute('data-s','ok')});silentSolved(e,fb,go,explain?explain.innerHTML:'')};
  e.__snap=function(){return {v:cells.map(function(c){return String(c.inp.value).slice(0,40)}),ok:e.querySelector('.sk-fb.sk-ok')?1:0}};
  e.__restore=function(st){if(st.ok){e.__solve();return}if(Array.isArray(st.v))cells.forEach(function(c,k){if(typeof st.v[k]==='string')c.inp.value=st.v[k]})};
  go.addEventListener('click',function(){
    if(cells.some(function(c){return !String(c.inp.value).trim()})){nudge(fb,'先把每一格都填上。');return}
    var mis=null,note='',bad=0;
    cells.forEach(function(c){var v=c.inp.value,ok=good(c,v);c.inp.setAttribute('data-s',ok?'ok':'no');if(ok)return;bad++;
      if(!mis)wrongs.some(function(w){var wv=w.getAttribute('value'),hit=c.n!==null?Math.abs(parseFloat(v)-parseFloat(wv))<=tol:norm(v)===norm(wv);if(hit){mis=w.getAttribute('misconception');note=w.getAttribute('feedback')||'';return true}return false})});
    var ok=!bad;feedback(fb,ok,ok&&explain?explain.innerHTML:(note||'標紅的 '+bad+' 格再檢查一次。'));report(qid,ok,mis,attempt);attempt++;if(!ok)stats.retries++;if(ok){cells.forEach(function(c){c.inp.disabled=true});solved(go)}});
});
define('sk-mark',function(e){
  var qid=e.id||id('mark'),spots=$$('sk-hit,sk-miss',e),explain=$('sk-explain',e),attempt=1,fb=box();
  if(!spots.length)return;e.insertBefore(question(e),e.firstChild);
  function on(s){return s.getAttribute('aria-pressed')==='true'}
  function set(s,v){s.setAttribute('aria-pressed',String(v));s.classList.toggle('sk-on',v)}
  function clear(){spots.forEach(function(s){s.classList.remove('sk-mgood','sk-mbad')})}
  spots.forEach(function(s){s.setAttribute('role','button');s.setAttribute('tabindex','0');s.classList.add('sk-mspot');set(s,false);
    function toggle(){if(e.dataset.done==='1')return;clear();set(s,!on(s));stats.controls++;if(e.getAttribute('data-state')==='no')wipe(e,fb)}
    s.addEventListener('click',toggle);s.addEventListener('keydown',function(ev){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();toggle()}})});
  var go=h('button',{type:'button','class':'sk-btn sk-primary',text:'檢查答案'});
  e.appendChild(h('div',{'class':'sk-actions'},[go,resetBtn('重來',function(){clear();spots.forEach(function(s){set(s,false)});wipe(e,fb)})]));e.appendChild(fb);
  e.__solve=function(){clear();spots.forEach(function(s){var hit=s.localName==='sk-hit';set(s,hit);if(hit)s.classList.add('sk-mgood')});e.dataset.done='1';silentSolved(e,fb,go,explain?explain.innerHTML:'')};
  go.addEventListener('click',function(){
    if(!spots.some(on)){nudge(fb,'先點選文字裡的片段。');return}
    var mis=null,note='',missing=0;clear();
    spots.forEach(function(s){var hit=s.localName==='sk-hit';if(on(s)){s.classList.add(hit?'sk-mgood':'sk-mbad');if(!hit&&!mis){mis=s.getAttribute('misconception');note=s.getAttribute('feedback')||''}}else if(hit)missing++});
    var ok=spots.every(function(s){return on(s)===(s.localName==='sk-hit')});
    if(!ok&&!note)note=missing?'還有 '+missing+' 處該選的沒有選到。':'有不該選的片段，看標 ✗ 的地方。';
    feedback(fb,ok,ok&&explain?explain.innerHTML:note);report(qid,ok,mis,attempt);attempt++;if(!ok)stats.retries++;if(ok){e.dataset.done='1';solved(go)}});
});
define('sk-reflect',function(e){
  var qid=e.id||id('reflect'),points=$$('sk-point',e),explain=$('sk-explain',e),attempt=1,fb=box(),min=num(e,'min',10),boxes=[];
  e.__noReveal=1;e.insertBefore(question(e),e.firstChild);
  var ta=h('textarea',{rows:'3','aria-label':'你的說明',placeholder:attr(e,'placeholder','用自己的話寫下來，寫完再對照參考說法（不會被批改，也不會傳給別人）')}),show=h('button',{type:'button','class':'sk-btn sk-primary',text:'對照參考說法'}),go=h('button',{type:'button','class':'sk-btn sk-primary',text:'完成對照'}),model=h('div',{'class':'sk-model',hidden:true});
  go.hidden=true;
  if(explain){var m=h('div');m.innerHTML='<b>參考說法：</b>'+explain.innerHTML;model.appendChild(m)}
  if(points.length)model.appendChild(h('p',{'class':'sk-note',text:'勾選你的說明裡有寫到的重點：'}));
  points.forEach(function(p){var c=h('input',{type:'checkbox'}),l=h('label',{'class':'sk-opt'},[c]),t=h('span');t.innerHTML=p.innerHTML;l.appendChild(t);boxes.push(c);model.appendChild(l)});
  e.appendChild(ta);e.appendChild(h('div',{'class':'sk-actions'},[show,go]));e.appendChild(model);e.appendChild(fb);
  function reveal(){model.hidden=false;show.hidden=true;go.hidden=false}
  show.addEventListener('click',function(){if(ta.value.trim().length<min){nudge(fb,'先寫下你的想法（至少 '+min+' 個字），再對照。');return}fb.hidden=true;reveal();animIn(model);stats.steps++});
  e.__solve=function(){ta.disabled=true;reveal();boxes.forEach(function(c){c.checked=true;c.disabled=true});silentSolved(e,fb,go,'')};
  go.addEventListener('click',function(){var ok=boxes.every(function(c){return c.checked});
    feedback(fb,ok,ok?'你的說明涵蓋了全部重點。':'把漏掉的重點補進你的說明，補好再勾選。',['完成。','還有重點沒寫到。']);report(qid,ok,ok?null:e.getAttribute('misconception'),attempt);attempt++;if(!ok)stats.retries++;if(ok){ta.disabled=true;boxes.forEach(function(c){c.disabled=true});solved(go)}});
});
define('sk-flashcards',function(e){
  var fid=e.id||id('cards'),cards=$$('sk-flash',e),queue=cards.map(function(_,k){return k}),again=0,done=false,flipped=false,t=attr(e,'heading','');
  if(!cards.length)return;if(t)e.insertBefore(h('p',{'class':'sk-q',text:t}),e.firstChild);
  var face=h('button',{type:'button','class':'sk-flash'}),count=h('span',{'class':'sk-count'}),know=h('button',{type:'button','class':'sk-btn sk-primary',text:'記得'}),not=h('button',{type:'button','class':'sk-btn',text:'還不熟'}),act=h('div',{'class':'sk-actions'},[count,not,know]),end=h('div',{'class':'sk-fb',hidden:true});
  e.appendChild(face);e.appendChild(act);e.appendChild(end);
  function paint(){var c=cards[queue[0]];face.classList.toggle('sk-back',flipped);face.textContent='';
    if(flipped){face.appendChild(h('span',{'class':'sk-side',text:'背面'}));var d=h('span',{'class':'sk-def'});d.innerHTML=c.innerHTML;face.appendChild(d)}
    else{face.appendChild(h('span',{'class':'sk-side',text:'正面'}));face.appendChild(h('span',{'class':'sk-termf',text:attr(c,'term','')}));face.appendChild(h('span',{'class':'sk-tip',text:'先在心裡回想，再點一下翻面'}))}
    know.disabled=not.disabled=!flipped;count.textContent='剩 '+queue.length+' 張'}
  function finish(quiet){done=true;face.hidden=true;act.hidden=true;end.className='sk-fb sk-ok';end.innerHTML='<span class="sk-fi" aria-hidden="true">✓</span><div class="sk-fbt"><b>'+cards.length+' 張都記得了。</b>'+(again?' 其中有 '+again+' 次需要再看一遍，這些詞課後再複習。':'')+'</div>';end.hidden=false;if(!quiet){animIn(end);say('字卡完成');emit('observe',{tag:slug(fid+'-recalled'),observed:'evidence'})}}
  function next(){flipped=false;if(!queue.length){finish();return}paint();animIn(face);try{face.focus({preventScroll:true})}catch(x){}}
  face.addEventListener('click',function(){if(done)return;flipped=!flipped;stats.controls++;paint();say(flipped?'背面':'正面')});
  know.addEventListener('click',function(){queue.shift();next()});
  not.addEventListener('click',function(){again++;stats.retries++;emit('retry',{id:slug(fid)});queue.push(queue.shift());next()});
  e.__snap=function(){return done?{d:1}:undefined};e.__restore=function(st){if(st.d){queue=[];finish(true)}};
  paint();
});
define('sk-observe',function(e){
  var of=attr(e,'of',''),min=num(e,'min',-Infinity),max=num(e,'max',Infinity),tag=slug(attr(e,'tag','')),kind=attr(e,'kind','evidence')==='misconception'?'misconception':'evidence',timer;
  if(!tag)return;
  listeners.push(function(v){var x=v[of];if(!stats.controls||typeof x!=='number'||x<min||x>max){clearTimeout(timer);return}
    clearTimeout(timer);timer=setTimeout(function(){if(sent[tag]&&!e.hasAttribute('repeat'))return;sent[tag]=1;emit('observe',{tag:tag,observed:kind})},700)});
});
define('sk-progress',function(e){
  var bar=h('i');e.appendChild(bar);e.setAttribute('role','progressbar');e.setAttribute('aria-label','完成進度');
  function upd(){var qs=$$(QS),done=qs.filter(function(q){return q.querySelector('.sk-fb.sk-ok')}).length,st=$$('sk-steps')[0];
    var frac=qs.length?done/qs.length:(st&&st.__progress?st.__progress():0);bar.style.width=Math.round(frac*100)+'%';e.setAttribute('aria-valuenow',Math.round(frac*100))}
  document.addEventListener('click',function(){setTimeout(upd,60)});upd();
});
var summarized=false;
function check(){var qs=$$(QS);if(qs.length&&qs.every(function(q){return q.querySelector('.sk-fb.sk-ok')})){if(!summarized&&qs.length>1)toast('✓ 這一頁的題目全部完成');summary()}}
function summary(){if(summarized)return;summarized=true;emit('summary',{ms:Date.now()-t0,controls:stats.controls,hints:stats.hints,answers:stats.answers,wrong:stats.wrong,retries:stats.retries,steps:stats.steps})}
window.addEventListener('pagehide',function(){if(stats.controls||stats.answers||stats.hints)summary()});
['pointerdown','keydown','input'].forEach(function(t){document.addEventListener(t,function(ev){var c=ev.target&&ev.target.closest?ev.target.closest(QS):null;if(c&&c.getAttribute('data-state')==='no')c.removeAttribute('data-state')},true)});
/* Space continues the lesson. The player cannot see keys pressed inside this page, so a press that nothing here uses is passed up to it. */
document.addEventListener('keydown',function(ev){
  if(ev.key!==' '||ev.repeat||ev.defaultPrevented||ev.ctrlKey||ev.metaKey||ev.altKey||ev.shiftKey||ev.isComposing||window.parent===window)return;
  var t=ev.target;if(t&&t.closest&&t.closest('input,textarea,select,button,a[href],summary,label,[contenteditable],[role=button],[role=slider],[role=radio],[role=checkbox],[role=switch],[role=tab],[role=option],[tabindex]:not([tabindex="-1"])'))return;
  ev.preventDefault();try{window.parent.postMessage({source:'study-kit-key',v:1,key:'space'},'*')}catch(e){}
});

/* ---- saved progress: the player stores this snapshot and sends it back when the page is opened again ---- */
var lastSent='',stateTimer=0;
function snapshot(){
  var c={},v={};
  savers.forEach(function(e){try{var st=e.__snap?e.__snap():(e.__solve&&e.querySelector('.sk-fb.sk-ok')?{ok:1}:undefined);if(st!=null)c[e.__key]=st}catch(x){}});
  $$('sk-slider,sk-segmented,sk-toggle,sk-knob').forEach(function(e){var n=e.getAttribute('name'),x=values[n];if(n&&(typeof x==='number'&&isFinite(x)||typeof x==='boolean'||typeof x==='string'&&x.length<60))v[n]=x});
  return {v:v,c:c};
}
function restore(state){
  if(!state||typeof state!=='object')return;
  restoring=true;
  try{
    var v=state.v||{},c=state.c||{};
    $$('sk-slider,sk-segmented,sk-toggle,sk-knob').forEach(function(e){var n=e.getAttribute('name');if(n&&Object.prototype.hasOwnProperty.call(v,n)&&e.__set)try{e.__set(v[n])}catch(x){}});
    savers.forEach(function(e){var st=c[e.__key];if(st==null||typeof st!=='object')return;try{if(e.__restore)e.__restore(st);else if(st.ok&&e.__solve)e.__solve()}catch(x){}});
  }finally{restoring=false}
  lastSent=JSON.stringify(snapshot());
  setTimeout(function(){document.dispatchEvent(new Event('click'))},80);
}
function sendState(){
  if(restoring||window.parent===window)return;
  var now=JSON.stringify(snapshot());if(now===lastSent)return;lastSent=now;
  try{window.parent.postMessage({source:'study-kit-state',v:1,state:JSON.parse(now)},'*')}catch(e){}
}
['click','input','change','pointerup','keyup'].forEach(function(t){document.addEventListener(t,function(){clearTimeout(stateTimer);stateTimer=setTimeout(sendState,800)},true)});
window.addEventListener('pagehide',sendState);
var hint=null,hintRaf=0;
function hintClear(){if(!hint)return;var x=hint;hint=null;cancelAnimationFrame(hintRaf);if(x.el)x.el.classList.remove('sk-hl-target');clearTimeout(x.to);[x.spot,x.laser,x.ann].forEach(function(n){if(!n)return;n.classList.add('sk-out');setTimeout(function(){n.remove()},reduce?0:240)})}
function hintPlace(){if(!hint)return;var r=hint.el.getBoundingClientRect(),pad=8,vw=window.innerWidth;
  /* A target inside a tab or panel that is not showing has no box (it sits at 0,0 with no size). Drawing the dim around it would black out the whole module, so the cue waits until the target can be seen. */
  var shown=r.width>0&&r.height>0&&hint.el.getClientRects().length>0;
  [hint.spot,hint.laser,hint.ann].forEach(function(n){if(n)n.style.display=shown?'':'none'});
  if(!shown){hintRaf=requestAnimationFrame(hintPlace);return}
  /* A target that fills most of the screen cannot be singled out by dimming everything else, so it only gets a ring. */
  hint.spot.classList.toggle('sk-spot-wide',r.width*r.height>.6*window.innerWidth*window.innerHeight);
  var st=hint.spot.style;st.left=(r.left-pad)+'px';st.top=(r.top-pad)+'px';st.width=(r.width+pad*2)+'px';st.height=(r.height+pad*2)+'px';
  hint.laser.style.transform='translate('+(r.left+r.width/2)+'px,'+(r.top+r.height/2)+'px)';
  if(hint.ann){var w=hint.ann.offsetWidth||200,hh=hint.ann.offsetHeight||40,left=Math.max(8,Math.min(r.left+r.width/2-w/2,vw-w-8)),top=r.top-pad-hh-12;if(top<8)top=r.bottom+pad+12;hint.ann.style.left=left+'px';hint.ann.style.top=top+'px'}
  hintRaf=requestAnimationFrame(hintPlace)}
/* A target in another tab, step or a closed details block is brought into view first, so the cue can point at it. */
function revealTarget(el){for(var n=el;n&&n!==document.body;n=n.parentElement){
  if(n.localName==='details'&&!n.open)n.open=true;
  var kind=n.localName==='sk-tab'?'sk-tabs':n.localName==='sk-step'?'sk-steps':'',owner=kind&&n.parentElement?n.parentElement.closest(kind):null;
  if(owner&&owner.__goto)owner.__goto(n)}}
function operate(target,text){var el=$(target);if(!el)return;hintClear();revealTarget(el);
  try{el.scrollIntoView({block:'center',inline:'center',behavior:reduce?'auto':'smooth'})}catch(e){}
  var spot=h('div',{'class':'sk-spot'}),laser=h('div',{'class':'sk-laser'},[h('b'),h('i')]),ann=text?h('div',{'class':'sk-ann',role:'status',text:String(text).slice(0,200)}):null;
  var r=el.getBoundingClientRect();laser.style.transform='translate('+(r.left+r.width/2-90)+'px,'+(r.top+r.height/2-110)+'px)';
  document.body.appendChild(spot);document.body.appendChild(laser);if(ann)document.body.appendChild(ann);
  el.classList.add('sk-hl-target');hint={el:el,spot:spot,laser:laser,ann:ann,to:setTimeout(hintClear,90000)};say(text?String(text):'請操作被標示的器材');hintPlace()}
['pointerdown','keydown','input','change'].forEach(function(t){document.addEventListener(t,function(ev){if(!hint||!ev.isTrusted)return;var n=ev.target;if(n&&n.nodeType===1&&(hint.el.contains(n)||(n.contains(hint.el)&&n!==document.body&&n!==document.documentElement))){emit('operate',{});hintClear()}},true)});
window.addEventListener('message',function(ev){var d=ev.data||{};
  if(d.type==='STUDY_KIT_RESTORE'){if(ev.source===window.parent)restore(d.state);return}
  if(d.type==='SET_WIDGET_STATE'&&d.state){Object.keys(d.state).forEach(function(k){var el=$$('sk-slider,sk-segmented,sk-toggle,sk-knob').filter(function(c){return c.getAttribute('name')===k})[0];if(el&&el.__set)el.__set(d.state[k]);else{var s=document.getElementById(k+'-slider')||$('[data-var="'+k+'"]');if(s){s.value=d.state[k];s.dispatchEvent(new Event('input',{bubbles:true}))}}})}
  else if(d.type==='HIGHLIGHT_ELEMENT'&&d.target)operate(d.target,d.content);
  else if(d.type==='ANNOTATE_ELEMENT'&&d.target)operate(d.target,d.content);
  else if(d.type==='REVEAL_ELEMENT'&&d.target){var r=$(d.target);if(r){r.hidden=false;r.style.display='';r.style.opacity='1';animIn(r)}}
});

function boot(){upgrade(document.body);run();lastSent=JSON.stringify(snapshot());if(window.parent!==window)try{window.parent.postMessage({source:'study-kit-state',v:1,ready:true},'*')}catch(e){}
  new MutationObserver(function(ms){ms.forEach(function(m){m.addedNodes.forEach(function(n){if(n.nodeType===1)upgrade(n)})})}).observe(document.body,{childList:true,subtree:true})}
window.StudyKit={version:VERSION,resetButton:resetBtn,values:values,on:function(f){listeners.push(f)},render:function(f){renders.push(f);setTimeout(function(){f(values)},0)},compute:function(n,f){computes[n]=f},plot:function(pid,series){plots[pid]=series;run()},records:function(rid){return(recs[rid]||[]).map(function(r){return r.v})},set:function(n,v){var el=$$('sk-slider,sk-segmented,sk-toggle,sk-knob').filter(function(c){return c.getAttribute('name')===n})[0];if(el&&el.__set)el.__set(v);else change(n,v)},emit:emit,fmt:fmt,define:define,h:h,say:say,animIn:animIn,slug:slug,reduce:reduce};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
`;

export const hasStudyKit = (html: string): boolean => /<sk-[a-z]|StudyKit/.test(html);
export const studyKitHead = (html = ''): string => '<style data-study-kit>' + STUDY_KIT_CSS + '</style><script data-study-kit>' + STUDY_KIT_JS.replace(/<\/script/gi, '<\\/script') + '</script>'
  + (hasStudyLab(html) ? '<style data-study-kit>' + STUDY_LAB_CSS + '</style><script data-study-kit>' + STUDY_LAB_JS.replace(/<\/script/gi, '<\\/script') + '</script>' : '');
