// Requires the prepared Core's Playwright browsers; optionally set PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const { chromium, webkit, expect } = await import(new URL('../../../../.openmaic/core/node_modules/@playwright/test/index.mjs', import.meta.url).href);
const css = await readFile(new URL('../overlay/components/study/classroom.css', import.meta.url), 'utf8');
for (const [engine, browserType] of [['chromium', chromium], ['webkit', webkit]]) {
  const browser = await browserType.launch({ headless: true, ...(engine === 'chromium' && process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: width < 700, isMobile: width < 700 });
      try {
        const page = await context.newPage();
        await page.setContent(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">
          <div id="app"><main style="visibility:visible;pointer-events:auto;transition:all .7s">
            <button id="old" style="visibility:visible;pointer-events:auto;transition:visibility 10s" onclick="window.oldClicks=(window.oldClicks||0)+1">Old lesson control</button>
            <iframe id="module" title="Old interactive module" style="visibility:visible;pointer-events:auto" srcdoc="<button>Old module control</button>"></iframe>
          </main><div class="study-session-expired" role="alert" tabindex="-1">Session expired. <a id="return" href="#reopen" onclick="window.returned=true">Return to STUDY</a></div></div>
        </body></html>`);
        await page.addStyleTag({ content: css });
        const old = page.locator('#old'), module = page.locator('#module');
        await expect(old).toBeVisible();
        const box = await old.boundingBox();
        await page.evaluate(() => { document.body.dataset.studySessionExpired = 'true'; document.querySelector('[role="alert"]').focus(); });
        assert.equal(await old.evaluate(element => getComputedStyle(element).visibility), 'hidden');
        assert.equal(await page.locator('main').evaluate(element => getComputedStyle(element).visibility), 'hidden');
        await expect(old).toBeHidden();
        await expect(module).toBeHidden();
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(page.getByRole('alert')).toBeFocused();
        assert.equal(await old.evaluate(element => getComputedStyle(element).pointerEvents), 'none');
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
        assert.equal(await page.evaluate(() => window.oldClicks || 0), 0);
        await page.getByRole('alert').focus();
        const tab = engine === 'webkit' ? 'Alt+Tab' : 'Tab';
        await page.keyboard.press(tab);
        await expect(page.locator('#return')).toBeFocused();
        for (const key of [tab, tab, engine === 'webkit' ? 'Alt+Shift+Tab' : 'Shift+Tab', 'Shift+Tab']) {
          await page.keyboard.press(key);
          assert.equal(await page.evaluate(() => ['old', 'module'].includes(document.activeElement?.id)), false);
        }
        await page.locator('#return')[width < 700 ? 'tap' : 'click']();
        assert.equal(await page.evaluate(() => window.returned), true);
        await page.evaluate(() => { delete document.body.dataset.studySessionExpired; });
        await expect(old).toBeVisible();
        await expect(module).toBeVisible();
        await old.click();
        assert.equal(await page.evaluate(() => window.oldClicks), 1);
        console.log(`PASS ${engine} ${width}px expired nested lesson/iframe hidden, pointer and keyboard blocked, return usable, normal view restored`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
