// Import Dependencies
import clsx from "clsx";

// ----------------------------------------------------------------------

export interface DropIndicatorProps {
  edge: "top" | "bottom" | "left" | "right";
  gap?: string;
}

export function DropIndicator({ edge, gap = "0px" }: DropIndicatorProps) {
  const lineOffset = `calc(-0.5 * (${gap} + 1px))`;

  return (
    <div
      className={clsx(
        "bg-primary-600 before:border-primary-600 absolute before:absolute before:size-2.5 before:rounded-full before:border-2",
        (edge === "top" || edge === "bottom") &&
          "inset-x-0 h-0.5 w-full before:-left-2.5 before:-translate-y-1/2",
        (edge === "left" || edge === "right") &&
          "inset-y-0 h-full w-0.5 before:-top-2.5 before:-translate-x-1/2",
        edge === "top" && "top-(--llo)",
        edge === "bottom" && "bottom-(--llo)",
        edge === "left" && "left-(--llo)",
        edge === "right" && "right-(--llo)",
      )}
      style={{ "--llo": lineOffset } as React.CSSProperties}
    />
  );
}
