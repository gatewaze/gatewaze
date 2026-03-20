import { useRef, useEffect, useCallback, ReactNode } from "react";

interface ScrollableTableProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wraps a table with automatic scroll-shadow overlays at sticky column
 * boundaries. Detects the actual scrolling element (Radix ScrollArea
 * viewport inside Table.Root) and attaches listeners there.
 *
 * Shadows are sized to fill the nearest overflow-hidden ancestor (typically
 * the Card) so they span from the card's top edge to its bottom edge.
 */
export function ScrollableTable({ children, className }: ScrollableTableProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const leftShadowRef = useRef<HTMLDivElement>(null);
  const rightShadowRef = useRef<HTMLDivElement>(null);

  const update = useCallback(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Find the actual scrolling element: Radix ScrollArea viewport,
    // or fall back to the wrapper itself
    const el =
      wrapper.querySelector<HTMLElement>(".rt-ScrollAreaViewport") ?? wrapper;

    const { scrollLeft, scrollWidth, clientWidth } = el;
    const canScrollLeft = scrollLeft > 1;
    const canScrollRight = scrollLeft + clientWidth < scrollWidth - 1;

    // Compute vertical bounds relative to the wrapper.
    // Top: extend to the nearest overflow-hidden ancestor (Card) top edge.
    // Bottom: stop at the wrapper's own bottom (the table boundary).
    const wrapperRect = wrapper.getBoundingClientRect();
    let clipTop = 0;
    const clipBottom = wrapperRect.height;

    const card = wrapper.closest<HTMLElement>(".overflow-hidden");
    if (card) {
      const cardRect = card.getBoundingClientRect();
      clipTop = cardRect.top - wrapperRect.top;
    }

    const setShadowBounds = (shadow: HTMLElement) => {
      shadow.style.top = `${clipTop}px`;
      shadow.style.height = `${clipBottom - clipTop}px`;
      shadow.style.bottom = "auto";
    };

    if (leftShadowRef.current) {
      const leftCell = wrapper.querySelector<HTMLElement>("[data-sticky-left-edge]");
      if (leftCell) {
        const cellRect = leftCell.getBoundingClientRect();
        leftShadowRef.current.style.left = `${cellRect.right - wrapperRect.left}px`;
        leftShadowRef.current.style.opacity = canScrollLeft ? "1" : "0";
        setShadowBounds(leftShadowRef.current);
      } else {
        leftShadowRef.current.style.opacity = "0";
      }
    }

    if (rightShadowRef.current) {
      const rightCell = wrapper.querySelector<HTMLElement>(
        "[data-sticky-right]",
      );
      if (rightCell) {
        const cellRect = rightCell.getBoundingClientRect();
        rightShadowRef.current.style.right = `${wrapperRect.right - cellRect.left}px`;
        rightShadowRef.current.style.opacity = canScrollRight ? "1" : "0";
        setShadowBounds(rightShadowRef.current);
      } else {
        rightShadowRef.current.style.opacity = "0";
      }
    }
  }, []);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    const el =
      wrapper.querySelector<HTMLElement>(".rt-ScrollAreaViewport") ?? wrapper;

    requestAnimationFrame(() => update());
    el.addEventListener("scroll", update, { passive: true });

    const observer = new ResizeObserver(update);
    observer.observe(el);
    const table = wrapper.querySelector("table");
    if (table) observer.observe(table);

    return () => {
      el.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [update]);

  return (
    <div ref={wrapperRef} className={className} style={{ position: "relative" }}>
      {children}
      {/* Left scroll shadow overlay */}
      <div
        ref={leftShadowRef}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: "10px",
          background:
            "linear-gradient(to right, rgba(0,0,0,0.15), transparent)",
          pointerEvents: "none",
          zIndex: 30,
          opacity: 0,
          transition: "opacity 0.15s",
        }}
      />
      {/* Right scroll shadow overlay */}
      <div
        ref={rightShadowRef}
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          width: "10px",
          background:
            "linear-gradient(to left, rgba(0,0,0,0.15), transparent)",
          pointerEvents: "none",
          zIndex: 30,
          opacity: 0,
          transition: "opacity 0.15s",
        }}
      />
    </div>
  );
}
