import { ReactNode } from "react";
import { flexRender, type Table as TanstackTable } from "@tanstack/react-table";
import { Table, THead, TBody, Tr, Th, Td } from "@/components/ui";
import { ScrollableTable } from "./ScrollableTable";

interface DataTableProps<T> {
  table: TanstackTable<T>;
  loading?: boolean;
  emptyState?: ReactNode;
  colSpan?: number;
  onRowDoubleClick?: (row: T) => void;
}

// Checkbox column width — used to offset the second column when select is first
const SELECT_COL_WIDTH = 44;

export function DataTable<T>({
  table,
  loading,
  emptyState,
  colSpan,
  onRowDoubleClick,
}: DataTableProps<T>) {
  const columnCount = colSpan ?? table.getAllColumns().length;
  const firstColIsSelect = table.getAllColumns()[0]?.id === "select";

  // Determine which column index is the "primary" sticky-left column
  // If first column is checkbox, both 0 and 1 are sticky-left
  const stickyLeftIndices = firstColIsSelect ? [0, 1] : [0];

  function getStickyStyle(
    index: number,
    total: number,
    isHeader: boolean,
  ): React.CSSProperties | undefined {
    const isLast = index === total - 1;
    const zIndex = isHeader ? 3 : 1;

    if (stickyLeftIndices.includes(index)) {
      const left =
        firstColIsSelect && index === 1 ? SELECT_COL_WIDTH : 0;
      return {
        position: "sticky",
        left,
        background: "var(--color-panel-solid)",
        zIndex: zIndex + 1, // left sticky above right sticky
        // Enforce exact width on checkbox column so second column aligns
        ...(firstColIsSelect && index === 0
          ? { width: SELECT_COL_WIDTH, minWidth: SELECT_COL_WIDTH, maxWidth: SELECT_COL_WIDTH, boxSizing: "border-box" as const }
          : {}),
      };
    }

    if (isLast) {
      return {
        position: "sticky",
        right: 0,
        background: "var(--color-panel-solid)",
        zIndex,
      };
    }

    return undefined;
  }

  function getStickyDataAttrs(index: number, total: number) {
    const isLast = index === total - 1;
    const isStickyLeft = stickyLeftIndices.includes(index);
    // The outermost sticky-left column gets an extra attr for shadow positioning
    const isStickyLeftEdge = firstColIsSelect ? index === 1 : index === 0;
    return {
      ...(isStickyLeft ? { "data-sticky-left": true } : {}),
      ...(isStickyLeftEdge ? { "data-sticky-left-edge": true } : {}),
      ...(isLast ? { "data-sticky-right": true } : {}),
    };
  }

  return (
    <ScrollableTable>
      <Table>
        <THead>
          {table.getHeaderGroups().map((headerGroup) => (
            <Tr key={headerGroup.id}>
              {headerGroup.headers.map((header, index) => {
                const total = headerGroup.headers.length;
                return (
                  <Th
                    key={header.id}
                    {...getStickyDataAttrs(index, total)}
                    style={{
                      verticalAlign: "middle",
                      width:
                        header.getSize() !== 150
                          ? header.getSize()
                          : undefined,
                      ...getStickyStyle(index, total, true),
                    }}
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className={
                          header.column.getCanSort()
                            ? "flex items-center gap-1 cursor-pointer select-none"
                            : "flex items-center gap-1"
                        }
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                        {header.column.getIsSorted() === "asc" && " ↑"}
                        {header.column.getIsSorted() === "desc" && " ↓"}
                      </div>
                    )}
                  </Th>
                );
              })}
            </Tr>
          ))}
        </THead>
        <TBody>
          {loading ? (
            <Tr>
              <Td colSpan={columnCount}>
                <div className="flex justify-center py-12">
                  <div className="size-6 border-2 border-[var(--accent-9)] border-t-transparent rounded-full animate-spin" />
                </div>
              </Td>
            </Tr>
          ) : table.getRowModel().rows.length === 0 ? (
            <Tr>
              <Td colSpan={columnCount}>
                <div className="text-center py-12 text-[var(--gray-a8)]">
                  {emptyState ?? "No results found."}
                </div>
              </Td>
            </Tr>
          ) : (
            table.getRowModel().rows.map((row) => {
              const cells = row.getVisibleCells();
              const total = cells.length;
              return (
                <Tr
                  key={row.id}
                  onDoubleClick={
                    onRowDoubleClick
                      ? () => onRowDoubleClick(row.original)
                      : undefined
                  }
                  // user-select: none on dbl-click rows: prevents the first
                  // click from starting a text selection that swallows the
                  // dblclick event (Chrome ships dblclick AFTER both clicks
                  // complete; if the in-between produces a text selection,
                  // the dblclick is sometimes dropped and the user sees
                  // "nothing happened" instead of the navigate).
                  style={
                    onRowDoubleClick
                      ? { cursor: "pointer", userSelect: "none" }
                      : undefined
                  }
                >
                  {cells.map((cell, index) => (
                    <Td
                      key={cell.id}
                      {...getStickyDataAttrs(index, total)}
                      style={{ verticalAlign: "middle", ...getStickyStyle(index, total, false) }}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </Td>
                  ))}
                </Tr>
              );
            })
          )}
        </TBody>
      </Table>
    </ScrollableTable>
  );
}
