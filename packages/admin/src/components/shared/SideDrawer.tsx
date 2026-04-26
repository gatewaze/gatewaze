import { type ReactNode, type CSSProperties, useEffect } from 'react';

/**
 * Right-side slide-in drawer used across the admin (Inbox triage, EventHosts
 * detail, etc.). Owns the backdrop, panel chrome, slide-in animation, and
 * optional prev/next footer. Consumers just pass content as children.
 *
 * Animation requires the `drawerSlideIn` keyframe defined in styles/base.css.
 */
export interface SideDrawerProps {
  /** Controls visibility; when false the drawer is unmounted. */
  open: boolean;
  /** Fired on backdrop click and on the X button. */
  onClose: () => void;
  /** Optional title rendered in the header. Renderable so consumers can pass JSX. */
  title?: ReactNode;
  /** Optional subtitle / metadata under the title. */
  subtitle?: ReactNode;
  /** Panel width. Default 640px. */
  width?: number | string;
  /** Drawer body. */
  children: ReactNode;
  /** If supplied, a sticky footer with Previous / Next / position counter renders. */
  onPrev?: () => void;
  onNext?: () => void;
  position?: { current: number; total: number };
  /** Optional inner-class on the panel for one-off styling. */
  className?: string;
}

export function SideDrawer({
  open,
  onClose,
  title,
  subtitle,
  width = 640,
  children,
  onPrev,
  onNext,
  position,
  className = '',
}: SideDrawerProps) {
  // Esc to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && onPrev) onPrev();
      else if (e.key === 'ArrowRight' && onNext) onNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, onPrev, onNext]);

  if (!open) return null;

  const panelStyle: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex justify-end"
      onClick={onClose}
    >
      <div
        style={panelStyle}
        className={`h-full bg-white dark:bg-[var(--gray-1)] text-[var(--gray-12)] shadow-2xl border-l border-[var(--gray-a4)] relative animate-[drawerSlideIn_0.2s_ease-out] flex flex-col ${className}`}
        onClick={(e) => e.stopPropagation()}
      >
        {(title || subtitle) && (
          <div className="flex items-start justify-between gap-4 p-6 pb-4 border-b border-[var(--gray-a4)]">
            <div className="flex-1 min-w-0">
              {title && (
                typeof title === 'string'
                  ? <h2 className="text-xl font-semibold truncate">{title}</h2>
                  : title
              )}
              {subtitle && (
                <div className="text-sm text-[var(--gray-11)] mt-1">{subtitle}</div>
              )}
            </div>
            <button
              onClick={onClose}
              className="text-[var(--gray-11)] hover:text-[var(--gray-12)] flex-shrink-0 text-xl leading-none"
              aria-label="Close"
            >
              ×
            </button>
          </div>
        )}

        {!title && !subtitle && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-[var(--gray-11)] hover:text-[var(--gray-12)] text-xl leading-none z-10"
            aria-label="Close"
          >
            ×
          </button>
        )}

        <div className="flex-1 overflow-y-auto">
          {children}
        </div>

        {(onPrev || onNext) && (
          <div className="sticky bottom-0 left-0 right-0 px-6 py-3 bg-white dark:bg-[var(--gray-1)] border-t border-[var(--gray-a4)] flex items-center justify-between">
            <button
              onClick={onPrev}
              disabled={!onPrev}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--gray-a3)] hover:bg-[var(--gray-a5)] text-[var(--gray-12)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              ← Previous
            </button>
            {position && (
              <span className="text-xs text-[var(--gray-11)] tabular-nums">
                {position.current + 1} of {position.total}
              </span>
            )}
            <button
              onClick={onNext}
              disabled={!onNext}
              className="px-3 py-1.5 rounded-md text-sm font-medium bg-[var(--gray-a3)] hover:bg-[var(--gray-a5)] text-[var(--gray-12)] disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
