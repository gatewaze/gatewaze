/**
 * Ensures the input is a string. If the input is `null` or `undefined`, returns an empty string.
 *
 * @param The value to ensure as a string.
 * @returns The input value as a string, or an empty string if the input is `null` or `undefined`.
 */

export const ensureString = (val: unknown): string =>
  val == null ? "" : String(val);
