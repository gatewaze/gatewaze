import { isServer } from "../isServer";

/**
 * Calculates the width of the scrollbar combined with the right padding of the document body.
 * This is useful for layout adjustments when a scrollbar is present.
 *
 * @returns {number} The total width of the scrollbar plus the right padding.
 */
export function getScrollbarWidth(): number {
  if (isServer) return 0;

  const computedStyle = window.getComputedStyle(document.body);
  const paddingRight = parseInt(computedStyle.paddingRight, 10);
  const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

  return paddingRight + scrollbarWidth;
}
