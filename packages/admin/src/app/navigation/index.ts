import { dashboardItems } from "./segments/dashboards";
import { admin } from "./segments/admin";
import { blog } from "./segments/blog";
import { moduleNavItems } from "./segments/modules";

export const navigation = [
  ...dashboardItems,
  ...moduleNavItems,
  blog,
  admin,
];
