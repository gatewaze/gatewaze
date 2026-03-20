// Import Dependencies
import { ElementType, HTMLAttributes, ReactNode, RefObject } from "react";
import clsx from "clsx";

// Types
type SwapValue = "on" | "off";

export interface SwapComponentProps extends HTMLAttributes<HTMLElement> {
  component?: ElementType;
  children?: ReactNode;
  ref?: RefObject<HTMLElement>;
}

// ----------------------------------------------------------------------

function createSwapComponent({ currentVal }: { currentVal: SwapValue }) {
  const Component = ({
    children,
    className,
    component: CustomComponent = "div",
    ref,
    ...rest
  }: SwapComponentProps & { [key: string]: any }) => {
    return (
      <CustomComponent
        {...{ [`data-swap-${currentVal}`]: true }}
        ref={ref}
        className={clsx(
          "z-10 col-start-1 row-start-1 fill-current transition-[transform,opacity] duration-300 ease-out",
          `swap-${currentVal}`,
          className,
        )}
        {...rest}
      >
        {children}
      </CustomComponent>
    );
  };

  Component.displayName = `Swap${currentVal}`;

  return Component;
}

export const SwapOn = createSwapComponent({ currentVal: "on" });
export const SwapOff = createSwapComponent({ currentVal: "off" });
