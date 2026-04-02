// Import Dependencies
import { Getter, Table } from "@tanstack/react-table";

// Local Imports
import { ensureString } from "@/utils/ensureString";
import { Highlight } from "../Highlight";

// ----------------------------------------------------------------------

export function HighlightableCell({
  getValue,
  table,
}: {
  getValue: Getter<any>;
  table: Table<any>;
}) {
  const query = ensureString(table.getState()?.globalFilter);

  return (
    <span>
      <Highlight query={query}>{getValue()}</Highlight>
    </span>
  );
}
