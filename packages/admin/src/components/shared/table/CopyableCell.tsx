// Import Dependencies
import { DocumentDuplicateIcon } from "@heroicons/react/20/solid";
import { Getter, Table } from "@tanstack/react-table";

// Local Imports
import { Button } from "@/components/ui";
import { useClipboard } from "@/hooks";
import { ensureString } from "@/utils/ensureString";
import { Highlight } from "../Highlight";

// ----------------------------------------------------------------------

export function CopyableCell({
  getValue,
  table,
  highlight = false,
}: {
  getValue: Getter<any>;
  table: Table<any>;
  highlight?: boolean;
}) {
  const val = getValue();
  const { copied, copy } = useClipboard({ timeout: 2000 });
  const query = ensureString(table.getState()?.globalFilter);

  return (
    <div className="flex space-x-1">
      <span>
        {highlight ? <Highlight query={query}>{val}</Highlight> : val}
      </span>

      <Button
        data-tooltip
        data-tooltip-content={copied ? "Copied" : "Copy"}
        onClick={() => copy(val)}
        isIcon
        variant="flat"
        className="size-5 rounded-full opacity-0 group-hover/td:opacity-100"
        aria-label="Copy Button"
      >
        <DocumentDuplicateIcon className="size-3.5" />
      </Button>
    </div>
  );
}
