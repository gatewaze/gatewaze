import { rankItem, RankingInfo } from "@tanstack/match-sorter-utils";
import type { Row } from "@tanstack/react-table";

export const fuzzyFilter = <T>(
  row: Row<T>,
  columnId: string,
  value: string,
  addMeta: (meta: { itemRank: RankingInfo }) => void
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
