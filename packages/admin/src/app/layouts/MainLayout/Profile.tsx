// Import Dependencies
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Transition,
} from "@headlessui/react";
import {
  ArrowLeftStartOnRectangleIcon,
} from "@heroicons/react/24/outline";
import { TbUser } from "react-icons/tb";
import { Link } from "react-router";

// Local Imports
import { Avatar, AvatarDot, Button } from "@/components/ui";
import { ColorType } from "@/constants/app";
import { useAuthContext } from "@/app/contexts/auth/context";

// Define Link Types
interface LinkItem {
  id: string;
  title: string;
  description: string;
  to: string;
  Icon: React.ElementType;
  color: ColorType;
}

const links: LinkItem[] = [
  {
    id: "1",
    title: "Profile",
    description: "Your profile settings",
    to: "/settings/general",
    Icon: TbUser,
    color: "warning",
  },
];

// ----------------------------------------------------------------------

export function Profile() {
  const { user, logout } = useAuthContext();

  const handleLogout = () => {
    logout();
  };

  return (
    <Popover className="relative">
      <PopoverButton
        as={Avatar}
        size={12}
        role="button"
        alt="Profile"
        indicator={
          <AvatarDot color="success" className="ltr:right-0 rtl:left-0" />
        }
        className="cursor-pointer"
      >
        {user?.name?.charAt(0).toUpperCase() || 'U'}
      </PopoverButton>
      <Transition
        enter="duration-200 ease-out"
        enterFrom="translate-x-2 opacity-0"
        enterTo="translate-x-0 opacity-100"
        leave="duration-200 ease-out"
        leaveFrom="translate-x-0 opacity-100"
        leaveTo="translate-x-2 opacity-0"
      >
        <PopoverPanel
          anchor={{ to: "right end", gap: 12 }}
          className="z-70 flex w-64 flex-col rounded-lg border border-[var(--gray-a6)] bg-[var(--color-background)] shadow-sm transition"
        >
          {({ close }) => (
            <>
              {/* User Info */}
              <div className="flex items-center gap-4 rounded-t-lg bg-[var(--gray-a3)] px-4 py-5">
                <Avatar
                  size={14}
                  alt="Profile"
                >
                  {user?.name?.charAt(0).toUpperCase() || 'U'}
                </Avatar>
                <div>
                  <Link
                    className="text-base font-medium text-[var(--gray-11)] hover:text-[var(--accent-9)] focus:text-[var(--accent-9)]"
                    to="/admin/settings"
                  >
                    {user?.name || 'User'}
                  </Link>
                </div>
              </div>

              {/* Navigation Links */}
              <div className="flex flex-col pb-5 pt-2">
                {links.map((link) => (
                  <Link
                    key={link.id}
                    to={link.to}
                    onClick={() => close()}
                    className="group flex items-center gap-3 px-4 py-2 tracking-wide outline-hidden transition-all hover:bg-[var(--gray-a3)] focus:bg-[var(--gray-a3)]"
                  >
                    <Avatar
                      size={8}
                      initialColor={link.color}
                      classNames={{ display: "rounded-lg" }}
                    >
                      <link.Icon className="size-4.5" />
                    </Avatar>
                    <div>
                      <h2 className="font-medium text-[var(--gray-12)] transition-colors group-hover:text-[var(--accent-9)] group-focus:text-[var(--accent-9)]">
                        {link.title}
                      </h2>
                      <div className="truncate text-xs text-[var(--gray-a8)]">
                        {link.description}
                      </div>
                    </div>
                  </Link>
                ))}

                {/* Logout Button */}
                <div className="px-4 pt-4">
                  <Button className="w-full gap-2" onClick={handleLogout}>
                    <ArrowLeftStartOnRectangleIcon className="size-4.5" />
                    <span>Logout</span>
                  </Button>
                </div>
              </div>
            </>
          )}
        </PopoverPanel>
      </Transition>
    </Popover>
  );
}
