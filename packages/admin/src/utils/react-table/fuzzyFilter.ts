import { rankItem } from "@tanstack/match-sorter-utils";

export const fuzzyFilter = (
  row: any,
  columnId: string,
  value: string,
  addMeta: any
): boolean => {
  // Rank the item
  const itemRank = rankItem(row.getValue(columnId), value);

  // Store the itemRank info
  addMeta({
    itemRank,
  });

  // Return if the item should be filtered in/out
  return itemRank.passed;
};
