// Import Dependencies
import clsx from "clsx";
import {
  DocumentMagnifyingGlassIcon,
  QuestionMarkCircleIcon,
} from "@heroicons/react/24/outline";
import { Link, NavLink, To } from "react-router";
import { useTranslation } from "react-i18next";

// Local Imports
import { Header } from "./Header";
import { Footer } from "./Footer";
import { Button, ScrollShadow } from "@/components/ui";
import { createScopedKeydownHandler } from "@/utils/dom/createScopedKeydownHandler";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { settings } from "@/app/navigation/segments/settings";
import { navigationIcons } from "@/app/navigation/icons";

// ----------------------------------------------------------------------

export function SidebarPanel() {
  return (
    <div
      className="prime-panel flex flex-col border-[var(--gray-a6)] ltr:border-r rtl:border-l"
    >
      <div
        className="flex h-full grow flex-col bg-[var(--color-background)] ltr:pl-(--main-panel-width) rtl:pr-(--main-panel-width)"
      >
        <Header />
        <ScrollShadow className="grow">
          <ul className="space-y-1.5 px-2 font-medium" data-menu-list>
            {settings.childs?.map((item) => (
              <li key={item.path}>
                <MenuItem
                  title={item.title ?? ""}
                  transKey={item.transKey ?? ""}
                  icon={item.icon ?? ""}
                  path={item.path ?? ""}
                />
              </li>
            ))}
          </ul>

          <div className="bg-[var(--gray-a6)] mx-4 my-4 h-px"></div>

          <ul className="space-y-1.5 px-2 font-medium">
            <li>
              <Button
                component={Link}
                to="/docs/getting-started"
                variant="flat"
                className="group text-xs-plus w-full justify-start gap-2 p-2"
              >
                <DocumentMagnifyingGlassIcon className="size-4.5 text-[var(--gray-a8)] transition-colors group-hover:text-[var(--gray-11)] group-focus:text-[var(--gray-11)]" />
                <span>Documentation</span>
              </Button>
            </li>
            <li>
              <Button
                variant="flat"
                className="group text-xs-plus w-full justify-start gap-2 p-2"
              >
                <QuestionMarkCircleIcon className="size-4.5 text-[var(--gray-a8)] transition-colors group-hover:text-[var(--gray-11)] group-focus:text-[var(--gray-11)]" />
                <span>FAQ</span>
              </Button>
            </li>
          </ul>
        </ScrollShadow>
        <Footer />
      </div>
    </div>
  );
}

function MenuItem({
  title,
  transKey,
  icon,
  path,
  ...rest
}: {
  title: string;
  transKey: string;
  icon: string;
  path: To;
}) {
  const { lgAndDown } = useBreakpointsContext();
  const { close } = useSidebarContext();
  const { t } = useTranslation();

  if (!icon || !navigationIcons[icon]) {
    throw new Error(`Icon ${icon} not found in navigationIcons`);
  }

  const Icon = navigationIcons[icon];

  return (
    <NavLink to={path} {...rest}>
      {({ isActive, isPending }) => (
        <Button
          variant="flat"
          color={isActive ? "primary" : "neutral"}
          className={clsx(
            "group text-xs-plus w-full justify-start gap-2 p-2",
            isPending && "opacity-80",
          )}
          onKeyDown={createScopedKeydownHandler({
            siblingSelector: "[data-menu-list-item]",
            parentSelector: "[data-menu-list]",
            activateOnFocus: true,
            loop: true,
            orientation: "vertical",
          })}
          data-menu-list-item
          onClick={() => lgAndDown && close()}
        >
          {Icon && (
            <Icon
              className={clsx(
                isActive
                  ? "text-[var(--accent-9)]"
                  : "text-[var(--gray-a8)] group-hover:text-[var(--gray-11)] group-focus:text-[var(--gray-11)]",
                "size-4.5 transition-colors",
              )}
            />
          )}
          <span>{t(transKey) || title}</span>
        </Button>
      )}
    </NavLink>
  );
}
