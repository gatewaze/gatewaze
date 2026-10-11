/**
 * Geometry the timeline virtualizer's size estimate depends on.
 *
 * A virtual item in `<TimelineContent>` is a whole DATE, not a card, and a date
 * can be busy: techtickets carries 1163 upcoming events over 229 dates, a mean
 * of 5.1 per date and a maximum of 32. A flat per-group estimate is therefore
 * out by over 10x on the biggest dates, and because group heights are measured
 * after mount, every correction shifts the offsets of all later groups while
 * the user is scrolling.
 *
 * The numbers below mirror Tailwind classes in `EventTimelineGroup` and
 * `EventTimelineCard`. If those classes change, update these, or the estimate
 * drifts and groups re-measure more than they need to.
 */

import { CARD_IMAGE_WIDTH, CARD_IMAGE_HEIGHT } from './cardImage';

/** Tailwind's `sm` breakpoint, where the card switches to its fixed height. */
export const SM_BREAKPOINT_PX = 640;
/** `sm:h-44` on the card wrapper. */
export const DESKTOP_CARD_HEIGHT = 176;
/** `space-y-3` between cards within a group. */
export const CARD_GAP_PX = 12;
/** Date header plus its `mb-3`, plus the group's `pb-8`. */
export const GROUP_CHROME_HEIGHT = 72;
/** The group's `w-6` timeline column plus its `gap-4`. */
export const MOBILE_TIMELINE_GUTTER_PX = 40;
/** Title, meta rows and padding below a stacked card's image on a phone. */
export const MOBILE_CARD_TEXT_HEIGHT = 112;

/**
 * Height of a single card.
 *
 * From `sm` up the card is a fixed `h-44`. Below it the card stacks, so its
 * height is the image box (the normalised 640x336 ratio applied to the content
 * column's width) plus the text block underneath.
 */
export function cardHeightFor(groupWidth: number, isDesktop: boolean): number {
  if (isDesktop) return DESKTOP_CARD_HEIGHT;
  const contentWidth = Math.max(0, groupWidth - MOBILE_TIMELINE_GUTTER_PX);
  const imageHeight = Math.round((contentWidth * CARD_IMAGE_HEIGHT) / CARD_IMAGE_WIDTH);
  return imageHeight + MOBILE_CARD_TEXT_HEIGHT;
}

/** Estimated height of one date group holding `eventCount` cards. */
export function estimateGroupHeight(eventCount: number, cardHeight: number): number {
  // A group always renders its header, and renders at least one card even when
  // the count is somehow 0, so the floor is one card rather than none.
  const count = Math.max(1, eventCount);
  return GROUP_CHROME_HEIGHT + count * cardHeight + (count - 1) * CARD_GAP_PX;
}
