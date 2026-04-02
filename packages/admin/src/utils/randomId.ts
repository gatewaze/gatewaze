/**
 * Generates a random identifier string.
 *
 * @returns A random identifier string in the format 'tl-<alphanumeric>'.
 */
export function randomId(): string {
  // Generate a random alphanumeric string
  const randomString = Math.random().toString(36).substring(2, 11); // 9 characters
  // Get the current timestamp in base-36 format (last 4 characters)
  const timestampString = Date.now().toString(36).slice(-4);

  return `tl-${randomString}-${timestampString}`;
}
