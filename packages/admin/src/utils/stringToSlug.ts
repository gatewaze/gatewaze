/**
 * Converts a string into a URL-friendly slug.
 *
 * @param str - The input string to be converted to a slug.
 * @returns The resulting slug.
 * @throws {TypeError} If the input is not a string.
 */
export function stringToSlug(str: string): string {
  if (typeof str !== "string") {
    throw new TypeError("Input must be a string.");
  }

  let result = str.trim().toLowerCase();

  result = result.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  result = result
    .replace(/[^a-z0-9 -]/g, "") // Remove invalid characters.
    .replace(/\s+/g, "-") // Replace spaces with dashes.
    .replace(/-+/g, "-"); // Collapse consecutive dashes.

  return result;
}
