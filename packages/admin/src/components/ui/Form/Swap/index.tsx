// Import Dependencies
import {
  ElementType,
  ReactNode,
  MouseEvent,
  forwardRef,
  ForwardedRef,
} from "react";
import clsx from "clsx";

// Local Imports
import { useUncontrolled } from "@/hooks";
import {
  SwapOff,
  SwapOn,
  SwapComponentProps,
} from "@/components/ui/Form/Swap/createSwapComponent";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

// ----------------------------------------------------------------------

type SwapValue = "on" | "off";
type SwapEffect = "fade" | "flip" | "rotate";

type SwapOwnProps<E extends ElementType = "div"> = {
  value?: SwapValue;
  defaultValue?: SwapValue;
  onChange?: (value: SwapValue) => void;
  disabled?: boolean;
  effect?: SwapEffect;
  children?: ReactNode;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
  component?: E;
};

type SwapProps<E extends ElementType = "div"> = PolymorphicComponentProps<
  E,
  SwapOwnProps<E>
>;

const SwapInner = forwardRef(
  <T extends ElementType = "input">(props: any, ref: ForwardedRef<any>) => {
    const {
      children,
      component: Component = "div",
      effect = "fade",
      value,
      className,
      defaultValue,
      onChange,
      disabled,
      onClick,
      ...rest
    } = props as SwapProps<T>;

    const [_value, handleChange] = useUncontrolled({
      value,
      defaultValue,
      finalValue: "on",
      onChange,
    });

    const handleClick = (e: MouseEvent<HTMLElement>) => {
      if (!disabled) {
        handleChange(_value === "on" ? "off" : "on");
      }
      onClick?.(e);
    };

    return (
      <Component
        data-swap-value={_value}
        ref={ref}
        disabled={disabled}
        data-disabled={disabled}
        data-swap-effect={effect}
        className={clsx(
          "swap relative inline-grid place-content-center select-none",
          effect === "flip" && "swap-flip",
          effect === "rotate" && "swap-rotate",
          _value === "on"
            ? "swap-active **:data-swap-on:z-11"
            : "**:data-swap-off:z-11",
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
          className,
        )}
        onClick={handleClick}
        {...rest}
      >
        {children}
      </Component>
    );
  },
);

type SwapComponent = (<E extends ElementType = "div">(
  props: SwapProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const Swap = SwapInner as SwapComponent;
Swap.displayName = "Swap";

export { Swap, SwapOff, SwapOn, type SwapComponentProps };
