// Import Dependencies
import { ElementType, ReactNode, forwardRef, ForwardedRef } from "react";

// Local imports
import { AccordionProvider } from "./AccordionProvider";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

// -----------------------------------------------------------------------------

type AccordionOwnProps<E extends ElementType = "div"> = {
  component?: E;
  id?: string;
  children?: ReactNode;
  multiple?: boolean;
  value?: any;
  defaultValue?: any;
  onChange?: (value: any) => void;
  transitionDuration?: number;
  loop?: boolean;
};

export type AccordionProps<E extends ElementType = "div"> =
  PolymorphicComponentProps<E, AccordionOwnProps<E>>;

const AccordionInner = forwardRef(
  <E extends ElementType = "div">(props: any, ref: ForwardedRef<any>) => {
    const {
      component,
      id,
      children,
      multiple,
      value,
      defaultValue,
      onChange,
      transitionDuration,
      loop,
      ...rest
    } = props as AccordionProps<E>;

    const Component = component || "div";

    return (
      <AccordionProvider
        id={id}
        multiple={multiple}
        value={value}
        defaultValue={defaultValue}
        onChange={onChange}
        transitionDuration={transitionDuration}
        loop={loop}
      >
        <Component {...rest} ref={ref} data-accordion>
          {children}
        </Component>
      </AccordionProvider>
    );
  },
);

type AccordionComponent = (<E extends ElementType = "div">(
  props: AccordionProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const Accordion = AccordionInner as AccordionComponent;
Accordion.displayName = "Accordion";

export { Accordion };
