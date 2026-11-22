import { expect, test } from 'vitest';
import { patchHtmlForIframe } from '@/lib/utils/iframe';
import { STUDY_KIT_CSS, STUDY_KIT_JS } from '@/lib/study-classroom/module-kit';
import { STUDY_LAB_CSS, STUDY_LAB_JS } from '@/lib/study-classroom/module-lab';

const identity = { token: 't', nonce: 'n' } as never;

test('adds the module kit once, only to pages built from its components', () => {
  const kit = '<!doctype html><html><head><title>m</title></head><body><sk-module heading="x"><sk-slider name="a"></sk-slider></sk-module></body></html>';
  const patched = patchHtmlForIframe(kit);
  expect(patched.split('data-study-kit').length - 1).toBe(2);
  expect(patched).toContain(STUDY_KIT_CSS.slice(0, 60));
  expect(patched).toContain(STUDY_KIT_JS.slice(0, 60));
  expect(patched.indexOf('data-study-kit')).toBeLessThan(patched.indexOf('<sk-module'));
  const plain = patchHtmlForIframe('<!doctype html><html><head></head><body><canvas id="c"></canvas></body></html>');
  expect(plain).not.toContain('data-study-kit');
  expect(patchHtmlForIframe(kit, identity)).toContain('data-study-kit');
});

test('adds the virtual lab only to pages that use <sk-lab>, after the kit it builds on', () => {
  const lab = '<!doctype html><html><head><title>m</title></head><body><sk-module><sk-lab><sk-item kind="beaker"></sk-item></sk-lab></sk-module></body></html>';
  const patched = patchHtmlForIframe(lab);
  expect(patched.split('data-study-kit').length - 1).toBe(4);
  expect(patched).toContain(STUDY_LAB_CSS.slice(0, 60));
  expect(patched).toContain(STUDY_LAB_JS.slice(0, 60));
  expect(patched.indexOf(STUDY_KIT_JS.slice(0, 60))).toBeLessThan(patched.indexOf(STUDY_LAB_JS.slice(0, 60)));
  expect(patched.indexOf(STUDY_LAB_JS.slice(0, 60))).toBeLessThan(patched.indexOf('<sk-module'));
  const noLab = patchHtmlForIframe('<!doctype html><html><head></head><body><sk-module></sk-module></body></html>');
  expect(noLab).not.toContain(STUDY_LAB_JS.slice(0, 60));
});
