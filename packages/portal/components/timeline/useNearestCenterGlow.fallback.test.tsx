import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import { useNearestCenterGlow } from './useNearestCenterGlow';

/**
 * Without IntersectionObserver there is no nearby set to filter by, so the hook
 * must fall back to measuring every registered card. That is the behaviour this
 * change replaced: slower, but it still lights the right card.
 *
 * This lives in its own file because vitest gives each test file a fresh module
 * registry, which is the only way the hook's lazily created observer can be
 * absent. The sibling file covers the observer-present path.
 */

let rafQueue: FrameRequestCallback[] = [];

function flushFrames() {
  for (let i = 0; i < 10 && rafQueue.length > 0; i++) {
    const queued = rafQueue;
    rafQueue = [];
    for (const cb of queued) cb(performance.now());
  }
}

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', undefined);
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
});

afterEach(() => {
  cleanup();
  flushFrames();
});

function Card({ index }: { index: number }) {
  const { ref, active } = useNearestCenterGlow<HTMLDivElement>();
  return <div ref={ref} data-testid={`card-${index}`} data-active={active ? 'yes' : 'no'} />;
}

describe('useNearestCenterGlow without IntersectionObserver', () => {
  it('measures every registered card and still lights the nearest to centre', () => {
    const tops = [0, 300, 700];
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
    rectSpies.forEach((s) => s.mockClear());

    act(() => {
      window.dispatchEvent(new Event('scroll'));
      flushFrames();
    });

    expect(rectSpies[0]).toHaveBeenCalled();
    expect(rectSpies[1]).toHaveBeenCalled();
    expect(rectSpies[2]).toHaveBeenCalled();
    // jsdom's innerHeight is 768, so the centre is 384 and card-1 straddles it.
    expect(view.getByTestId('card-1').dataset.active).toBe('yes');
  });
});
