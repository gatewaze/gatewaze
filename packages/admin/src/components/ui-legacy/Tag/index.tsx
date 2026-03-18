// Import Dependencies
import clsx from "clsx";
import {
  ElementType,
  ComponentPropsWithoutRef,
  forwardRef,
  ForwardedRef,
  ReactNode,
} from "react";

// Local Imports
import { ColorType } from "@/constants/app";
import { setThisClass } from "@/utils/setThisClass";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

// ----------------------------------------------------------------------

type Variant = "filled" | "outlined" | "soft";

type TagOwnProps<T extends ElementType = "a"> = {
  component?: T;
  className?: string;
  children?: React.ReactNode;
  color?: ColorType;
  unstyled?: boolean;
  variant?: Variant;
  isGlow?: boolean;
} & ComponentPropsWithoutRef<T>;

export type TagProps<E extends ElementType = "a"> = PolymorphicComponentProps<
  E,
  TagOwnProps<E>
>;

const variants: Record<Variant, string> = {
  filled:
    "bg-this text-white hover:bg-this-darker focus:bg-this-darker active:bg-this-darker/90 disabled:bg-this-light dark:disabled:bg-this-darker",
  outlined:
    "border border-gray-300 dark:border-dark-450 text-this hover:border-this focus:border-this dark:border-this-lighter/30 dark:text-this-lighter dark:hover:border-this-lighter dark:focus:border-this-lighter",
  soft: "text-this-darker bg-this-darker/[0.07] hover:text-white hover:bg-this-darker focus:text-white focus:bg-this-darker dark:text-this-lighter dark:bg-this-lighter/[.13] dark:hover:bg-this dark:hover:text-white dark:focus:bg-this dark:focus:text-white",
};

const neutralVariants: Record<Variant, string> = {
  filled:
    "bg-gray-150 text-gray-900 hover:bg-gray-200 focus:bg-gray-200 active:bg-gray-200/80 dark:bg-surface-2 dark:text-dark-100 dark:hover:bg-surface-1 dark:focus:bg-surface-1 dark:active:bg-surface-1/90",
  outlined:
    "border border-gray-300 text-gray-800 hover:border-gray-800 focus:border-gray-800 dark:border-surface-2 dark:text-dark-100 dark:hover:border-dark-100 dark:focus:border-dark-100",
  soft: "text-this-darker bg-gray-150/10 hover:text-gray-900 focus:text-gray-900 hover:bg-gray-150 focus:bg-gray-150 active:bg-gray-150/80 dark:text-dark-100 dark:bg-dark-500/10 dark:hover:bg-dark-500 dark:focus:bg-dark-500 dark:active:bg-dark-500/80",
};

const TagInner = forwardRef(
  <E extends ElementType = "a">(props: TagProps<E>, ref: ForwardedRef<any>) => {
    const {
      component,
      className,
      children,
      color = "neutral",
      unstyled,
      variant = "filled",
      isGlow,
      ...rest
    } = props as TagProps<E>;
    const Component = component || "a";

    return (
      <Component
        className={clsx(
          "tag-base",
          !unstyled && [
            "tag",
            color === "neutral"
              ? [
                  neutralVariants[variant],
                  isGlow &&
                    "dark:shadow-dark-450/50 shadow-lg shadow-gray-200/50",
                ]
              : [
                  setThisClass(color),
                  variants[variant],
                  isGlow &&
                    "shadow-this/50 dark:shadow-this-light/50 shadow-lg",
                ],
          ],
          className,
        )}
        ref={ref}
        {...rest}
      >
        {children}
      </Component>
    );
  },
);

type TagComponent = (<E extends ElementType = "a">(
  props: TagProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const Tag = TagInner as TagComponent;
Tag.displayName = "Tag";

export { Tag };
