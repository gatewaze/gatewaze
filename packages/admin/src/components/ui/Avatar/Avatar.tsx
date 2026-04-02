import {
  ElementType,
  ReactNode,
  CSSProperties,
  forwardRef,
  ForwardedRef,
} from "react";
import { Avatar as RadixAvatar } from "@radix-ui/themes";
import clsx from "clsx";

import { colorFromText } from "@/utils/colorFromText";
import { ColorType } from "@/constants/app";
import {
  PolymorphicComponentProps,
  PolymorphicRef,
} from "@/@types/polymorphic";

type AvatarOwnProps<T extends ElementType = "div"> = {
  component?: T;
  imgComponent?: ElementType;
  alt?: string;
  loading?: React.ImgHTMLAttributes<HTMLImageElement>["loading"];
  imgProps?: React.ComponentPropsWithoutRef<"img">;
  src?: React.ImgHTMLAttributes<HTMLImageElement>["src"] | null;
  srcSet?: React.ImgHTMLAttributes<HTMLImageElement>["srcSet"] | null;
  name?: string;
  initialColor?: ColorType | "auto";
  initialVariant?: "filled" | "soft";
  initialProps?: Record<string, unknown>;
  classNames?: {
    root?: string;
    display?: string;
    image?: string;
    initial?: string;
  };
  children?: ReactNode;
  size?: number;
  style?: CSSProperties;
  indicator?: ReactNode;
};

export type AvatarProps<E extends ElementType = "div"> =
  PolymorphicComponentProps<E, AvatarOwnProps<E>>;

const colorMap: Record<
  string,
  React.ComponentProps<typeof RadixAvatar>["color"] | undefined
> = {
  primary: undefined,
  secondary: "blue",
  info: "cyan",
  success: "green",
  warning: "orange",
  error: "red",
  neutral: "gray",
};

export const AvatarInner = forwardRef(
  <T extends ElementType = "div">(props: any, ref: ForwardedRef<any>) => {
    const {
      alt,
      src,
      srcSet,
      name,
      initialColor = "neutral",
      initialVariant = "filled",
      className,
      classNames = {},
      children,
      size = 12,
      style,
      indicator,
      // Preserved in type for backwards compat
      component: _component,
      imgComponent: _imgComponent,
      loading: _loading,
      imgProps: _imgProps,
      initialProps: _initialProps,
      ...rest
    } = props as AvatarProps<T>;

    const chars =
      name
        ?.match(/\b(\w)/g)
        ?.slice(0, 2)
        .join("") || "";

    const resolvedColor: ColorType =
      initialColor === "auto"
        ? colorFromText(chars)
        : (initialColor ?? "neutral");

    const radixColor = colorMap[resolvedColor];
    const radixVariant = initialVariant === "soft" ? "soft" : "solid";
    const fallbackText = name ? chars : (children as string) || "?";
    const sizeRem = size / 4;

    return (
      <div
        className={clsx(
          "relative inline-flex shrink-0",
          className,
          classNames?.root,
        )}
        style={{ height: `${sizeRem}rem`, width: `${sizeRem}rem`, ...style }}
        ref={ref}
        {...(rest as any)}
      >
        <RadixAvatar
          src={src || undefined}
          fallback={fallbackText}
          alt={alt || name || "avatar"}
          variant={radixVariant}
          {...(radixColor ? { color: radixColor } : {})}
          style={{ width: "100%", height: "100%" }}
        />
        {indicator}
      </div>
    );
  },
);

type AvatarComponent = (<E extends ElementType = "div">(
  props: AvatarProps<E> & { ref?: PolymorphicRef<E> },
) => ReactNode) & { displayName?: string };

const Avatar = AvatarInner as AvatarComponent;
Avatar.displayName = "Avatar";

export { Avatar };
