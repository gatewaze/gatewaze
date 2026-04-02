import { useEffect, useRef } from "react";
import { capitalize } from "@/utils/capitalize";

export type ScrollOverflowVisibility =
  | "auto"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "both"
  | "none";

export type ScrollOverflowEdgeCheck =
  | "all"
  | "top"
  | "bottom"
  | "left"
  | "right";

export type ScrollOverflowOrientation = "horizontal" | "vertical";
export type ScrollOverflowCheck = ScrollOverflowOrientation | "both";

export interface UseDataScrollOverflowProps {
  overflowCheck?: ScrollOverflowCheck;
  visibility?: ScrollOverflowVisibility;
  isEnabled?: boolean;
  offset?: number;
  updateDeps?: any[];
  onVisibilityChange?: (overflow: ScrollOverflowVisibility) => void;
}

export function useDataScrollOverflow(props: UseDataScrollOverflowProps = {}) {
  const {
    isEnabled = true,
    overflowCheck = "vertical",
    visibility = "auto",
    offset = 0,
    onVisibilityChange,
    updateDeps = [],
  } = props;

  const visibleRef = useRef<ScrollOverflowVisibility>(visibility);

  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref?.current;
    
    if (!el || !isEnabled) return;

    const setAttributes = (
      _direction: string,
      hasBefore: boolean,
      hasAfter: boolean,
      prefix: string,
      suffix: string,
    ) => {
      if (visibility === "auto") {
        const both = `${prefix}${capitalize(suffix)}Scroll`;

        if (hasBefore && hasAfter) {
          el.dataset[both] = "true";
          el.removeAttribute(`data-${prefix}-scroll`);
          el.removeAttribute(`data-${suffix}-scroll`);
        } else {
          el.dataset[`${prefix}Scroll`] = hasBefore.toString();
          el.dataset[`${suffix}Scroll`] = hasAfter.toString();
          el.removeAttribute(`data-${prefix}-${suffix}-scroll`);
        }
      } else {
        const next =
          hasBefore && hasAfter
            ? "both"
            : hasBefore
              ? prefix
              : hasAfter
                ? suffix
                : "none";

        if (next !== visibleRef.current) {
          onVisibilityChange?.(next as ScrollOverflowVisibility);
          visibleRef.current = next as ScrollOverflowVisibility;
        }
      }
    };

    const checkOverflow = () => {
      const directions = [
        { type: "vertical", prefix: "top", suffix: "bottom" },
        { type: "horizontal", prefix: "left", suffix: "right" },
      ];

      const listbox = el.querySelector('ul[data-slot="list"]');

      // in virtualized listbox, el.scrollHeight is the height of the visible listbox
      const scrollHeight = +(
        listbox?.getAttribute("data-virtual-scroll-height") ?? el.scrollHeight
      );

      // in virtualized listbox, el.scrollTop is always 0
      const scrollTop = +(
        listbox?.getAttribute("data-virtual-scroll-top") ?? el.scrollTop
      );

      for (const { type, prefix, suffix } of directions) {
        if (overflowCheck === type || overflowCheck === "both") {
          const hasBefore =
            type === "vertical" ? scrollTop > offset : el.scrollLeft > offset;
          const hasAfter =
            type === "vertical"
              ? scrollTop + el.clientHeight + offset < scrollHeight
              : el.scrollLeft + el.clientWidth + offset < el.scrollWidth;

          setAttributes(type, hasBefore, hasAfter, prefix, suffix);
        }
      }
    };

    const clearOverflow = () => {
      ["top", "bottom", "top-bottom", "left", "right", "left-right"].forEach(
        (attr) => {
          el.removeAttribute(`data-${attr}-scroll`);
        },
      );
    };

    const observer = new ResizeObserver(checkOverflow);
    observer.observe(el);

    // auto
    el.addEventListener("scroll", checkOverflow, true);

    // controlled
    if (visibility !== "auto") {
      clearOverflow();
      if (visibility === "both") {
        el.dataset.topBottomScroll = String(overflowCheck === "vertical");
        el.dataset.leftRightScroll = String(overflowCheck === "horizontal");
      } else {
        el.dataset.topBottomScroll = "false";
        el.dataset.leftRightScroll = "false";

        ["top", "bottom", "left", "right"].forEach((attr) => {
          el.dataset[`${attr}Scroll`] = String(visibility === attr);
        });
      }
    }

    return () => {
      el.removeEventListener("scroll", checkOverflow, true);
      observer.disconnect();
      clearOverflow();
    };
  }, [
    isEnabled,
    visibility,
    overflowCheck,
    onVisibilityChange,
    ref,
    offset,
    updateDeps,
  ]);

  return { ref };
}

export type UseDataScrollOverflowReturn = ReturnType<
  typeof useDataScrollOverflow
>;
