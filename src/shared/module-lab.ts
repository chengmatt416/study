// STUDY lab kit: pre-built virtual lab apparatus (glassware, titration, balance, heating, electrical circuits, optics bench,
// spring, pendulum, ramp with light gates, microscope) with their own behaviour and animation. Injected after the module kit
// only into pages that use <sk-lab>. Spec: docs/module-kit.md. The chatbot writes <sk-lab><sk-item kind="..."></sk-item></sk-lab>;
// it does not draw SVG or write drag logic. The CSS/JS strings must not contain backticks or a dollar-brace so they stay valid in String.raw.
export const STUDY_LAB_CSS = String.raw`
sk-lab{display:block;margin:12px 0;padding:10px 10px 12px;border:1px solid var(--sk-line);border-radius:var(--sk-r-card);background:var(--sk-card);box-shadow:var(--sk-soft),var(--sk-sheen)}
sk-item{display:none}
.lab-title{margin:0 0 6px 4px;font-size:12px;font-weight:650;letter-spacing:.06em;color:var(--sk-mute)}
.lab-svg{display:block;width:100%;height:auto;max-height:46dvh;touch-action:none;user-select:none;-webkit-user-select:none;border-radius:16px;background:radial-gradient(120% 90% at 50% 0,rgb(255 255 255/.65),transparent 70%),var(--sk-chip)}
.lab-table{fill:rgb(15 23 42/.05)}
.lab-edge{stroke:rgb(15 23 42/.22);stroke-width:1}
.lab-item{cursor:grab;outline:none}
.lab-item.drag{cursor:grabbing}
.lab-ring{fill:none;stroke:var(--sk-focus);stroke-width:1.2;stroke-dasharray:3 3;opacity:0;pointer-events:none;transition:opacity 160ms}
.lab-item.sel .lab-ring,.lab-item:focus-visible .lab-ring{opacity:.7}
.lab-item.drag .lab-ring{opacity:0}
.lab-hit{fill:transparent}
.lab-glass{stroke:#27272a;stroke-opacity:.62;stroke-width:1.3;stroke-linejoin:round;stroke-linecap:round}
.lab-glass-line{stroke:#27272a;stroke-opacity:.62;stroke-width:1.3;stroke-linecap:round}
.lab-shine{fill:none;stroke:#fff;stroke-opacity:.7;stroke-width:1.6;stroke-linecap:round}
.lab-liq{fill:rgba(148,163,184,.3);transition:fill 220ms}
.lab-surf{fill:none;stroke:#fff;stroke-opacity:.55;stroke-width:1}
.lab-stream{fill:none;stroke-width:2.2;stroke-linecap:round}
.lab-drop{fill:rgba(100,116,139,.8)}
.lab-tk{stroke:#27272a;stroke-opacity:.55;stroke-width:.6}
.lab-tk.big{stroke-opacity:.9;stroke-width:.8}
.lab-tn{font:600 5.4px/1 'Geist','Noto Sans TC',system-ui;fill:#3f3f46;font-variant-numeric:tabular-nums}
.lab-t{font:500 6.4px/1 'Geist','Noto Sans TC',system-ui;fill:var(--sk-mute);pointer-events:none}
.lab-cap{fill:var(--sk-mute);font-size:6.2px}
.lab-ltxt{fill:#27272a;font-size:5.4px;font-weight:650}
.lab-ltxt.dark{fill:#18181b;font-size:5.6px}
.lab-label{fill:#fafafa;stroke:#a1a1aa;stroke-width:.4}
.lab-foot{stroke:#27272a;stroke-opacity:.5;stroke-width:1}
.lab-dark{fill:#27272a}
.lab-metal{fill:#a1a1aa}
.lab-rock{stroke:#3f3f46;stroke-width:.9}
.lab-mark{stroke:#18181b;stroke-width:.8}
.lab-lcd{fill:#0f172a;stroke:#334155;stroke-width:.6}
.lab-lcdt{font:600 10px/1 ui-monospace,'SF Mono',Menlo,monospace;fill:#e2e8f0;font-variant-numeric:tabular-nums}
.lab-lcdt.sm{font-size:8.4px}
.lab-lcdt.xs{font-size:7px}
.lab-lcdu{font:500 5.4px/1 'Geist',system-ui;fill:#94a3b8}
.lab-key{fill:#52525b;stroke:#18181b;stroke-width:.6}
.lab-keyt{font:600 3.5px/1 system-ui;fill:#e4e4e7;text-anchor:middle}
.lab-keymark{stroke:#e4e4e7;stroke-width:1.2;stroke-linecap:round}
.lab-led{fill:#52525b}
.lab-hotplate{fill:#a3a3a3;filter:none}
.lab-shadow{pointer-events:none}
.lab-cable{fill:none;stroke:#3f3f46;stroke-width:1.4;stroke-linecap:round;pointer-events:none}
.lab-loupe-bg{fill:rgb(255 255 255/.92);stroke:none}
.lab-loupe-ring{fill:none;stroke:#27272a;stroke-width:1.1}
.lab-leader{stroke:#27272a;stroke-width:.6;stroke-dasharray:2 2}
.lab-fx{pointer-events:none}
.lab-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:10px;min-height:44px}
.lab-hint{color:var(--sk-mute);font-size:14px}
.lab-sel{padding:4px 10px;border-radius:999px;background:var(--sk-chip);font-size:13px;font-weight:600}
.lab-act{min-height:44px;padding:6px 14px;font-size:14px}
.lab-act.hold,.lab-act:active:not(:disabled){transform:scale(.97)}
.lab-msg{margin:6px 2px 0;min-height:20px;color:var(--sk-mute);font-size:14px}
.lab-tools{display:flex;gap:8px;justify-content:flex-end;margin-top:6px}
.lab-mini{min-height:36px;padding:2px 12px;font-size:13px}
.lab-coil{fill:none;stroke:#52525b;stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round}
.lab-rulerbg{fill:#f4f4f5;stroke:#a1a1aa;stroke-width:.5}
.lab-ptr{fill:none;stroke:#18181b;stroke-width:1.1;stroke-linejoin:round;stroke-linecap:round}
.lab-string{stroke:#3f3f46;stroke-width:.9}
.lab-bob{fill:#71717a;stroke:#18181b;stroke-width:.8}
.lab-bobhi{fill:#fff;opacity:.55}
.lab-track{stroke:#3f3f46;stroke-width:.7}
.lab-car{fill:#d4d4d8;stroke:#27272a;stroke-width:.9}
.lab-wheel{fill:#27272a}
.lab-block{fill:#d6c7ad;stroke:#52525b;stroke-width:.7}
.lab-part{pointer-events:none}.lab-part .lab-hit,.lab-part [data-hot]{pointer-events:all}
.lab-partbg{fill:rgb(255 255 255/.5);stroke:rgb(15 23 42/.12);stroke-width:.7}
.lab-pw,.lab-pl{stroke:#27272a;stroke-width:1.4;stroke-linecap:round;fill:none}
.lab-res{fill:#fafafa;stroke:#27272a;stroke-width:1.2}
.lab-bulbc{fill:rgb(255 255 255/.7);stroke:#27272a;stroke-width:1.2}
.lab-fil{fill:none;stroke:#27272a;stroke-width:1}
.lab-glow{pointer-events:none;mix-blend-mode:normal}
.lab-lever{stroke:#27272a;stroke-width:1.8;stroke-linecap:round;transition:all 160ms}
.lab-meter{fill:#fafafa;stroke:#27272a;stroke-width:1.3}
.lab-meterl{font:700 11px/1 'Geist',system-ui;fill:#27272a}
.lab-lcdv{font:600 7.5px/1 ui-monospace,Menlo,monospace;fill:#27272a;font-variant-numeric:tabular-nums}
.lab-tdot{fill:#27272a;stroke:#fafafa;stroke-width:1}
.lab-term.on .lab-tdot{fill:#f4f4f5;stroke:#0f172a;stroke-width:2}
.lab-wire{fill:none;stroke:#27272a;stroke-width:2.2;stroke-linecap:round}
.lab-flow{fill:none;stroke:#fff;stroke-width:1.2;stroke-linecap:round;stroke-dasharray:1.5 9;stroke-dashoffset:var(--dash,0);opacity:var(--flow,0);pointer-events:none}
.lab-wirehit{fill:none;stroke:transparent;stroke-width:12}
.lab-axis{stroke:#71717a;stroke-width:.5;stroke-dasharray:3 3}
.lab-lens{fill:rgb(190 215 235/.35);stroke:#27272a;stroke-width:1}
.lab-screen{fill:#e4e4e7;stroke:#27272a;stroke-width:.8}
.lab-arrow{fill:#52525b;stroke:#18181b;stroke-width:.5}
.lab-arm{fill:none;stroke:#27272a;stroke-width:6;stroke-linecap:round}
.lab-slide{fill:#e4e4e7;stroke:#71717a;stroke-width:.5}
.lab-lamp{opacity:.8}
.lab-eye{fill:#18181b}
.lab-field{fill:#f5f5f4}
.lab-eyering{fill:none;stroke:#27272a;stroke-width:1.4}
.lab-cell{fill:rgb(214 211 209/.35);stroke:#52525b;stroke-width:1;vector-effect:non-scaling-stroke}
.lab-cell.cheek{fill:rgb(231 229 228/.7)}
.lab-nuc{fill:rgb(113 113 122/.75);stroke:#3f3f46;stroke-width:.6;vector-effect:non-scaling-stroke}
.lab-sbar{stroke:#18181b;stroke-width:2;stroke-linecap:butt}
.lab-ruler .lab-tn{font-size:4.8px}
@media (prefers-color-scheme:dark){.lab-partbg{fill:rgb(255 255 255/.06)}.lab-pw,.lab-pl,.lab-lever,.lab-fil,.lab-wire{stroke:#e4e4e7}.lab-flow{stroke:#18181b}.lab-res,.lab-meter{fill:#27272a;stroke:#e4e4e7}.lab-meterl,.lab-lcdv{fill:#e4e4e7}.lab-rulerbg{fill:#27272a}.lab-tdot{fill:#e4e4e7}.lab-bulbc{fill:rgb(255 255 255/.12);stroke:#e4e4e7}.lab-svg{background:radial-gradient(120% 90% at 50% 0,rgb(255 255 255/.06),transparent 70%),rgb(255 255 255/.04)}.lab-table{fill:rgb(255 255 255/.05)}.lab-edge{stroke:rgb(255 255 255/.25)}.lab-glass,.lab-glass-line{stroke:#e4e4e7}.lab-tk{stroke:#e4e4e7}.lab-tn,.lab-ltxt{fill:#e4e4e7}.lab-loupe-bg{fill:rgb(24 24 27/.95)}.lab-loupe-ring,.lab-leader{stroke:#e4e4e7}.lab-mark{stroke:#e4e4e7}.lab-cable{stroke:#a1a1aa}}
@media (prefers-reduced-motion:reduce){.lab-liq,.lab-ring{transition:none}}
`;

