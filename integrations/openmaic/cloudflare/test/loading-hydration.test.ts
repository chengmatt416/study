import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('@/lib/study-classroom/tips', () => ({ tipAt: (index: number) => ['第一個提示', '第二個提示'][index] }));
import { StudyClassroomLoading } from '../overlay/components/study/StudyClassroomLoading';

it('renders the same initial loading text on the server and client before effects run', () => {
  const random = vi.spyOn(Math, 'random').mockReturnValue(0);
  try {
    const server = renderToString(createElement(StudyClassroomLoading));
    random.mockReturnValue(0.99);
    expect(renderToString(createElement(StudyClassroomLoading))).toBe(server);
    expect(server).toContain('第一個提示');
  } finally { random.mockRestore(); }
});
