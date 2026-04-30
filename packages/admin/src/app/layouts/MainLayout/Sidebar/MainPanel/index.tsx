// Import Dependencies
import { Link } from "react-router";
import { SetStateAction, Dispatch } from "react";
import { Theme } from "@radix-ui/themes";

// Local Imports
import { BrandLogo } from "@/components/BrandLogo";
import { Menu } from "./Menu";
import { Item } from "./Menu/item";
import { useAuthContext } from "@/app/contexts/auth/context";
import { settings } from "@/app/navigation/segments/settings";
import { NavigationTree } from "@/@types/navigation";
import { SegmentPath } from "..";
import { navigationIcons } from "@/app/navigation/icons";

// ----------------------------------------------------------------------

// Define Prop Types
interface MainPanelProps {
  nav: NavigationTree[];
  setActiveSegmentPath?: Dispatch<SetStateAction<SegmentPath>>;
  activeSegmentPath: SegmentPath;
}

export function MainPanel({
  nav,
  setActiveSegmentPath,
  activeSegmentPath,
}: MainPanelProps) {
  const { logout } = useAuthContext();

  const LogoutIcon = navigationIcons['logout'];

  const handleLogout = () => {
    logout();
  };

  return (
    <div className="main-panel">
      <Theme
        appearance="dark"
        accentColor="gray"
        className="border-[var(--accent-a4)] flex h-full w-full flex-col items-center ltr:border-r rtl:border-l bg-[var(--accent-2)]"
      >
        {/* Application Logo */}
        <div className="flex pt-3.5">
          <Link to="/">
            <BrandLogo type="logo" className="text-[var(--brand-accent)] size-10" />
          </Link>
        </div>

        <div className="mt-4 flex w-full grow flex-col overflow-hidden">
          <Menu
            nav={nav}
            activeSegmentPath={activeSegmentPath}
            setActiveSegmentPath={setActiveSegmentPath}
          />
        </div>

        {/* Bottom Links */}
        <div className="flex flex-col items-center space-y-3 py-2.5">
          <Item
            id={settings.id}
            component={Link}
            to="/admin/settings"
            title="Settings"
            isActive={activeSegmentPath === settings.path}
            icon={settings.icon}
          />
          <button
            onClick={handleLogout}
            data-tooltip
            data-tooltip-content="Sign Out"
            data-tooltip-place="right"
            className="relative flex size-11 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-hidden transition-colors duration-200 text-[var(--accent-11)] hover:bg-[var(--accent-a3)] focus:bg-[var(--accent-a3)] active:bg-[var(--accent-a4)] hover:text-[var(--accent-12)]"
          >
            <LogoutIcon className="size-7" />
          </button>
        </div>
      </Theme>
    </div>
  );
}
