// Import Dependencies
import { useMemo } from "react";

// Local Imports
import { useUncontrolled } from "@/hooks";
import { range } from "@/utils/range";

// ----------------------------------------------------------------------

export const DOTS = "dots";

export interface UsePaginationParams {
  total: number;
  siblings?: number;
  boundaries?: number;
  page?: number;
  initialPage?: number;
  onChange?: (page: number) => void;
}

export interface UsePaginationReturn {
  range: (number | string)[];
  active: number;
  setPage: (pageNumber: number) => void;
  next: () => void;
  previous: () => void;
  first: () => void;
  last: () => void;
}

export function usePagination({
  total,
  siblings = 1,
  boundaries = 1,
  page,
  initialPage = 1,
  onChange,
}: UsePaginationParams): UsePaginationReturn {
  const _total = Math.max(Math.trunc(total), 0);
  const [activePage, setActivePage] = useUncontrolled({
    value: page,
    onChange,
    defaultValue: initialPage,
    finalValue: initialPage,
  });

  const setPage = (pageNumber: number): void => {
    if (pageNumber <= 0) {
      setActivePage(1);
    } else if (pageNumber > _total) {
      setActivePage(_total);
    } else {
      setActivePage(pageNumber);
    }
  };

  const next = (): void => setPage(activePage + 1);
  const previous = (): void => setPage(activePage - 1);
  const first = (): void => setPage(1);
  const last = (): void => setPage(_total);

  const paginationRange = useMemo(() => {
    const totalPageNumbers = siblings * 2 + 3 + boundaries * 2;
    if (totalPageNumbers >= _total) {
      return range(1, _total);
    }

    const leftSiblingIndex = Math.max(activePage - siblings, boundaries);
    const rightSiblingIndex = Math.min(
      activePage + siblings,
      _total - boundaries,
    );

    const shouldShowLeftDots = leftSiblingIndex > boundaries + 2;
    const shouldShowRightDots = rightSiblingIndex < _total - (boundaries + 1);

    if (!shouldShowLeftDots && shouldShowRightDots) {
      const leftItemCount = siblings * 2 + boundaries + 2;
      return [
        ...range(1, leftItemCount),
        DOTS,
        ...range(_total - (boundaries - 1), _total),
      ];
    }

    if (shouldShowLeftDots && !shouldShowRightDots) {
      const rightItemCount = boundaries + 1 + 2 * siblings;
      return [
        ...range(1, boundaries),
        DOTS,
        ...range(_total - rightItemCount, _total),
      ];
    }

    return [
      ...range(1, boundaries),
      DOTS,
      ...range(leftSiblingIndex, rightSiblingIndex),
      DOTS,
      ...range(_total - boundaries + 1, _total),
    ];
  }, [siblings, boundaries, _total, activePage]);

  return {
    range: paginationRange,
    active: activePage,
    setPage,
    next,
    previous,
    first,
    last,
  };
}
