// Import Dependencies
import { useTranslation } from "react-i18next";
import clsx from "clsx";
import invariant from "tiny-invariant";

// Local Imports
import { Collapse } from "@/components/ui";
import { useDisclosure } from "@/hooks";
import { CollapsibleItem } from "./CollapsibleItem";
import { MenuItem } from "./MenuItem";
import { type NavigationTree } from "@/@types/navigation";

// ----------------------------------------------------------------------

export function Group({ data }: { data: NavigationTree }) {
  const [isOpened, { toggle }] = useDisclosure(true);
  const { t } = useTranslation();

  invariant(
    data.childs && data.childs.length > 0,
    "[Group] Group menu must have at least one child",
  );

  return (
    <div className="pt-3">
      <div
        className="sticky top-0 z-10 px-6 bg-[var(--accent-2)]"
      >
        <button
          onClick={toggle}
          className="mb-2 flex cursor-pointer items-center gap-3 pt-2 text-xs font-medium tracking-wider text-[var(--accent-a9)] uppercase outline-hidden hover:text-[var(--accent-11)] focus:text-[var(--accent-11)]"
        >
          <span>{data.transKey ? t(data.transKey) : data.title}</span>
        </button>
        <div
          className="pointer-events-none absolute inset-x-0 -bottom-3 h-3"
          style={{
            background: `linear-gradient(to bottom, var(--accent-2), transparent)`
          }}
        ></div>
      </div>
      {data.childs && data.childs.length > 0 && (
        <Collapse in={isOpened}>
          <div className="flex flex-col space-y-1.5">
            {data.childs.map((item) => {
              switch (item.type) {
                case "collapse":
                  return <CollapsibleItem key={item.path} data={item} />;
                case "item":
                  return <MenuItem key={item.path} data={item} />;
                default:
                  return null;
              }
            })}
          </div>
        </Collapse>
      )}
    </div>
  );
}
