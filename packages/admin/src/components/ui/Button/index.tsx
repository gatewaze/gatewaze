import { forwardRef } from "react";
import {
  Button as RadixButton,
  IconButton as RadixIconButton,
} from "@radix-ui/themes";
import type { ComponentProps } from "react";

type RadixButtonProps = ComponentProps<typeof RadixButton>;
type RadixIconButtonProps = ComponentProps<typeof RadixIconButton>;

// Backwards-compat: map old variant names to Radix variants
const variantMap: Record<string, RadixButtonProps["variant"]> = {
  filled: "solid",
  outlined: "outline",
  soft: "soft",
  flat: "ghost",
  // Also accept Radix names directly
  solid: "solid",
  outline: "outline",
  ghost: "ghost",
  surface: "surface",
  classic: "classic",
};

// Backwards-compat: map old ColorType to Radix color names
const colorMap: Record<string, RadixButtonProps["color"]> = {
  primary: undefined, // uses accent
  secondary: "blue",
  info: "cyan",
  success: "green",
  warning: "orange",
  error: "red",
  neutral: "gray",
  // Also accept Radix names directly
  red: "red",
  blue: "blue",
  green: "green",
  orange: "orange",
  cyan: "cyan",
  gray: "gray",
};

type SemanticColor = "primary" | "secondary" | "info" | "success" | "warning" | "error" | "neutral";
type LegacyVariant = "filled" | "outlined" | "flat";

export type ButtonProps = Omit<RadixButtonProps, "color" | "variant" | "size"> & {
  color?: RadixButtonProps["color"] | SemanticColor;
  variant?: RadixButtonProps["variant"] | LegacyVariant;
  size?: RadixButtonProps["size"] | "sm" | "xs" | "md" | "lg";
  /** @deprecated Use `variant="solid"` instead */
  isIcon?: boolean;
  /** @deprecated No longer supported */
  unstyled?: boolean;
  /** @deprecated No longer supported */
  isGlow?: boolean;
  /** @deprecated Use `asChild` instead */
  component?: any;
  /** Polymorphic: pass-through props (e.g. `to` for Link) */
  [key: string]: any;
};

const sizeMap: Record<string, RadixButtonProps["size"]> = {
  xs: "1",
  sm: "1",
  md: "2",
  lg: "3",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "solid", color, size, isIcon, unstyled, isGlow, component, ...rest }, ref) => {
    const mappedVariant = variantMap[variant as string] ?? "solid";
    const mappedColor = color ? (colorMap[color as string] ?? (color as RadixButtonProps["color"])) : undefined;
    const mappedSize = size ? (sizeMap[size as string] ?? (size as RadixButtonProps["size"])) : undefined;

    // unstyled -> ghost with no color
    if (unstyled) {
      return <RadixButton ref={ref} variant="ghost" highContrast {...(mappedSize ? { size: mappedSize } : {})} {...rest as any} />;
    }

    if (isIcon) {
      return (
        <RadixIconButton
          ref={ref}
          variant={mappedVariant as RadixIconButtonProps["variant"]}
          {...(mappedColor ? { color: mappedColor } : {})}
          {...(mappedSize ? { size: mappedSize } : {})}
          {...(rest as any)}
        />
      );
    }

    return (
      <RadixButton
        ref={ref}
        variant={mappedVariant}
        {...(mappedColor ? { color: mappedColor } : {})}
        {...(mappedSize ? { size: mappedSize } : {})}
        {...(rest as any)}
      />
    );
  },
);

Button.displayName = "Button";

// Also export IconButton for direct usage
export const IconButton = RadixIconButton;
