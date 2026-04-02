// Import Dependencies
import { type Table } from "@tanstack/react-table";

// Local Imports
import {
  Pagination,
  PaginationItems,
  PaginationNext,
  PaginationPrevious,
  Select,
} from "@/components/ui";
import { useBreakpointsContext } from "@/app/contexts/breakpoint/context";

// ----------------------------------------------------------------------

export function PaginationSection({ table }: { table: Table<any> }) {
  const paginationState = table.getState().pagination;
  const { isXl, is2xl } = useBreakpointsContext();

  return (
    <div className="flex flex-col justify-between space-y-4 sm:flex-row sm:items-center sm:space-y-0">
      <div className="text-xs-plus flex items-center space-x-2">
        <span>Show</span>
        <Select
          data={[10, 20, 30, 40, 50, 100]}
          value={paginationState.pageSize}
          onChange={(e) => {
            table.setPageSize(Number(e.target.value));
          }}
          classNames={{
            root: "w-fit",
            select: "h-7 rounded-full py-1 text-xs ltr:pr-7! rtl:pl-7!",
          }}
        />
        <span>entries</span>
      </div>
      <div>
        <Pagination
          total={table.getPageCount()}
          value={paginationState.pageIndex + 1}
          onChange={(page) => table.setPageIndex(page - 1)}
          siblings={isXl ? 2 : is2xl ? 3 : 1}
          boundaries={isXl ? 2 : 1}
        >
          <PaginationPrevious />
          <PaginationItems />
          <PaginationNext />
        </Pagination>
      </div>
      <div className="text-xs-plus truncate">
        {paginationState.pageIndex * paginationState.pageSize + 1} -{" "}
        {table.getRowModel().rows.length} of{" "}
        {table.getCoreRowModel().rows.length} entries
      </div>
    </div>
  );
}
