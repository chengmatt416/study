import { expect, it } from 'vitest';
import { patchStudyCourseCompleteSlot } from '../patch-classroom.mjs';

const handler = `onClick={() => {
                    if (onSceneSelect) {
                      onSceneSelect(PENDING_SCENE_ID);
                    } else {
                      setCurrentSceneId(PENDING_SCENE_ID);
                    }
                  }}`;

it('closes the phone completion directory even when a generating row has the same pending-scene handler', () => {
  const generating = 'key={`generating-${outline.id}`}\n                  ' + handler;
  const complete = 'key="course-complete-slot"\n                  ' + handler;
  const patched = patchStudyCourseCompleteSlot(generating + '\n' + complete);
  expect(patched.slice(0, patched.indexOf('key="course-complete-slot"'))).toBe(generating + '\n');
  const target = patched.slice(patched.indexOf('key="course-complete-slot"'));
  expect(target).toContain('data-testid="scene-complete-item"');
  expect(target).toContain('onSceneSelect(PENDING_SCENE_ID)');
  expect(target).toContain('setCurrentSceneId(PENDING_SCENE_ID)');
  expect(target).toContain("if (window.matchMedia('(max-width: 700px), (max-height: 500px) and (pointer: coarse)').matches) onCollapseChange(true)");
  expect(target).toContain("event.key === 'Enter' || event.key === ' '");
});

it('fails preparation if the exact pinned completion target changes', () => {
  expect(() => patchStudyCourseCompleteSlot(handler)).toThrow('completion selection patch no longer matches');
});
