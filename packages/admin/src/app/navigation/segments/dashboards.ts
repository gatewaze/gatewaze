import { NavigationTree } from "@/@types/navigation";

// Core navigation items — module-specific items (competitions, discounts, etc.)
// are now provided by each module's adminNavItems in their index.ts
export const dashboardItems: NavigationTree[] = [
  {
    id: "inbox",
    path: "/inbox",
    type: "item",
    title: "Inbox",
    icon: "admin.inbox",
    requiredFeature: "content-platform.inbox",
  },
  {
    id: "people",
    path: "/people",
    type: "item",
    title: "People",
    icon: "dashboards.members",
    requiredFeature: "dashboard_people",
  },
];
