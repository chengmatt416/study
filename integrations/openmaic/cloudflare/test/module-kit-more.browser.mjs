// Drives the newer kit components in a real browser: the "see the answer" way out, gated steps, graph, table, mark,
// reflect and flashcards. Requires the prepared Core's Playwright installation and a Chromium browser.
// Run: node integrations/openmaic/cloudflare/test/module-kit-more.browser.mjs
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const { chromium } = await import(new URL('../../../../.openmaic/core/node_modules/@playwright/test/index.mjs', import.meta.url).href);
const vite = await createViteServer({ configFile: false, root, cacheDir: root + '.openmaic/qa/module-kit-more-cache', server: { middlewareMode: true }, appType: 'custom' });
let kit;
try { ({ studyKitHead: kit } = await vite.ssrLoadModule('/src/shared/module-kit.ts')); } finally { await vite.close(); }

const body = `<sk-module heading="新元件">
<sk-numeric id="q-num" question="2 + 2 = ?" answer="4"><sk-wrong value="22" misconception="concat" feedback="不是把數字接在一起。"></sk-wrong><sk-explain>2 + 2 = 4。</sk-explain></sk-numeric>
<sk-steps id="walk" gated>
  <sk-step heading="第一步"><sk-numeric id="s1" question="3 × 3 = ?" answer="9"><sk-explain>九。</sk-explain></sk-numeric></sk-step>
  <sk-step heading="第二步"><p>完成</p></sk-step>
</sk-steps>
<sk-graph id="g-pts" question="標出 (1, 2) 與 (-2, 0)" points="1,2;-2,0"><sk-wrong points="2,1;0,-2" misconception="swapped-xy" feedback="x 與 y 對調了。"></sk-wrong><sk-explain>先橫後縱。</sk-explain></sk-graph>
<sk-graph id="g-line" question="畫出 y = 2x + 1" line="2,1"><sk-wrong line="-2,1" misconception="slope-sign" feedback="斜率的正負號反了。"></sk-wrong><sk-explain>斜率 2，截距 1。</sk-explain></sk-graph>
<sk-table id="tbl" question="完成表格" rowhead>
  <sk-tr head>x|x²|奇偶</sk-tr>
  <sk-tr>2|[4]|[偶數]</sk-tr>
  <sk-tr>3|[9]|奇數</sk-tr>
  <sk-wrong value="6" misconception="doubled-not-squared" feedback="平方不是乘以 2。"></sk-wrong>
  <sk-explain>平方是自己乘自己。</sk-explain>
</sk-table>
<sk-mark id="mk" question="點出句中的動詞"><sk-text>The cat <sk-hit>sat</sk-hit> on the mat and <sk-hit>purred</sk-hit> <sk-miss misconception="adverb-as-verb" feedback="loudly 是副詞。">loudly</sk-miss>.</sk-text><sk-explain>sat 與 purred。</sk-explain></sk-mark>
<sk-reflect id="rf" question="用自己的話說明為什麼週期與振幅無關" misconception="amplitude-period"><sk-explain>回復力與位移成正比。</sk-explain><sk-point>回復力與位移成正比</sk-point><sk-point>振幅大，速度也大</sk-point></sk-reflect>
<sk-flashcards id="fc" heading="術語"><sk-flash term="period">週期</sk-flash><sk-flash term="frequency">頻率</sk-flash></sk-flashcards>
</sk-module>`;
const html = '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + kit() + '<script>window.__events=[];window.addEventListener("message",function(e){if(e.data&&e.data.source==="study-kit")window.__events.push(e.data.event)})</script></head><body>' + body + '</body></html>';

