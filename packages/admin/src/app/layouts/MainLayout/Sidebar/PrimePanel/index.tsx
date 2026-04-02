// Import Dependencies
import clsx from "clsx";
import { ChevronLeftIcon } from "@heroicons/react/20/solid";
import { useTranslation } from "react-i18next";
import { Theme } from "@radix-ui/themes";

// Local Imports
import { Button } from "@/components/ui";
import { Menu } from "./Menu";
import { NavigationTree } from "@/@types/navigation";

// ----------------------------------------------------------------------

export interface PrimePanelProps {
  currentSegment?: NavigationTree;
  pathname: string;
  close: () => void;
}

export function PrimePanel({ currentSegment, pathname, close }: PrimePanelProps) {
  const { t } = useTranslation();

  const title = t(currentSegment?.transKey ?? "") || currentSegment?.title;

  return (
    <div
      className="prime-panel flex h-full flex-col ltr:border-r rtl:border-l border-gray-900"
    >
      <Theme
        appearance="dark"
        accentColor="gray"
        className="flex h-full grow flex-col bg-black ltr:pl-(--main-panel-width) rtl:pr-(--main-panel-width)"
      >
        <div className="relative flex h-16 w-full shrink-0 items-center justify-between pl-4 pr-1 rtl:pl-1 rtl:pr-4">
          <p className="truncate text-base tracking-wider text-white">
            {title}
          </p>
          <Button
            onClick={close}
            isIcon
            variant="ghost"
            className="size-7 rounded-full xl:hidden"
          >
            <ChevronLeftIcon className="size-6 rtl:rotate-180" />
          </Button>
        </div>
        {currentSegment?.childs && (
          <Menu nav={currentSegment.childs} pathname={pathname} />
        )}
      </Theme>
    </div>
  );
}
