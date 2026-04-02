// Import Dependencies
import { ElementType, ReactNode, forwardRef, ForwardedRef } from "react";
import clsx from "clsx";

// Local Imports
import { usePaginationContext } from "./Pagination.context";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

// ----------------------------------------------------------------------

type PaginationControlOwnProps<E extends ElementType = "button"> = {
  component?: E;
  active?: boolean;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
};

export type PaginationControlProps<E extends ElementType = "button"> =
  PolymorphicComponentProps<E, PaginationControlOwnProps<E>>;

export const PaginationControlInner = forwardRef(
  <C extends ElementType = "button">(props: any, ref: ForwardedRef<any>) => {
    const { component, active, className, disabled, children, ...rest } =
      props as PaginationControlProps<C>;

    const ctx = usePaginationContext();

    const Component = component || "button";

    return (
      <Component
        {...rest}
        ref={ref}
        disabled={disabled}
        data-active={active || undefined}
        data-disabled={disabled || undefined}
        className={clsx(
          "pagination-control cursor-pointer",
          [
            active
              ? "active bg-[var(--accent-9)] text-white disabled:opacity-50 disabled:cursor-not-allowed"
              : [
                  disabled
                    ? "disabled:cursor-not-allowed disabled:opacity-60"
                    : "hover:bg-[var(--gray-a4)] focus-visible:bg-[var(--gray-a4)] active:bg-[var(--gray-a5)]",
                ],
          ],
          ctx.classNames?.control,
          className,
        )}
      >
        {children}
      </Component>
    );
  },
);

type PaginationControlComponent = (<E extends ElementType = "button">(
  props: PaginationControlProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const PaginationControl = PaginationControlInner as PaginationControlComponent;

PaginationControl.displayName = "PaginationControl";

export { PaginationControl };