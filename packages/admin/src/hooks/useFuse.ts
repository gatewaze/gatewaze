import Fuse, { IFuseOptions, FuseResult } from "fuse.js";
import {
  useMemo,
  useState,
  useDeferredValue,
  SetStateAction,
  Dispatch,
} from "react";

interface UseFuseOptions<T> extends IFuseOptions<T> {
  /**
   * Maximum number of results to return.
   * Note: This is a search option, not a Fuse configuration option.
   */
  limit?: number;

  /**
   * If true and the query is empty, returns all items (up to `limit`).
   */
  matchAllOnEmptyQuery?: boolean;
}

interface UseFuseResult<T> {
  /**
   * The search results based on the query and Fuse options.
   */
  result: FuseResult<T>[];

  /**
   * The current query string (deferred value).
   */
  query: string;

  /**
   * Whether the search is in a "loading" state due to deferred query changes.
   */
  loading: boolean;

  /**
   * Function to update the query string.
   */
  setQuery: Dispatch<SetStateAction<string>>;
}

export function useFuse<T>(
  list: T[],
  options: UseFuseOptions<T>,
): UseFuseResult<T> {
  const [query, setQuery] = useState<string>("");
  const deferredQuery = useDeferredValue(query);

  // Extract custom options from Fuse options
  const { limit = 10, matchAllOnEmptyQuery = false, ...fuseOptions } = options;

  // Memoize the Fuse instance for performance
  const fuse = useMemo(
    () => new Fuse<T>(list, fuseOptions),
    [list, fuseOptions],
  );

  // Memoize the search results whenever the query or options change
  const result = useMemo<FuseResult<T>[]>(() => {
    if (!deferredQuery.trim() && matchAllOnEmptyQuery) {
      // Return all items up to the specified limit if the query is empty and matchAllOnEmptyQuery is true
      return list
        .slice(0, limit)
        .map((item, index) => ({ item, refIndex: index }));
    }

    // Perform a fuzzy search using the deferred query
    return fuse.search(deferredQuery.trim(), { limit });
  }, [fuse, limit, matchAllOnEmptyQuery, deferredQuery, list]);

  const loading = deferredQuery !== query;

  return {
    result,
    query: deferredQuery,
    loading,
    setQuery,
  };
}
