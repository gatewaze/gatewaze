const head: HTMLHeadElement = document.head || document.getElementsByTagName("head")[0];

/**
 * Inserts a style element into the document head.
 *
 * @param tag - The HTMLStyleElement to insert.
 */
export function insertStylesToHead(tag: HTMLStyleElement): void {
  head.appendChild(tag);
}

/**
 * Removes a style element from the document head.
 *
 * @param tag - The HTMLStyleElement to remove.
 */
export function removeStylesFromHead(tag: HTMLStyleElement): void {
  head.removeChild(tag);
}

/**
 * Injects CSS styles into a given style element.
 *
 * This function uses the non-standard `styleSheet` property (primarily for older versions
 * of IE) if available; otherwise, it appends a text node containing the CSS.
 *
 * @param tag - The HTMLStyleElement where the CSS will be injected.
 * @param css - The CSS string to inject.
 */
export function injectStyles(tag: HTMLStyleElement, css: string): void {
  // For IE and older browsers that support the styleSheet property.
  if ((tag as any).styleSheet) {
    (tag as any).styleSheet.cssText = css;
  } else {
    tag.appendChild(document.createTextNode(css));
  }
}

/**
 * Creates and returns a new style element.
 *
 * @returns A newly created HTMLStyleElement with type "text/css".
 */
export function makeStyleTag(): HTMLStyleElement {
  const tag = document.createElement("style");
  tag.type = "text/css";
  return tag;
}
