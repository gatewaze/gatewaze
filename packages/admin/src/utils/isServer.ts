/**
 * Checks if the code is running on the server side.
 *
 * @returns Returns `true` if running on the server, otherwise `false`.
 */
export const isServer =
  typeof window === "undefined" || typeof document === "undefined";
