// Import Dependencies
import {
  Dialog,
  DialogPanel,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { Fragment, useEffect, useMemo, useRef } from "react";
import {
  MagnifyingGlassIcon,
  ChevronRightIcon,
  ChatBubbleBottomCenterIcon,
  CloudIcon,
  CurrencyDollarIcon,
  ViewColumnsIcon,
  ShoppingBagIcon,
  RocketLaunchIcon,
} from "@heroicons/react/24/outline";
import { Link } from "react-router";
import { useHotkeys } from "react-hotkeys-hook";

// Local Imports
import { Avatar, Button, Input } from "@/components/ui";
import { useDisclosure, useFuse } from "@/hooks";
import { useThemeContext } from "@/app/contexts/theme/context";
import { createScopedKeydownHandler } from "@/utils/dom/createScopedKeydownHandler";
import { useNavigation } from "@/hooks/useNavigation";
import { Highlight } from "@/components/shared/Highlight";
import { settings } from "@/app/navigation/segments/settings";
import { ColorType } from "@/constants/app";
import { NavigationTree } from "@/@types/navigation";

// ----------------------------------------------------------------------

interface PopularSearchItem {
  id: string;
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  color: ColorType;
  to: string;
}

interface SearchResult {
  item: NavigationTree;
  refIndex: number;
}

/**
 * Search component props
 */
interface SearchProps {
  renderButton?: (openFn: () => void) => React.ReactNode;
}

/**
 * SearchDialog component props
 */
interface SearchDialogProps {
  isOpen?: boolean;
  close: () => void;
}

const popular: PopularSearchItem[] = [
  {
    id: "0",
    Icon: RocketLaunchIcon,
    title: "Documentation",
    color: "primary",
    to: "/docs/getting-started",
  },
  {
    id: "1",
    Icon: ViewColumnsIcon,
    title: "Kanban",
    color: "success",
    to: "/apps/kanban",
  },
  {
    id: "2",
    Icon: CurrencyDollarIcon,
    title: "Analytics",
    color: "warning",
    to: "/crm-analytics",
  },
  {
    id: "3",
    Icon: ChatBubbleBottomCenterIcon,
    title: "Chat",
    color: "info",
    to: "/apps/chat",
  },
  {
    id: "4",
    Icon: CloudIcon,
    title: "File Manager",
    color: "error",
    to: "/apps/filemanager",
  },
  {
    id: "5",
    Icon: ShoppingBagIcon,
    title: "Orders",
    color: "info",
    to: "/orders",
  },
  {
    id: "6",
    Icon: CurrencyDollarIcon,
    title: "Sales",
    color: "success",
    to: "/sales",
  },
];

export function Search({ renderButton }: SearchProps) {
  const [isOpen, { open, close }] = useDisclosure(false);

  useHotkeys("/", () => open(), {
    ignoreModifiers: true,
    preventDefault: true,
  });

  return (
    <>
      <Transition appear show={isOpen} as={Fragment}>
        <Dialog
          as="div"
          className="fixed inset-0 z-100 flex flex-col items-center justify-center overflow-hidden sm:px-5 sm:py-6"
          onClose={close}
        >
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm transition-opacity dark:bg-black/30" />
          </TransitionChild>
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-300"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-200"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <DialogPanel className="relative flex h-full w-full max-w-lg origin-bottom flex-col bg-[var(--color-background)] transition-all duration-300 sm:max-h-[600px] sm:rounded-lg">
              <SearchDialog close={close} />
            </DialogPanel>
          </TransitionChild>
        </Dialog>
      </Transition>

      {renderButton ? renderButton(open) : null}
    </>
  );
}

export function SearchDialog({ close }: SearchDialogProps) {
  const { isDark } = useThemeContext();
  const navigation = useNavigation();
  const data = useMemo(() => flattenNav([...navigation, settings]), [navigation]);
  const searchInputId = useRef(
    `search-input-${Math.random().toString(36).substring(2, 11)}`,
  ).current;
  const { result, query, setQuery } = useFuse(data, {
    keys: ["title"],
    threshold: 0.2,
    matchAllOnEmptyQuery: false,
  });

  useEffect(() => {
    const inputElement = document.getElementById(
      searchInputId,
    ) as HTMLInputElement;
    if (inputElement) {
      inputElement.focus();
    }
  }, [searchInputId]);

  return (
    <div data-search-wrapper className="flex flex-col overflow-hidden">
      <div className="rounded-t-lg bg-[var(--gray-a3)] py-2 lg:py-3">
        <div className="flex items-center justify-between pr-4 pl-2 rtl:pr-2 rtl:pl-4">
          <Input
            id={searchInputId}
            placeholder="Search here..."
            value={query}
            data-search-item
            onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
              setQuery(event.target.value)
            }
            classNames={{ root: "flex-1", input: "border-none" }}
            prefix={<MagnifyingGlassIcon className="size-5" />}
            onKeyDown={createScopedKeydownHandler({
              siblingSelector: "[data-search-item]",
              parentSelector: "[data-search-wrapper]",
              activateOnFocus: false,
              loop: true,
              orientation: "vertical",
            })}
          />
          <Button
            onClick={close}
            variant={isDark ? "filled" : "outlined"}
            className="px-3 py-1.5 text-xs"
          >
            ESC
          </Button>
        </div>
      </div>

      {result.length === 0 && query === "" && (
        <div className="mt-4">
          <h3 className="px-4 text-[var(--gray-12)] sm:px-5">
            Popular search
          </h3>
          <div className="mt-3 flex flex-wrap gap-3.5 px-4">
            {popular.map(({ id, to, Icon, title, color }) => (
              <Link
                key={id}
                to={to}
                onClick={close}
                className="w-14 shrink-0 text-center"
              >
                <Avatar
                  size={12}
                  initialColor={color}
                  classNames={{ display: "rounded-2xl" }}
                >
                  <Icon className="size-5 stroke-2" />
                </Avatar>

                <p className="mt-1.5 truncate text-xs whitespace-nowrap text-[var(--gray-12)]">
                  {title}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {result.length === 0 && query !== "" && (
        <div className="flex flex-col overflow-y-auto py-4">
          <h3 className="px-4 text-[var(--gray-12)] sm:px-5">
            No Result Found
          </h3>
        </div>
      )}

      {result.length > 0 && (
        <div className="flex flex-col overflow-y-auto py-4">
          <h3 className="px-4 text-[var(--gray-12)] sm:px-5">
            Search Result
          </h3>
          <div className="space-y-3 px-4 pt-3">
            {result.map(({ item, refIndex }: SearchResult) => (
              <Link
                key={refIndex}
                onKeyDown={createScopedKeydownHandler({
                  siblingSelector: "[data-search-item]",
                  parentSelector: "[data-search-wrapper]",
                  activateOnFocus: false,
                  loop: true,
                  orientation: "vertical",
                })}
                data-search-item
                to={item.path || "#"}
                className="group focus:ring-primary-500/50 flex items-center justify-between space-x-2 rounded-lg bg-[var(--gray-a3)] px-2.5 py-2 tracking-wide text-[var(--gray-12)] outline-hidden transition-all focus:ring-3 rtl:space-x-reverse"
                onClick={close}
              >
                <div className="min-w-0">
                  <span className="truncate">
                    <Highlight query={query}>{item.title || ""}</Highlight>
                  </span>
                </div>

                <ChevronRightIcon className="size-4.5 rtl:rotate-180" />
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function flattenNav(items: NavigationTree[]): NavigationTree[] {
  let flatArray: NavigationTree[] = [];
  items.forEach((item) => {
    if (item.path && item.type !== "collapse") {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { transKey, ...filteredItem } = item;
      flatArray.push(filteredItem);
    }
    if (item.childs) {
      flatArray = flatArray.concat(flattenNav(item.childs));
    }
  });
  return flatArray;
}
