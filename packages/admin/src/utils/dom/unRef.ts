import { isRef } from "./isRef";
import { RefObject } from "react";

/**
 * Accepts either a ref object or a DOM node and returns a DOM node.
 *
 * @param target - A React ref object or a DOM node.
 * @returns The resolved DOM node.
 */
export function unRef<T extends Element>(target: RefObject<T> | T): T {
    return isRef(target) ? target.current! : target;
}