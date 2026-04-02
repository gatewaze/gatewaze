/**
 * Capitalizes the first character of a string and converts the rest of the string to lowercase.
 *
 * @param s - The string to capitalize.
 * @returns The capitalized string, or an empty string if the input is falsy.
 *
 */
export const capitalize = (s: string) => {
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : "";
};
