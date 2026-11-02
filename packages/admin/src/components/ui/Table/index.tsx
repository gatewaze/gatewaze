import { Table as RadixTable } from "@radix-ui/themes";
import { forwardRef, type ComponentProps, type ComponentRef } from "react";

/**
 * Radix Table, wrapped so a wide table scrolls inside its own container
 * instead of widening the page. On a phone that difference is the whole
 * page being usable or not: an unconstrained table pushes the document
 * wider than the viewport and every other element renders against a void.
 * Radix's own root does not constrain width, so the wrapper does.
 *
 * forwardRef because the props type advertises a ref; without it a caller's
 * ref would be dropped silently rather than failing the type check.
 */
export const Table = forwardRef<
  ComponentRef<typeof RadixTable.Root>,
  ComponentProps<typeof RadixTable.Root>
>(function Table(props, ref) {
  return (
    <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
      <RadixTable.Root ref={ref} {...props} />
    </div>
  );
});
export const THead = RadixTable.Header;
export const TBody = RadixTable.Body;
export const Tr = RadixTable.Row;
export const Th = RadixTable.ColumnHeaderCell;
export const Td = RadixTable.Cell;
export const TFoot = RadixTable.Header; // Radix has no Footer, use Header as fallback
