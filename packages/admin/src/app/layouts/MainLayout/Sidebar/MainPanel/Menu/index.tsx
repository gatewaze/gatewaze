// Import Dependencies
import { Dispatch, ElementType, SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

// Local Imports
import { ScrollShadow } from "@/components/ui";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { Item } from "./item";
import { NavigationTree } from "@/@types/navigation";
import { SegmentPath } from "../..";

// ----------------------------------------------------------------------

export interface MenuProps {
  nav: NavigationTree[];
  activeSegmentPath: SegmentPath;
  setActiveSegmentPath?: Dispatch<SetStateAction<SegmentPath>>;
}

export function Menu({
  nav,
  setActiveSegmentPath,
  activeSegmentPath,
}: MenuProps) {
  const { t } = useTranslation();
  const { isExpanded, open } = useSidebarContext();

  const handleSegmentSelect = (path: string) => {
    setActiveSegmentPath?.(path);
    if (!isExpanded) {
      open();
    }
  };

  const getProps = ({ path, type, title, transKey }: NavigationTree) => {
    const isLink = type === "item";

    return {
      component: isLink ? Link : ("button" as ElementType),
      ...(isLink ? { to: path } : {}),
      onClick: isLink ? undefined : () => handleSegmentSelect(path as string),
      isActive: path === activeSegmentPath,
      title: t(transKey as string) || (title as string),
      path,
    };
  };

  return (
    <ScrollShadow
      data-root-menu
      className="hide-scrollbar flex w-full grow flex-col items-center space-y-4 overflow-y-auto pt-4 lg:space-y-3 2xl:space-y-4"
    >
      {nav.map(({ id, icon, path, type, title, transKey }) => (
        <Item
          key={path}
          {...getProps({ id, icon, path, type, title, transKey })}
          id={id}
          icon={icon}
        />
      ))}
    </ScrollShadow>
  );
}