export const STUDY_LAB_JS = String.raw`
(function(){
var K=window.StudyKit;if(!K||!K.define||window.StudyLab)return;
var NS='http://www.w3.org/2000/svg',W=360,H=224,BENCH=202,KINDS={},NAMES={},reduce=K.reduce,uid=0;
function S(t,a,k){var e=document.createElementNS(NS,t);for(var n in (a||{}))if(a[n]!=null&&a[n]!==false)e.setAttribute(n,a[n]);(k||[]).forEach(function(c){e.appendChild(c)});return e}
function A(e,o){for(var n in o){if(o[n]==null)e.removeAttribute(n);else e.setAttribute(n,o[n])}return e}
function G(cls,k,tr){return S('g',{class:cls,transform:tr},k)}
function P(d,cls,a){a=a||{};a.d=d;if(cls)a['class']=cls;return S('path',a)}
function R(x,y,w,h,cls,rx){return S('rect',{x:x,y:y,width:w,height:h,'class':cls,rx:rx||0})}
function C(cx,cy,r,cls){return S('circle',{cx:cx,cy:cy,r:r,'class':cls})}
function Ln(x1,y1,x2,y2,cls){return S('line',{x1:x1,y1:y1,x2:x2,y2:y2,'class':cls})}
function T(x,y,s,cls,anc){var e=S('text',{x:x,y:y,'class':'lab-t '+(cls||''),'text-anchor':anc||'middle'});e.textContent=s;return e}
function cl(v,a,b){return v<a?a:v>b?b:v}
function mix(a,b,t){return a+(b-a)*t}
function fx(v,d){return (Math.round(v*Math.pow(10,d))/Math.pow(10,d)).toFixed(d)}
function num(e,n,d){var v=parseFloat(e.getAttribute(n));return isFinite(v)?v:d}
function ease(p){return 1-Math.pow(1-p,3)}
function html(tag,attrs,kids){return K.h(tag,attrs,kids)}

/* ---------- item base ---------- */
function base(lab,spec,w){
  var it={lab:lab,spec:spec,kind:spec.getAttribute('kind'),w:w||60,y:BENCH,on:null,mounted:[],inside:null,tw:null,draggable:true,top:60};
  it.id=spec.id||it.kind+(++uid);
  it.label=spec.getAttribute('label')||'';
  var x=parseFloat(spec.getAttribute('x'));it.x=isFinite(x)?x:NaN;
  it.g=S('g',{'class':'lab-item','data-id':it.id,tabindex:'0',role:'button'});
  it.body=S('g',{});
  it.shadow=S('ellipse',{cx:0,cy:1,rx:it.w*.46,ry:3.2,'class':'lab-shadow'});
  it.ring=S('rect',{'class':'lab-ring',rx:8});
  it.g.appendChild(it.shadow);it.g.appendChild(it.body);it.g.appendChild(it.ring);
  it.place=function(){it.g.setAttribute('transform','translate('+it.x.toFixed(2)+' '+it.y.toFixed(2)+')')};
  it.fit=function(){A(it.ring,{x:-it.w/2-4,y:-it.top-4,width:it.w+8,height:it.top+8})};
  it.go=function(x,y,ms,done){if(reduce||!ms&&ms!==undefined){it.x=x;it.y=y;it.tw=null;it.place();if(done)done();return}it.tw={x0:it.x,y0:it.y,x1:x,y1:y,t:0,d:(ms||260)/1000,done:done}};
  it.upd=function(){};it.acts=function(){return []};it.reads=function(){return {}};it.accepts=function(){return false};
  it.take=function(){};it.lost=function(){};it.hover=function(){};it.press=function(){};it.release=function(){};it.slot=function(){return {x:it.x,y:it.y}};it.reset=function(){};
  it.name=function(){return it.label||NAMES[it.kind]||it.kind};
  return it;
}
function Lab(el){
  var L=this;L.el=el;L.uid=++uid;L.specs=[].slice.call(el.querySelectorAll('sk-item')).map(function(s){return s.cloneNode(true)});
  L.heading=el.getAttribute('heading')||'';
  el.textContent='';
  L.build();
  window.StudyLab=window.StudyLab||{};(window.StudyLab.labs=window.StudyLab.labs||[]).push(L);
  L.t=performance.now();
  requestAnimationFrame(function f(t){L.frame(t);requestAnimationFrame(f)});
  setInterval(function(){var n=performance.now();if(n-L.t>120)L.frame(n)},100);
}
Lab.prototype.build=function(){
  var L=this,el=L.el;el.textContent='';
  L.items=[];L.byId={};L.sel=null;L.drag=null;L.hot=null;L.speed=1;L.clock=0;L.pubd={};
  var id=L.uid;
  L.svg=S('svg',{viewBox:'0 0 '+W+' '+H,'class':'lab-svg',role:'group','aria-label':L.heading||'實驗桌'});
  var defs=S('defs',{},[
    S('linearGradient',{id:'lg'+id,x1:0,x2:1,y1:0,y2:0},[S('stop',{offset:0,'stop-color':'#fff','stop-opacity':.65}),S('stop',{offset:.22,'stop-color':'#fff','stop-opacity':.1}),S('stop',{offset:.62,'stop-color':'#fff','stop-opacity':0}),S('stop',{offset:1,'stop-color':'#fff','stop-opacity':.28})]),
    S('linearGradient',{id:'lm'+id,x1:0,x2:1,y1:0,y2:0},[S('stop',{offset:0,'stop-color':'#f4f4f5'}),S('stop',{offset:.35,'stop-color':'#a1a1aa'}),S('stop',{offset:.7,'stop-color':'#d4d4d8'}),S('stop',{offset:1,'stop-color':'#52525b'})]),
    S('linearGradient',{id:'ld'+id,x1:0,x2:0,y1:0,y2:1},[S('stop',{offset:0,'stop-color':'#3f3f46'}),S('stop',{offset:1,'stop-color':'#18181b'})]),
    S('radialGradient',{id:'ls'+id},[S('stop',{offset:0,'stop-color':'#000','stop-opacity':.28}),S('stop',{offset:1,'stop-color':'#000','stop-opacity':0})]),
    S('radialGradient',{id:'lw'+id},[S('stop',{offset:0,'stop-color':'#fff','stop-opacity':.95}),S('stop',{offset:1,'stop-color':'#fff','stop-opacity':0})])
  ]);
  L.svg.appendChild(defs);
  L.gl='url(#lg'+id+')';L.mt='url(#lm'+id+')';L.dk='url(#ld'+id+')';L.sh='url(#ls'+id+')';L.wm='url(#lw'+id+')';
  L.svg.appendChild(R(0,BENCH,W,H-BENCH,'lab-table'));L.svg.appendChild(Ln(0,BENCH,W,BENCH,'lab-edge'));L.cab=S('g',{});L.svg.appendChild(L.cab);L.fx=S('g',{'class':'lab-fx'});
  L.specs.forEach(function(sp){var f=KINDS[sp.getAttribute('kind')];if(!f){console.error('study-lab: unknown kind',sp.getAttribute('kind'));return}
    var it=f(L,sp);it.shadow.setAttribute('fill',L.sh);L.items.push(it);L.byId[it.id]=it});
  var free=L.items.filter(function(i){return isNaN(i.x)}),fw=free.reduce(function(s,i){return s+i.w},0),gap=Math.max(2,(W-16-fw)/(free.length+1)),cx=8+gap;
  free.forEach(function(i){i.x=cx+i.w/2;cx+=i.w+gap});
  L.items.forEach(function(i){i.home={x:i.x,y:i.y};i.fit();if(i.init)i.init();i.place();L.svg.appendChild(i.g)});
  L.items.slice().forEach(function(i){if(i.post)i.post()});L.svg.appendChild(L.fx);
  L.msg=html('p',{'class':'lab-msg','aria-live':'polite'});
  L.bar=html('div',{'class':'lab-bar'});
  var tools=html('div',{'class':'lab-tools'});
  L.speedBtn=html('button',{type:'button','class':'sk-btn lab-mini',text:'時間 ×1','aria-label':'加快實驗時間'});
  L.speedBtn.addEventListener('click',function(){L.speed=L.speed===1?10:1;L.speedBtn.textContent='時間 ×'+L.speed;L.speedBtn.setAttribute('aria-pressed',String(L.speed>1))});
  var rst=K.resetButton?K.resetButton('重設實驗桌',function(){el.classList.remove('lab-rebuilt');void el.offsetWidth;el.classList.add('lab-rebuilt');L.build();K.say('實驗桌已重設')},true):html('button',{type:'button','class':'sk-btn lab-mini',text:'重設實驗桌'});
  if(!K.resetButton)rst.addEventListener('click',function(){L.build();K.say('實驗桌已重設')});
  rst.classList.add('lab-mini');
  if(L.items.some(function(i){return i.timed}))tools.appendChild(L.speedBtn);tools.appendChild(rst);
  if(L.heading)el.appendChild(html('div',{'class':'lab-title',text:L.heading}));
  el.appendChild(L.svg);el.appendChild(L.bar);el.appendChild(L.msg);el.appendChild(tools);
  L.wire();L.refresh();
};
Lab.prototype.pt=function(ev){var s=this.svg,m=s.getScreenCTM();if(!m)return {x:0,y:0};var p=s.createSVGPoint();p.x=ev.clientX;p.y=ev.clientY;p=p.matrixTransform(m.inverse());return {x:p.x,y:p.y}};
Lab.prototype.say=function(t){this.msg.textContent=t||'';if(t)K.say(t)};
Lab.prototype.pub=function(it,key,v){var n=it.id+'.'+key;if(v==null||!isFinite(v)){if(n in this.pubd){delete this.pubd[n];delete K.values[n]}return}v=Math.round(v*1e4)/1e4;if(this.pubd[n]===v)return;this.pubd[n]=v;K.set(n,v)};
Lab.prototype.select=function(it){var L=this;if(L.sel&&L.sel!==it)L.sel.g.classList.remove('sel');L.sel=it;if(it)it.g.classList.add('sel');L.refresh()};
Lab.prototype.refresh=function(){
  var L=this,it=L.sel,bar=L.bar;bar.textContent='';
  if(!it){bar.appendChild(html('span',{'class':'lab-hint',text:'點選或拖曳器材；選到器材後這裡會出現它的操作按鈕。'}));return}
  bar.appendChild(html('span',{'class':'lab-sel',text:it.name()}));
  var acts=it.acts(L);
  acts.forEach(function(a){
    var b=html('button',{type:'button','class':'sk-btn lab-act',text:a.label,disabled:a.off});
    if(a.hold){
      var on=false;function start(e){if(on||b.disabled)return;on=true;b.classList.add('hold');a.hold(true);if(e&&e.pointerId!=null)try{b.setPointerCapture(e.pointerId)}catch(x){}}
      function stop(){if(!on)return;on=false;b.classList.remove('hold');a.hold(false);L.refresh()}
      b.addEventListener('pointerdown',function(e){e.preventDefault();start(e)});b.addEventListener('pointerup',stop);b.addEventListener('pointercancel',stop);b.addEventListener('lostpointercapture',stop);
      b.addEventListener('keydown',function(e){if((e.key===' '||e.key==='Enter')&&!e.repeat){e.preventDefault();start()}});b.addEventListener('keyup',function(e){if(e.key===' '||e.key==='Enter')stop()});b.addEventListener('blur',stop);
    }else b.addEventListener('click',function(){a.run();L.refresh()});
    bar.appendChild(b);
  });
};
Lab.prototype.wire=function(){
  var L=this,svg=L.svg;
  svg.addEventListener('pointerdown',function(ev){
    var gi=ev.target.closest&&ev.target.closest('[data-id]');if(!gi)return;
    var it=L.byId[gi.getAttribute('data-id')];if(!it)return;
    L.select(it);
    var hot=ev.target.closest('[data-hot]');
    if(hot&&(!it.canPress||it.canPress(hot.getAttribute('data-hot')))){L.hot={it:it,part:hot.getAttribute('data-hot')};it.press(L.hot.part,ev);try{svg.setPointerCapture(ev.pointerId)}catch(x){}ev.preventDefault();return}
    if(!it.draggable)return;
    var p=L.pt(ev);L.drag={it:it,dx:it.x-p.x,dy:it.y-p.y,sx:p.x,sy:p.y,moved:false};
    try{svg.setPointerCapture(ev.pointerId)}catch(x){}ev.preventDefault();
  });
  svg.addEventListener('pointermove',function(ev){
    if(L.hot&&L.hot.it.move){L.hot.it.move(L.pt(ev),L.hot.part);return}
    var d=L.drag;if(!d)return;var p=L.pt(ev);
    if(!d.moved){if(Math.abs(p.x-d.sx)+Math.abs(p.y-d.sy)<4)return;d.moved=true;L.lift(d.it)}
    var it=d.it;it.tw=null;it.px=cl(p.x+d.dx,10,W-10);it.py=cl(p.y+d.dy,36,BENCH);
    if(!it.snapped){it.x=it.px;it.y=it.py}
    it.g.classList.add('drag');L.hover(it);it.place();
  });
  function end(ev){
    if(L.hot){var h=L.hot;L.hot=null;h.it.release(h.part,ev);L.refresh()}
    var d=L.drag;L.drag=null;if(!d)return;d.it.g.classList.remove('drag');
    if(d.moved)L.drop(d.it);else if(d.it.tap)d.it.tap();
    L.refresh();
  }
  svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',end);
  svg.addEventListener('keydown',function(ev){
    var gi=ev.target.closest&&ev.target.closest('[data-id]');if(!gi)return;
    if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();L.select(L.byId[gi.getAttribute('data-id')]);var b=L.bar.querySelector('.lab-act');if(b)b.focus()}
  });
  svg.addEventListener('focusin',function(ev){var gi=ev.target.closest&&ev.target.closest('[data-id]');if(gi&&L.byId[gi.getAttribute('data-id')]!==L.sel)L.select(L.byId[gi.getAttribute('data-id')])});
};
Lab.prototype.lift=function(it){
  var L=this;it.from={x:it.home.x,y:BENCH};if(it.on){it.on.lost(it);var m=it.on.mounted;m.splice(m.indexOf(it),1);it.on=null}
  if(it.inside){it.inside.lost(it);it.inside=null}
  it.snapped=false;if(it.lifted)it.lifted();L.svg.appendChild(it.g);it.mounted.forEach(function r(m){L.svg.appendChild(m.g);m.mounted.forEach(r)});L.svg.appendChild(L.fx);L.refresh();
};
Lab.prototype.hover=function(it){it.hover(this)};
Lab.prototype.drop=function(it){
  var L=this;if(it.dropped&&it.dropped(L))return;
  for(var i=0;i<L.items.length;i++){var t=L.items[i];if(t!==it&&t.accepts(it)){t.take(it);L.refresh();return}}
  it.x=cl(it.x,it.w/2,W-it.w/2);it.go(it.x,BENCH,220);it.home={x:it.x,y:BENCH};L.refresh();
};
Lab.prototype.frame=function(t){
  var L=this,dt=Math.min(.12,(t-L.t)/1000||0);L.t=t;var sdt=dt*L.speed;L.clock+=sdt;
  L.items.forEach(function(it){
    if(it.tw){var w=it.tw;w.t+=dt;var p=Math.min(1,w.t/w.d),e=ease(p);it.x=mix(w.x0,w.x1,e);it.y=mix(w.y0,w.y1,e);it.place();if(p>=1){var f=w.done;it.tw=null;if(f)f()}}
    else if(it.on&&!(L.drag&&L.drag.it===it)){var s=it.on.slot(it);if(s&&(Math.abs(s.x-it.x)>.01||Math.abs(s.y-it.y)>.01)){it.x=s.x;it.y=s.y;it.place()}}
    it.upd(dt,sdt);
  });
};
K.define('sk-lab',function(el){new Lab(el)});
window.StudyLab=Object.assign(window.StudyLab||{},{kinds:KINDS,names:NAMES,S:S,A:A,G:G,P:P,R:R,C:C,L:Ln,T:T,cl:cl,mix:mix,fx:fx,num:num,ease:ease,base:base,html:html,W:W,H:H,BENCH:BENCH,reduce:reduce});
/* ================= 化學模型 ================= */
var SUB={water:{n:'水'},HCl:{n:'HCl',sa:1},HNO3:{n:'HNO₃',sa:1},H2SO4:{n:'H₂SO₄',sa:2},CH3COOH:{n:'CH₃COOH',ka:1.8e-5},NaOH:{n:'NaOH',sb:1},KOH:{n:'KOH',sb:1},NaCl:{n:'NaCl'},CuSO4:{n:'CuSO₄',col:[96,150,212,.5]},KMnO4:{n:'KMnO₄',col:[140,60,168,.55]}};
var IND={phenolphthalein:{lo:8.2,hi:10,a:[255,255,255,0],b:[214,84,150,.62]},methylorange:{lo:3.1,hi:4.4,a:[214,72,56,.58],b:[236,196,70,.58]},bromothymolblue:{lo:6,hi:7.6,a:[236,196,70,.5],b:[66,116,196,.55]}};
function parseLiq(s){var out=[];(s||'').split(';').forEach(function(p){p=p.trim();if(!p)return;var a=p.split(':');out.push({s:a[0].trim(),c:parseFloat(a[1])||0,v:parseFloat(a[2])||0})});return out}
function totV(l){return l.reduce(function(s,e){return s+e.v},0)}
function addLiq(l,e){if(e.v<=0)return;for(var i=0;i<l.length;i++)if(l[i].s===e.s&&Math.abs(l[i].c-e.c)<1e-9){l[i].v+=e.v;return}l.push({s:e.s,c:e.c,v:e.v})}
function takeLiq(l,dv){var tot=totV(l);dv=Math.min(dv,tot);if(dv<=0)return [];var f=dv/tot,out=[];l.forEach(function(e){var t=e.v*f;e.v-=t;out.push({s:e.s,c:e.c,v:t})});for(var i=l.length-1;i>=0;i--)if(l[i].v<1e-9)l.splice(i,1);return out}
function pHOf(liq){
  var V=totV(liq)/1000;if(V<=0)return null;var ca=0,cb=0,cw=0,ka=1.8e-5;
  liq.forEach(function(e){var d=SUB[e.s]||{},m=(e.c||0)*e.v/1000;if(d.sa)ca+=m*d.sa;else if(d.ka){cw+=m;ka=d.ka}else if(d.sb)cb+=m*d.sb});
  ca/=V;cb/=V;cw/=V;if(!ca&&!cb&&!cw)return 7;
  function g(lh){var h=Math.pow(10,lh);return h+cb-1e-14/h-ca-cw*ka/(ka+h)}
  var lo=-14,hi=1;for(var i=0;i<48;i++){var m=(lo+hi)/2;if(g(m)>0)hi=m;else lo=m}
  return -(lo+hi)/2;
}
function indRGBA(name,pH){var d=IND[name];if(!d||pH==null)return null;var t=cl((pH-d.lo)/(d.hi-d.lo),0,1);return [mix(d.a[0],d.b[0],t),mix(d.a[1],d.b[1],t),mix(d.a[2],d.b[2],t),mix(d.a[3],d.b[3],t)]}
function liqColor(v){
  var c=[148,163,184,.3],tot=totV(v.liq);if(tot<=0)return 'rgba(148,163,184,.3)';
  v.liq.forEach(function(e){var d=SUB[e.s];if(d&&d.col&&e.c>0){var w=cl(e.c*1.6*e.v/tot*3,0,1);for(var k=0;k<3;k++)c[k]=mix(c[k],d.col[k],w);c[3]=mix(c[3],d.col[3],w)}});
  if(v.ind){var ic=indRGBA(v.ind,pHOf(v.liq));if(ic&&ic[3]>0.02){var w2=ic[3]/.62;for(var j=0;j<3;j++)c[j]=mix(c[j],ic[j],w2);c[3]=mix(c[3],.62,w2)}}
  return 'rgba('+Math.round(c[0])+','+Math.round(c[1])+','+Math.round(c[2])+','+c[3].toFixed(2)+')';
}
Object.assign(NAMES,{beaker:'燒杯',flask:'錐形瓶',cylinder:'量筒',testtube:'試管',burette:'滴定管',pipette:'吸量管',bottle:'滴瓶',balance:'電子天平',thermometer:'數位溫度計',heater:'加熱板',stopwatch:'碼錶',phmeter:'pH 計',probe:'pH 探頭',solid:'固體',mass:'砝碼'});
function massOf(it){
  if(it.ves){var m=it.m0;it.liq.forEach(function(e){m+=e.v*(e.s==='water'?1:1+Math.min(.08,e.c*.04))});it.mounted.forEach(function(c){m+=massOf(c)});return m}
  return it.gram||0;
}
function raise(it){it.lab.svg.appendChild(it.g);it.mounted.forEach(raise);it.lab.svg.appendChild(it.lab.fx)}

/* ================= 玻璃器皿 ================= */
var VES={
  beaker:{cap:250,hw:27,ih:62,m0:55,r:3,prof:function(){return 1},w:62,rim:true,minor:25,major:50},
  flask:{cap:150,hw:30,ih:62,m0:90,r:3,prof:function(t){return t<.58?mix(1,.34,t/.58):mix(.34,.4,(t-.58)/.42)},w:68},
  cylinder:{cap:100,hw:13,ih:112,m0:130,r:2,prof:function(){return 1},w:46,foot:true,minor:1,major:10,labels:true},
  testtube:{cap:20,hw:8,ih:62,m0:12,round:true,prof:function(){return 1},w:30,minor:5,major:10}
};
function outline(c){
  var N=20,hw=c.hw,ih=c.ih,L=[],i,t,w,d;
  var tt=c.round?hw/ih:0;
  for(i=0;i<=N;i++){t=1-i/N*(1-tt);L.push([-hw*c.prof(t),-ih*t])}
  d='M'+L[0][0]+' '+L[0][1];
  for(i=1;i<L.length;i++)d+='L'+L[i][0].toFixed(2)+' '+L[i][1].toFixed(2);
  var lastw=hw*c.prof(tt);
  if(c.round)d+='A'+hw+' '+hw+' 0 0 0 '+hw+' '+(-ih*tt).toFixed(2);
  else{var r=c.r||0;d=d.replace(/L[-\d.]+ [-\d.]+$/,'L'+(-lastw)+' '+(-r)+'Q'+(-lastw)+' 0 '+(-lastw+r)+' 0L'+(lastw-r)+' 0Q'+lastw+' 0 '+lastw+' '+(-r))}
  for(i=L.length-1;i>=0;i--){if(!c.round&&i===L.length-1)continue;d+='L'+(-L[i][0]).toFixed(2)+' '+L[i][1].toFixed(2)}
  return d;
}
function vesselKind(kind){
  var c=VES[kind];
  return function(L,sp){
    var it=base(L,sp,c.w);it.ves=true;it.kind=kind;it.cap=num(sp,'cap',c.cap);it.hw=c.hw;it.ih=c.ih;it.top=c.ih+8;it.m0=num(sp,'mass',c.m0);
    it.liq=parseLiq(sp.getAttribute('liquid'));it.ind=sp.getAttribute('indicator')||'';it.T=num(sp,'temp',20);it.ang=0;it.pourTo=null;it.side=1;it.heated=false;
    // 容積與液面高度對照（以截面寬度平方近似圓形截面）
    var N=40,cum=[0],i;for(i=1;i<=N;i++){var w=c.prof((i-.5)/N);cum.push(cum[i-1]+w*w)}
    function frac(v){v=cl(v/it.cap,0,1.15)*cum[N];if(v>=cum[N])return 1+ (v-cum[N])/cum[N]*0;for(var k=1;k<=N;k++)if(cum[k]>=v)return ((k-1)+(v-cum[k-1])/(cum[k]-cum[k-1]))/N;return 1}
    it.app=function(){var s=totV(it.liq);it.mounted.forEach(function(m){if(m.solid)s+=m.vol});return s};
    it.levelH=function(){return frac(it.app())*c.ih};
    var d=outline(c),cid='cp'+L.uid+it.id.replace(/[^\w]/g,'');
    var clip=S('clipPath',{id:cid},[P(d+'Z')]);
    var liqG=S('g',{'clip-path':'url(#'+cid+')'}),liqRot=S('g',{}),liqP=P('', 'lab-liq'),surf=P('','lab-surf');
    liqRot.appendChild(liqP);liqRot.appendChild(surf);liqG.appendChild(liqRot);
    var glass=P(d,'lab-glass',{fill:L.gl});
    var shine=P('M'+(-c.hw*.62)+' '+(-c.ih*.88)+'L'+(-c.hw*.62)+' '+(-c.ih*.22),'lab-shine');
    var ticks=G('lab-ticks');
    if(c.minor){var n=Math.round(it.cap/c.minor);for(i=1;i<=n;i++){var v=i*c.minor,y=-frac(v)*c.ih,big=Math.abs(v/c.major-Math.round(v/c.major))<1e-6;
      var xe=c.hw*c.prof(frac(v));ticks.appendChild(Ln(xe-(big?7:4),y,xe,y,big?'lab-tk big':'lab-tk'));
      if(c.labels&&big)ticks.appendChild(T(xe+3,y+2,String(v),'lab-tn','start'))}}
    it.body.appendChild(clip);it.body.appendChild(liqG);it.body.appendChild(glass);it.body.appendChild(shine);it.body.appendChild(ticks);
    if(c.rim){it.body.appendChild(Ln(-c.hw-3,-c.ih,-c.hw+1,-c.ih,'lab-glass-line'));it.body.appendChild(Ln(c.hw-1,-c.ih,c.hw+3,-c.ih,'lab-glass-line'))}
    if(c.foot){it.body.appendChild(P('M'+(-c.hw-5)+' 0L'+(-c.hw-2)+' -4L'+(c.hw+2)+' -4L'+(c.hw+5)+' 0Z','lab-foot',{fill:L.mt}))}
    var cap=T(0,12,it.name(),'lab-cap');it.g.appendChild(cap);
    it.sx=0;it.stream=null;it.lastCol='';it.lastLvl=-1;
    function draw(){
      var lh=it.levelH(),y=-lh,hw=c.hw+6,col=liqColor(it);
      if(totV(it.liq)<=0){liqP.setAttribute('d','');surf.setAttribute('d','')}
      else{liqP.setAttribute('d','M'+(-hw*3)+' '+(y-1.4)+'L'+(-hw)+' '+(y-1.4)+'Q0 '+(y+2.2)+' '+hw+' '+(y-1.4)+'L'+(hw*3)+' '+(y-1.4)+'L'+(hw*3)+' 40L'+(-hw*3)+' 40Z');
        liqP.style.fill=col;surf.setAttribute('d','M'+(-hw)+' '+(y-1.4)+'Q0 '+(y+2.2)+' '+hw+' '+(y-1.4));
      }
      it.lastLvl=lh;
    }
    it.draw=draw;draw();it.tilt=function(){liqRot.setAttribute('transform','rotate('+(-it.ang).toFixed(1)+' 0 '+(-it.lastLvl).toFixed(1)+')')};
    it.slot=function(m){
      if(m.ves)return {x:it.x,y:it.y};
      var idx=it.mounted.indexOf(m);
      if(m.solid)return {x:it.x+(idx%2?5:-5)*Math.min(1,it.hw/14)+((idx%3)-1)*2,y:it.y-2-Math.floor(idx/2)*4};
      return {x:it.x+it.hw*.38,y:it.y-3};
    };
    it.accepts=function(o){
      if(o===it||!(o.solid||o.probe))return false;
      return Math.abs(o.x-it.x)<it.hw+8&&!(o.probe&&it.mounted.some(function(m){return m.probe}))&&(!o.solid||it.cap>=15);
    };
    it.take=function(o){o.on=it;it.mounted.push(o);raise(it);o.go(it.slot(o).x,it.slot(o).y,420);o.home={x:o.x,y:o.y}};
    it.lost=function(o){};
    // 倒液
    it.canPour=function(){return totV(it.liq)>.05&&!it.on&&true};
    it.pourTarget=function(px,py){
      for(var i=0;i<L.items.length;i++){var b=L.items[i];if(b===it||!b.ves)continue;
        if(Math.abs(px-b.x)<b.hw+it.hw*.7&&py<b.y-b.ih+6&&py>b.y-b.ih-90)return b}
      return null;
    };
    it.startPour=function(b,keep){
      it.pourTo=b;it.snapped=true;it.keepPose=!!keep;it.side=it.x<=b.x?1:-1;
      it.sx=b.x-it.side*c.hw;it.sy=b.y-b.ih-9+c.ih;
      it.go(it.sx,it.sy,260);
    };
    it.stopPour=function(back){
      it.pourTo=null;it.snapped=false;
      if(back){var f=it.from||it.home;it.go(f.x,BENCH,320);it.home={x:f.x,y:BENCH}}
    };
    it.hover=function(){
      if(!it.canPour())return;
      if(it.snapped&&it.pourTo){if(Math.hypot(it.px-it.sx,it.py-it.sy)>46){it.pourTo=null;it.snapped=false;it.x=it.px;it.y=it.py;it.place()}return}
      var b=it.pourTarget(it.px,it.py);if(b)it.startPour(b);
    };
    it.dropped=function(){if(it.pourTo){it.stopPour(true);return true}return false};
    it.acts=function(){
      var out=[];L.items.forEach(function(b){if(b!==it&&b.ves&&!it.on)out.push({label:'倒入「'+b.name()+'」（按住）',off:totV(it.liq)<=.05,hold:function(on){if(on)it.startPour(b,true);else it.stopPour(true)}})});
      if(it.mounted.some(function(m){return m.solid}))out.push({label:'取出固體',run:function(){var m=it.mounted.filter(function(x){return x.solid})[0];if(m){it.mounted.splice(it.mounted.indexOf(m),1);m.on=null;m.go(it.x+it.hw+16,BENCH,320);m.home={x:it.x+it.hw+16,y:BENCH}}}});
      out.push({label:'倒掉全部',run:function(){it.liq=[];it.ind='';L.say('已倒掉容器內的液體')},off:totV(it.liq)<=.05});
      return out;
    };
    it.reads=function(){return {volume:it.app(),temp:it.T}};
    var pourSound=0;
    it.upd=function(dt,sdt){
      // 傾斜動畫
      var target=it.pourTo?it.side*Math.min(62,28+Math.max(0,(1-totV(it.liq)/it.cap))*0+40):0;
      var full=totV(it.liq)>.01;
      if(it.pourTo&&!full)target=it.side*22;
      it.ang+=(target-it.ang)*Math.min(1,dt*(reduce?60:9));
      var pourAng=Math.abs(it.ang);it.tilt();
      A(it.body,{transform:it.ang?'rotate('+it.ang.toFixed(1)+' '+(it.side*c.hw)+' '+(-c.ih)+')':null});
      var flowing=it.pourTo&&full&&pourAng>26;
      if(flowing){
        var b=it.pourTo,rate=14*cl((pourAng-26)/30,.15,1),dv=Math.min(rate*dt,totV(it.liq));
        var moved=takeLiq(it.liq,dv),room=Math.max(0,b.cap-totV(b.liq)),mv=moved.reduce(function(s,e){return s+e.v},0);
        if(mv>room+1e-9){L.say(b.name()+'已滿，多出的液體溢到桌面');}
        moved.forEach(function(e){addLiq(b.liq,{s:e.s,c:e.c,v:e.v*Math.min(1,room/Math.max(mv,1e-9))})});
        if(it.ind&&!b.ind)b.ind=it.ind;
        if(!it.stream){it.stream=P('','lab-stream');L.fx.appendChild(it.stream)}
        var lipX=it.x+it.side*c.hw+(it.side*Math.sin(Math.abs(it.ang)*Math.PI/180)*0),lipY=it.y-c.ih;
        var topY=b.y-b.levelH();
        it.stream.setAttribute('d','M'+lipX.toFixed(1)+' '+lipY.toFixed(1)+'Q'+(lipX+it.side*3).toFixed(1)+' '+((lipY+topY)/2).toFixed(1)+' '+(b.x+(lipX-b.x)*.35).toFixed(1)+' '+topY.toFixed(1));
        it.stream.style.stroke=liqColor(it).replace(/,[\d.]+\)$/,',.75)');
        it.stream.style.display='';
      }else if(it.stream)it.stream.style.display='none';
      // 溫度
      if(!it.heated)it.T+=(20-it.T)*(1-Math.exp(-sdt/500));
      it.heated=false;
      if(it.T>100)it.T=100;
      var lh=it.levelH();if(Math.abs(lh-it.lastLvl)>.02||flowing||it.ind||it.dirtyCol!==liqColor(it)){it.dirtyCol=liqColor(it);draw()}
      it.pub=it.pub||0;
      var rd=it.reads();L.pub(it,'volume',rd.volume);L.pub(it,'temp',rd.temp);
    };
    it.reset=function(){};
    return it;
  };
}
['beaker','flask','cylinder','testtube'].forEach(function(k){KINDS[k]=vesselKind(k)});

/* ================= 滴定管 ================= */
KINDS.burette=function(L,sp){
  var it=base(L,sp,84),Y0=-166,Y1=-94,total=50;it.top=176;it.draggable=false;
  it.liq=parseLiq(sp.getAttribute('liquid'));var start=num(sp,'start',0);
  var vol=Math.max(0,total-start);if(it.liq.length){var tv=totV(it.liq);it.liq.forEach(function(e){e.v=e.v/tv*vol})}
  it.reading=start;it.open=false;it.pressT=0;it.drop=null;
  var y=function(r){return Y0+(r/total)*(Y1-Y0)};
  it.body.appendChild(R(-36,-4,72,4,'lab-dark',2));
  it.body.appendChild(R(-33,-178,4,176,'lab-metal',1.5,{fill:L.mt}));it.body.lastChild.setAttribute('fill',L.mt);
  it.body.appendChild(R(-30,-136,26,3,'lab-metal'));it.body.lastChild.setAttribute('fill',L.mt);
  var cid='bc'+L.uid+it.id;
  var tube=S('clipPath',{id:cid},[R(-6,Y0,12,Y1-Y0+8,'')]);
  var liqRect=R(-6,y(start),12,Y1-y(start)+8,'lab-liq');
  var lg=S('g',{'clip-path':'url(#'+cid+')'},[liqRect]);
  it.body.appendChild(tube);it.body.appendChild(lg);
  it.body.appendChild(P('M-6 '+Y0+'L-6 '+(Y1+8)+'L-1.4 '+(Y1+14)+'L-1.4 '+(Y1+22)+'L1.4 '+(Y1+22)+'L1.4 '+(Y1+14)+'L6 '+(Y1+8)+'L6 '+Y0,'lab-glass',{fill:L.gl}));
  var tk=G('lab-ticks');for(var i=0;i<=50;i++){var big=i%10===0,mid=i%5===0;tk.appendChild(Ln(6-(big?7:mid?5:3),y(i),6,y(i),big?'lab-tk big':'lab-tk'));if(big)tk.appendChild(T(9,y(i)+2,String(i),'lab-tn','start'))}
  it.body.appendChild(tk);
  it.body.appendChild(R(-7,Y1+6,14,7,'lab-metal'));it.body.lastChild.setAttribute('fill',L.mt);
  it.lever=G('',[R(0,-1.8,15,3.6,'lab-dark',1.8),R(-2,-9,19,18,'lab-hit')],'translate(0 '+(Y1+9.5)+')');
  it.lever.setAttribute('data-hot','cock');it.lever.style.cursor='pointer';
  it.body.appendChild(it.lever);
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  // 放大鏡：以目前讀數為中心顯示 0.1 mL 刻度
  var LX=26,LY=-172,LW=62,LH=54,lc='lc'+L.uid+it.id,lp=G('lab-loupe');
  lp.appendChild(S('clipPath',{id:lc},[R(LX,LY,LW,LH,'',7)]));
  lp.appendChild(R(LX,LY,LW,LH,'lab-loupe-bg',7));
  var lcontent=S('g',{'clip-path':'url(#'+lc+')'}),lliq=P('','lab-liq'),lt=G('');
  lcontent.appendChild(lliq);lcontent.appendChild(lt);lp.appendChild(lcontent);lp.appendChild(R(LX,LY,LW,LH,'lab-loupe-ring',7));
  lp.appendChild(Ln(LX-12,LY+LH/2,LX,LY+LH/2,'lab-leader'));
  it.body.appendChild(lp);
  function loupe(){
    var r=it.reading,cy=LY+LH/2,k=60;lt.textContent='';
    for(var v=Math.floor((r-.5)*10)/10;v<=r+.5;v+=.1){var vv=Math.round(v*10)/10;if(vv<0||vv>50)continue;var yy=cy+(vv-r)*k,mj=Math.abs(vv-Math.round(vv))<.01,hf=Math.abs(vv*2-Math.round(vv*2))<.01;
      lt.appendChild(Ln(LX+LW-(mj?18:hf?13:8),yy,LX+LW,yy,mj?'lab-tk big':'lab-tk'));if(mj)lt.appendChild(T(LX+LW-21,yy+2.4,String(Math.round(vv)),'lab-tn','end'))}
    lliq.setAttribute('d','M'+LX+' '+cy+'Q'+(LX+LW*.36)+' '+(cy+4)+' '+(LX+LW*.7)+' '+cy+'L'+(LX+LW*.7)+' '+(LY+LH+4)+'L'+LX+' '+(LY+LH+4)+'Z');
    lliq.style.fill=liqColor(it);
  }
  it.tip=function(){return {x:it.x,y:BENCH+Y1+22}};
  it.below=function(){var best=null;L.items.forEach(function(v){if(v.ves&&Math.abs(v.x-it.x)<24&&v.y>=BENCH-70){best=best&&Math.abs(best.x-it.x)<Math.abs(v.x-it.x)?best:v}});return best};
  it.accepts=function(o){return o.ves&&Math.abs(o.x-it.x)<30&&o.kind!=='cylinder'};
  it.take=function(o){o.on=it;it.mounted.push(o);raise(it);o.go(it.x,BENCH,300);o.home={x:it.x,y:BENCH};L.say('已放到滴定管下方')};
  it.slot=function(){return {x:it.x,y:BENCH}};
  function dispense(dv){
    dv=Math.min(dv,totV(it.liq));if(dv<=0){return 0}
    var v=it.below();var moved=takeLiq(it.liq,dv);it.reading=Math.min(50,it.reading+dv);
    if(v){moved.forEach(function(e){addLiq(v.liq,e)})}else if(!it.spill){it.spill=true;L.say('液體滴到桌面了，請把容器放到滴定管下方')}
    if(v)it.spill=false;
    return dv;
  }
  var streamEl=P('','lab-stream'),dropEl=C(0,0,1.6,'lab-drop');streamEl.style.display='none';dropEl.style.display='none';L.fx.appendChild(streamEl);L.fx.appendChild(dropEl);
  it.single=function(){
    if(totV(it.liq)<=0){L.say('滴定管已空');return}
    dispense(.05);it.drop={t:0};if(reduce)it.drop=null;
  };
  it.press=function(part){if(part!=='cock')return;it.pressT=performance.now();it.open=false;it.holding=true};
  it.release=function(part){
    if(part!=='cock')return;it.holding=false;
    if(!it.open)it.single();it.open=false;
  };
  it.acts=function(){return [{label:'滴一滴（約 0.05 mL）',run:function(){it.single()}},{label:'旋開旋塞（按住）',hold:function(on){it.open=on;it.holding=on}}]};
  it.reads=function(){return {reading:it.reading}};
  it.upd=function(dt){
    if(it.holding&&!it.open&&performance.now()-it.pressT>260&&totV(it.liq)>0)it.open=true;
    if(it.open)dispense(.8*dt);
    A(it.lever,{transform:'translate(0 '+(Y1+9.5)+') rotate('+(it.open?88:0)+')'});
    it.lever.style.transition=reduce?'none':'transform 140ms cubic-bezier(.22,1,.36,1)';
    var ry=y(it.reading);liqRect.setAttribute('y',ry);liqRect.setAttribute('height',Math.max(0,Y1-ry+8));liqRect.style.fill=liqColor(it);
    var tp=it.tip(),v=it.below(),floor=v?(v.y-v.levelH()):BENCH;
    if(it.open&&totV(it.liq)>0){streamEl.setAttribute('d','M'+tp.x+' '+tp.y+'L'+tp.x+' '+floor);streamEl.style.display='';streamEl.style.stroke=liqColor(it).replace(/,[\d.]+\)$/,',.7)')}else streamEl.style.display='none';
    if(it.drop){it.drop.t+=dt;var p=it.drop.t/.24;if(p>=1){it.drop=null;dropEl.style.display='none'}else{dropEl.setAttribute('cx',tp.x);dropEl.setAttribute('cy',mix(tp.y+2,floor,p*p));dropEl.style.display='';dropEl.style.fill=liqColor(it).replace(/,[\d.]+\)$/,',.8)')}}
    if(Math.abs(it.reading-(it.lr||-1))>1e-6){it.lr=it.reading;loupe()}
    L.pub(it,'reading',it.reading);
  };
  loupe();
  return it;
};

/* ================= 吸量管 ================= */
KINDS.pipette=function(L,sp){
  var it=base(L,sp,22),cap=num(sp,'cap',25);it.top=122;it.liq=[];it.over=null;it.cap=cap;
  var tube=S('g',{});
  var bodyD='M-1.6 -10L-1.6 -22L-4 -30L-4 -44L-8 -50L-8 -72L-4 -78L-4 -112L4 -112L4 -78L8 -72L8 -50L4 -44L4 -30L1.6 -22L1.6 -10Z';
  var cid='pc'+L.uid+it.id;
  it.body.appendChild(S('clipPath',{id:cid},[P(bodyD)]));
  var liqRect=R(-9,-10,18,0,'lab-liq');it.body.appendChild(S('g',{'clip-path':'url(#'+cid+')'},[liqRect]));
  it.body.appendChild(P(bodyD,'lab-glass',{fill:L.gl}));
  it.body.appendChild(Ln(-4.6,-90,4.6,-90,'lab-mark'));it.body.appendChild(T(12,-88,cap+' mL','lab-tn','start'));
  it.body.appendChild(T(0,22,it.name(),'lab-cap'));
  it.body.setAttribute('transform','translate(0 -10)');
  it.fill=function(){return totV(it.liq)>=cap-1e-6};
  it.hover=function(){var v=null;L.items.forEach(function(b){if(b.ves&&Math.abs(it.px-b.x)<b.hw+6)v=b});if(v){it.snapped=true;it.over=v;it.sx=v.x+(v.hw>14?v.hw*.2:0);it.sy=v.y-v.ih*.2;it.x=it.sx;it.y=it.sy;it.place()}else{it.snapped=false;it.over=null}};
  it.dropped=function(){if(it.over&&it.snapped){it.home={x:it.x,y:it.y};return true}return false};
  it.lifted=function(){it.over=null};
  it.acts=function(){
    var v=it.over,out=[];
    out.push({label:'吸取至刻度（'+cap+' mL）',off:!v||totV(it.liq)>0,run:function(){if(!v)return;if(totV(v.liq)<cap){L.say('「'+v.name()+'」裡的溶液不夠');return}it.liq=takeLiq(v.liq,cap);it.ind=v.ind;L.say('已吸取 '+cap+' mL')}});
    out.push({label:'放出溶液',off:!v||totV(it.liq)<=0,run:function(){if(!v)return;var room=v.cap-totV(v.liq);var mv=takeLiq(it.liq,Math.min(room,totV(it.liq)));mv.forEach(function(e){addLiq(v.liq,e)});L.say('已放入「'+v.name()+'」')}});
    out.push({label:'放回桌面',run:function(){it.over=null;it.snapped=false;var f=it.from||it.home;it.go(f.x,BENCH,300);it.home={x:f.x,y:BENCH}}});
    return out;
  };
  it.upd=function(){
    var h=cl(totV(it.liq)/cap,0,1);
    if(totV(it.liq)>0){liqRect.setAttribute('y',-112+ (1-h)*0);liqRect.setAttribute('y',h>=1?-90:-10-h*80);liqRect.setAttribute('height',h>=1?80:h*80);liqRect.style.fill=liqColor(it)}else liqRect.setAttribute('height',0);
    L.pub(it,'volume',totV(it.liq));
  };
  it.y=BENCH;
  return it;
};

/* ================= 滴瓶 ================= */
KINDS.bottle=function(L,sp){
  var it=base(L,sp,30),hb=34;it.top=50;it.label=sp.getAttribute('label')||'';
  var spec=(sp.getAttribute('liquid')||'').trim();it.indicator=IND[spec]?spec:'';it.liq=it.indicator?[]:parseLiq(spec);
  it.body.appendChild(P('M-11 0L-11 -22Q-11 -34 -5 -36L-5 -40L5 -40L5 -36Q11 -34 11 -22L11 0Z','lab-glass',{fill:L.gl}));
  it.body.appendChild(P('M-9.6 -2L-9.6 -21Q-9.6 -30 -4.6 -32L4.6 -32Q9.6 -30 9.6 -21L9.6 -2Z','lab-liq'));it.body.lastChild.style.fill=it.indicator?'rgba(148,163,184,.5)':'rgba(148,163,184,.4)';
  it.body.appendChild(R(-4,-48,8,10,'lab-dark',2));it.body.appendChild(P('M-3.4 -48Q0 -58 3.4 -48','lab-dark'));
  it.body.appendChild(P('M-1.2 -40L-1.2 -36L1.2 -36L1.2 -40Z','lab-dark'));
  it.body.appendChild(R(-8,-24,16,10,'lab-label',1));
  it.txt=T(0,-16.6,it.indicator?{phenolphthalein:'酚酞',methylorange:'甲基橙',bromothymolblue:'BTB'}[it.indicator]:(SUB[it.liq[0]&&it.liq[0].s]||{n:'試劑'}).n,'lab-ltxt');it.body.appendChild(it.txt);
  var sq=R(-12,-50,24,52,'lab-hit');sq.setAttribute('data-hot','squeeze');it.body.appendChild(sq);
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  it.top=58;it.over=null;it.pressT=0;it.rep=0;it.holding=false;it.rot=0;
  function drip(v){
    if(!v)return false;
    if(it.indicator){v.ind=it.indicator;addLiq(v.liq,{s:'water',c:0,v:.05})}
    else if(it.liq.length){var e=it.liq[0];addLiq(v.liq,{s:e.s,c:e.c,v:.05})}
    var d=C(it.x,it.y+2,1.6,'lab-drop');d.style.fill='rgba(100,116,139,.8)';L.fx.appendChild(d);it.drops=it.drops||[];it.drops.push({el:d,t:0,v:v});return true;
  }
  it.hover=function(){
    var v=null;L.items.forEach(function(b){if(b.ves&&Math.abs(it.px-b.x)<b.hw+8&&it.py<b.y-b.ih+14&&b.cap>=15)v=b});
    if(v){if(it.over!==v||!it.snapped){it.over=v;it.snapped=true;it.sx=v.x;it.sy=v.y-v.ih-9;it.go(it.sx,it.sy,200);it.rot=180}}else{it.over=null;it.snapped=false;it.rot=0}
  };
  it.dropped=function(){if(it.over&&it.snapped){it.home={x:it.x,y:it.y};return true}it.rot=0;return false};
  it.lifted=function(){};
  it.canPress=function(){return !!it.over};
  it.press=function(part){if(part!=='squeeze')return;it.pressT=performance.now();it.holding=true;it.rep=0};
  it.release=function(part){if(part!=='squeeze')return;if(it.holding&&it.rep===0&&it.over){drip(it.over)}it.holding=false};
  it.acts=function(){
    var out=[];L.items.forEach(function(v){if(v.ves&&v.cap>=15)out.push({label:'滴入「'+v.name()+'」（按住連滴）',hold:function(on){if(on){it.over=v;it.snapped=true;it.rot=180;it.go(v.x,v.y-v.ih-9,240);it.holding=true;it.rep=0;it.pressT=performance.now()-300;drip(v);it.rep=1}else{it.holding=false;it.over=null;it.snapped=false;it.rot=0;it.go(it.home.x,BENCH,300)}}})});
    return out;
  };
  it.upd=function(dt){
    if(it.holding&&it.over&&performance.now()-it.pressT>400){it.rep+=dt;if(it.rep>.22){it.rep=.001;drip(it.over)}}
    A(it.body,{transform:it.rot?'rotate('+it.rot+' 0 -25)':null});
    if(it.drops)for(var i=it.drops.length-1;i>=0;i--){var d=it.drops[i];d.t+=dt;var v=d.v,fl=v.y-v.levelH(),p=Math.min(1,d.t/.2);d.el.setAttribute('cx',it.x);d.el.setAttribute('cy',mix(it.y+2,fl,p*p));if(p>=1){d.el.remove();it.drops.splice(i,1)}}
  };
  return it;
};

/* ================= 電子天平 ================= */
KINDS.balance=function(L,sp){
  var it=base(L,sp,100),py=-30;it.top=60;it.tare=0;it.draggable=false;it.res=num(sp,'resolution',.01);
  it.body.appendChild(P('M-48 0L-48 -22Q-48 -26 -44 -26L44 -26Q48 -26 48 -22L48 0Z','lab-dark',{fill:L.dk}));
  it.body.appendChild(R(-34,-31,68,5,'lab-metal',2.5));it.body.lastChild.setAttribute('fill',L.mt);
  it.body.appendChild(R(-37,-22,50,15,'lab-lcd',3));
  it.txt=T(10,-11.2,'0.00','lab-lcdt','end');it.body.appendChild(it.txt);it.body.appendChild(T(11,-11.2,'g','lab-lcdu','start'));
  var tb=G('',[C(0,0,6.5,'lab-key'),T(0,2.4,'→0←','lab-keyt')],'translate(31 -14.6)');tb.setAttribute('data-hot','tare');tb.style.cursor='pointer';it.body.appendChild(tb);
  it.body.appendChild(C(31,-14.6,10,'lab-hit'));it.body.lastChild.setAttribute('data-hot','tare');
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  it.accepts=function(o){return (o.ves||o.solid||o.gram)&&!o.probe&&Math.abs(o.x-it.x)<44&&it.mounted.length<2};
  it.take=function(o){o.on=it;it.mounted.push(o);raise(it);var s=it.slot(o);o.go(s.x,s.y,320);o.home={x:o.x,y:o.y}};
  it.slot=function(o){var i=it.mounted.indexOf(o),n=it.mounted.length;return {x:it.x+(n>1?(i?15:-15):0),y:BENCH+py-1}};
  it.press=function(p){if(p==='tare'){it.tare=it.total();L.say('已歸零')}};
  it.total=function(){var m=0;it.mounted.forEach(function(c){m+=massOf(c)});return m};
  it.acts=function(){return [{label:'歸零（TARE）',run:function(){it.tare=it.total();L.say('已歸零')}}]};
  it.upd=function(){var m=it.total()-it.tare,d=Math.round(-Math.log10(it.res));it.txt.textContent=fx(m,d);L.pub(it,'mass',Math.round(m/it.res)*it.res)};
  it.reads=function(){return {}};
  return it;
};

/* ================= 數位溫度計 ================= */
KINDS.thermometer=function(L,sp){
  var it=base(L,sp,24),r=0;it.top=100;it.probe=true;it.Tr=20;
  it.body.appendChild(R(-2,-86,4,84,'lab-glass',2));it.body.lastChild.setAttribute('fill',L.gl);
  it.body.appendChild(R(-1,-84,2,82,'lab-liq',1));it.body.lastChild.style.fill='rgba(63,63,70,.85)';
  it.body.appendChild(R(-15,-112,30,20,'lab-dark',4));it.body.lastChild.setAttribute('fill',L.dk);
  it.body.appendChild(R(-12,-109,24,10,'lab-lcd',2));
  it.txt=T(9,-101.2,'20.0','lab-lcdt sm','end');it.body.appendChild(it.txt);it.body.appendChild(T(10,-101.2,'°C','lab-lcdu','start'));
  it.body.appendChild(R(-2.5,-92,5,8,'lab-dark'));
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  it.top=114;it.fit();
  it.upd=function(dt,sdt){
    var v=it.on&&it.on.ves?it.on:null,tgt=v&&totV(v.liq)>0?v.T:20;
    it.Tr+=(tgt-it.Tr)*(1-Math.exp(-sdt/(v?2.5:12)));
    it.txt.textContent=fx(it.Tr,1);L.pub(it,'temp',Math.round(it.Tr*10)/10);
  };
  return it;
};

/* ================= 加熱板 ================= */
KINDS.heater=function(L,sp){
  var it=base(L,sp,92),py=-20;it.top=36;it.on_=false;it.draggable=false;it.timed=true;it.glow=0;it.power=num(sp,'power',320);
  it.body.appendChild(P('M-44 0L-44 -14Q-44 -17 -40 -17L40 -17Q44 -17 44 -14L44 0Z','lab-dark',{fill:L.dk}));
  var plate=R(-40,-21,80,5,'lab-metal',2.5);plate.setAttribute('fill',L.mt);it.body.appendChild(plate);
  it.hot=R(-40,-21,80,5,'lab-hotplate',2.5);it.hot.style.opacity=0;it.body.appendChild(it.hot);
  it.led=C(-30,-8,2.2,'lab-led');it.body.appendChild(it.led);
  var knob=G('',[C(0,0,6,'lab-key'),Ln(0,-1,0,-5,'lab-keymark')],'translate(30 -8)');knob.setAttribute('data-hot','knob');knob.style.cursor='pointer';it.body.appendChild(knob);
  it.body.appendChild(C(30,-8,10,'lab-hit'));it.body.lastChild.setAttribute('data-hot','knob');it.knob=knob;
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  it.accepts=function(o){return o.ves&&Math.abs(o.x-it.x)<48&&it.mounted.length<1};
  it.take=function(o){o.on=it;it.mounted.push(o);raise(it);var s=it.slot(o);o.go(s.x,s.y,320);o.home={x:o.x,y:o.y}};
  it.slot=function(){return {x:it.x,y:BENCH+py}};
  function toggle(){it.on_=!it.on_;L.say(it.on_?'加熱板已開啟':'加熱板已關閉')}
  it.press=function(p){if(p==='knob')toggle()};
  it.acts=function(){return [{label:it.on_?'關閉加熱':'開啟加熱',run:toggle}]};
  it.upd=function(dt,sdt){
    it.glow+=((it.on_?1:0)-it.glow)*Math.min(1,dt*(reduce?60:3));
    it.hot.style.opacity=it.glow.toFixed(2);A(it.led,{fill:it.on_?'#d4d4d8':'#52525b'});A(it.knob,{transform:'translate(30 -8) rotate('+(it.on_?90:0)+')'});
    if(it.on_)it.mounted.forEach(function(v){if(v.ves){var C=Math.max(20,totV(v.liq))*4.18+60;v.T=Math.min(100,v.T+it.power*sdt/C);v.heated=true}});
  };
  return it;
};

/* ================= 碼錶 ================= */
KINDS.stopwatch=function(L,sp){
  var it=base(L,sp,46),acc=0,t0=0;it.top=48;it.run=false;
  it.body.appendChild(R(-3,-52,6,6,'lab-dark',1));it.body.lastChild.setAttribute('data-hot','start');it.body.lastChild.style.cursor='pointer';
  it.body.appendChild(C(0,-24,22,'lab-dark'));it.body.lastChild.setAttribute('fill',L.dk);
  it.body.appendChild(C(0,-24,18.5,'lab-lcd'));
  it.txt=T(0,-22.5,'00:00.00','lab-lcdt xs','middle');it.body.appendChild(it.txt);
  it.body.appendChild(R(15,-42,5,7,'lab-key',1.5));it.body.lastChild.setAttribute('data-hot','reset');it.body.lastChild.style.cursor='pointer';
  var h1=R(-9,-60,18,16,'lab-hit');h1.setAttribute('data-hot','start');it.body.appendChild(h1);
  var h2=R(10,-47,16,16,'lab-hit');h2.setAttribute('data-hot','reset');it.body.appendChild(h2);
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  it.read=function(){return it.run?acc+(L.clock-t0):acc};
  function toggle(){if(it.run){acc+=L.clock-t0;it.run=false}else{t0=L.clock;it.run=true}}
  function reset(){it.run=false;acc=0}
  it.press=function(p){if(p==='start')toggle();else if(p==='reset')reset()};
  it.acts=function(){return [{label:it.run?'停止':'開始',run:toggle},{label:'歸零',run:reset}]};
  it.upd=function(){var t=it.read(),m=Math.floor(t/60),s=t-m*60;it.txt.textContent=(m<10?'0':'')+m+':'+(s<10?'0':'')+fx(s,2);L.pub(it,'time',Math.round(t*100)/100)};
  it.reset=reset;it.top=62;it.fit();
  return it;
};

/* ================= pH 計與探頭 ================= */
KINDS.phmeter=function(L,sp){
  var it=base(L,sp,52);it.top=40;it.draggable=true;
  it.body.appendChild(P('M-24 0L-24 -30Q-24 -34 -20 -34L20 -34Q24 -34 24 -30L24 0Z','lab-dark',{fill:L.dk}));
  it.body.appendChild(R(-19,-29,38,16,'lab-lcd',3));
  it.txt=T(14,-16.8,'—','lab-lcdt','end');it.body.appendChild(it.txt);it.body.appendChild(T(15,-16.8,'pH','lab-lcdu','start'));
  it.body.appendChild(C(-10,-7,3,'lab-key'));it.body.appendChild(C(0,-7,3,'lab-key'));it.body.appendChild(C(10,-7,3,'lab-key'));
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  it.post=function(){
    var pr=KINDS.probe(L,sp);pr.id=it.id+'-probe';pr.meter=it;pr.label=it.label?it.label+'探頭':'';pr.g.setAttribute('data-id',pr.id);pr.shadow.setAttribute('fill',L.sh);
    pr.x=Math.min(W-14,it.x+it.w/2+16);pr.home={x:pr.x,y:BENCH};pr.fit();pr.place();L.items.push(pr);L.byId[pr.id]=pr;L.svg.appendChild(pr.g);it.probeItem=pr;
    it.cable=P('','lab-cable');L.cab.appendChild(it.cable);
  };
  it.upd=function(){
    var pr=it.probeItem;if(!pr)return;
    var v=pr.on&&pr.on.ves&&totV(pr.on.liq)>0?pr.on:null,ph=v?pHOf(v.liq):null;
    it.txt.textContent=ph==null?'—':fx(ph,2);L.pub(it,'ph',ph==null?null:Math.round(ph*100)/100);
    var x1=it.x+10,y1=it.y-3,x2=pr.x,y2=pr.y-pr.cableTop;
    it.cable.setAttribute('d','M'+x1.toFixed(1)+' '+y1.toFixed(1)+'C'+(x1+30).toFixed(1)+' '+(y1+28).toFixed(1)+' '+(x2-6).toFixed(1)+' '+(y2-40).toFixed(1)+' '+x2.toFixed(1)+' '+y2.toFixed(1));
  };
  return it;
};
KINDS.probe=function(L,sp){
  var it=base(L,sp,16);it.top=90;it.probe=true;it.cableTop=94;it.kind='probe';
  it.body.appendChild(R(-3,-92,6,28,'lab-dark',2));it.body.lastChild.setAttribute('fill',L.dk);
  it.body.appendChild(R(-2.2,-64,4.4,56,'lab-glass',2));it.body.lastChild.setAttribute('fill',L.gl);
  it.body.appendChild(P('M-2.2 -8Q0 -1 2.2 -8Z','lab-glass',{fill:L.gl}));
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  return it;
};

/* ================= 固體與砝碼 ================= */
KINDS.solid=function(L,sp){
  var it=base(L,sp,26),vol=num(sp,'volume',18),m=num(sp,'mass',num(sp,'density',2.7)*vol),r=cl(4+Math.cbrt(vol)*1.9,6,17);
  it.solid=true;it.vol=vol;it.gram=m;it.top=r*2+6;
  it.body.appendChild(P('M'+(-r)+' 0Q'+(-r*1.1)+' '+(-r*1.1)+' '+(-r*.2)+' '+(-r*1.7)+'Q'+(r*.9)+' '+(-r*1.9)+' '+(r*1.05)+' '+(-r*.8)+'Q'+(r*1.1)+' 0 '+(r*.5)+' 0Z','lab-rock',{fill:L.mt}));
  it.body.appendChild(P('M'+(-r*.5)+' '+(-r*.9)+'Q0 '+(-r*1.3)+' '+(r*.4)+' '+(-r*.9),'lab-shine'));
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  it.w=Math.max(26,r*2+6);it.fit();
  it.reads=function(){return {}};
  it.name=function(){return it.label||'固體'};
  return it;
};
KINDS.mass=function(L,sp){
  var it=base(L,sp,34),g=num(sp,'grams',50);it.gram=g;it.top=14;it.hang=true;
  it.body.appendChild(R(-15,-9,30,9,'lab-metal',2));it.body.lastChild.setAttribute('fill',L.mt);
  it.body.appendChild(R(-3,-12,6,3,'lab-metal'));
  it.body.appendChild(T(0,-2.2,g+' g','lab-ltxt dark'));
  it.body.appendChild(T(0,12,'砝碼','lab-cap'));
  it.name=function(){return it.label||g+' g 砝碼'};
  return it;
};
/* ================= 物理：彈簧與砝碼 ================= */
Object.assign(NAMES,{spring:'彈簧與砝碼',pendulum:'單擺',ramp:'斜面與光閘',circuit:'電路板',optics:'光學桌',microscope:'顯微鏡'});
KINDS.spring=function(L,sp){
  var it=base(L,sp,100),k=num(sp,'k',20),hanger=num(sp,'hanger',20)/1000,g=9.81,PX=3,TOP=-166,L0=40;it.top=176;it.draggable=false;
  it.y0=0;it.v=0;it.eq=0;it.k=k;
  it.body.appendChild(R(-46,-4,92,4,'lab-dark',2));
  var rod=R(-42,-176,4,174,'lab-metal',2);rod.setAttribute('fill',L.mt);it.body.appendChild(rod);
  var arm=R(-42,-170,44,4,'lab-metal',2);arm.setAttribute('fill',L.mt);it.body.appendChild(arm);
  it.coil=P('','lab-coil');it.body.appendChild(it.coil);
  var hk=G('',[Ln(0,0,0,6,'lab-coil'),R(-14,6,28,3,'lab-dark',1.5),Ln(0,9,0,13,'lab-coil')]);it.hk=hk;it.body.appendChild(hk);
  // 直尺：零點在彈簧自然長度時的吊盤位置
  var rl=G('lab-ruler');rl.appendChild(R(28,TOP+L0-4,16,PX*24+8,'lab-rulerbg',2));
  for(var i=0;i<=24;i++){var big=i%5===0;rl.appendChild(Ln(44-(big?8:5),TOP+L0+i*PX,44,TOP+L0+i*PX,big?'lab-tk big':'lab-tk'));if(big)rl.appendChild(T(33,TOP+L0+i*PX+2,String(i),'lab-tn','middle'))}
  rl.appendChild(T(36,TOP+L0-6,'cm','lab-tn','middle'));
  it.body.appendChild(rl);
  it.ptr=P('','lab-ptr');it.body.appendChild(it.ptr);
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  it.M=function(){var m=hanger;it.mounted.forEach(function(x){m+=x.gram/1000});return m};
  it.accepts=function(o){return o.hang&&Math.abs(o.x-it.x)<44&&it.mounted.length<6};
  it.take=function(o){o.on=it;it.mounted.push(o);raise(it);var s=it.slot(o);o.go(s.x,s.y,260);o.home={x:o.x,y:o.y}};
  it.yh=function(){return TOP+L0+it.y0*100*PX};
  it.slot=function(o){var i=it.mounted.indexOf(o);return {x:it.x,y:it.y+it.yh()+14+i*9.4}};
  it.damp=false;
  it.acts=function(){return [{label:'用手按住停止晃動（按住）',hold:function(on){it.damp=on}},{label:'取下全部砝碼',off:!it.mounted.length,run:function(){it.mounted.slice().forEach(function(m,i){it.mounted.splice(it.mounted.indexOf(m),1);m.on=null;var x=cl(it.x+54+i*34,20,W-20);m.go(x,BENCH,320);m.home={x:x,y:BENCH}})}}]};
  it.upd=function(dt){
    var M=it.M(),e=M*g/k,h=1/240,n=Math.min(40,Math.ceil(dt/h)),c=it.damp?30:.9;it.eq=e;
    for(var i=0;i<n;i++){var a=-(k/M)*(it.y0-e)-c*it.v;it.v+=a*h;it.y0+=it.v*h}
    var y=it.yh(),d='M0 '+TOP,turns=12,amp=6,seg=(y-TOP-6)/(turns*2);
    d+='L0 '+(TOP+3);for(var j=0;j<turns*2;j++)d+='L'+((j%2?-1:1)*amp)+' '+(TOP+3+seg*(j+.5));d+='L0 '+(y-3)+'L0 '+y;
    it.coil.setAttribute('d',d);A(it.hk,{transform:'translate(0 '+y.toFixed(2)+')'});
    it.ptr.setAttribute('d','M0 '+(y+8)+'L'+(44-9)+' '+(y+8)+'L'+(44-12)+' '+(y+5.5)+'M'+(44-9)+' '+(y+8)+'L'+(44-12)+' '+(y+10.5));
    L.pub(it,'extension',Math.round(e*100*10)/10);L.pub(it,'load',Math.round(M*1000));
  };
  return it;
};

/* ================= 物理：單擺 ================= */
KINDS.pendulum=function(L,sp){
  var it=base(L,sp,110),g=9.81,PXM=120,PY=-168;it.top=176;it.draggable=false;
  it.len=cl(num(sp,'length',.6),.2,1);it.th=0;it.w=0;it.count=0;it.side=1;it.swing=false;it.grab=false;
  it.body.appendChild(R(-46,-4,92,4,'lab-dark',2));
  var rod=R(-42,-178,4,176,'lab-metal',2);rod.setAttribute('fill',L.mt);it.body.appendChild(rod);
  var arm=R(-42,-172,48,5,'lab-metal',2);arm.setAttribute('fill',L.mt);it.body.appendChild(arm);
  it.body.appendChild(C(0,PY,2.6,'lab-dark'));
  var rl=G('lab-ruler');rl.appendChild(R(30,PY,16,PXM*1+4,'lab-rulerbg',2));
  for(var i=0;i<=100;i+=2){var big=i%10===0;rl.appendChild(Ln(46-(big?8:4),PY+i*PXM/100,46,PY+i*PXM/100,big?'lab-tk big':'lab-tk'));if(big&&i>0)rl.appendChild(T(34,PY+i*PXM/100+2,String(i),'lab-tn','middle'))}
  it.body.appendChild(rl);it.body.appendChild(T(38,PY-4,'cm','lab-tn','middle'));
  it.str=Ln(0,PY,0,PY+60,'lab-string');it.body.appendChild(it.str);
  it.bob=G('',[C(0,0,7.5,'lab-bob'),C(-2,-2.4,2.2,'lab-bobhi'),C(0,0,14,'lab-hit')]);it.bob.setAttribute('data-hot','bob');it.bob.style.cursor='grab';it.body.appendChild(it.bob);
  it.body.appendChild(R(-36,-62,0.1,0.1,''));
  var lcd=R(-38,-120,38,16,'lab-lcd',3);it.body.appendChild(lcd);it.cnt=T(-8,-108.6,'0','lab-lcdt sm','end');it.body.appendChild(it.cnt);it.body.appendChild(T(-6,-108.6,'次','lab-lcdu','start'));
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  it.press=function(){it.grab=true;it.swing=false;it.w=0;it.count=0};
  it.move=function(p){var dx=p.x-it.x,dy=p.y-(it.y+PY);it.th=cl(Math.atan2(dx,Math.max(8,dy)),-1.2,1.2)};
  it.release=function(){it.grab=false;if(Math.abs(it.th)>.03){it.swing=true;it.side=it.th>0?1:-1;it.count=0;it.w=0}};
  it.acts=function(){return [
    {label:'加長 10 cm',off:it.len>=.995,run:function(){it.len=Math.min(1,Math.round((it.len+.1)*100)/100);it.th=0;it.swing=false;it.w=0}},
    {label:'縮短 10 cm',off:it.len<=.205,run:function(){it.len=Math.max(.2,Math.round((it.len-.1)*100)/100);it.th=0;it.swing=false;it.w=0}},
    {label:'擺錘歸零',run:function(){it.th=0;it.w=0;it.swing=false;it.count=0}}];
  };
  it.upd=function(dt){
    if(it.swing&&!it.grab){var h=1/300,n=Math.min(40,Math.ceil(dt/h)),l=it.len;
      for(var i=0;i<n;i++){var pw=it.w;it.w+=(-(g/l)*Math.sin(it.th)-.03*it.w)*h;it.th+=it.w*h;if(pw*it.w<=0&&pw!==0&&it.th*it.side>0.02)it.count++}
      if(Math.abs(it.th)<.004&&Math.abs(it.w)<.02){it.swing=false;it.th=0;it.w=0}}
    var px=it.len*PXM,x=Math.sin(it.th)*px,y=PY+Math.cos(it.th)*px;
    A(it.str,{x2:x.toFixed(2),y2:y.toFixed(2)});A(it.bob,{transform:'translate('+x.toFixed(2)+' '+y.toFixed(2)+')'});
    it.cnt.textContent=String(it.count);
    L.pub(it,'length',it.len);L.pub(it,'angle',Math.round(it.th*180/Math.PI*10)/10);L.pub(it,'count',it.count);
  };
  return it;
};

/* ================= 物理：斜面、小車與光閘 ================= */
KINDS.ramp=function(L,sp){
  var it=base(L,sp,220),g=9.81,LEN=180,BLK=9,card=.05,mu=num(sp,'friction',.03);it.top=90;it.draggable=false;
  it.n=cl(Math.round(num(sp,'blocks',2)),1,5);it.s=.04;it.v=0;it.run=false;it.t=0;it.log={};it.gates=[.35,.75];
  var tr=G('');it.body.appendChild(tr);it.tr=tr;
  var trackBg=R(0,-5,LEN,5,'lab-track',1.5);trackBg.setAttribute('fill',L.mt);tr.appendChild(trackBg);
  for(var i=0;i<=10;i++){tr.appendChild(Ln(i*LEN/10,-5,i*LEN/10,i%5===0?-1:-3,'lab-tk'));if(i%5===0)tr.appendChild(T(i*LEN/10,6.5,(i*10)+' cm','lab-tn','middle'))}
  it.gateEls=it.gates.map(function(s,i){var x=s*LEN,gp=G('',[R(-3,-30,6,26,'lab-dark',1.5),R(-9,-30,18,3,'lab-dark',1.5),C(0,-22,1.4,'lab-led'),T(0,-33,'閘'+(i+1),'lab-tn','middle')],'translate('+x+' 0)');tr.appendChild(gp);return gp});
  it.car=G('',[R(-14,-15,28,10,'lab-car',3),C(-8,-4,3.2,'lab-wheel'),C(8,-4,3.2,'lab-wheel'),R(-3,-22,6,7,'lab-dark',1),R(-14,-12,28,2,'lab-metal'),R(-16,-17,34,24,'lab-hit')]);
  it.car.setAttribute('data-hot','car');it.car.style.cursor='grab';tr.appendChild(it.car);
  it.blocks=G('');it.body.appendChild(it.blocks);
  var lcd=R(22,-92,92,40,'lab-lcd',4);it.body.appendChild(lcd);
  it.lt=[0,1,2].map(function(i){var t=T(26,-80+i*12,'','lab-lcdt xs','start');it.body.appendChild(t);return t});
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  it.ang=function(){var h=it.n*BLK;return Math.atan2(h,Math.sqrt(LEN*LEN-h*h))};
  it.setTrack=function(){var a=it.ang();A(tr,{transform:'translate(-90 '+(-it.n*BLK)+') rotate('+(a*180/Math.PI).toFixed(2)+')'});
    it.blocks.textContent='';for(var i=0;i<it.n;i++)it.blocks.appendChild(R(-96,-(i+1)*BLK,14,BLK,'lab-block',1));it.blocks.appendChild(R(-97,-it.n*BLK-1,16,1,''))};
  it.reset_=function(){it.s=.04;it.v=0;it.run=false;it.t=0;it.log={}};
  it.press=function(){it.run=false;it.v=0};
  it.move=function(p){var a=it.ang(),ox=it.x-90,oy=it.y-it.n*BLK;var dx=p.x-ox,dy=p.y-oy;var s=(dx*Math.cos(a)+dy*Math.sin(a))/LEN;it.s=cl(s,.04,.2);it.log={};it.t=0};
  it.release=function(){if(it.s<.3){it.run=true;it.t=0;it.log={}}};
  it.acts=function(){return [
    {label:'放開小車',run:function(){it.reset_();it.run=true}},{label:'小車歸位',run:it.reset_},
    {label:'再墊高一塊',off:it.n>=5||it.run,run:function(){it.n++;it.reset_();it.setTrack()}},{label:'拿掉一塊',off:it.n<=1||it.run,run:function(){it.n--;it.reset_();it.setTrack()}}];
  };
  it.upd=function(dt){
    if(it.run){var a=g*(Math.sin(it.ang())-mu*Math.cos(it.ang()));it.t+=dt;var s0=it.s;it.v+=a*dt;it.s+=it.v*dt;
      it.gates.forEach(function(gs,i){var f='f'+i,b='b'+i,ds=it.s-s0,tp=it.t-dt;
        if(it.log[f]==null&&it.s+card/2>=gs&&s0+card/2<gs&&ds>0)it.log[f]=tp+dt*(gs-(s0+card/2))/ds;
        if(it.log[b]==null&&it.s-card/2>=gs&&s0-card/2<gs&&ds>0)it.log[b]=tp+dt*(gs-(s0-card/2))/ds;});
      if(it.s>=.96){it.s=.96;it.run=false;it.v=0}}
    A(it.car,{transform:'translate('+(it.s*LEN).toFixed(2)+' 0)'});
    var l=it.log,t1=l.f0!=null?l.f0:null,t2=l.f1!=null?l.f1:null,v1=l.b0!=null?card/(l.b0-l.f0):null,v2=l.b1!=null?card/(l.b1-l.f1):null;
    it.lt[0].textContent='閘1 '+(t1==null?'--':fx(t1,3)+' s  '+(v1==null?'':fx(v1,2)+' m/s'));
    it.lt[1].textContent='閘2 '+(t2==null?'--':fx(t2,3)+' s  '+(v2==null?'':fx(v2,2)+' m/s'));
    it.lt[2].textContent='Δt '+(t1!=null&&t2!=null?fx(t2-t1,3)+' s':'--');
    L.pub(it,'height',it.n*5);L.pub(it,'t1',t1==null?null:Math.round(t1*1000)/1000);L.pub(it,'t2',t2==null?null:Math.round(t2*1000)/1000);
    L.pub(it,'v1',v1==null?null:Math.round(v1*100)/100);L.pub(it,'v2',v2==null?null:Math.round(v2*100)/100);L.pub(it,'dt',t1!=null&&t2!=null?Math.round((t2-t1)*1000)/1000:null);
  };
  it.init=function(){it.setTrack()};
  return it;
};

/* ================= 物理：電路板 ================= */
var PARTW={cell:'電池',switch:'開關',resistor:'電阻',bulb:'燈泡',rheostat:'變阻器',ammeter:'電流計',voltmeter:'電壓計'};
KINDS.circuit=function(L,sp){
  var it=base(L,sp,344),defs=(sp.getAttribute('parts')||'cell:6;switch;resistor:10;bulb:6;ammeter;voltmeter').split(/[;,]/).map(function(s){return s.trim()}).filter(Boolean);
  it.top=190;it.draggable=false;it.parts=[];it.wires=[];it.pick=null;it.dirty=true;it.msg='';
  var cnt={},cols=4,PW=82,PH=82,ox=-(cols*PW)/2+PW/2,oy=-176,wl=G('lab-wires'),pl=G('');it.body.appendChild(wl);it.body.appendChild(pl);
  defs.forEach(function(d,i){var a=d.split(':'),type=a[0],val=parseFloat(a[1]);if(!PARTW[type])return;
    cnt[type]=(cnt[type]||0)+1;var tag={cell:'E',switch:'S',resistor:'R',bulb:'B',rheostat:'Rh',ammeter:'A',voltmeter:'V'}[type]+cnt[type];
    var n=it.parts.length,col=n%cols,row=Math.floor(n/cols),px=ox+col*PW,py=oy+row*PH+PH/2;
    var part={type:type,tag:tag,v:isFinite(val)?val:({cell:6,resistor:10,bulb:6,rheostat:20}[type]||0),closed:false,x:px,y:py,idx:n,blown:false,I:0,dV:0,max:type==='rheostat'?(isFinite(val)?val:20):0};
    if(type==='rheostat')part.v=part.max*.5;
    var g=G('lab-part',[R(-33,-22,66,44,'lab-partbg',8)],'translate('+px+' '+py+')');
    part.g=g;pl.appendChild(g);
    var sym=G('');g.appendChild(sym);part.sym=sym;
    if(type==='cell'){sym.appendChild(Ln(-8,-9,-8,9,'lab-pl'));sym.appendChild(Ln(-1,-5,-1,5,'lab-pl'));sym.appendChild(Ln(-8,0,-26,0,'lab-pw'));sym.appendChild(Ln(-1,0,10,0,'lab-pw'));sym.appendChild(Ln(10,0,26,0,'lab-pw'));sym.appendChild(T(-26,-4,'+','lab-tn','middle'));sym.appendChild(T(26,-4,'−','lab-tn','middle'));sym.appendChild(T(0,16,part.v+' V','lab-tn','middle'))}
    if(type==='resistor'){sym.appendChild(R(-12,-5,24,10,'lab-res'));sym.appendChild(Ln(-26,0,-12,0,'lab-pw'));sym.appendChild(Ln(12,0,26,0,'lab-pw'));sym.appendChild(T(0,16,part.v+' Ω','lab-tn','middle'))}
    if(type==='bulb'){part.glow=C(0,0,17,'lab-glow');part.glow.setAttribute('fill',L.wm);part.glow.style.opacity=0;sym.appendChild(part.glow);sym.appendChild(C(0,0,9,'lab-bulbc'));part.fil=P('M-5 5L-2 -3L2 3L5 -5','lab-fil');sym.appendChild(part.fil);sym.appendChild(Ln(-26,0,-9,0,'lab-pw'));sym.appendChild(Ln(9,0,26,0,'lab-pw'));sym.appendChild(T(0,19,part.v+' Ω','lab-tn','middle'))}
    if(type==='switch'){sym.appendChild(Ln(-26,0,-12,0,'lab-pw'));sym.appendChild(Ln(12,0,26,0,'lab-pw'));part.lev=Ln(-12,0,11,-10,'lab-lever');sym.appendChild(part.lev);sym.appendChild(C(-12,0,2,'lab-dark'));sym.appendChild(C(12,0,2,'lab-dark'));var hit=R(-24,-18,48,28,'lab-hit');hit.setAttribute('data-hot','sw:'+n);sym.appendChild(hit);part.lab=T(0,17,'斷開','lab-tn','middle');sym.appendChild(part.lab)}
    if(type==='rheostat'){sym.appendChild(R(-14,-5,28,10,'lab-res'));sym.appendChild(Ln(-26,0,-14,0,'lab-pw'));sym.appendChild(Ln(14,0,26,0,'lab-pw'));part.knob=G('',[P('M0 -6L-4 -13L4 -13Z','lab-dark'),R(-9,-22,18,18,'lab-hit')]);part.knob.setAttribute('data-hot','rh:'+n);part.knob.style.cursor='ew-resize';sym.appendChild(part.knob);part.lab=T(0,17,'','lab-tn','middle');sym.appendChild(part.lab)}
    if(type==='ammeter'||type==='voltmeter'){sym.appendChild(C(0,-2,13,'lab-meter'));sym.appendChild(T(0,2,type==='ammeter'?'A':'V','lab-meterl','middle'));sym.appendChild(Ln(-26,-2,-13,-2,'lab-pw'));sym.appendChild(Ln(13,-2,26,-2,'lab-pw'));part.lab=T(0,19,'0.00','lab-lcdv','middle');sym.appendChild(part.lab)}
    var yy=type==='ammeter'||type==='voltmeter'?-2:0;
    part.term=[0,1].map(function(s){var t=G('lab-term',[C(0,0,4.2,'lab-tdot'),C(0,0,13,'lab-hit')],'translate('+(s?29:-29)+' '+yy+')');t.setAttribute('data-hot','t:'+n+':'+s);t.style.cursor='pointer';g.appendChild(t);return t});
    g.appendChild(T(0,-26,PARTW[type]+' '+tag,'lab-cap','middle'));
    it.parts.push(part);
  });
  it.termPos=function(n,s){var p=it.parts[n];return {x:p.x+(s?29:-29),y:p.y+((p.type==='ammeter'||p.type==='voltmeter')?-2:0)}};
  it.wireEls=[];
  it.drawWires=function(){wl.textContent='';it.wires.forEach(function(w,i){var a=it.termPos(w[0],w[1]),b=it.termPos(w[2],w[3]),mx=(a.x+b.x)/2,sag=18+Math.abs(a.x-b.x)*.08;
    var d='M'+a.x+' '+a.y+'C'+a.x+' '+(a.y+sag)+' '+b.x+' '+(b.y+sag)+' '+b.x+' '+b.y;
    var path=P(d,'lab-wire'),flow=P(d,'lab-flow'),hit=P(d,'lab-wirehit');hit.setAttribute('data-hot','w:'+i);hit.style.cursor='pointer';wl.appendChild(path);wl.appendChild(flow);wl.appendChild(hit)})};
  it.canPress=function(){return true};
  it.press=function(part){
    var a=part.split(':');
    if(a[0]==='t'){var n=+a[1],s=+a[2];if(!it.pick){it.pick=[n,s];it.parts[n].term[s].classList.add('on');L.say('已選取接點，再點另一個接點完成接線')}
      else{var p=it.pick;it.parts[p[0]].term[p[1]].classList.remove('on');it.pick=null;if(p[0]===n&&p[1]===s){L.say('已取消');return}
        if(it.wires.some(function(w){return (w[0]===p[0]&&w[1]===p[1]&&w[2]===n&&w[3]===s)||(w[2]===p[0]&&w[3]===p[1]&&w[0]===n&&w[1]===s)})){L.say('這兩個接點已經接過了');return}
        it.wires.push([p[0],p[1],n,s]);it.drawWires();it.dirty=true;L.say('已接線')}}
    else if(a[0]==='w'){it.wires.splice(+a[1],1);it.drawWires();it.dirty=true;L.say('已拆除一條導線')}
    else if(a[0]==='sw'){var p2=it.parts[+a[1]];p2.closed=!p2.closed;it.dirty=true;L.say(p2.tag+(p2.closed?' 已閉合':' 已斷開'))}
    else if(a[0]==='rh'){it.rh=+a[1]}
  };
  it.move=function(p,part){var a=part.split(':');if(a[0]!=='rh')return;var q=it.parts[+a[1]],f=cl((p.x-(it.x+q.x-12))/24,0,1);q.v=Math.max(.5,q.max*f);it.dirty=true};
  it.release=function(){it.rh=null};
  it.acts=function(){return [{label:'拆除全部導線',off:!it.wires.length,run:function(){it.wires=[];it.pick=null;it.parts.forEach(function(p){p.term.forEach(function(t){t.classList.remove('on')})});it.drawWires();it.dirty=true}},
    {label:'更換受損元件',off:!it.parts.some(function(p){return p.blown}),run:function(){it.parts.forEach(function(p){p.blown=false});it.dirty=true}}]};
  function solve(){
    // 節點以接線合併（並查集）
    var par={};function key(n,s){return n+':'+s}function f(x){while(par[x]!==x){par[x]=par[par[x]];x=par[x]}return x}
    it.parts.forEach(function(p){par[key(p.idx,0)]=key(p.idx,0);par[key(p.idx,1)]=key(p.idx,1)});
    it.wires.forEach(function(w){var a=f(key(w[0],w[1])),b=f(key(w[2],w[3]));if(a!==b)par[a]=b});
    var ids={},N=0;function nid(n,s){var r=f(key(n,s));if(ids[r]==null)ids[r]=N++;return ids[r]}
    var els=[];
    it.parts.forEach(function(p){var a=nid(p.idx,0),b=nid(p.idx,1),G_=0,Ic=0;
      if(p.type==='cell'){G_=1/.3;Ic=p.v/.3;els.push({a:a,b:b,g:G_,i:Ic,p:p})}
      else if(p.type==='resistor'||p.type==='bulb'||p.type==='rheostat')els.push({a:a,b:b,g:p.blown?0:1/Math.max(.05,p.v),i:0,p:p});
      else if(p.type==='switch')els.push({a:a,b:b,g:p.closed?1e3:0,i:0,p:p});
      else if(p.type==='ammeter')els.push({a:a,b:b,g:p.blown?0:1/.05,i:0,p:p});
      else if(p.type==='voltmeter')els.push({a:a,b:b,g:1e-6,i:0,p:p})});
    var cellEl=els.filter(function(e){return e.p.type==='cell'})[0];
    var V=new Array(N).fill(0);
    if(cellEl){var ref=cellEl.b,M=[],rhs=[];for(var i=0;i<N;i++){M.push(new Array(N).fill(0));rhs.push(0);M[i][i]+=1e-9}
      els.forEach(function(e){M[e.a][e.a]+=e.g;M[e.b][e.b]+=e.g;M[e.a][e.b]-=e.g;M[e.b][e.a]-=e.g;rhs[e.a]+=e.i;rhs[e.b]-=e.i});
      for(var c=0;c<N;c++){M[ref][c]=c===ref?1:0}rhs[ref]=0;
      for(var col=0;col<N;col++){var pv=col;for(var r=col+1;r<N;r++)if(Math.abs(M[r][col])>Math.abs(M[pv][col]))pv=r;
        var tm=M[col];M[col]=M[pv];M[pv]=tm;var tr_=rhs[col];rhs[col]=rhs[pv];rhs[pv]=tr_;
        if(Math.abs(M[col][col])<1e-14)continue;
        for(var r2=col+1;r2<N;r2++){var fct=M[r2][col]/M[col][col];if(!fct)continue;for(var c2=col;c2<N;c2++)M[r2][c2]-=fct*M[col][c2];rhs[r2]-=fct*rhs[col]}}
      for(var r3=N-1;r3>=0;r3--){var s_=rhs[r3];for(var c3=r3+1;c3<N;c3++)s_-=M[r3][c3]*V[c3];V[r3]=Math.abs(M[r3][r3])<1e-14?0:s_/M[r3][r3]}}
    els.forEach(function(e){var p=e.p,dv=V[e.a]-V[e.b];p.dV=dv;p.I=p.type==='cell'?(p.v-dv)*e.g*-1+0:dv*e.g;if(p.type==='cell')p.I=(e.i-dv*e.g)});
    // 後果：燈泡過亮燒毀、電流計過載
    var msg='';
    it.parts.forEach(function(p){
      if(p.type==='bulb'&&!p.blown){var P_=p.dV*p.dV/Math.max(.05,p.v),rated=36/Math.max(.05,p.v);if(P_>rated*2.6){p.blown=true;msg='燈泡電壓過高，燒壞了'}}
      if(p.type==='ammeter'&&!p.blown&&Math.abs(p.I)>3){p.blown=true;msg='電流計通過的電流過大，保險絲燒斷了：電流計必須串聯'}
    });
    if(msg){L.say(msg);it.dirty=true}
    return V;
  }
  var dash=0;
  it.upd=function(dt){
    if(it.dirty){it.dirty=false;solve();
      it.parts.forEach(function(p){
        if(p.type==='switch'){A(p.lev,{x2:p.closed?12:11,y2:p.closed?0:-10});p.lab.textContent=p.closed?'閉合':'斷開'}
        if(p.type==='rheostat'){p.knob.setAttribute('transform','translate('+(-12+24*p.v/p.max).toFixed(1)+' 0)');p.lab.textContent=fx(p.v,1)+' Ω'}
        if(p.type==='ammeter')p.lab.textContent=p.blown?'OL':fx(p.I,3);
        if(p.type==='voltmeter')p.lab.textContent=fx(p.dV,2);
        if(p.type==='bulb'){var P_=p.blown?0:p.dV*p.dV/Math.max(.05,p.v),rated=36/Math.max(.05,p.v);p.glow.style.opacity=cl(P_/rated,0,1).toFixed(2);A(p.fil,{'stroke-dasharray':p.blown?'2 4':null})}
        if(p.type==='ammeter')L.pub(it,p.tag,p.blown?null:Math.round(Math.abs(p.I)*1000)/1000);
        if(p.type==='voltmeter')L.pub(it,p.tag,Math.round(p.dV*100)/100);
        if(p.type==='rheostat')L.pub(it,p.tag,Math.round(p.v*10)/10);
        if(p.type==='bulb')L.pub(it,p.tag,Math.round(Math.min(1,(p.dV*p.dV/Math.max(.05,p.v))/(36/Math.max(.05,p.v)))*100)/100);
      });
    }
    // 電流流動動畫：導線虛線沿方向移動，速度與迴路最大電流成比例
    var imax=0;it.parts.forEach(function(p){if(p.type!=='voltmeter'&&p.type!=='cell')imax=Math.max(imax,Math.abs(p.I))});
    dash=(dash-dt*cl(imax*40,0,90))%20;
    wl.style.setProperty('--dash',dash.toFixed(1));wl.style.setProperty('--flow',imax>1e-4?'.85':'0');
  };
  it.post=function(){it.drawWires()};
  return it;
};

/* ================= 物理：光學桌 ================= */
KINDS.optics=function(L,sp){
  var it=base(L,sp,344),f=num(sp,'focal',15),PX=3.1,X0=-150,RY=-34,h0=3;it.top=120;it.draggable=false;
  it.lens=num(sp,'lens',30);it.scr=num(sp,'screen',70);
  var rail=R(X0-6,RY,PX*100+12,5,'lab-track',2);rail.setAttribute('fill',L.mt);it.body.appendChild(rail);
  for(var i=0;i<=100;i+=1){var big=i%10===0,mid=i%5===0;it.body.appendChild(Ln(X0+i*PX,RY+5,X0+i*PX,RY+5+(big?7:mid?5:3),big?'lab-tk big':'lab-tk'));if(big)it.body.appendChild(T(X0+i*PX,RY+21,String(i),'lab-tn','middle'))}
  it.body.appendChild(T(X0+PX*100+4,RY+21,'cm','lab-tn','start'));
  // 物（發光箭頭）固定在 0 cm
  var obj=G('',[R(-5,-20,10,22,'lab-dark',2),P('M0 -52L-5 -44L-1.6 -44L-1.6 -26L1.6 -26L1.6 -44L5 -44Z','lab-arrow'),T(0,-58,'物 0 cm','lab-tn','middle')],'translate('+X0+' '+RY+')');it.body.appendChild(Ln(X0,RY-26,X0+PX*100,RY-26,'lab-axis'));it.body.appendChild(obj);
  var blur=S('filter',{id:'ob'+L.uid+it.id,x:'-50%',y:'-50%',width:'200%',height:'200%'},[S('feGaussianBlur',{stdDeviation:0})]);it.body.appendChild(S('defs',{},[blur]));it.blur=blur.firstChild;
  it.lensG=G('',[S('ellipse',{cx:0,cy:-26,rx:4.2,ry:26,'class':'lab-lens'}),R(-4,-1,8,6,'lab-dark',1),R(-14,-60,28,70,'lab-hit'),T(0,-62,'透鏡','lab-tn','middle')]);it.lensG.setAttribute('data-hot','lens');it.lensG.style.cursor='ew-resize';it.body.appendChild(it.lensG);
  it.scrG=G('',[R(-2.5,-56,5,58,'lab-screen',1.5),R(-12,-60,24,70,'lab-hit'),T(0,-62,'螢幕','lab-tn','middle')]);it.scrG.setAttribute('data-hot','screen');it.scrG.style.cursor='ew-resize';it.body.appendChild(it.scrG);
  it.img=G('lab-img');it.body.appendChild(it.img);it.imgA=P('','lab-arrow');it.imgA.setAttribute('filter','url(#ob'+L.uid+it.id+')');it.img.appendChild(it.imgA);
  it.body.appendChild(T(0,12,it.name(),'lab-cap'));
  var cur=null;
  it.press=function(p){cur=p};
  it.move=function(p,part){var c=cl(Math.round(((p.x-it.x-X0)/PX)*2)/2,part==='lens'?4:12,100);if(part==='lens')it.lens=cl(c,4,it.scr-3);else it.scr=cl(c,it.lens+3,100)};
  it.release=function(){cur=null};
  function nudge(which,d){return {label:(which==='lens'?'透鏡 ':'螢幕 ')+(d<0?'← 0.5 cm（按住連續）':'→ 0.5 cm（按住連續）'),hold:function(on){it.nudge=on?{w:which,d:d}:null}}}
  it.acts=function(){return [nudge('lens',-1),nudge('lens',1),nudge('screen',-1),nudge('screen',1)]};
  it.upd=function(dt){
    if(it.nudge){var n=it.nudge;if(n.w==='lens')it.lens=cl(it.lens+n.d*8*dt,4,it.scr-3);else it.scr=cl(it.scr+n.d*8*dt,it.lens+3,100)}
    var lx=X0+it.lens*PX,sx=X0+it.scr*PX;A(it.lensG,{transform:'translate('+lx.toFixed(1)+' '+RY+')'});A(it.scrG,{transform:'translate('+sx.toFixed(1)+' '+RY+')'});
    var u=it.lens,real=u>f+.01,v=real?u*f/(u-f):Infinity,m=real?v/u:0,s=it.scr-it.lens;
    if(real){var err=Math.abs(s-v),ht=cl(m*h0*PX*3.2,3,46),sd=cl(err*.55,0,9);it.blur.setAttribute('stdDeviation',sd.toFixed(2));
      var hh=Math.min(8,ht*.4);it.imgA.setAttribute('d','M0 '+ht+'L-5 '+(ht-hh)+'L-1.6 '+(ht-hh)+'L-1.6 0L1.6 0L1.6 '+(ht-hh)+'L5 '+(ht-hh)+'Z');
      A(it.img,{transform:'translate('+sx.toFixed(1)+' '+(RY-26)+')',opacity:cl(1-sd/10,.15,1).toFixed(2)})}
    else{it.imgA.setAttribute('d','');A(it.img,{opacity:0})}
    L.pub(it,'lens',Math.round(it.lens*2)/2);L.pub(it,'screen',Math.round(it.scr*2)/2);L.pub(it,'sharp',real&&Math.abs(s-v)<.8?1:0);
  };
  return it;
};
/* ================= 生物：顯微鏡 ================= */
function rng(seed){var s=seed>>>0;return function(){s=(s*1664525+1013904223)>>>0;return s/4294967296}}
KINDS.microscope=function(L,sp){
  var it=base(L,sp,170),spec=sp.getAttribute('specimen')||'onion',OBJ=[4,10,40],FIELD={4:2000,10:800,40:200},BEST={4:.3,10:.55,40:.8},VR=40,VX=52,VY=-118;it.top=164;it.draggable=false;
  it.obj=4;it.focus=num(sp,'focus',.05);it.px=1000;it.py=1000;
  // 顯微鏡本體
  it.body.appendChild(R(-34,-7,60,7,'lab-dark',3));
  it.body.appendChild(P('M-14 -7C-30 -34 -30 -74 -8 -100','lab-arm'));
  it.body.appendChild(R(-26,-44,40,3,'lab-metal',1));it.body.lastChild.setAttribute('fill',L.mt);
  it.body.appendChild(R(-12,-47,26,3,'lab-slide',1));
  it.body.appendChild(P('M-9 -14L11 -14L7 -22L-5 -22Z','lab-metal'));it.body.lastChild.setAttribute('fill',L.mt);
  var lamp=C(1,-30,5,'lab-lamp');lamp.setAttribute('fill',L.wm);it.body.appendChild(lamp);
  it.body.appendChild(R(-4,-104,13,44,'lab-dark',2));it.body.lastChild.setAttribute('fill',L.dk);
  it.body.appendChild(R(-1,-112,7,9,'lab-metal',2));
  it.turret=R(-7,-60,19,6,'lab-metal',2);it.body.appendChild(it.turret);
  [-4,2.5,9].forEach(function(x,i){it.body.appendChild(R(x-1.8,-54,3.6,8+i*2,'lab-dark',1))});
  it.knob=G('',[C(0,0,8,'lab-key'),Ln(-5,0,5,0,'lab-keymark'),C(0,0,13,'lab-hit')],'translate(-24 -56)');it.knob.setAttribute('data-hot','focus');it.knob.style.cursor='ns-resize';it.body.appendChild(it.knob);
  it.body.appendChild(T(-24,-42,'調焦','lab-tn','middle'));
  // 目鏡視野
  var cid='mc'+L.uid+it.id,view=G('');
  it.body.appendChild(S('clipPath',{id:cid},[C(VX,VY,VR,'')]));
  it.body.appendChild(C(VX,VY,VR+3,'lab-eye'));
  var fid='mb'+L.uid+it.id,fil=S('filter',{id:fid,x:'-20%',y:'-20%',width:'140%',height:'140%'},[S('feGaussianBlur',{stdDeviation:0})]);
  it.body.appendChild(S('defs',{},[fil]));it.blur=fil.firstChild;
  var clipG=S('g',{'clip-path':'url(#'+cid+')'}),bg=C(VX,VY,VR,'lab-field');clipG.appendChild(bg);
  var pan=G('');pan.setAttribute('filter','url(#'+fid+')');clipG.appendChild(pan);it.spec=G('');pan.appendChild(it.spec);
  var viewHit=C(VX,VY,VR,'lab-hit');viewHit.setAttribute('data-hot','view');viewHit.style.cursor='move';clipG.appendChild(viewHit);
  it.body.appendChild(clipG);it.body.appendChild(C(VX,VY,VR,'lab-eyering'));
  it.scaleBar=Ln(0,0,10,0,'lab-sbar');it.scaleTxt=T(0,0,'','lab-tn','middle');it.body.appendChild(it.scaleBar);it.body.appendChild(it.scaleTxt);
  it.magTxt=T(VX,VY-VR-6,'','lab-tn','middle');it.body.appendChild(it.magTxt);
  it.body.appendChild(T(-4,12,it.name(),'lab-cap'));
  // 標本（單位：微米，區域 2000×2000）
  (function make(){
    var r=rng(spec==='cheek'?7:3),d='',i,nuc=[];
    if(spec==='cheek'){
      for(i=0;i<360;i++){var cx=r()*2000,cy=r()*2000,rx=26+r()*14,ry=22+r()*14,a=r()*180;
        var e=S('ellipse',{cx:cx,cy:cy,rx:rx,ry:ry,transform:'rotate('+a.toFixed(0)+' '+cx.toFixed(0)+' '+cy.toFixed(0)+')','class':'lab-cell cheek'});it.spec.appendChild(e);
        it.spec.appendChild(C(cx+(r()-.5)*8,cy+(r()-.5)*8,6+r()*2,'lab-nuc'))}
    }else{
      var rows=25,cols=11;
      for(var rw=0;rw<rows;rw++)for(var c=0;c<cols;c++){var x=c*200+(rw%2?100:0)-100+(r()-.5)*14,y=rw*80+(r()-.5)*8;
        d+='M'+x.toFixed(0)+' '+y.toFixed(0)+'h188v72h-188Z';
        nuc.push([x+30+r()*120,y+20+r()*34])}
      it.spec.appendChild(P(d,'lab-cell onion'));
      nuc.forEach(function(n){it.spec.appendChild(C(n[0],n[1],9+r()*2,'lab-nuc'))});
    }
  })();
  it.press=function(part){it.lastY=null};
  it.move=function(p,part){
    if(part==='focus'){if(it.lastY==null){it.lastY=p.y;return}var dy=p.y-it.lastY;it.lastY=p.y;it.focus=cl(it.focus-dy*.006,0,1)}
    else if(part==='view'){if(it.lastX==null){it.lastX=p.x;it.lastY2=p.y;return}var k=FIELD[it.obj]/(2*VR);it.px=cl(it.px-(p.x-it.lastX)*k,300,1700);it.py=cl(it.py-(p.y-it.lastY2)*k,300,1700);it.lastX=p.x;it.lastY2=p.y}
  };
  it.release=function(){it.lastY=null;it.lastX=null;it.lastY2=null};
  it.acts=function(){
    var out=OBJ.map(function(o){return {label:'物鏡 ×'+o,run:function(){it.obj=o;L.say('已切換到 ×'+o+' 物鏡，需要重新對焦')}}});
    out.push({label:'粗調 ▲（按住）',hold:function(on){it.nud=on?.5:0}});out.push({label:'粗調 ▼（按住）',hold:function(on){it.nud=on?-.5:0}});
    out.push({label:'細調 ▲（按住）',hold:function(on){it.nud=on?.08:0}});out.push({label:'細調 ▼（按住）',hold:function(on){it.nud=on?-.08:0}});
    out.push({label:'玻片 ← （按住）',hold:function(on){it.pn=on?[-1,0]:null}});out.push({label:'玻片 → （按住）',hold:function(on){it.pn=on?[1,0]:null}});
    out.push({label:'玻片 ↑ （按住）',hold:function(on){it.pn=on?[0,-1]:null}});out.push({label:'玻片 ↓ （按住）',hold:function(on){it.pn=on?[0,1]:null}});
    return out;
  };
  it.upd=function(dt){
    if(it.nud)it.focus=cl(it.focus+it.nud*dt,0,1);
    var k=FIELD[it.obj];if(it.pn){it.px=cl(it.px+it.pn[0]*k*.5*dt,300,1700);it.py=cl(it.py+it.pn[1]*k*.5*dt,300,1700)}
    var sc=(2*VR)/k,d=Math.abs(it.focus-BEST[it.obj]),sd=cl(d*24,0,9);
    it.blur.setAttribute('stdDeviation',sd.toFixed(2));
    it.spec.setAttribute('transform','translate('+(VX-it.px*sc).toFixed(2)+' '+(VY-it.py*sc).toFixed(2)+') scale('+sc.toFixed(4)+')');
    var bar=it.obj===4?500:it.obj===10?200:50,bw=bar*sc,bx=VX-VR+8,by=VY+VR-8;
    A(it.scaleBar,{x1:bx,y1:by,x2:bx+bw,y2:by});it.scaleTxt.setAttribute('x',bx+bw/2);it.scaleTxt.setAttribute('y',by-3);it.scaleTxt.textContent=bar+' μm';
    it.magTxt.textContent='目鏡 ×10 · 物鏡 ×'+it.obj+' · 總放大 ×'+(it.obj*10);
    A(it.turret,{x:-7+(OBJ.indexOf(it.obj)-1)*2});
    A(it.knob,{transform:'translate(-24 -56) rotate('+(it.focus*720).toFixed(0)+')'});
    L.pub(it,'mag',it.obj*10);L.pub(it,'objective',it.obj);L.pub(it,'focus',Math.round(it.focus*100)/100);L.pub(it,'sharp',d<.03?1:0);L.pub(it,'barum',bar);
  };
  return it;
};
})();
`;

export const hasStudyLab = (html: string): boolean => /<sk-lab/.test(html);
