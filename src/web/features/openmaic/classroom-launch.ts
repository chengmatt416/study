// Opens a classroom without leaving the page until it is actually ready. The slow part is the first request to the
// classroom service (it starts up), so it happens here, behind a progress screen that tells the truth, and the browser
// only navigates once the service is awake and the lesson has been read.
export interface LaunchSession { action: string; ticket: string; classroom_id: string }
export const LAUNCH_STEPS = ['確認課堂', '準備學習環境', '連線到課堂', '載入教材', '開始學習'] as const;
type Fetch = typeof fetch;

/** Sets the classroom session cookie and reads the stored lesson once. Returns false when the page should fall back to a normal form post. */
export async function enterClassroomQuietly(session: LaunchSession, onStep: (step: number) => void, fetchImpl: Fetch = fetch, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted();
  try {
    const response = await fetchImpl(session.action, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ ticket: session.ticket }), redirect: 'manual', credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90_000)]) : AbortSignal.timeout(90_000) });
    signal?.throwIfAborted();
    // A manual redirect shows up as an opaque response with status 0, or as the 303 itself.
    if (response.status === 401 || response.status === 403) throw new ClassroomLaunchError('課堂登入已失效，請重新開啟課堂。');
    if (response.status >= 400) throw new ClassroomLaunchError('課堂服務暫時無法連線，請重試。');
    if (!(response.type === 'opaqueredirect' || response.status === 303 || response.ok)) return false;
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof ClassroomLaunchError) throw error;
    return false;
  }
  onStep(3);
  try {
    const stage = await fetchImpl(`/api/stages/${encodeURIComponent(session.classroom_id)}`, { credentials: 'same-origin', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45_000)]) : AbortSignal.timeout(45_000) });
    await stage.body?.cancel();
  } catch { /* The classroom reads it again itself; this only warms it. */ }
  signal?.throwIfAborted();
  onStep(4);
  return true;
}

class ClassroomLaunchError extends Error {}

interface LaunchActions {
  prepare: () => Promise<void>;
  navigate: (path: string) => void;
  form: (session: LaunchSession) => void;
  enter?: typeof enterClassroomQuietly;
  isCurrent?: () => boolean;
}

/** Cancellation remains effective even when an earlier browser operation cannot itself be aborted. */
export async function runClassroomLaunch(getSession: (signal: AbortSignal) => Promise<LaunchSession>, onStep: (step: number) => void, signal: AbortSignal, actions: LaunchActions): Promise<void> {
  const ensureCurrent = () => {
    signal.throwIfAborted();
    if (actions.isCurrent?.() === false) throw new DOMException('The lesson page changed', 'AbortError');
  };
  ensureCurrent();
  const session = await getSession(signal);
  ensureCurrent();
  onStep(1);
  await actions.prepare();
  ensureCurrent();
  onStep(2);
  const ready = await (actions.enter ?? enterClassroomQuietly)(session, onStep, fetch, signal);
  ensureCurrent();
  if (ready) actions.navigate(`/classroom/${encodeURIComponent(session.classroom_id)}`);
  else actions.form(session);
}

/** Form post fallback: the browser itself follows the redirect. */
export function submitSessionForm(session: LaunchSession) {
  const form = document.createElement('form');
  form.method = 'POST'; form.action = session.action;
  const ticket = document.createElement('input'); ticket.type = 'hidden'; ticket.name = 'ticket'; ticket.value = session.ticket; form.append(ticket);
  document.body.append(form); form.submit(); form.remove();
}

/** Tell the server to start the classroom service while the learner is still reading the course page. */
export function warmClassroom(slug: string, post: (path: string, body: unknown) => Promise<unknown>): Promise<unknown> {
  return post('/api/openmaic/warm', { note_slug: slug }).catch(() => undefined);
}
