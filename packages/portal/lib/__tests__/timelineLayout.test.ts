import { describe, it, expect } from 'vitest';
import {
  cardHeightFor,
  estimateGroupHeight,
  DESKTOP_CARD_HEIGHT,
  GROUP_CHROME_HEIGHT,
  CARD_GAP_PX,
  MOBILE_CARD_TEXT_HEIGHT,
} from '../timelineLayout';

describe('cardHeightFor', () => {
  it('is the fixed sm:h-44 height on desktop, whatever the width', () => {
    expect(cardHeightFor(1200, true)).toBe(DESKTOP_CARD_HEIGHT);
    expect(cardHeightFor(320, true)).toBe(DESKTOP_CARD_HEIGHT);
  });

  it('derives the mobile height from the 640x336 image ratio plus the text block', () => {
    // 390px phone: content column 390 - 40 = 350, image 350 * 336/640 = 184.
    expect(cardHeightFor(390, false)).toBe(184 + MOBILE_CARD_TEXT_HEIGHT);
  });

  it('grows with the column width on mobile', () => {
    expect(cardHeightFor(430, false)).toBeGreaterThan(cardHeightFor(360, false));
  });

  it('never returns less than the text block, even at zero width', () => {
    expect(cardHeightFor(0, false)).toBe(MOBILE_CARD_TEXT_HEIGHT);
    expect(cardHeightFor(10, false)).toBeGreaterThanOrEqual(MOBILE_CARD_TEXT_HEIGHT);
  });
});

describe('estimateGroupHeight', () => {
  it('counts the chrome plus one card for a single-event date', () => {
    expect(estimateGroupHeight(1, 200)).toBe(GROUP_CHROME_HEIGHT + 200);
  });

  it('adds a gap between every pair of cards, not after the last', () => {
    expect(estimateGroupHeight(3, 200)).toBe(GROUP_CHROME_HEIGHT + 600 + 2 * CARD_GAP_PX);
  });

  it('scales with the event count', () => {
    // This is the whole point: the previous flat 480px estimate was wrong by
    // over 10x on techtickets' busiest date, which holds 32 events.
    const busy = estimateGroupHeight(32, 200);
    expect(busy).toBeGreaterThan(6000);
    expect(busy / 480).toBeGreaterThan(10);
  });

  it('is monotonic in the event count', () => {
    const heights = [1, 2, 5, 10, 32].map((n) => estimateGroupHeight(n, 200));
    expect(heights).toEqual([...heights].sort((a, b) => a - b));
  });

  it('treats a zero or negative count as one card rather than collapsing', () => {
    expect(estimateGroupHeight(0, 200)).toBe(GROUP_CHROME_HEIGHT + 200);
    expect(estimateGroupHeight(-3, 200)).toBe(GROUP_CHROME_HEIGHT + 200);
  });
});
