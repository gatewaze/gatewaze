/**
 * Pads a number to two digits by adding a leading zero if necessary.
 *
 * @param The number to pad.
 * @returns The padded number as a string.
 */
function padTo2Digits(num: number): string {
  return num.toString().padStart(2, "0");
}

/**
 * Converts milliseconds into a formatted time string (HH:MM:SS).
 *
 * @param milliseconds - The time in milliseconds to convert.
 * @returns The formatted time string.
 * @throws If `milliseconds` is not a non-negative number.
 */
export function msToTime(milliseconds: number): string {
  if (typeof milliseconds !== "number" || milliseconds < 0) {
    throw new Error("Input must be a non-negative number.");
  }

  const seconds = Math.floor(milliseconds / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  // Format the time as HH:MM:SS
  return `${padTo2Digits(hours)}:${padTo2Digits(minutes % 60)}:${padTo2Digits(seconds % 60)}`;
}
