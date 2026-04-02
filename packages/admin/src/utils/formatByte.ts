/**
 * Converts a number of bytes into a human-readable format (e.g., KB, MB, GB).
 *
 * @param The number of bytes to format.
 * @param The base value for the unit conversion (e.g., 1000 for decimal, 1024 for binary).
 * @param The number of decimal places to include in the formatted output.
 * @returns The formatted string with the appropriate size unit.
 * @throws If the input is not a valid number or is negative.
 */
export function formatBytes(
  bytes: number,
  base: number = 1000,
  precision: number = 2
): string {
  if (typeof bytes !== "number" || isNaN(bytes) || bytes < 0) {
    throw new Error("Input must be a non-negative number.");
  }
  if (typeof base !== "number" || base <= 0) {
    throw new Error("Base must be a positive number.");
  }
  if (typeof precision !== "number" || precision < 0) {
    throw new Error("Precision must be a non-negative number.");
  }

  if (bytes === 0) return "0 Bytes";

  const sizes = ["Bytes", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.floor(Math.log(bytes) / Math.log(base));

  return `${(bytes / Math.pow(base, i)).toFixed(precision)} ${sizes[i]}`;
}
