// Import Dependencies

// Local Imports
import { Checkbox } from "@/components/ui";
import { Row, Table } from "@tanstack/react-table";

// ----------------------------------------------------------------------

export function SelectHeader({ table }: { table: Table<any> }) {
  return (
    <div className="flex items-center justify-center">
      <Checkbox
        className="size-4.5"
        color="error"
        checked={table.getIsAllRowsSelected()}
        indeterminate={table.getIsSomeRowsSelected()}
        onChange={table.getToggleAllRowsSelectedHandler()}
      />
    </div>
  );
}

export function SelectCell({ row }: { row: Row<any> }) {
  return (
    <div className="flex items-center justify-center">
      <Checkbox
        className="size-4.5"
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        indeterminate={row.getIsSomeSelected()}
        onChange={row.getToggleSelectedHandler()}
      />
    </div>
  );
}
