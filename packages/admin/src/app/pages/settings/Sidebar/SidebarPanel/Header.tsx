// Import Dependencies
import { ChevronLeftIcon } from "@heroicons/react/20/solid";
import { useTranslation } from "react-i18next";

// Local Imports
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { Avatar, Button } from "@/components/ui";
import { settings } from "@/app/navigation/segments/settings";
import { navigationIcons } from "@/app/navigation/icons";

// ----------------------------------------------------------------------

export function Header() {
  const { close: closeSidebar } = useSidebarContext();

  if (!settings.icon || !navigationIcons[settings.icon]) {
    throw new Error(`Icon ${settings.icon} not found in navigationIcons`);
  }

  const Icon = navigationIcons[settings.icon];

  const { t } = useTranslation();

  const title = t(settings.transKey ?? "") || settings.title;

  return (
    <div className="relative flex h-18 w-full shrink-0 items-center justify-between pl-4 pr-1 rtl:pl-1 rtl:pr-4">
      <div className="flex items-center gap-3">
        <Avatar size={9} initialColor="primary" initialVariant="soft">
          <Icon className="size-5.5 stroke-2" />
        </Avatar>
        <p className="truncate text-base tracking-wider text-[var(--gray-12)]">
          {title}
        </p>
      </div>
      <Button
        onClick={closeSidebar}
        isIcon
        variant="ghost"
        className="size-7 rounded-full xl:hidden"
      >
        <ChevronLeftIcon className="size-6 rtl:rotate-180" />
      </Button>
    </div>
  );
}
