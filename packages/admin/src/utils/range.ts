/**
 * Generates an array of numbers from start to end with a given step size.
 *
 * @param start - The starting number.
 * @param end - The ending number.
 * @param step - The step size between numbers. Defaults to 1.
 * @returns An array containing numbers from start to end.
 */
export function range(start: number, end: number, step: number = 1): number[] {
    const result: number[] = [];
    for (let i = start; step > 0 ? i <= end : i >= end; i += step) {
      result.push(i);
    }
    return result;
  }
  