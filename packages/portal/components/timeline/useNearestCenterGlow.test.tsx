import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { useNearestCenterGlow } from './useNearestCenterGlow';

/**
 * The property under test is a performance one: the glow must measure only the
 * cards the IntersectionObserver reports as near the viewport, not every card
 * mounted. One date group on a busy brand can hold 30+ cards, and the previous
 * version called getBoundingClientRect on all of them on every scroll frame.
 *
 * The hook keeps module-level state shared by every card. Do NOT reset modules
 * between tests to isolate it — a fresh module registry gives the hook its own
 * React copy, which renders nothing. Unmounting is what resets the state: the
 * registration cleanup removes the card from both sets.
 */

type IORecord = { target: Element; isIntersecting: boolean };

const ioCallbacks: Array<(records: IORecord[]) => void> = [];
let observed: Element[] = [];
let rafQueue: FrameRequestCallback[] = [];

function flushFrames() {
  // Draining can enqueue more frames; cap it so a bug cannot hang the suite.
  for (let i = 0; i < 10 && rafQueue.length > 0; i++) {
    const queued = rafQueue;
    rafQueue = [];
    for (const cb of queued) cb(performance.now());
  }
}

function fireIntersections(records: IORecord[]) {
  for (const cb of ioCallbacks) cb(records);
}

beforeAll(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(cb: (records: IORecord[]) => void) {
        ioCallbacks.push(cb);
      }
      observe(el: Element) {
        observed.push(el);
      }
      unobserve(el: Element) {
        observed = observed.filter((e) => e !== el);
      }
      disconnect() {
        observed = [];
      }
      takeRecords() {
        return [];
      }
    },
  );

  // The hook only engages below 820px, so report a phone.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width: 820px'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));

  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
});

beforeEach(() => {
  rafQueue = [];
  observed = [];
});

afterEach(() => {
  cleanup();
  flushFrames();
});

function Card({ index }: { index: number }) {
  const { ref, active } = useNearestCenterGlow<HTMLDivElement>();
  return <div ref={ref} data-testid={`card-${index}`} data-active={active ? 'yes' : 'no'} />;
}

/**
 * Renders one card per entry in `tops`, each reporting a 200px-tall rect at
 * that viewport offset, and returns a getBoundingClientRect spy per card.
 * jsdom's window.innerHeight is 768, so the centre line is at 384.
 */
function renderCards(tops: number[]) {
  const view = render(
    <>
      {tops.map((_, i) => (
        <Card key={i} index={i} />
      ))}
    </>,
  );
  const rectSpies = tops.map((top, i) => {
    const el = view.getByTestId(`card-${i}`);
    const spy = vi.fn(() => ({
      top,
      bottom: top + 200,
      left: 0,
      right: 0,
      width: 0,
      height: 200,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }));
    el.getBoundingClientRect = spy as unknown as Element['getBoundingClientRect'];
    return spy;
  });
  return { view, rectSpies };
}

describe('useNearestCenterGlow', () => {
  it('observes every card it registers', () => {
    renderCards([0, 300, 600]);
    expect(observed).toHaveLength(3);
  });

  it('measures only the cards the observer reports as nearby', () => {
    const { view, rectSpies } = renderCards([0, 300, 5000]);
    rectSpies.forEach((s) => s.mockClear());

    act(() => {
      fireIntersections([{ target: view.getByTestId('card-1'), isIntersecting: true }]);
      window.dispatchEvent(new Event('scroll'));
      flushFrames();
    });

    expect(rectSpies[1]).toHaveBeenCalled();
    expect(rectSpies[0]).not.toHaveBeenCalled();
    expect(rectSpies[2]).not.toHaveBeenCalled();
  });

  it('lights the nearby card closest to the viewport centre', () => {
    const { view } = renderCards([0, 300, 700]);

    act(() => {
      fireIntersections([
        { target: view.getByTestId('card-0'), isIntersecting: true },
        { target: view.getByTestId('card-1'), isIntersecting: true },
        { target: view.getByTestId('card-2'), isIntersecting: true },
      ]);
      window.dispatchEvent(new Event('scroll'));
      flushFrames();
    });

    // card-1 spans 300..500 and straddles the 384 centre line, so distance 0.
    expect(view.getByTestId('card-1').dataset.active).toBe('yes');
    expect(view.getByTestId('card-0').dataset.active).toBe('no');
    expect(view.getByTestId('card-2').dataset.active).toBe('no');
  });

  it('stops measuring a card once the observer says it left the band', () => {
    const { view, rectSpies } = renderCards([300, 900]);

    act(() => {
      fireIntersections([
        { target: view.getByTestId('card-0'), isIntersecting: true },
        { target: view.getByTestId('card-1'), isIntersecting: true },
      ]);
      flushFrames();
    });
    rectSpies.forEach((s) => s.mockClear());

    act(() => {
      fireIntersections([{ target: view.getByTestId('card-0'), isIntersecting: false }]);
      window.dispatchEvent(new Event('scroll'));
      flushFrames();
    });

    expect(rectSpies[0]).not.toHaveBeenCalled();
    expect(rectSpies[1]).toHaveBeenCalled();
  });

  it('lights nothing while the observer reports no nearby cards', () => {
    const { view } = renderCards([5000, 6000]);

    act(() => {
      window.dispatchEvent(new Event('scroll'));
      flushFrames();
    });

    expect(view.getByTestId('card-0').dataset.active).toBe('no');
    expect(view.getByTestId('card-1').dataset.active).toBe('no');
  });

  it('unobserves a card when it unmounts', () => {
    const { view } = renderCards([0, 300]);
    expect(observed).toHaveLength(2);

    act(() => {
      view.unmount();
      flushFrames();
    });
    expect(observed).toHaveLength(0);
  });

  it('keeps the per-frame measurement count at the nearby set, not the mounted set', () => {
    // 30 cards mounted, as one busy date group would produce; 2 near the centre.
    const tops = Array.from({ length: 30 }, (_, i) => i * 300);
    const { view, rectSpies } = renderCards(tops);
    rectSpies.forEach((s) => s.mockClear());

    act(() => {
      fireIntersections([
        { target: view.getByTestId('card-1'), isIntersecting: true },
        { target: view.getByTestId('card-2'), isIntersecting: true },
      ]);
      window.dispatchEvent(new Event('scroll'));
      flushFrames();
    });

    const measured = rectSpies.filter((s) => s.mock.calls.length > 0).length;
    expect(measured).toBe(2);
  });
});
