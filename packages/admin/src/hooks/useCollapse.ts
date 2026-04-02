import { useRef, useState } from "react";
import { flushSync } from "react-dom";

import { mergeRefs, useDidUpdate } from "./index";
import { CSSProperties } from "react";

function getAutoHeightDuration(height: number | string) {
  if (!height || typeof height === "string") {
    return 0;
  }
  const constant = height / 36;
  return Math.round((4 + 15 * constant ** 0.25 + constant / 5) * 10);
}

export function getElementHeight(
  el:
    | React.RefObject<HTMLElement | null>
    | { current?: { scrollHeight: number } },
) {
  return el?.current ? el.current.scrollHeight : "auto";
}

const raf = typeof window !== "undefined" && window.requestAnimationFrame;

export interface UseCollapse {
  opened: boolean;
  transitionDuration?: number;
  transitionTimingFunction?: string;
  onTransitionEnd?: () => void;
  min?: string;
}

interface GetCollapseProps {
  [key: string]: unknown;
  style?: CSSProperties;
  onTransitionEnd?: (e: TransitionEvent) => void;
  refKey?: string;
  ref?: React.Ref<HTMLElement>;
}

export function useCollapse({
  transitionDuration,
  transitionTimingFunction = "ease",
  onTransitionEnd = () => {},
  opened,
  min = "0px",
}: UseCollapse): (props?: GetCollapseProps) => Record<string, any> {
  const el = useRef<HTMLElement | null>(null);
  const collapsedHeight = min;
  const collapsedStyles = {
    display: min === "0px" ? "none" : undefined,
    height: collapsedHeight,
    overflow: "hidden",
  };
  const [styles, setStylesRaw] = useState<CSSProperties>(
    opened ? {} : collapsedStyles,
  );
  const setStyles = (
    newStyles: object | ((oldStyles: object) => object),
  ): void => {
    flushSync(() => setStylesRaw(newStyles));
  };

  const mergeStyles = (newStyles: object): void => {
    setStyles((oldStyles) => ({ ...oldStyles, ...newStyles }));
  };

  function getTransitionStyles(height: number | string): {
    transition: string;
  } {
    const _duration = transitionDuration || getAutoHeightDuration(height);
    return {
      transition: `height ${_duration}ms ${transitionTimingFunction}`,
    };
  }

  useDidUpdate(() => {
    if (typeof raf === "function") {
      if (opened) {
        raf(() => {
          mergeStyles({
            willChange: "height",
            display: "block",
            overflow: "hidden",
          });
          raf(() => {
            const height = getElementHeight(el);
            mergeStyles({ ...getTransitionStyles(height), height });
          });
        });
      } else {
        raf(() => {
          const height = getElementHeight(el);
          mergeStyles({
            ...getTransitionStyles(height),
            willChange: "height",
            height,
          });
          raf(() =>
            mergeStyles({ height: collapsedHeight, overflow: "hidden" }),
          );
        });
      }
    }
  }, [opened]);

  const handleTransitionEnd = (e: React.TransitionEvent): void => {
    if (e.target !== el.current || e.propertyName !== "height") {
      return;
    }

    if (opened) {
      const height = getElementHeight(el);

      if (height === styles.height) {
        setStyles({});
      } else {
        mergeStyles({ height });
      }

      onTransitionEnd();
    } else if (styles.height === collapsedHeight) {
      setStyles(collapsedStyles);
      onTransitionEnd();
    }
  };

  function getCollapseProps({
    style = {},
    refKey = "ref",
    ...rest
  }: GetCollapseProps = {}) {
    const theirRef: any = rest[refKey];
    return {
      "aria-hidden": !opened,
      ...rest,
      [refKey]: mergeRefs(el, theirRef),
      onTransitionEnd: handleTransitionEnd,
      style: { boxSizing: "border-box", ...style, ...styles },
    };
  }

  return getCollapseProps;
}
