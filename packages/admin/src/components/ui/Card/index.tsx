import { forwardRef } from "react";
import { Card as RadixCard } from "@radix-ui/themes";
import type { ComponentProps } from "react";

type RadixCardProps = ComponentProps<typeof RadixCard>;

// Map old skin names to Radix variants
const skinMap: Record<string, RadixCardProps["variant"]> = {
  shadow: "surface",
  bordered: "classic",
  none: "ghost",
  // Also accept Radix names directly
  surface: "surface",
  classic: "classic",
  ghost: "ghost",
};

export type CardProps = RadixCardProps & {
  /** @deprecated Use `variant` instead */
  skin?: string;
  /** @deprecated Use `asChild` instead */
  component?: any;
};

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ skin, variant, component, ...rest }, ref) => {
    const mappedVariant = skin
      ? skinMap[skin] ?? "surface"
      : variant ?? "surface";

    return <RadixCard ref={ref} variant={mappedVariant} {...rest} />;
  },
);

Card.displayName = "Card";
