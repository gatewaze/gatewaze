// Import Dependencies
import {
  ElementType,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  forwardRef,
  ForwardedRef,
} from "react";

// Local Imports
import { createScopedKeydownHandler } from "@/utils/dom/createScopedKeydownHandler";
import { useAccordionContext } from "./Accordion.context";
import { useAccordionItemContext } from "./AccordionItem.context";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

// -----------------------------------------------------------------------------

type AccordionButtonOwnProps<E extends ElementType = "button"> = {
  children?: ReactNode | ((params: { open: boolean }) => ReactNode);
  className?: string | ((params: { open: boolean }) => string);
  disabled?: boolean;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  component?: E;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
};

export type AccordionButtonProps<E extends ElementType = "button"> =
  PolymorphicComponentProps<E, AccordionButtonOwnProps<E>>;

export const AccordionButtonInner = forwardRef(
  <E extends ElementType = "button">(
    props: any,
    ref: ForwardedRef<any>,
  ) => {
    const {
      children,
      className,
      disabled,
      onClick,
      component,
      onKeyDown,
      ...rest
    } = props as AccordionButtonProps<E>;
    const ctx = useAccordionContext();
    const { value } = useAccordionItemContext();
    const isActive = ctx.isItemActive(value);

    const Component = component || "button";

    return (
      <Component
        {...rest}
        ref={ref}
        data-accordion-control
        disabled={disabled}
        className={
          typeof className === "function"
            ? className({ open: isActive })
            : className
        }
        onClick={(event: MouseEvent<HTMLButtonElement>) => {
          onClick?.(event);
          ctx.onChange(value);
        }}
        type="button"
        aria-expanded={isActive}
        aria-controls={`${ctx.panelId}-${value}`}
        id={`${ctx.buttonId}-${value}`}
        onKeyDown={createScopedKeydownHandler({
          siblingSelector: "[data-accordion-control]",
          parentSelector: "[data-accordion]",
          activateOnFocus: false,
          loop: ctx.loop,
          orientation: "vertical",
          onKeyDown,
        })}
      >
        {typeof children === "function"
          ? children({ open: isActive })
          : children}
      </Component>
    );
  },
);

type AccordionButtonComponent = (<E extends ElementType = "button">(
  props: AccordionButtonProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const AccordionButton = AccordionButtonInner as AccordionButtonComponent;
AccordionButton.displayName = "AccordionButton";

export { AccordionButton };
