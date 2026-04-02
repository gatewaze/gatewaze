import { Table as RadixTable } from "@radix-ui/themes";

// Re-export Radix Table namespace components with backwards-compatible names
export const Table = RadixTable.Root;
export const THead = RadixTable.Header;
export const TBody = RadixTable.Body;
export const Tr = RadixTable.Row;
export const Th = RadixTable.ColumnHeaderCell;
export const Td = RadixTable.Cell;
export const TFoot = RadixTable.Header; // Radix has no Footer, use Header as fallback
