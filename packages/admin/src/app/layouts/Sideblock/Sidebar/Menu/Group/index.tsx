// Import Dependencies
import { useTranslation } from "react-i18next";
import invariant from "tiny-invariant";

// Local Imports
import { Collapse } from "@/components/ui";
import { useDisclosure } from "@/hooks";
import { useSidebarContext } from "@/app/contexts/sidebar/context";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";
import { CollapsibleItem } from "./CollapsibleItem";
import { MenuItem } from "./MenuItem";
import { type NavigationTree } from "@/@types/navigation";

// ----------------------------------------------------------------------

function renderChildren(childs: NavigationTree[]) {
  return childs.map((item) => {
    switch (item.type) {
      case "collapse":
        return <CollapsibleItem key={item.path} data={item} />;
      case "item":
        return <MenuItem key={item.path} data={item} />;
      default:
        return null;
    }
  });
}

export function Group({ data }: { data: NavigationTree }) {
  const [isOpened, { toggle }] = useDisclosure(true);
  const { t } = useTranslation();
  const { isCollapsed } = useSidebarContext();
  const { xlAndUp } = useBreakpointsContext();

  invariant(
    data.childs && data.childs.length > 0,
    "[Group] Group menu must have at least one child",
  );

  const label = data.transKey ? t(data.transKey) : data.title;

  // Rail mode: the uppercase label clips in the narrow rail, so swap it for a
  // short centered divider and surface the category name as a hover tooltip.
  if (isCollapsed && xlAndUp) {
    return (
      <div className="pt-3">
        {/* Same total height as the expanded label row (h-6 + mb-2) so the
            icon column doesn't shift vertically when toggling the rail. */}
        <div
          className="mb-2 flex h-6 items-center justify-center"
          title={label}
          aria-label={label}
        >
          <div className="h-px w-6 bg-[var(--accent-a5)]" />
        </div>
        <div className="flex flex-col space-y-1.5">{renderChildren(data.childs!)}</div>
      </div>
    );
  }

  return (
    <div className="pt-3">
      <div
        className="sticky top-0 z-10 px-6 bg-[var(--accent-2)]"
      >
        <button
          onClick={toggle}
          className="mb-2 flex cursor-pointer items-center gap-3 pt-2 text-xs font-medium tracking-wider text-[var(--accent-a9)] uppercase outline-hidden hover:text-[var(--accent-11)] focus:text-[var(--accent-11)]"
        >
          <span>{label}</span>
        </button>
        <div
          className="pointer-events-none absolute inset-x-0 -bottom-3 h-3"
          style={{
            background: `linear-gradient(to bottom, var(--accent-2), transparent)`
          }}
        ></div>
      </div>
      <Collapse in={isOpened}>
        <div className="flex flex-col space-y-1.5">{renderChildren(data.childs)}</div>
      </Collapse>
    </div>
  );
}
