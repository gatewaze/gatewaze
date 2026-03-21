import { ReactNode } from 'react';
import { Dialog } from '@radix-ui/themes';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from './Button';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  children: ReactNode;
  footer?: ReactNode;
}

const sizeClasses = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
  full: 'max-w-[calc(100vw-4rem)]',
};

export function Modal({ isOpen, onClose, title, size = 'md', children, footer }: ModalProps) {
  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Content
        maxWidth="100vw"
        className={`w-full ${sizeClasses[size]} max-h-[90vh] !rounded-2xl flex flex-col`}
        aria-describedby={undefined}
      >
        {title && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--gray-a6)] flex-shrink-0">
            <Dialog.Title className="text-lg font-medium leading-6">
              {title}
            </Dialog.Title>
            <Button
              variant="flat"
              isIcon
              onClick={onClose}
              className="text-[var(--gray-a8)] hover:text-[var(--gray-12)]"
            >
              <XMarkIcon className="h-5 w-5" />
            </Button>
          </div>
        )}

        <div className={`overflow-y-auto flex-1 min-h-0 ${title ? 'px-4 py-3' : 'p-4'}`}>
          {children}
        </div>

        {footer && (
          <div className="flex-shrink-0 border-t border-[var(--gray-a6)] px-4 pt-3 pb-1.5">
            {footer}
          </div>
        )}
      </Dialog.Content>
    </Dialog.Root>
  );
}
