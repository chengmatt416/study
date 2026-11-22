import type { PracticeCursor, PracticeItem, PracticePage } from "../../../shared/practice";

export function createPracticeFeed<Lane>(
  fetchPage: (lane: Lane, cursor: PracticeCursor, signal: AbortSignal) => Promise<PracticePage>,
  plan: readonly Lane[],
) {
  const makeLanes = () => plan.map(lane => ({
    lane, cursor: { key: "", offset: 0 } as PracticeCursor | null, items: [] as PracticeItem[],
  }));
  let lanes = makeLanes();
  let turn = 0;
  let played = false;

  return async function next(signal: AbortSignal): Promise<PracticeItem | null> {
    for (;;) {
      signal.throwIfAborted();
      if (lanes.every(lane => !lane.cursor && !lane.items.length)) {
        lanes = makeLanes();
        if (!played) return null;
        played = false;
      }

      const lane = lanes[turn];
      if (!lane.items.length && lane.cursor) {
        const page = await fetchPage(lane.lane, lane.cursor, signal);
        signal.throwIfAborted();
        lane.cursor = page.next;
        lane.items = [...page.items];
      }
      turn = (turn + 1) % lanes.length;
      const item = lane.items.shift();
      if (item) {
        played = true;
        return item;
      }
    }
  };
}

export function bufferPracticeFeed(
  next: (signal: AbortSignal) => Promise<PracticeItem | null>,
  signal: AbortSignal,
  prepare: (item: PracticeItem) => void,
) {
  const buffer: PracticeItem[] = [];
  let pending: Promise<void> | null = null;
  let failure: { cause: unknown } | null = null;
  let ended = false;

  function prefetch() {
    if (pending || failure || ended || signal.aborted || buffer.length >= 3) return;
    pending = next(signal).then(item => {
      if (signal.aborted) return;
      if (item) {
        buffer.push(item);
        prepare(item);
      } else ended = true;
    }).catch(cause => {
      if (!signal.aborted) failure = { cause };
    }).finally(() => {
      pending = null;
      prefetch();
    });
  }

  function takeReady() {
    const item = buffer.shift();
    prefetch();
    return item;
  }

  async function take() {
    signal.throwIfAborted();
    if (!buffer.length) {
      prefetch();
      await pending;
    }
    signal.throwIfAborted();
    if (buffer.length) return takeReady()!;
    if (failure) {
      const { cause } = failure;
      failure = null;
      throw cause;
    }
    return null;
  }

  return { takeReady, take };
}
