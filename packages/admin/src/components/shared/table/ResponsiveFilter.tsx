// Import Dependencies
import {
  PopoverButton,
  Dialog,
  DialogPanel,
  Popover,
  PopoverPanel,
  Transition,
  TransitionChild,
  type PopoverPanelProps,
} from "@headlessui/react";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import clsx from "clsx";
import { ReactNode } from "react";

// Local Imports
import { Button } from "@/components/ui";
import { useDisclosure } from "@/hooks";

// ----------------------------------------------------------------------

export type AnchorPosition = PopoverPanelProps["anchor"];

interface BaseFilterProps {
  children: ReactNode;
  buttonContent: ReactNode;
  classNames?: {
    button?: string;
  };
}

interface ResponsiveFilterProps extends BaseFilterProps {
  anchor?: AnchorPosition;
}

type MobileViewProps = BaseFilterProps;

interface DesktopViewProps extends BaseFilterProps {
  anchor: AnchorPosition;
}

export const ResponsiveFilter = ({
  children,
  buttonContent,
  anchor,
  classNames,
}: ResponsiveFilterProps) => {
  const { smAndDown } = useBreakpointsContext();

  const View = smAndDown ? MobileView : DesktopView;

  return (
    <View
      {...{
        buttonContent,
        anchor,
        classNames,
      }}
    >
      {children}
    </View>
  );
};

const MobileView = ({
  children,
  buttonContent,
  classNames,
}: MobileViewProps) => {
  const [isOpen, { open, close }] = useDisclosure(false);

  return (
    <>
      <Button
        variant="outlined"
        className={clsx(
          "h-8 gap-2 px-2.5 text-xs whitespace-nowrap",
          isOpen
            ? "border-primary-600 ring-primary-500/50 dark:border-primary-500 ring-3"
            : "border-dashed",
          classNames?.button,
        )}
        onClick={open}
      >
        {buttonContent}
      </Button>
      <Transition
        appear
        show={isOpen}
        as={Dialog}
        className="relative z-100"
        onClose={close}
      >
        <TransitionChild
          as="div"
          enter="ease-out duration-300"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-200"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
          className="fixed inset-0 bg-gray-900/50 backdrop-blur-sm transition-opacity dark:bg-black/40"
        />
        <TransitionChild
          as={DialogPanel}
          enter="ease-out transform-gpu transition-transform duration-200"
          enterFrom="translate-y-full"
          enterTo="translate-y-0"
          leave="ease-in transform-gpu transition-transform duration-200"
          leaveFrom="translate-y-0"
          leaveTo="translate-y-full"
          className="fixed bottom-0 left-0 flex w-full transform-gpu flex-col rounded-t-2xl bg-[var(--color-background)] transition-transform duration-200"
        >
          {children}
        </TransitionChild>
      </Transition>
    </>
  );
};

const DesktopView = ({
  children,
  buttonContent,
  anchor = { to: "bottom start", gap: 12 },
  classNames,
}: DesktopViewProps) => {
  return (
    <Popover>
      {({ open }) => (
        <>
          <PopoverButton
            as={Button}
            variant="outlined"
            className={clsx(
              "h-8 gap-2 px-2.5 text-xs whitespace-nowrap",
              open
                ? "border-primary-600 ring-primary-500/50 dark:border-primary-500 ring-3"
                : "border-dashed",
              classNames?.button,
            )}
          >
            {buttonContent}
          </PopoverButton>
          <Transition
            as={PopoverPanel}
            enter="transition ease-out"
            enterFrom="opacity-0 translate-y-2"
            enterTo="opacity-100 translate-y-0"
            leave="transition ease-in"
            leaveFrom="opacity-100 translate-y-0"
            leaveTo="opacity-0 translate-y-2"
            anchor={anchor}
            className="ring-primary-500/50 z-100 flex w-fit flex-col rounded-md border border-[var(--gray-a5)] bg-[var(--color-background)] shadow-lg shadow-gray-200/50 outline-hidden focus-visible:ring-3 focus-visible:outline-hidden dark:shadow-none"
          >
            <div className="flex flex-col overflow-hidden">{children}</div>
          </Transition>
        </>
      )}
    </Popover>
  );
};
