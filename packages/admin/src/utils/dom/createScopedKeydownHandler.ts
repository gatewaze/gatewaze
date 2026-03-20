export function findElementAncestor(element: HTMLElement, selector: string) {
  let _element: HTMLElement | null = element;
  while ((_element = _element.parentElement) && !_element.matches(selector)) {
    /* empty */
  }
  return _element;
}

// Helper function to check i0f an element is disabled
function isElementDisabled<T extends HTMLElement>(element: T): boolean {
  // For standard elements with disabled property
  if ('disabled' in element) {
    // Use a more accurate type check
    return Boolean((element as unknown as { disabled: boolean }).disabled);
  }
  
  // For other elements, check aria-disabled
  return element.getAttribute('aria-disabled') === 'true';
}

function getPreviousIndex<T extends HTMLElement>(
  current: number,
  elements: T[],
  loop: boolean
) {
  for (let i = current - 1; i >= 0; i -= 1) {
    if (!isElementDisabled(elements[i])) {
      return i;
    }
  }

  if (loop) {
    for (let i = elements.length - 1; i > -1; i -= 1) {
      if (!isElementDisabled(elements[i])) {
        return i;
      }
    }
  }

  return current;
}

function getNextIndex<T extends HTMLElement>(
  current: number,
  elements: T[],
  loop: boolean
) {
  for (let i = current + 1; i < elements.length; i += 1) {
    if (!isElementDisabled(elements[i])) {
      return i;
    }
  }

  if (loop) {
    for (let i = 0; i < elements.length; i += 1) {
      if (!isElementDisabled(elements[i])) {
        return i;
      }
    }
  }

  return current;
}

/** Validates that target element is on the same level as sibling, used to filter out children that have the same sibling selector */
function onSameLevel<T extends HTMLElement>(
  target: T,
  sibling: T,
  parentSelector: string
) {
  return (
    findElementAncestor(target, parentSelector) ===
    findElementAncestor(sibling, parentSelector)
  );
}

interface GetElementsSiblingsInput<T extends HTMLElement = HTMLElement> {
  /** Selector used to find parent node, e.g. '[role="tablist"]', '.mantine-Text-root' */
  parentSelector: string;

  /** Selector used to find element siblings, e.g. '[data-tab]' */
  siblingSelector: string;

  /** Determines whether next/previous indices should loop */
  loop?: boolean;

  /** Determines which arrow keys will be used */
  orientation: "vertical" | "horizontal";

  /** Text direction */
  dir?: "rtl" | "ltr";

  /** Determines whether element should be clicked when focused with keyboard event */
  activateOnFocus?: boolean;

  /** External keydown event */
  onKeyDown?: (event: React.KeyboardEvent<T>) => void;
}

export function createScopedKeydownHandler<T extends HTMLElement = HTMLElement>({
  parentSelector,
  siblingSelector,
  onKeyDown,
  loop = true,
  activateOnFocus = false,
  dir = "ltr",
  orientation,
}: GetElementsSiblingsInput<T>) {
  return (event: React.KeyboardEvent<T>) => {
    onKeyDown?.(event);

    const elements = Array.from(
      findElementAncestor(
        event.currentTarget,
        parentSelector
      )?.querySelectorAll<T>(siblingSelector) || []
    ).filter((node) => onSameLevel(event.currentTarget, node, parentSelector));

    const current = elements.findIndex((el) => event.currentTarget === el);
    const _nextIndex = getNextIndex(current, elements, loop);
    const _previousIndex = getPreviousIndex(current, elements, loop);
    const nextIndex = dir === "rtl" ? _previousIndex : _nextIndex;
    const previousIndex = dir === "rtl" ? _nextIndex : _previousIndex;

    switch (event.key) {
      case "ArrowRight": {
        if (orientation === "horizontal") {
          event.stopPropagation();
          event.preventDefault();
          elements[nextIndex].focus();
          if (activateOnFocus) elements[nextIndex].click();
        }

        break;
      }

      case "ArrowLeft": {
        if (orientation === "horizontal") {
          event.stopPropagation();
          event.preventDefault();
          elements[previousIndex].focus();
          if (activateOnFocus) elements[previousIndex].click();
        }

        break;
      }

      case "ArrowUp": {
        if (orientation === "vertical") {
          event.stopPropagation();
          event.preventDefault();
          elements[_previousIndex].focus();
          if (activateOnFocus) elements[_previousIndex].click();
        }

        break;
      }

      case "ArrowDown": {
        if (orientation === "vertical") {
          event.stopPropagation();
          event.preventDefault();
          elements[_nextIndex].focus();
          if (activateOnFocus) elements[_nextIndex].click();
        }

        break;
      }

      case "Home": {
        event.stopPropagation();
        event.preventDefault();
        if (!isElementDisabled(elements[0])) elements[0].focus();
        break;
      }

      case "End": {
        event.stopPropagation();
        event.preventDefault();
        const last = elements.length - 1;
        if (!isElementDisabled(elements[last])) elements[last].focus();
        break;
      }
    }
  };
}
