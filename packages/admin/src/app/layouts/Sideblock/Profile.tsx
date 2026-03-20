// Import Dependencies
import React from "react";
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
import { Avatar, AvatarDot, type AvatarProps, Button } from "@/components/ui";
import { useAuthContext } from "@/app/contexts/auth/context";

// ----------------------------------------------------------------------

interface LinkItem {
  id: string;
  title: string;
  description: string;
  to: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  color: AvatarProps["initialColor"];
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

export function Profile() {
  const { user, logout } = useAuthContext();

  const handleLogout = () => {
    logout();
  };

  return (
    <Popover className="relative flex">
      <PopoverButton
        as={Avatar}
        size={9}
        role="button"
        indicator={
          <AvatarDot
            color="success"
            className="-m-0.5 size-3 ltr:right-0 rtl:left-0"
          />
        }
        className="cursor-pointer"
      >
        {user?.name?.charAt(0).toUpperCase() || 'U'}
      </PopoverButton>
      <Transition
        enter="duration-200 ease-out"
        enterFrom="translate-y-2 opacity-0"
        enterTo="translate-y-0 opacity-100"
        leave="duration-200 ease-out"
        leaveFrom="translate-y-0 opacity-100"
        leaveTo="translate-y-2 opacity-0"
      >
        <PopoverPanel
          anchor={{ to: "bottom end", gap: 12 }}
          className="z-70 flex w-64 flex-col rounded-lg border border-[var(--gray-a6)] bg-[var(--color-background)] shadow-sm transition"
        >
          {({ close }: { close: () => void }) => (
            <>
              <div className="flex items-center gap-4 rounded-t-lg bg-[var(--gray-a3)] px-4 py-5">
                <Avatar size={14}>
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
              <div className="flex flex-col pt-2 pb-5">
                {links.map((link) => (
                  <Link
                    key={link.id}
                    to={link.to}
                    onClick={close}
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
