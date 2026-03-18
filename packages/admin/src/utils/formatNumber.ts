/**
 * Formats a number into a human-readable format with suffixes (e.g., "k", "M", "B", "T").
 *
 * @param The number to format.
 * @param The number of decimal places to include in the formatted output.
 * @returns The formatted number with the appropriate suffix.
 * @throws If `num` is not a number or `precision` is not a valid non-negative number.
 */
export function formatNumber(num: number, precision: number = 2): string {
  if (typeof num !== "number" || isNaN(num)) {
    throw new Error("Input must be a valid number.");
  }
  if (typeof precision !== "number" || precision < 0) {
    throw new Error("Precision must be a non-negative number.");
  }

  const map: { suffix: string; threshold: number }[] = [
    { suffix: "T", threshold: 1e12 },
    { suffix: "B", threshold: 1e9 },
    { suffix: "M", threshold: 1e6 },
    { suffix: "k", threshold: 1e3 },
    { suffix: "", threshold: 1 },
  ];

  // Find the appropriate suffix for the given number
  const found = map.find((x) => Math.abs(num) >= x.threshold);
  if (found) {
    // Format the number with the chosen suffix, remove trailing zeros if needed
    const formattedValue = (num / found.threshold).toFixed(precision);
    return `${parseFloat(formattedValue)}${found.suffix}`;
  }

  // Return the number as-is if it's less than 1,000
  return num.toString();
}
