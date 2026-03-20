import { NavigationTree } from "@/@types/navigation";

/**
 * Object containing the base navigation items for the application.
 * This object serves as a centralized configuration for main navigation elements.
 */
export const baseNavigationObj: Record<string, NavigationTree> = {
  admin: {
    id: "admin",
    type: "item",
    path: "/admin",
    title: "Admin",
    transKey: "nav.admin.admin",
    icon: "admin",
  },
  blog: {
    id: "blog",
    type: "item",
    path: "/blog/posts",
    title: "Blog",
    transKey: "nav.blog.blog",
    icon: "blog",
    requiredFeature: "blog",
  },
};

/**
 * Array of navigation items derived from baseNavigationObj.
 * This array format is used for rendering the navigation menu in the application.
 */
export const baseNavigation: NavigationTree[] = Array.from(
  Object.values(baseNavigationObj),
);
