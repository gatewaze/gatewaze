// Import Dependencies
import { ElementType, ComponentPropsWithoutRef } from "react";
import clsx from "clsx";
import { type To, useRouteLoaderData } from "react-router";

// Local Imports
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { Badge } from "@/components/ui";
import { createScopedKeydownHandler } from "@/utils/dom/createScopedKeydownHandler";
import { ColorType } from "@/constants/app";
import { navigationIcons } from "@/app/navigation/icons";

// ----------------------------------------------------------------------

export interface ItemProps {
  id: string;
  title: string;
  to?: To;
  isActive?: boolean;
  icon?: string;
  component?: ElementType;
  onClick?: (path: string) => void;
  onKeyDown?: ComponentPropsWithoutRef<"button">["onKeyDown"];
}

export function Item({
  id,
  title,
  isActive,
  icon,
  component,
  onKeyDown,
  ...rest
}: ItemProps) {
  if (!icon || !navigationIcons[icon]) {
    throw new Error(`Icon ${icon} not found in navigationIcons`);
  }

  const Element = component || "button";
  const { lgAndUp } = useBreakpointsContext();
  const info = useRouteLoaderData("root")?.[id]?.info as
    | { val?: string; color?: ColorType }
    | undefined;

  const Icon = navigationIcons[icon];

  return (
    <Element
      data-root-menu-item
      data-tooltip={lgAndUp ? true : undefined}
      data-tooltip-content={title}
      data-tooltip-place="right"
      className={clsx(
        "relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-hidden transition-colors duration-200",
        isActive
          ? "bg-white/20 text-white"
          : "text-white/70 hover:bg-white/10 focus:bg-white/10 active:bg-white/15 hover:text-white",
      )}
      onKeyDown={createScopedKeydownHandler({
        siblingSelector: "[data-root-menu-item]",
        parentSelector: "[data-root-menu]",
        activateOnFocus: false,
        loop: true,
        orientation: "vertical",
        onKeyDown,
      })}
      {...rest}
    >
      <Icon className="size-7" />
      {info?.val && (
        <Badge
          color={info.color}
          className="text-tiny-plus dark:ring-dark-800 absolute top-0 right-0 -m-1 h-4 min-w-[1rem] rounded-full px-1 py-0 ring-1 ring-white"
        >
          <span>{info.val}</span>
        </Badge>
      )}
    </Element>
  );
}
