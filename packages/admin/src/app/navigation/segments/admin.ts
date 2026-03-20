import { baseNavigationObj } from "../baseNavigation";
import { NavigationTree } from "@/@types/navigation";
import { moduleAdminNavItems } from "./modules";

// Core admin navigation — module-specific items (accounts, scrapers, compliance, etc.)
// are injected from each module's adminNavItems with parentGroup: 'admin'
export const admin: NavigationTree = {
  ...baseNavigationObj["admin"],
  type: "root",
  childs: [
    {
      id: "admin.users",
      path: "/admin/users",
      type: "item",
      title: "Team Members",
      transKey: "nav.admin.users",
      icon: "admin.users",
      requiredFeature: "users",
    },
    {
      id: "admin.emails",
      path: "/admin/emails",
      type: "item",
      title: "Emails",
      icon: "admin.emails",
      requiredFeature: "emails",
    },
    {
      id: "admin.integrations",
      path: "/admin/integrations",
      type: "item",
      title: "Integrations",
      icon: "ArrowsRightLeft",
      requiredFeature: "settings",
    },
    // Module-contributed admin items (sorted by order)
    ...moduleAdminNavItems,
    {
      id: "admin.settings",
      path: "/admin/settings",
      type: "item",
      title: "Settings",
      transKey: "nav.admin.settings",
      icon: "settings",
      requiredFeature: "settings",
    },
    {
      id: "admin.modules",
      path: "/admin/modules",
      type: "item",
      title: "Modules",
      icon: "Puzzle",
      requiredFeature: "settings",
    },
  ],
};
