import {
  centeredScrollTop,
  createScrollMemory,
  createThrottledScrollSaver,
  isFullyVisible,
  revealScrollTop,
  SCROLL_STORE_KEY,
  type StorageLike,
} from '../docs/.vitepress/theme/sidebar-scroll.js';

function fakeStorage(initial: Record<string, string> = {}): StorageLike & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('createScrollMemory', () => {
  test('saves and returns per-route positions', () => {
    const memory = createScrollMemory(fakeStorage());
    memory.save('api/modules/ts/aws-cdk-lib/aws-sqs/Queue', 340);
    memory.save('api/modules/ts/aws-cdk-lib/aws-sns/Topic', 12);
    expect(memory.get('api/modules/ts/aws-cdk-lib/aws-sqs/Queue')).toBe(340);
    expect(memory.get('api/modules/ts/aws-cdk-lib/aws-sns/Topic')).toBe(12);
    expect(memory.get('api/modules/ts/aws-cdk-lib/aws-s3/Bucket')).toBeUndefined();
  });

  test('re-saving a route overwrites its position', () => {
    const memory = createScrollMemory(fakeStorage());
    memory.save('api', 100);
    memory.save('api', 250);
    expect(memory.get('api')).toBe(250);
  });

  test('persists to storage and is readable by a fresh instance (page reload)', () => {
    const storage = fakeStorage();
    createScrollMemory(storage).save('api/x', 77);
    expect(createScrollMemory(storage).get('api/x')).toBe(77);
  });

  test('works without storage (in-memory only)', () => {
    const memory = createScrollMemory(undefined);
    memory.save('api/x', 5);
    expect(memory.get('api/x')).toBe(5);
  });

  test('tolerates corrupt stored JSON by starting fresh', () => {
    const memory = createScrollMemory(fakeStorage({ [SCROLL_STORE_KEY]: '{not json' }));
    expect(memory.get('api/x')).toBeUndefined();
    memory.save('api/x', 9);
    expect(memory.get('api/x')).toBe(9);
  });

  test('ignores malformed entries in stored JSON', () => {
    const raw = JSON.stringify([['api/ok', 3], 'junk', ['api/bad', 'NaN'], [7, 8]]);
    const memory = createScrollMemory(fakeStorage({ [SCROLL_STORE_KEY]: raw }));
    expect(memory.get('api/ok')).toBe(3);
    expect(memory.get('api/bad')).toBeUndefined();
  });

  test('tolerates a throwing storage (private mode / quota) in memory', () => {
    const throwing: StorageLike = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    const memory = createScrollMemory(throwing);
    memory.save('api/x', 42);
    expect(memory.get('api/x')).toBe(42);
  });

  test('evicts the least-recently-saved routes past the cap', () => {
    const memory = createScrollMemory(fakeStorage(), SCROLL_STORE_KEY, 3);
    memory.save('a', 1);
    memory.save('b', 2);
    memory.save('c', 3);
    memory.save('a', 10); // refresh recency of a
    memory.save('d', 4); // evicts b (oldest)
    expect(memory.get('b')).toBeUndefined();
    expect(memory.get('a')).toBe(10);
    expect(memory.get('c')).toBe(3);
    expect(memory.get('d')).toBe(4);
  });
});

describe('centeredScrollTop', () => {
  test('centers the item within the container', () => {
    // item at 1000 in content coords, 20px tall, 500px container:
    // top = 1000 - (500 - 20) / 2 = 760
    expect(centeredScrollTop(1000, 20, 500)).toBe(760);
  });

  test('clamps to 0 for items near the top', () => {
    expect(centeredScrollTop(30, 20, 500)).toBe(0);
  });

  test('rounds to a whole pixel', () => {
    expect(Number.isInteger(centeredScrollTop(100.7, 21, 501))).toBe(true);
    expect(Number.isInteger(centeredScrollTop(999.5, 20.5, 480.25))).toBe(true);
  });
});

describe('isFullyVisible', () => {
  const container = { top: 0, bottom: 900, height: 900 };

  test('an item inside the container is visible', () => {
    expect(isFullyVisible({ top: 100, bottom: 120, height: 20 }, container)).toBe(true);
  });

  test('an item past either edge is not visible', () => {
    expect(isFullyVisible({ top: -10, bottom: 10, height: 20 }, container)).toBe(false);
    expect(isFullyVisible({ top: 890, bottom: 910, height: 20 }, container)).toBe(false);
  });

  test('pure geometry: it does NOT judge whether the item has a box', () => {
    // Deliberate. A zero-size rect at the origin IS contained by a container
    // starting at y=0, and that is the correct answer to the containment
    // question — which is why revealScrollTop, not this, owns the "has a
    // box at all" check.
    expect(isFullyVisible({ top: 0, bottom: 0, height: 0 }, container)).toBe(true);
  });

  test('a container that starts below the viewport top still works', () => {
    const lower = { top: 64, bottom: 800, height: 736 };
    expect(isFullyVisible({ top: 100, bottom: 120, height: 20 }, lower)).toBe(true);
    expect(isFullyVisible({ top: 10, bottom: 30, height: 20 }, lower)).toBe(false);
  });
});

