// Import Dependencies
import {
  Dialog,
  DialogPanel,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import {
  ExclamationTriangleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import clsx from "clsx";
import merge from "lodash/merge";
import { ElementType, useRef } from "react";

// Local Imports
import { Button, GhostSpinner } from "@/components/ui";
import { AnimatedTick } from "./AnimatedTick";

// ----------------------------------------------------------------------

export type ModalState = "pending" | "success" | "error";

interface MessageConfig {
  Icon: ElementType;
  iconClassName?: string;
  title: string;
  description: string;
  actionText: string;
}

interface Messages {
  pending: MessageConfig;
  success: MessageConfig;
  error: MessageConfig;
}

export interface ConfirmProps {
  onOk: () => void;
  onClose: () => void;
  state: ModalState;
  messages?: ConfirmMessages;
  confirmLoading?: boolean;
}

export type ConfirmMessages = {
  [K in ModalState]?: Partial<MessageConfig>;
};

const defaultMessages: Messages = {
  pending: {
    Icon: ExclamationTriangleIcon,
    iconClassName: "text-warning",
    title: "Are you sure?",
    description:
      "Are you sure you want to delete this record? Once deleted, it cannot be restored.",
    actionText: "Delete",
  },
  success: {
    Icon: AnimatedTick,
    iconClassName: "text-success",
    title: "Record Deleted",
    description: "You have successfully deleted the record from the database.",
    actionText: "Done",
  },
  error: {
    Icon: XCircleIcon,
    title: "Opps... Something failed.",
    description:
      "Ensure internet is on and retry. Contact support if issue remains.",
    actionText: "Retry",
    iconClassName: "text-error",
  },
};

export function ConfirmModal({
  show,
  onClose,
  onOk,
  confirmLoading,
  className,
  state,
  messages,
}: ConfirmProps & { show: boolean; className?: string }) {
  const focusRef = useRef<HTMLButtonElement>(null);

  const dialogProps = confirmLoading
    ? {
        onClose: () => {},
        static: true,
      }
    : {
        onClose,
      };

  return (
    <Transition
      appear
      show={show}
      as={Dialog}
      initialFocus={focusRef}
      className="fixed inset-0 z-100 flex flex-col items-center justify-center overflow-hidden px-4 py-6 sm:px-5"
      {...dialogProps}
    >
      <TransitionChild
        as="div"
        enter="ease-out duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="ease-in duration-200"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        className="absolute inset-0 bg-gray-900/50 transition-opacity dark:bg-black/40"
      />

      <TransitionChild
        as={DialogPanel}
        enter="ease-out duration-300"
        enterFrom="opacity-0"
        enterTo="opacity-100"
        leave="ease-in duration-200"
        leaveFrom="opacity-100"
        leaveTo="opacity-0"
        className={clsx(
          "scrollbar-sm relative flex w-full max-w-md flex-col overflow-y-auto rounded-lg bg-[var(--color-background)] px-4 py-6 transition-opacity duration-300 sm:px-5",
          className,
        )}
      >
        <Confirm
          {...{
            onOk,
            state,
            messages,
            confirmLoading,
            onClose,
            focusRef,
          }}
        />
      </TransitionChild>
    </Transition>
  );
}

function Confirm({
  onOk,
  state,
  messages,
  confirmLoading,
  onClose,
  focusRef,
}: ConfirmProps & { focusRef: React.RefObject<HTMLButtonElement | null> }) {
  const mergedMessages = merge(defaultMessages, messages);
  const Icon = mergedMessages[state].Icon;
  const spinner = <GhostSpinner variant="soft" className="size-4 border-2" />;

  return (
    <>
      <Icon
        className={clsx(
          "mx-auto size-24 shrink-0",
          mergedMessages[state].iconClassName,
        )}
      />
      <div className="mt-4">
        <h3 className="text-xl text-[var(--gray-12)]">
          {mergedMessages[state].title}
        </h3>
        <p className="mx-auto mt-2 max-w-xs">
          {mergedMessages[state].description}
        </p>

        {state === "success" ? (
          <Button
            onClick={onClose}
            color="success"
            className="mt-12 h-9 min-w-[7rem]"
          >
            {mergedMessages[state].actionText}
          </Button>
        ) : (
          <div className="mt-12 flex justify-center space-x-3 rtl:space-x-reverse">
            <Button
              onClick={onClose}
              variant="outlined"
              className="h-9 min-w-[7rem]"
            >
              Cancel
            </Button>

            {state === "pending" && (
              <Button
                ref={focusRef}
                onClick={onOk}
                color="primary"
                className="h-9 min-w-[7rem] space-x-2 rtl:space-x-reverse"
              >
                {confirmLoading && spinner}
                <span> {mergedMessages[state].actionText}</span>
              </Button>
            )}

            {state === "error" && (
              <Button
                onClick={onOk}
                color="error"
                className="h-9 min-w-[7rem] space-x-2 rtl:space-x-reverse"
              >
                {confirmLoading && spinner}
                <span> {mergedMessages[state].actionText}</span>
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
