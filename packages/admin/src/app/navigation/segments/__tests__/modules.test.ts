import { describe, expect, it } from "vitest";
import type { InstalledModuleRow } from "@gatewaze/shared/modules";

import { getModuleNavItemsFromRows } from "../modules";

function row(admin_nav: InstalledModuleRow["admin_nav"]): InstalledModuleRow {
  return {
    id: "marketing-os",
    name: "Marketing OS",
    version: "2.0.0",
    features: ["marketing-os"],
    status: "enabled",
    config: {},
    admin_nav,
  } as InstalledModuleRow;
}

describe("getModuleNavItemsFromRows", () => {
  it("carries a module-declared hub id onto the nav item", () => {
    const [item] = getModuleNavItemsFromRows([
      row([{ path: "/marketing-os", label: "Marketing OS", icon: "RocketLaunch", hub: "marketing-os" }]),
    ]);
    expect(item.hub).toBe("marketing-os");
  });

  it("leaves hub unset when the module declares none", () => {
    const [item] = getModuleNavItemsFromRows([row([{ path: "/x", label: "X", icon: "Mail" }])]);
    expect(item).not.toHaveProperty("hub");
  });
});
