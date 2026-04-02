export const compareArrays = <T>(a: T[], b: T[]): boolean => {
  if (a.length !== b.length) return false;

  return a.every((element, index) => {
    const otherElement = b[index];

    // Recursively compare nested arrays
    if (Array.isArray(element) && Array.isArray(otherElement)) {
      return compareArrays(element, otherElement);
    }

    // Direct comparison for primitive values
    return element === otherElement;
  });
};
