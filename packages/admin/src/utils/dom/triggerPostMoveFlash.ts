import { RefObject } from "react";
import { unRef } from "./unRef";

// Constants for animation durations
const TRANSITION_DURATION = 500; // in ms
const FLASH_DURATION = 100; // in ms

/**
 * Triggers a flash animation on an element, temporarily changing its background color.
 * 
 * @param el - The element or a React ref object pointing to the element to apply the flash effect.
 */
export function triggerPostMoveFlash(el: HTMLElement | RefObject<HTMLElement>): void {
    const element = unRef(el);

    if (!(element instanceof HTMLElement)) {
        console.error("Invalid element provided to triggerPostMoveFlash. Expected an HTMLElement or RefObject but received:", element);
        return;
    }

    const originalBackground = window.getComputedStyle(element).backgroundColor;

    element.style.transition = `background-color ${TRANSITION_DURATION}ms ease-out`;

    element.style.backgroundColor = `var(--colors-primary-500)`;

    setTimeout(() => {
        element.style.backgroundColor = originalBackground;

        setTimeout(() => {
            element.style.transition = '';
        }, TRANSITION_DURATION);
    }, FLASH_DURATION);
}