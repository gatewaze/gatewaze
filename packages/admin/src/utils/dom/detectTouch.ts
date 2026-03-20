import { isServer } from "../isServer";

/**
 * Detects if the device supports touch events.
 *
 * @returns {boolean} True if touch events are supported, otherwise false.
 */
export function detectTouch(): boolean {
  if (isServer) return false;

  return (
    window.ontouchstart === null &&
    window.ontouchmove === null &&
    window.ontouchend === null
  );
}
