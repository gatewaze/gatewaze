// Import Dependencies
import { ElementType } from "react";
import { EllipsisHorizontalIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";

// Local Imports
import { usePaginationContext } from "./Pagination.context";

// ----------------------------------------------------------------------

export const PaginationDots = ({ icon }: { icon?: ElementType }) => {
  const Icon = icon || EllipsisHorizontalIcon;
  const ctx = usePaginationContext();

  return (
    <div
      className={clsx(
        "pagination-control pagination-control-icon",
        ctx.classNames?.control,
        ctx.classNames?.controlIcon,
      )}
    >
      <Icon className={clsx("pagination-icon", ctx.classNames?.icon)} />
    </div>
  );
};

PaginationDots.displayName = "PaginationDots";
