import { baseNavigationObj } from "../baseNavigation";
import { NavigationTree } from "@/@types/navigation";

export const blog: NavigationTree = {
  ...baseNavigationObj["blog"],
  path: "/blog/posts",
  type: "item",
};
