import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { StudyAppProvider } from '../overlay/components/study/StudyAppContext';
import { StudyNextSteps } from '../overlay/components/study/StudyNextSteps';
import { StudyContentsGuard } from '../overlay/components/study/StudyContentsGuard';

it('offers ordinary app navigation outside sandboxed content only when STUDY hosts the classroom', () => {
  const render = (hosted: boolean) => renderToStaticMarkup(createElement(StudyAppProvider, { hosted, children: createElement(StudyNextSteps, { complete: true }) }));
  const standalone = render(false);
  expect(standalone).not.toContain('href="/decks"'); expect(standalone).not.toContain('href="/exams"');
  expect(standalone).toContain('返回首頁'); expect(standalone).toContain('已到課程最後一頁');
  const html = render(true);
  expect(html).toContain('aria-label="課後學習"');
  expect(html).toContain('href="/decks"'); expect(html).toContain('href="/exams"'); expect(html).toContain('href="/"');
  expect(html).not.toContain('target="_top"');
});

it('keeps an initially open directory safe to render without browser globals', () => {
  expect(renderToStaticMarkup(createElement(StudyContentsGuard, { open: true, onClose: () => {} }))).toBe('');
});
