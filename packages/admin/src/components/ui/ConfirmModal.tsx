import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { Modal } from './Modal';
import { Button } from './Button';

export interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  confirmColor?: 'red' | 'blue' | 'green';
  confirmVariant?: string;
  cancelText?: string;
  isProcessing?: boolean;
}


export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  confirmColor = 'red',
  cancelText = 'Cancel'
}: ConfirmModalProps) {
  const handleConfirm = () => {
    onConfirm();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="flex flex-col items-center">
        <div className="mx-auto flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-[var(--red-a3)]">
          <ExclamationTriangleIcon
            className="h-6 w-6 text-[var(--red-9)]"
            aria-hidden="true"
          />
        </div>

        <div className="mt-4 text-center">
          <h3 className="text-lg font-medium leading-6 text-[var(--gray-12)] mb-2">
            {title}
          </h3>
          <p className="text-sm text-[var(--gray-11)] mb-6">
            {message}
          </p>
        </div>

        <div className="flex gap-3 justify-end w-full">
          <Button
            variant="outline"
            onClick={onClose}
          >
            {cancelText}
          </Button>
          <Button
            onClick={handleConfirm}
            color={confirmColor}
          >
            {confirmText}
          </Button>
        </div>
      </div>
    </Modal>
  );
}