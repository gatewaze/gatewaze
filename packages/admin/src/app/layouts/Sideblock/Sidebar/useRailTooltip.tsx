// Import Dependencies
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// ----------------------------------------------------------------------

/**
 * Hover tooltip for the collapsed (icon-only) sidebar rail.
 *
 * Shows the item's label after the cursor rests on the icon for ~0.5s, sliding
 * out from the rail's right edge. Rendered in a portal so it isn't clipped by
 * the menu's `overflow` (the in-DOM labels would be). Self-contained so the
 * app's shared react-tooltip (tables, etc.) is unaffected.
 *
 * `enabled` is false when the sidebar is expanded — then it's a no-op.
 */

const SHOW_DELAY_MS = 500;

interface RailTooltip {
  /** Callback ref for the anchor element (the menu row / icon button). */
  ref: (el: HTMLElement | null) => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  /** Portal node to render; `null` until the tooltip is visible. */
  node: ReactNode;
}

export function useRailTooltip(enabled: boolean, label: string): RailTooltip {
  const elRef = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const ref = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
  }, []);

  const clear = useCallback(() => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  }, []);

  const onMouseEnter = useCallback(() => {
    if (!enabled) return;
    clear();
    timer.current = window.setTimeout(() => {
      const el = elRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Anchor the tooltip to the rail's right edge so every row lines up,
      // regardless of each item's own padding.
      const panel = el.closest(".sidebar-panel");
      const rightEdge = panel
        ? panel.getBoundingClientRect().right
        : rect.right;
      setPos({ top: rect.top + rect.height / 2, left: rightEdge + 8 });
    }, SHOW_DELAY_MS);
  }, [enabled, clear]);

  const onMouseLeave = useCallback(() => {
    clear();
    setPos(null);
  }, [clear]);

  // Hide when leaving collapse mode, and clear the timer on unmount.
  useEffect(() => {
    if (!enabled) {
      clear();
      setPos(null);
    }
    return clear;
  }, [enabled, clear]);

  const node =
    enabled && pos
      ? createPortal(
          <div
            role="tooltip"
            className="rail-tooltip pointer-events-none fixed z-[1000] whitespace-nowrap rounded-md bg-[var(--color-gray-900,#18181b)] px-2.5 py-1.5 text-xs font-medium text-white shadow-lg"
            style={{ top: pos.top, left: pos.left }}
          >
            {label}
          </div>,
          document.body,
        )
      : null;

  return { ref, onMouseEnter, onMouseLeave, node };
}
