// Import Dependencies
import { ElementType, ReactNode, forwardRef, ForwardedRef } from "react";

// Local Imports
import { AccordionItemContextProvider } from "./AccordionItem.context";
import { useAccordionContext } from "./Accordion.context";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

// -----------------------------------------------------------------------------

type AccordionItemOwnProps<E extends ElementType = "div"> = {
  children?: ReactNode | ((props: { open: boolean }) => ReactNode);
  className?: string | ((props: { open: boolean }) => string);
  value: string;
  component?: E;
};

export type AccordionItemProps<E extends ElementType = "div"> =
  PolymorphicComponentProps<E, AccordionItemOwnProps<E>>;

const AccordionItemInner = forwardRef(
  <E extends ElementType = "div">(props: any, ref: ForwardedRef<any>) => {

    const { children, className, value, component, ...rest } =
      props as AccordionItemProps<E>;
      
    const ctx = useAccordionContext();
    const isActive = ctx.isItemActive(value);

    const Component = component || "div";

    return (
      <AccordionItemContextProvider value={{ value }}>
        <Component
          data-state={isActive ? "open" : undefined}
          className={
            typeof className === "function"
              ? className({ open: isActive })
              : className
          }
          ref={ref}
          {...rest}
        >
          {typeof children === "function"
            ? children({ open: isActive })
            : children}
        </Component>
      </AccordionItemContextProvider>
    );
  },
);

type AccordionItemComponent = (<E extends ElementType = "div">(
  props: AccordionItemProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const AccordionItem = AccordionItemInner as AccordionItemComponent;
AccordionItem.displayName = "AccordionItem";

export { AccordionItem };
