import { forwardRef } from "react";
import { Badge as RadixBadge } from "@radix-ui/themes";
import type { ComponentProps } from "react";

type RadixBadgeProps = ComponentProps<typeof RadixBadge>;

const variantMap: Record<string, RadixBadgeProps["variant"]> = {
  filled: "solid",
  outlined: "outline",
  soft: "soft",
  solid: "solid",
  outline: "outline",
  surface: "surface",
};

const colorMap: Record<string, RadixBadgeProps["color"] | undefined> = {
  primary: undefined,
  secondary: "blue",
  info: "cyan",
  success: "green",
  warning: "orange",
  error: "red",
  neutral: "gray",
};

type SemanticColor = "primary" | "secondary" | "info" | "success" | "warning" | "error" | "neutral";

export type BadgeProps = Omit<RadixBadgeProps, "color" | "variant"> & {
  color?: RadixBadgeProps["color"] | SemanticColor;
  variant?: RadixBadgeProps["variant"] | "filled" | "outlined" | "success" | "secondary" | "primary" | "default";
  /** @deprecated No longer supported */
  unstyled?: boolean;
  /** @deprecated No longer supported */
  isGlow?: boolean;
  /** @deprecated Use `asChild` instead */
  component?: any;
};

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ variant = "solid", color, unstyled, isGlow, component, ...rest }, ref) => {
    const mappedVariant = variantMap[variant as string] ?? "solid";
    const mappedColor = color
      ? (colorMap[color as string] ?? (color as RadixBadgeProps["color"]))
      : undefined;

    return (
      <RadixBadge
        ref={ref}
        variant={mappedVariant}
        {...(mappedColor ? { color: mappedColor } : {})}
        {...rest}
      />
    );
  },
);

Badge.displayName = "Badge";
