// Requires the prepared Core's Playwright installation and a Chromium browser.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH may select an existing browser executable.
import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const { chromium, expect } = await import(new URL('../../../../.openmaic/core/node_modules/@playwright/test/index.mjs', import.meta.url).href);
const vite = await createViteServer({ configFile: false, root, cacheDir: root + '.openmaic/qa/module-record-cache', server: { middlewareMode: true }, appType: 'custom' });
let kit, parseProgressUpdate;
try {
  ({ studyKitHead: kit } = await vite.ssrLoadModule('/src/shared/module-kit.ts'));
  ({ parseProgressUpdate } = await vite.ssrLoadModule('/src/shared/classroom-progress.ts'));
} finally { await vite.close(); }

const moduleBody = (manual = false) => '<sk-module heading="實驗紀錄"><sk-segmented name="mass" label="質量"><sk-option value="1">1 kg</sk-option><sk-option value="4">4 kg</sk-option></sk-segmented><sk-record id="readings" min="2"><sk-col name="mass" label="質量" unit="kg" low="0" high="10"' + (manual ? ' manual tol="0.5"' : '') + '></sk-col></sk-record></sk-module>';
const html = body => '<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + kit() + '</head><body>' + body + '</body></html>';
const host = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0"><iframe id="module" title="實驗模組" sandbox="allow-scripts" style="width:100%;height:95vh;border:0"></iframe><script>var saved=null,ready=null;addEventListener("message",async function(e){if(e.source!==document.querySelector("iframe").contentWindow)return;var d=e.data||{};if(d.source==="study-kit-state"){if(d.ready){ready=e.source;if(saved)ready.postMessage({type:"STUDY_KIT_RESTORE",state:saved},"*")}else if(d.state){var r=await fetch("/state",{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({module:{scene_id:"record-module",state:d.state}})});if(!r.ok)throw Error("state rejected");saved=d.state}}else if(d.source==="study-kit")await fetch("/event",{method:"POST",body:JSON.stringify(d.event)})});fetch("/state").then(r=>r.json()).then(s=>{saved=s;document.querySelector("iframe").src="/module"});</script></body></html>';
let saved = null, events = [], moduleMarkup = moduleBody(true);
const server = createHttpServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store');
  response.setHeader('content-type', 'text/html; charset=utf-8');
  if (request.url === '/state' && request.method === 'PUT') {
    let body = ''; for await (const chunk of request) body += chunk;
    const parsed = parseProgressUpdate(JSON.parse(body));
    if (typeof parsed === 'string') { response.writeHead(400); response.end(parsed); return; }
    saved = parsed.module.state; response.end('{}'); return;
  }
  if (request.url === '/state') { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(saved)); return; }
  if (request.url === '/event') {
    let body = ''; for await (const chunk of request) body += chunk;
    events.push(JSON.parse(body)); response.end('{}'); return;
  }
  response.end(request.url === '/host' ? host : html(request.url === '/module' ? moduleMarkup : moduleBody()));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = 'http://127.0.0.1:' + server.address().port;
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
try {
  for (const width of [1440, 390]) {
    saved = null; events = []; moduleMarkup = moduleBody(true);
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 700, isMobile: width < 700 });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(30000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/numeric');
    await page.getByRole('radio', { name: '4 kg' }).click();
    await page.getByRole('button', { name: '記錄這一筆' }).click();
    assert.deepEqual(await page.evaluate(() => window.StudyKit.records('readings')), [{ mass: 4 }]);
    for (const value of [0, ' 0 ', '-2.5', '1e2']) {
      await page.evaluate(value => { window.StudyKit.values.mass = value; }, value);
      await page.getByRole('button', { name: '記錄這一筆' }).click();
    }
    assert.deepEqual(await page.evaluate(() => window.StudyKit.records('readings').map(row => row.mass)), [4, 0, 0, -2.5, 100]);
    for (const value of [true, false, null, undefined, '', '   ', '4 kg', 'Infinity', Infinity, NaN, {}, []]) {
      await page.evaluate(value => { window.StudyKit.values.mass = value; }, value);
      await page.getByRole('button', { name: '記錄這一筆' }).click();
      assert.equal(await page.evaluate(() => window.StudyKit.records('readings').length), 5);
    }

    await page.goto(origin + '/host');
    const frame = page.frameLocator('#module');
    await frame.getByRole('radio', { name: '4 kg' }).click();
    await frame.getByRole('textbox', { name: '質量', exact: true }).fill('4');
    await frame.getByRole('button', { name: '記錄這一筆' }).click();
    await frame.getByRole('radio', { name: '1 kg' }).click();
    await frame.getByRole('textbox', { name: '質量', exact: true }).fill('3');
    await frame.getByRole('button', { name: '記錄這一筆' }).click();
    await expect.poll(() => saved?.c?.['sk-record-0']?.r).toEqual([[1, 4], [0, 3]]);
    const columnIdentity = structuredClone(saved.c['sk-record-0'].n);
    assert.ok(JSON.stringify(saved).length < 12000);
    const answerCount = events.filter(event => event.kind === 'answer').length;
    assert.equal(answerCount, 2);
    await page.reload();
    await expect(frame.locator('sk-record')).toContainText('已記錄 2 筆');
    assert.deepEqual(await frame.locator('body').evaluate(() => window.StudyKit.records('readings')), [{ mass: 4 }, { mass: 3 }]);
    assert.deepEqual(await frame.locator('tbody tr td:last-child').allTextContents(), ['✓ 合理', '✗ 檢查操作']);
    await page.waitForTimeout(1000);
    assert.equal(events.filter(event => event.kind === 'answer').length, answerCount);

    for (const [before, after] of [['name="mass" label="質量" unit=', 'name="temperature" label="質量" unit='], ['unit="kg"', 'unit="g"'], ['low="0"', 'low="-10"'], ['high="10"', 'high="20"'], ['tol="0.5"', 'tol="0.1"']]) {
      moduleMarkup = moduleBody(true).replace(before, after);
      await page.reload();
      await expect(frame.locator('sk-record')).toContainText('實驗欄位或檢核方式已更新');
      assert.deepEqual(await frame.locator('body').evaluate(() => window.StudyKit.records('readings')), []);
      assert.equal(events.filter(event => event.kind === 'answer').length, answerCount);
    }
    moduleMarkup = moduleBody(true);
    await page.reload(); await expect(frame.locator('sk-record')).toContainText('已記錄 2 筆');

    await frame.getByRole('button', { name: '刪除最後一筆' }).click();
    await expect.poll(() => saved?.c?.['sk-record-0']?.r).toEqual([[1, 4]]);
    await page.reload();
    await expect(frame.locator('sk-record')).toContainText('已記錄 1 筆');
    await frame.getByRole('button', { name: '刪除最後一筆' }).click();
    await expect.poll(() => saved?.c?.['sk-record-0']).toBeUndefined();
    await page.reload();
    await expect(frame.locator('sk-record')).toContainText('已記錄 0 筆');

    await page.evaluate(identity => document.querySelector('iframe').contentWindow.postMessage({ type: 'STUDY_KIT_RESTORE', state: { c: { 'sk-record-0': { n: identity, r: [[1, 4], [1, null], [1, '3'], [1, Infinity], [1, -1], [0, 2], [9, 5], 'invalid', [1, 4, 5]] } } } }, '*'), columnIdentity);
    await expect(frame.locator('sk-record')).toContainText('已記錄 3 筆');
    assert.deepEqual(await frame.locator('tbody tr td:last-child').allTextContents(), ['✓ 合理', '✗ 檢查操作', '✗ 檢查操作']);
    await page.evaluate(identity => document.querySelector('iframe').contentWindow.postMessage({ type: 'STUDY_KIT_RESTORE', state: { c: { 'sk-record-0': { n: identity, r: Array.from({ length: 100 }, () => [1, 4]) } } } }, '*'), columnIdentity);
    await expect(frame.locator('sk-record')).toContainText('已記錄 12 筆');
    await expect(frame.getByRole('button', { name: '記錄這一筆' })).toBeDisabled();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: numeric options, invalid readings, bounded reload recovery, validation history, delete/clear, and no signal replay`);
    await context.close();
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
