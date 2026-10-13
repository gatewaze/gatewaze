import type { NavigationTree } from "@/@types/navigation";

/**
 * Flatten navigation trees into the searchable list of pages: every node with
 * a route, minus collapsible group headers, once per id. A page can appear in
 * more than one tree (e.g. in the sidebar and on a module hub), and it should
 * show up in the results once.
 */
export function buildSearchItems(trees: NavigationTree[]): NavigationTree[] {
  const seen = new Set<string>();
  return flattenNav(trees).filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function flattenNav(items: NavigationTree[]): NavigationTree[] {
  let flatArray: NavigationTree[] = [];
  items.forEach((item) => {
    if (item.path && item.type !== "collapse") {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { transKey, ...filteredItem } = item;
      flatArray.push(filteredItem);
    }
    if (item.childs) {
      flatArray = flatArray.concat(flattenNav(item.childs));
    }
  });
  return flatArray;
}
