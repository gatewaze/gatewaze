// Import Dependencies
import { useRef, useEffect } from "react";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import clsx from "clsx";

// Local Imports
import { useDisclosure } from "@/hooks";
import { Button, Input } from "@/components/ui";

// ----------------------------------------------------------------------

interface CollapsibleSearchProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  defaultState?: boolean;
  className?: string;
  buttonProps?: object;
}

export function CollapsibleSearch({
  defaultState = false,
  className,
  buttonProps,
  ...props
}: CollapsibleSearchProps) {
  const [isExpanded, { toggle }] = useDisclosure(defaultState);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isExpanded) inputRef.current?.focus();
  }, [isExpanded]);

  return (
    <div className="flex items-center" {...{ "data-collapsed": !isExpanded }}>
      <Input
        autoComplete="off"
        unstyled
        ref={inputRef}
        classNames={{
          root: clsx(
            "text-end transition-[width] duration-100",
            isExpanded ? "w-32 lg:w-48" : "w-0",
          ),
          input: clsx(
            "dark:placeholder:text-dark-200 text-end placeholder:font-light placeholder:text-gray-600",
            className,
          ),
        }}
        {...props}
      />
      <Button
        onClick={toggle}
        variant="flat"
        isIcon
        className="size-8 rounded-full"
        aria-label="Toggle Search"
        title="Toggle Search"
        {...buttonProps}
      >
        <MagnifyingGlassIcon className="size-4.5" />
      </Button>
    </div>
  );
}
