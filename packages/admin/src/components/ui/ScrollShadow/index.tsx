// Import Dependencies
import {
  ElementType,
  ReactNode,
  CSSProperties,
  forwardRef,
  ForwardedRef,
} from "react";
import clsx from "clsx";

// Local Imports
import { useDataScrollOverflow, useMergedRef } from "@/hooks";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

// ----------------------------------------------------------------------

export type ScrollShadowOwnProps<E extends ElementType = "div"> = {
  component?: E;
  children?: ReactNode;
  className?: string;
  size?: number;
  offset?: number;
  isEnabled?: boolean;
  orientation?: "vertical" | "horizontal" | "both";
  style?: CSSProperties;
};

export type ScrollShadowProps<E extends ElementType = "div"> =
  ScrollShadowOwnProps<E> &
    PolymorphicComponentProps<E, ScrollShadowOwnProps<E>>;

// Default implementation
const ScrollShadowInner = forwardRef(
  <E extends ElementType = "div">(props: any, ref: ForwardedRef<any>) => {
    const {
      component,
      children,
      className,
      size = 10,
      offset = 0,
      isEnabled = true,
      orientation = "vertical",
      style,
      ...rest
    } = props as ScrollShadowProps<E>;

    const { ref: domRef } = useDataScrollOverflow({
      offset,
      isEnabled,
      overflowCheck: orientation,
    });

    const mergedRef = useMergedRef(domRef, ref);

    const Component = component || "div";

    return (
      <Component
        ref={mergedRef}
        data-orientation={orientation}
        className={clsx(
          orientation === "vertical" && "overflow-y-auto",
          orientation === "horizontal" && "overflow-x-auto",
          orientation === "both" && "overflow-auto",
          className,
        )}
        style={
          {
            "--scroll-shadow-size": `${size / 4}rem`,
            ...style,
          } as CSSProperties
        }
        {...rest}
      >
        {children}
      </Component>
    );
  },
);

type ScrollShadowComponent = (<E extends ElementType = "div">(
  props: ScrollShadowProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const ScrollShadow = ScrollShadowInner as ScrollShadowComponent;
ScrollShadow.displayName = "ScrollShadow";

export { ScrollShadow };
