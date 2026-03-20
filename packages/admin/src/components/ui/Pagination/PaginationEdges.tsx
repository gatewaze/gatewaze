// Local Imports
import { ElementType, ComponentPropsWithoutRef } from "react";
import {
  ChevronDoubleRightIcon,
  ChevronDoubleLeftIcon,
  ChevronRightIcon,
  ChevronLeftIcon,
} from "@heroicons/react/20/solid";
import clsx from "clsx";

// Import Dependencies
import { usePaginationContext } from "./Pagination.context";
import { PaginationControl } from "./PaginationControl";

// ----------------------------------------------------------------------

type EdgeComponentProps = ComponentPropsWithoutRef<typeof PaginationControl> & {
  Icon?: ElementType;
}

function createEdgeComponent({ 
  icon, 
  type, 
  action 
}: { 
  icon: ElementType; 
  type: "next" | "previous"; 
  action: "onNext" | "onPrevious" | "onFirst" | "onLast";
}) {
  function EdgeComponent({ Icon = icon, ...props }: EdgeComponentProps) {
    const ctx = usePaginationContext();
    const disabled =
      type === "next" ? ctx.active === ctx.total : ctx.active === 1;

    return (
      <PaginationControl
        disabled={ctx.disabled || disabled}
        onClick={ctx[action]}
        className={clsx("pagination-control-icon", ctx.classNames?.controlIcon)}
        {...props}
      >
        <Icon
          className={clsx("pagination-icon rtl:rotate-180", ctx.classNames?.icon)}
        />
      </PaginationControl>
    );
  }

  EdgeComponent.displayName = "Pagination" + type.charAt(0).toUpperCase() + type.slice(1);

  return EdgeComponent;
}

export const PaginationNext = createEdgeComponent({
  icon: ChevronRightIcon,
  type: "next",
  action: "onNext",
});

export const PaginationPrevious = createEdgeComponent({
  icon: ChevronLeftIcon,
  type: "previous",
  action: "onPrevious",
});

export const PaginationFirst = createEdgeComponent({
  icon: ChevronDoubleLeftIcon,
  type: "previous",
  action: "onFirst",
});

export const PaginationLast = createEdgeComponent({
  icon: ChevronDoubleRightIcon,
  type: "next",
  action: "onLast",
});
