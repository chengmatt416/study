import { afterEach, expect, it, vi } from 'vitest';
import { prepareClassroomServiceWorker } from '../src/web/features/openmaic/service-worker';

afterEach(() => vi.unstubAllGlobals());
it('進入原生課堂前啟用等待中的 SW，避免舊 SPA fallback 攔截', async () => {
  class WaitingWorker extends EventTarget {
    state = 'installed';
    postMessage = vi.fn((message: unknown) => {
      expect(message).toEqual({ type: 'SKIP_WAITING' });
      queueMicrotask(() => { this.state = 'activated'; this.dispatchEvent(new Event('statechange')); });
    });
  }
  const waiting = new WaitingWorker();
  const registration = { update: vi.fn(async () => {}), installing: null, waiting };
  const register = vi.fn(async () => registration);
  vi.stubGlobal('navigator', { serviceWorker: { register } });
  await prepareClassroomServiceWorker();
  expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  expect(registration.update).toHaveBeenCalledOnce();
  expect(waiting.postMessage).toHaveBeenCalledOnce();
  expect(waiting.state).toBe('activated');
});
it('瀏覽器未支援 SW 時仍可開啟線上課堂', async () => {
  vi.stubGlobal('navigator', {});
  await expect(prepareClassroomServiceWorker()).resolves.toBeUndefined();
});
it('SW 更新不可用時不使課堂開啟流程拋出錯誤', async () => {
  vi.stubGlobal('navigator', { serviceWorker: { register: vi.fn(async () => { throw new Error('SW unavailable'); }) } });
  await expect(prepareClassroomServiceWorker()).resolves.toBeUndefined();
});
