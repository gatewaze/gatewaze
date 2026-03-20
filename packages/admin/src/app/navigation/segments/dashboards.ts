import { NavigationTree } from "@/@types/navigation";

// Core navigation items — module-specific items (competitions, discounts, etc.)
// are now provided by each module's adminNavItems in their index.ts
export const dashboardItems: NavigationTree[] = [
  {
    id: "home",
    path: "/home",
    type: "item",
    title: "Home",
    transKey: "nav.dashboards.home",
    icon: "dashboards.home",
    requiredFeature: "dashboard_home",
  },
  {
    id: "people",
    path: "/people",
    type: "item",
    title: "People",
    icon: "dashboards.members",
    requiredFeature: "dashboard_people",
  },
  {
    id: "events",
    path: "/events",
    type: "item",
    title: "Events",
    transKey: "nav.dashboards.events",
    icon: "admin.events",
    requiredFeature: "events",
  },
];
