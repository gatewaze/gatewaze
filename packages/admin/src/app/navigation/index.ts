import { dashboardItems } from "./segments/dashboards";
import { admin } from "./segments/admin";
import { moduleNavItems } from "./segments/modules";

export const navigation = [
  ...dashboardItems,
  ...moduleNavItems,
  admin,
];
