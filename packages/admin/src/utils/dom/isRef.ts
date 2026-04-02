import type { RefObject } from "react";

/**
 * Checks if an object is a React ref (specifically a ref object with a `current` property).
 *
 * @param obj - The object to check.
 * @returns True if the object is a React ref object, false otherwise.
 */
export const isRef = (obj: any): obj is RefObject<any> => {
  return (
    obj !== null &&
    typeof obj === "object" &&
    "current" in obj &&
    (obj.current === null || typeof obj.current !== "function")
  );
};
