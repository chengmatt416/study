// Activating the routing update before entering avoids an older STUDY SW
// answering the new Next.js classroom URL with the SPA shell.
export async function prepareClassroomServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    await registration.update();
    const installing = registration.installing;
    if (installing) await new Promise<void>(resolve => {
      const timer = setTimeout(finish, 8000);
      function finish() { clearTimeout(timer); installing!.removeEventListener('statechange', changed); resolve(); }
      function changed() { if (['installed', 'activated', 'redundant'].includes(installing!.state)) finish(); }
      installing.addEventListener('statechange', changed);
      changed();
    });
    if (registration.waiting) await new Promise<void>(resolve => {
      const waiting = registration.waiting!;
      const timer = setTimeout(finish, 8000);
      function finish() { clearTimeout(timer); waiting.removeEventListener('statechange', changed); resolve(); }
      function changed() { if (['activated', 'redundant'].includes(waiting.state)) finish(); }
      waiting.addEventListener('statechange', changed);
      waiting.postMessage({ type: 'SKIP_WAITING' });
      changed();
    });
  } catch {
    // A fresh online classroom still works when SW is unavailable.
  }
}
