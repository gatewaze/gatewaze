import { ReactNode, useRef, useState, useCallback, useEffect } from 'react';
import { Dialog, VisuallyHidden } from '@radix-ui/themes';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from './Button';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  children: ReactNode;
  footer?: ReactNode;
  /** Set to false to disable edge-drag resizing. Default: true */
  resizable?: boolean;
}

const sizeDefaults: Record<string, { width: number; minWidth: number }> = {
  sm:   { width: 448,  minWidth: 320 },
  md:   { width: 512,  minWidth: 360 },
  lg:   { width: 672,  minWidth: 400 },
  xl:   { width: 896,  minWidth: 480 },
  '2xl': { width: 1152, minWidth: 560 },
  full: { width: 0,    minWidth: 480 },
};

type Edge = 'right' | 'bottom' | 'left' | 'corner';

export function Modal({ isOpen, onClose, title, size = 'md', children, footer, resizable = true }: ModalProps) {
  const defaults = sizeDefaults[size] ?? sizeDefaults.md;
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const dragging = useRef<{ edge: Edge; startX: number; startY: number; startW: number; startH: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Reset dimensions when modal opens/closes or size changes
  useEffect(() => {
    if (isOpen) setDims(null);
  }, [isOpen, size]);

  const onPointerDown = useCallback((edge: Edge) => (e: React.PointerEvent) => {
    e.preventDefault();
    const el = contentRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    dragging.current = { edge, startX: e.clientX, startY: e.clientY, startW: rect.width, startH: rect.height };

    const onMove = (ev: PointerEvent) => {
      const d = dragging.current;
      if (!d) return;
      const dx = ev.clientX - d.startX;
      const dy = ev.clientY - d.startY;
      const minW = defaults.minWidth;
      const minH = 200;
      const maxW = window.innerWidth - 64;
      const maxH = window.innerHeight - 64;

      let newW = d.startW;
      let newH = d.startH;

      if (d.edge === 'right' || d.edge === 'corner') {
        newW = Math.max(minW, Math.min(maxW, d.startW + dx * 2)); // *2 because modal is centered
      }
      if (d.edge === 'left') {
        newW = Math.max(minW, Math.min(maxW, d.startW - dx * 2));
      }
      if (d.edge === 'bottom' || d.edge === 'corner') {
        newH = Math.max(minH, Math.min(maxH, d.startH + dy));
      }

      setDims({ w: newW, h: newH });
    };

    const onUp = () => {
      dragging.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [defaults.minWidth]);

  const isFullSize = size === 'full';
  const customStyle: React.CSSProperties = {};
  if (dims && resizable) {
    customStyle.width = dims.w;
    customStyle.maxWidth = dims.w;
    customStyle.height = dims.h;
    customStyle.maxHeight = dims.h;
  }

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content
        ref={contentRef}
        maxWidth={isFullSize ? '100vw' : undefined}
        className={`w-full ${isFullSize ? 'max-w-[calc(100vw-4rem)]' : ''} max-h-[90vh] !rounded-2xl flex flex-col relative`}
        style={{
          ...(!isFullSize && !dims ? { maxWidth: defaults.width } : {}),
          ...customStyle,
          // Prevent text selection while dragging
          ...(dragging.current ? { userSelect: 'none' } : {}),
        }}
        aria-describedby={undefined}
      >
        {title ? (
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--gray-a6)] flex-shrink-0">
            <Dialog.Title className="text-lg font-medium leading-6">
              {title}
            </Dialog.Title>
            <Button
              variant="ghost"
              isIcon
              onClick={onClose}
              className="text-[var(--gray-a8)] hover:text-[var(--gray-12)]"
            >
              <XMarkIcon className="h-5 w-5" />
            </Button>
          </div>
        ) : (
          <VisuallyHidden><Dialog.Title>Dialog</Dialog.Title></VisuallyHidden>
        )}

        <div className={`overflow-y-auto flex-1 min-h-0 ${title ? 'px-4 py-3' : 'p-4'}`}>
          {children}
        </div>

        {footer && (
          <div className="flex-shrink-0 border-t border-[var(--gray-a6)] px-4 pt-3 pb-1.5">
            {footer}
          </div>
        )}

        {/* Resize handles */}
        {resizable && !isFullSize && (
          <>
            {/* Right edge */}
            <div
              onPointerDown={onPointerDown('right')}
              className="absolute top-0 -right-1 w-2 h-full cursor-ew-resize"
            />
            {/* Left edge */}
            <div
              onPointerDown={onPointerDown('left')}
              className="absolute top-0 -left-1 w-2 h-full cursor-ew-resize"
            />
            {/* Bottom edge */}
            <div
              onPointerDown={onPointerDown('bottom')}
              className="absolute -bottom-1 left-0 w-full h-2 cursor-ns-resize"
            />
            {/* Bottom-right corner */}
            <div
              onPointerDown={onPointerDown('corner')}
              className="absolute -bottom-1 -right-1 w-4 h-4 cursor-nwse-resize"
            />
            {/* Bottom-left corner */}
            <div
              onPointerDown={onPointerDown('corner')}
              className="absolute -bottom-1 -left-1 w-4 h-4 cursor-nesw-resize"
            />
          </>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
