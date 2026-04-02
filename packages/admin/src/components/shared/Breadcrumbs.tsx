// Import Dependencies
import { ReactNode, HTMLAttributes } from "react";
import { NavLink } from "react-router";
import { ChevronLeftIcon, ChevronRightIcon } from "@heroicons/react/20/solid";
import clsx from "clsx";

// Local Imports
import { isRtl } from "@/utils/localeUtils";

// ----------------------------------------------------------------------

export interface BreadcrumbItem {
  title: string;
  path?: string;
}

export interface BreadcrumbsProps extends HTMLAttributes<HTMLUListElement> {
  items?: BreadcrumbItem[];
  className?: string;
}

function Breadcrumbs({
  items = [],
  className,
  ...rest
}: BreadcrumbsProps): ReactNode {
  const SeparatorIcon = isRtl ? ChevronLeftIcon : ChevronRightIcon;

  return (
    <ul
      className={clsx("flex flex-wrap items-center gap-1.5", className)}
      {...rest}
    >
      {items.map((item, i) => (
        <li key={i} className="flex items-center gap-1.5">
          {item.path ? (
            <>
              <NavLink
                to={item.path}
                className="tracking-wide text-primary-600 transition-colors hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-500"
              >
                {item.title}
              </NavLink>
              {i < items.length - 1 && <SeparatorIcon className="size-5" />}
            </>
          ) : (
            <span className="tracking-wide"> {item.title}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export { Breadcrumbs };
