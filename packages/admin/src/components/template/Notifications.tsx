// Import Dependencies
import {
  Popover,
  PopoverButton,
  PopoverPanel,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels,
  Transition,
} from "@headlessui/react";
import {
  ArchiveBoxXMarkIcon,
  Cog6ToothIcon,
  DocumentTextIcon,
  EnvelopeIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { IoCheckmarkDoneOutline } from "react-icons/io5";
import clsx from "clsx";
import React, { Fragment, useState, FocusEvent } from "react";
import { Link } from "react-router";

// Local Imports
import {
  Avatar,
  type AvatarProps,
  AvatarDot,
  Badge,
  Button,
} from "@/components/ui";
import { useThemeContext } from "@/app/contexts/theme/context";
import { NotificationType } from "@/@types/common";
import AlarmIcon from "@/assets/dualicons/alarm.svg?react";
import GirlEmptyBox from "@/assets/illustrations/girl-empty-box.svg?react";

// ----------------------------------------------------------------------

interface NotificationTypeInfo {
  title: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  color: AvatarProps["initialColor"];
}

interface Notification {
  id: string;
  title: string;
  description: string;
  type: NotificationType;
  time: string;
}

interface NotificationItemProps {
  data: Notification;
  remove: (id: string) => void;
}

const types: Record<NotificationType, NotificationTypeInfo> = {
  message: {
    title: "Message",
    Icon: EnvelopeIcon,
    color: "info",
  },
  task: {
    title: "Task",
    Icon: IoCheckmarkDoneOutline,
    color: "success",
  },
  log: {
    title: "Log",
    Icon: DocumentTextIcon,
    color: "neutral",
  },
  security: {
    title: "Security",
    Icon: ExclamationTriangleIcon,
    color: "error",
  },
};

const fakeNotifications: Notification[] = [
  {
    id: "1",
    title: "User Photo Changed",
    description: "John Doe changed his avatar photo",
    type: "log",
    time: "2 hours ago",
  }
];

const typesKey = Object.keys(types) as NotificationType[];

export function Notifications() {
  const [notifications, setNotifications] =
    useState<Notification[]>(fakeNotifications);
  const [activeTab, setActiveTab] = useState<number>(0);

  const filteredNotifications = notifications.filter(
    (notification) => notification.type === typesKey[activeTab - 1],
  );

  const removeNotification = (id: string): void => {
    setNotifications((n) => n.filter((notification) => notification.id !== id));
  };

  const clearNotifications = (): void => {
    if (activeTab === 0) {
      setNotifications([]);
    } else {
      setNotifications((n) =>
        n.filter(
          (notification) => notification.type !== typesKey[activeTab - 1],
        ),
      );
    }
  };

  return (
    <Popover className="relative flex">
      <PopoverButton
        as={Button}
        variant="flat"
        isIcon
        className="relative size-9 rounded-full"
      >
        <AlarmIcon className="size-6 text-[var(--gray-12)]" />
        {notifications.length > 0 && (
          <AvatarDot
            color="error"
            isPing
            className="top-0 ltr:right-0 rtl:left-0"
          />
        )}
      </PopoverButton>
      <Transition
        enter="transition ease-out"
        enterFrom="opacity-0 translate-y-2"
        enterTo="opacity-100 translate-y-0"
        leave="transition ease-in"
        leaveFrom="opacity-100 translate-y-0"
        leaveTo="opacity-0 translate-y-2"
      >
        <PopoverPanel
          anchor={{ to: "bottom end", gap: 8 }}
          className="z-70 mx-4 flex h-[min(32rem,calc(100vh-6rem))] w-[calc(100vw-2rem)] flex-col rounded-lg border border-[var(--gray-a5)] bg-[var(--color-background)] shadow-soft dark:shadow-soft-dark sm:m-0 sm:w-80"
        >
          {({ close }: { close: () => void }) => (
            <div className="flex grow flex-col overflow-hidden">
              <div className="rounded-t-lg bg-[var(--gray-a3)]">
                <div className="flex items-center justify-between px-4 pt-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-[var(--gray-12)]">
                      Notifications
                    </h3>
                    {notifications.length > 0 && (
                      <Badge
                        color="primary"
                        className="h-5 rounded-full px-1.5"
                        variant="soft"
                      >
                        {notifications.length}
                      </Badge>
                    )}
                  </div>
                  <Button
                    component={Link}
                    to="/settings/notifications"
                    className="size-7 rounded-full ltr:-mr-1.5 rtl:-ml-1.5"
                    isIcon
                    variant="flat"
                    onClick={close}
                  >
                    <Cog6ToothIcon className="size-4.5" />
                  </Button>
                </div>
              </div>
              <TabGroup
                as={Fragment}
                selectedIndex={activeTab}
                onChange={setActiveTab}
              >
                <TabList className="hide-scrollbar flex shrink-0 overflow-x-auto scroll-smooth bg-[var(--gray-a3)] px-3">
                  <Tab
                    onFocus={(e: FocusEvent<HTMLButtonElement>) => {
                      const target = e.target;
                      const parent = target.parentNode as HTMLElement;
                      if (parent) {
                        parent.scrollLeft =
                          target.offsetLeft - parent.offsetWidth / 2;
                      }
                    }}
                    className={({ selected }: { selected: boolean }) =>
                      clsx(
                        "shrink-0 scroll-mx-16 whitespace-nowrap border-b-2 px-3 py-2 font-medium",
                        selected
                          ? "border-primary-600 text-primary-600 dark:border-primary-500 dark:text-primary-400"
                          : "border-transparent hover:text-[var(--gray-12)] focus:text-[var(--gray-12)]",
                      )
                    }
                    as={Button}
                    unstyled
                  >
                    All
                  </Tab>
                  {typesKey.map((key) => (
                    <Tab
                      onFocus={(e: FocusEvent<HTMLButtonElement>) => {
                        const target = e.target;
                        const parent = target.parentNode as HTMLElement;
                        if (parent) {
                          parent.scrollLeft =
                            target.offsetLeft - parent.offsetWidth / 2;
                        }
                      }}
                      key={key}
                      className={({ selected }: { selected: boolean }) =>
                        clsx(
                          "shrink-0 scroll-mx-16 whitespace-nowrap border-b-2 px-3 py-2 font-medium",
                          selected
                            ? "border-primary-600 text-primary-600 dark:border-primary-500 dark:text-primary-400"
                            : "border-transparent hover:text-[var(--gray-12)] focus:text-[var(--gray-12)]",
                        )
                      }
                      as={Button}
                      unstyled
                    >
                      {types[key].title}
                    </Tab>
                  ))}
                </TabList>
                {(notifications.length > 0 && activeTab === 0) ||
                filteredNotifications.length > 0 ? (
                  <TabPanels as={Fragment}>
                    <TabPanel className="custom-scrollbar grow space-y-4 overflow-y-auto overflow-x-hidden p-4 outline-hidden">
                      {notifications.map((item) => (
                        <NotificationItem
                          key={item.id}
                          remove={removeNotification}
                          data={item}
                        />
                      ))}
                    </TabPanel>
                    {typesKey.map((key) => (
                      <TabPanel
                        key={key}
                        className="custom-scrollbar scrollbar-hide grow space-y-4 overflow-y-auto overflow-x-hidden p-4"
                      >
                        {filteredNotifications.map((item) => (
                          <NotificationItem
                            key={item.id}
                            remove={removeNotification}
                            data={item}
                          />
                        ))}
                      </TabPanel>
                    ))}
                  </TabPanels>
                ) : (
                  <Empty />
                )}
              </TabGroup>
              {((notifications.length > 0 && activeTab === 0) ||
                filteredNotifications.length > 0) && (
                <div className="shrink-0 overflow-hidden rounded-b-lg bg-[var(--gray-a3)]">
                  <Button
                    // variant="flat"
                    className="w-full rounded-t-none"
                    onClick={clearNotifications}
                  >
                    <span>Archive all notifications</span>
                  </Button>
                </div>
              )}
            </div>
          )}
        </PopoverPanel>
      </Transition>
    </Popover>
  );
}

function Empty() {
  const { primaryColorScheme: primary, darkColorScheme: dark } =
    useThemeContext();
  return (
    <div className="grid grow place-items-center text-center">
      <div className="">
        <GirlEmptyBox
          className="mx-auto w-40"
          style={
            {
              "--primary": primary[500],
              "--dark": dark[500],
            } as React.CSSProperties
          }
        />
        <div className="mt-6">
          <p>No new notifications yet</p>
        </div>
      </div>
    </div>
  );
}

function NotificationItem({ data, remove }: NotificationItemProps) {
  const Icon = types[data.type].Icon;
  return (
    <div className="group flex items-center justify-between gap-3">
      <div className="flex min-w-0 gap-3">
        <Avatar
          size={10}
          initialColor={types[data.type].color}
          classNames={{ display: "rounded-lg" }}
        >
          <Icon className="size-4.5" />
        </Avatar>
        <div className="min-w-0">
          <p className="-mt-0.5 truncate font-medium text-[var(--gray-12)]">
            {data.title}
          </p>
          <div className="mt-0.5 truncate text-xs">{data.description}</div>
          <div className="mt-1 truncate text-xs text-[var(--gray-a8)]">
            {data.time}
          </div>
        </div>
      </div>
      <Button
        variant="flat"
        isIcon
        onClick={() => remove(data.id)}
        className="size-7 rounded-full opacity-0 group-hover:opacity-100 ltr:-mr-2 rtl:-ml-2"
      >
        <ArchiveBoxXMarkIcon className="size-4" />
      </Button>
    </div>
  );
}
