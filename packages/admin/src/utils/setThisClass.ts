// @ts-nocheck
// Define the colors object with literal types.
const colors = {
  primary: "this:primary",
  secondary: "this:secondary",
  info: "this:info",
  success: "this:success",
  warning: "this:warning",
  error: "this:error",
} as const;

// Derive a union type of the keys.
export type ColorKey = keyof typeof colors;

/**
 * Returns the class name for the specified color.
 *
 * @param color - The color key to look up.
 * @returns The corresponding class name for the color.
 * @throws {Error} Throws an error if the color is not found in the color map.
 */
export function setThisClass(color: ColorKey): string {
  const className = colors[color];
  if (!className) {
    // This condition should never occur given the type, but is kept for runtime safety.
    throw new Error(`Color "${color}" not found in the color map.`);
  }
  return className;
}
