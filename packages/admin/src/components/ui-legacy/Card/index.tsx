// @ts-nocheck
// Import Dependencies
import { ElementType, ForwardedRef, forwardRef, ReactNode } from "react";
import clsx from "clsx";

// Local Imports
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";
import { useThemeContext } from "@/app/contexts/theme/context";

// ------------------------------------------------------------------------

type Skin = "none" | "bordered" | "shadow";

type CardOwnProps<E extends ElementType = "div"> = {
  children?: ReactNode;
  className?: string;
  component?: E;
  skin?: Skin;
};

export type CardProps<E extends ElementType = "div"> =
  PolymorphicComponentProps<E, CardOwnProps<E>>;

const CardInner = forwardRef(
  <E extends ElementType = "div">(props: any, ref: ForwardedRef<any>) => {
    const { component, className, children, skin, ...rest } =
      props as CardProps<E>;

    const { cardSkin } = useThemeContext();
    const appliedSkin = skin ?? cardSkin;

    const Component = component || "div";

    return (
      <Component
        ref={ref}
        className={clsx(
          "card rounded-lg",
          appliedSkin !== "none" && [
            appliedSkin === "bordered" &&
              "dark:border-dark-600 border border-gray-200 print:border-0",
            appliedSkin === "shadow" &&
              "shadow-soft dark:bg-dark-700 bg-white dark:shadow-none print:shadow-none",
          ],
          className,
        )}
        {...rest}
      >
        {children}
      </Component>
    );
  },
);

type CardComponent = (<E extends ElementType = "div">(
  props: CardProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const Card = CardInner as CardComponent;
Card.displayName = "Card";

export { Card };
