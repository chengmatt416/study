// Renew only an authenticated, currently open classroom. Hidden tabs do not extend sessions.
export function keepClassroomSession(classroom: string, expired: () => void): () => void {
  let stopped = false, pending = false, next = 0, refocus = false;
  let active: AbortController | undefined;
  const refresh = async () => {
    if (stopped || pending || document.visibilityState === 'hidden' || Date.now() < next) return;
    pending = true;
    active = new AbortController();
    try {
      const response = await fetch('/api/openmaic/live/session/refresh', {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ classroom_id: classroom }), signal: AbortSignal.any([active.signal, AbortSignal.timeout(15_000)]),
      });
      if (stopped) return;
      if ([401, 403, 409].includes(response.status)) { stopped = true; expired(); }
      next = Date.now() + (response.ok ? 5 * 60_000 : 30_000);
    } catch { next = Date.now() + 30_000; }
    finally {
      pending = false; active = undefined;
      if (refocus && !stopped) { refocus = false; next = 0; void refresh(); }
    }
  };
  const timer = setInterval(() => { void refresh(); }, 30_000);
  const resume = () => { void refresh(); };
  const focus = () => { next = 0; refocus = pending; void refresh(); };
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('online', resume);
  window.addEventListener('focus', focus);
  void refresh();
  return () => {
    stopped = true; active?.abort(); clearInterval(timer);
    document.removeEventListener('visibilitychange', resume);
    window.removeEventListener('online', resume);
    window.removeEventListener('focus', focus);
  };
}