describe('revealScrollTop', () => {
  const container = { top: 64, bottom: 564, height: 500 };

  test('an off-screen item yields a centering target', () => {
    // 1000px down the content, 20px tall, 500px container -> 760 (centered).
    expect(revealScrollTop({ top: 1064, bottom: 1084, height: 20 }, container, true, 0, 500)).toBe(760);
  });

  test('an already-visible item yields no scroll', () => {
    expect(revealScrollTop({ top: 100, bottom: 120, height: 20 }, container, true, 0, 500)).toBeNull();
  });

  test('a NOT-laid-out item yields no scroll at all', () => {
    // The failure mode this pins: a `display: none` entry reports {0,0,0}, and
    // falling through to the centering maths would compute a target from
    // that meaningless rect and jump the sidebar somewhere unrelated. An
    // entry with no box cannot be scrolled to — only re-attempted later.
    expect(revealScrollTop({ top: 0, bottom: 0, height: 0 }, container, false, 8785, 500)).toBeNull();
  });

  test('zero height yields no scroll even if the caller claims it is laid out', () => {
    expect(revealScrollTop({ top: 0, bottom: 0, height: 0 }, container, true, 8785, 500)).toBeNull();
  });

  test('the no-scroll answer does not depend on the container being hidden too', () => {
    // The drawer case hides the container as well, so a bogus target collapses
    // back to the current scrollTop and the bug stays invisible there. A
    // collapsed group inside a laid-out container is the reachable case.
    expect(revealScrollTop({ top: 0, bottom: 0, height: 0 }, container, false, 1234, 500)).toBeNull();
  });
});

describe('createThrottledScrollSaver', () => {
  /**
   * A frame that runs only when the test says so. `run` returns the flushes it
   * invoked, so a test can invoke the same one again.
   */
  function fakeFrame() {
    const queued: (() => void)[] = [];
    return {
      schedule: (flush: () => void) => void queued.push(flush),
      pending: () => queued.length,
      run: () => {
        const due = queued.splice(0);
        for (const flush of due) flush();
        return due;
      },
    };
  }

  test('saves nothing until the frame runs, then saves once', () => {
    const saved: [string, number][] = [];
    const frame = fakeFrame();
    const record = createThrottledScrollSaver((p, t) => void saved.push([p, t]), frame.schedule);

    record('api/x', 10);
    expect(saved).toEqual([]);
    expect(frame.pending()).toBe(1);

    frame.run();
    expect(saved).toEqual([['api/x', 10]]);
  });

  test('coalesces a burst into one save carrying the last pair', () => {
    const saved: [string, number][] = [];
    const frame = fakeFrame();
    const record = createThrottledScrollSaver((p, t) => void saved.push([p, t]), frame.schedule);

    record('api/x', 10);
    record('api/x', 40);
    record('api/x', 90);
    // One frame scheduled for the whole burst, not three.
    expect(frame.pending()).toBe(1);

    frame.run();
    expect(saved).toEqual([['api/x', 90]]);
  });

  // The failure this shape exists to prevent. The route can change between
  // the scroll event and the frame; because the caller hands
  // over VALUES, the save can only ever land under the route that was current
  // when the position was read. An implementation that re-read the route (or
  // the position) at flush time would file 10 under 'api/incoming' here, and
  // on a history traversal that overwrites the position the incoming route is
  // about to be restored to.
  test('a route change before the frame cannot re-target the pending save', () => {
    const saved: [string, number][] = [];
    const frame = fakeFrame();
    const record = createThrottledScrollSaver((p, t) => void saved.push([p, t]), frame.schedule);

    let currentRoute = 'api/outgoing';
    record(currentRoute, 10);
    currentRoute = 'api/incoming';

    frame.run();
    expect(saved).toEqual([['api/outgoing', 10]]);
    expect(currentRoute).toBe('api/incoming');
  });

  test('a later burst schedules a fresh frame', () => {
    const saved: [string, number][] = [];
    const frame = fakeFrame();
    const record = createThrottledScrollSaver((p, t) => void saved.push([p, t]), frame.schedule);

    record('api/x', 10);
    frame.run();
    record('api/y', 20);
    expect(frame.pending()).toBe(1);
    frame.run();

    expect(saved).toEqual([['api/x', 10], ['api/y', 20]]);
  });

  // Invokes the SAME flush a second time, which is why `pending` is cleared as
  // the frame runs: without that, the stale pair would be saved again.
  test('re-invoking a spent flush does not re-save the pair', () => {
    const saved: [string, number][] = [];
    const frame = fakeFrame();
    const record = createThrottledScrollSaver((p, t) => void saved.push([p, t]), frame.schedule);

    record('api/x', 10);
    const [flush] = frame.run();
    expect(saved).toEqual([['api/x', 10]]);

    flush();
    expect(saved).toEqual([['api/x', 10]]);
  });
});