const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  for (const viewport of [{ width: 1100, height: 900 }, { width: 375, height: 667 }]) {
    const page = await browser.newPage({ viewport });
    const errors = []; page.on('pageerror', error => errors.push(String(error)));
    await page.setContent(html);
    await page.waitForSelector('#q-num .sk-btn');
    // Events reach the page through postMessage, so they arrive a moment after the click.
    const sawEvent = want => page.waitForFunction(w => window.__events.some(event => Object.keys(w).every(key => event[key] === w[key])), want, { timeout: 3000 }).then(() => true);
    const text = selector => page.locator(selector).innerText();
    const check = id => page.locator(`#${id} .sk-actions .sk-primary, #${id} .sk-row .sk-primary`).first().click();

    // A filled button keeps its fill and readable label while the pointer is over it.
    await page.hover('#q-num .sk-row .sk-primary');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.querySelector('#q-num .sk-row .sk-primary')).backgroundImage), 'none');

    // Two misses offer the answer; taking it shows the explanation, completes the card and counts as a hint.
    await page.fill('#q-num input', '22'); await check('q-num');
    assert.match(await text('#q-num .sk-fb'), /不是把數字接在一起/);
    assert.equal(await page.locator('#q-num .sk-giveup').count(), 0);
    await page.fill('#q-num input', '5'); await check('q-num');
    await page.click('#q-num .sk-giveup');
    assert.match(await text('#q-num .sk-fb'), /這是解答。.*2 \+ 2 = 4/s);
    assert.equal(await page.inputValue('#q-num input'), '4');
    assert.ok(await sawEvent({ kind: 'hint', id: 'q-num', level: 3 }));

    // A gated step opens only when its question is answered, and a corrected answer is praised.
    const next = page.locator('#walk .sk-nav .sk-primary');
    assert.equal(await next.isDisabled(), true); assert.equal(await next.innerText(), '先完成這一步');
    await page.fill('#s1 input', '6'); await check('s1');
    assert.equal(await next.isDisabled(), true);
    await page.fill('#s1 input', '9'); await check('s1');
    assert.match(await text('#s1 .sk-fb'), /修正得很好/);
    await page.waitForFunction(() => !document.querySelector('#walk .sk-nav .sk-primary').disabled);
    await next.click();
    assert.equal(await page.locator('#walk sk-step:nth-of-type(2)').isVisible(), true);

    // Graph, points: tap to place, tap again to remove, keyboard to add and move.
    const tap = async (id, x, y) => {
      const box = await page.locator(`#${id} svg.sk-graph`).boundingBox();
      const px = box.x + (24 + (x + 5) / 10 * 252) / 300 * box.width, py = box.y + (300 - 24 - (y + 5) / 10 * 252) / 300 * box.height;
      await page.mouse.click(px, py);
    };
    await page.locator('#g-pts').scrollIntoViewIfNeeded();
    await tap('g-pts', 2, 1); await tap('g-pts', 0, -2); await check('g-pts');
    assert.match(await text('#g-pts .sk-fb'), /x 與 y 對調了/);
    await tap('g-pts', 2, 1); await tap('g-pts', 0, -2);
    assert.equal(await page.locator('#g-pts .sk-gp').count(), 0);
    await tap('g-pts', 1, 2);
    await page.click('#g-pts .sk-actions .sk-btn:has-text("加一個點")');
    for (const key of ['ArrowLeft', 'ArrowLeft']) await page.keyboard.press(key);
    assert.match(await text('#g-pts .sk-gread'), /\(1, 2\)、\(-2, 0\)/);
    await check('g-pts');
    assert.match(await text('#g-pts .sk-fb'), /答對了.*先橫後縱/s);

    // Graph, line: taps place the two handles in turn.
    await page.locator('#g-line').scrollIntoViewIfNeeded();
    await tap('g-line', 0, 1); await tap('g-line', 1, -1); await check('g-line');
    assert.match(await text('#g-line .sk-fb'), /斜率的正負號反了/);
    // Tapping a handle chooses it; the next tap on the grid moves it there.
    await tap('g-line', 1, -1); await tap('g-line', 2, 5); await check('g-line');
    assert.match(await text('#g-line .sk-fb'), /答對了/);

    // Table: every blank is checked, a known wrong value names its misconception.
    await page.locator('#tbl').scrollIntoViewIfNeeded();
    const cells = page.locator('#tbl .sk-tbl input');
    assert.equal(await cells.count(), 3);
    await check('tbl'); assert.match(await text('#tbl .sk-fb'), /先把每一格都填上/);
    await cells.nth(0).fill('4'); await cells.nth(1).fill(' 偶數 '); await cells.nth(2).fill('6'); await check('tbl');
    assert.match(await text('#tbl .sk-fb'), /平方不是乘以 2/);
    assert.equal(await cells.nth(2).getAttribute('data-s'), 'no'); assert.equal(await cells.nth(0).getAttribute('data-s'), 'ok');
    await cells.nth(2).fill('9'); await check('tbl');
    assert.match(await text('#tbl .sk-fb'), /平方是自己乘自己/);

    // Mark: a wrong pick is named, a missing one is counted, the keyboard works.
    await page.locator('#mk').scrollIntoViewIfNeeded();
    await page.click('#mk sk-hit >> nth=0'); await page.click('#mk sk-miss'); await check('mk');
    assert.match(await text('#mk .sk-fb'), /loudly 是副詞/);
    await page.click('#mk sk-miss'); await check('mk');
    assert.match(await text('#mk .sk-fb'), /還有 1 處/);
    await page.locator('#mk sk-hit >> nth=1').focus(); await page.keyboard.press('Enter'); await check('mk');
    assert.match(await text('#mk .sk-fb'), /sat 與 purred/);

    // Reflect: write first, then compare with the model and tick what was covered.
    await page.locator('#rf').scrollIntoViewIfNeeded();
    await page.click('#rf .sk-actions .sk-primary >> nth=0');
    assert.match(await text('#rf .sk-fb'), /先寫下你的想法/);
    assert.equal(await page.locator('#rf .sk-model').isVisible(), false);
    await page.fill('#rf textarea', '因為回復力與位移成正比，所以週期固定。');
    await page.click('#rf .sk-actions .sk-primary >> nth=0');
    assert.equal(await page.locator('#rf .sk-model').isVisible(), true);
    await page.click('#rf .sk-model .sk-opt >> nth=0');
    await page.click('#rf .sk-actions .sk-primary:visible');
    assert.match(await text('#rf .sk-fb'), /還有重點沒寫到/);
    await page.click('#rf .sk-model .sk-opt >> nth=1');
    await page.click('#rf .sk-actions .sk-primary:visible');
    assert.match(await text('#rf .sk-fb'), /完成。/);
    assert.ok(await sawEvent({ kind: 'answer', id: 'rf', correct: false, misconception: 'amplitude-period' }));

    // Flashcards: flip before rating, a card not known yet comes back.
    await page.locator('#fc').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#fc .sk-actions .sk-primary').isDisabled(), true);
    assert.match(await text('#fc .sk-flash'), /period/);
    await page.click('#fc .sk-flash'); assert.match(await text('#fc .sk-flash'), /週期/);
    await page.click('#fc .sk-actions .sk-btn:has-text("還不熟")');
    assert.match(await text('#fc .sk-flash'), /frequency/);
    await page.click('#fc .sk-flash'); await page.click('#fc .sk-actions .sk-primary');
    assert.match(await text('#fc .sk-flash'), /period/);
    await page.click('#fc .sk-flash'); await page.click('#fc .sk-actions .sk-primary');
    assert.match(await text('#fc .sk-fb'), /2 張都記得了.*1 次需要再看一遍/s);
    assert.ok(await sawEvent({ kind: 'observe', tag: 'fc-recalled' }));

    // Everything answered: the module reports its summary once, and nothing overflows sideways on a phone.
    assert.ok(await sawEvent({ kind: 'summary' }));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'no horizontal scroll at ' + viewport.width);
    assert.deepEqual(errors, []);
    await page.close();
    console.log('ok', viewport.width + 'x' + viewport.height);
  }
} finally { await browser.close(); }
