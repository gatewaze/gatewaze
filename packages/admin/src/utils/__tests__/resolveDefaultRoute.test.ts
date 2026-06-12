import { describe, it, expect } from "vitest";
import type { NavigationTree } from "@/@types/navigation";
import type { AdminPermissionsMap } from "@/lib/permissions/types";
import { resolveDefaultRoute } from "../navigationPermissions";

const nav: NavigationTree[] = [
  { id: "inbox", type: "item", path: "/inbox", title: "Inbox", requiredFeature: "content-platform.inbox" },
  { id: "people", type: "item", path: "/people", title: "People", requiredFeature: "dashboard_people" },
  { id: "newsletter", type: "item", path: "/admin/newsletter", title: "Newsletter", requiredFeature: "newsletter" },
];

const perms = (features: string[]): AdminPermissionsMap =>
  Object.fromEntries(features.map((f) => [f, true])) as AdminPermissionsMap;

describe("resolveDefaultRoute", () => {
  it("uses the configured default when the user can access it", () => {
    const route = resolveDefaultRoute(nav, perms(["dashboard_people"]), false, "people");
    expect(route).toBe("/people");
  });

  it("matches the configured default by stable id or by path", () => {
    const byPath = resolveDefaultRoute(nav, perms(["newsletter"]), false, "/admin/newsletter");
    expect(byPath).toBe("/admin/newsletter");
  });

  it("falls back to the first accessible route when the default is inaccessible", () => {
    // Default is inbox, but the user only has newsletter access.
    const route = resolveDefaultRoute(nav, perms(["newsletter"]), false, "inbox");
    expect(route).toBe("/admin/newsletter");
  });

  it("ignores the default for super admins only insofar as everything is accessible", () => {
    const route = resolveDefaultRoute(nav, perms([]), true, "people");
    expect(route).toBe("/people");
  });

  it("falls back to first available when no default is configured", () => {
    const route = resolveDefaultRoute(nav, perms(["dashboard_people"]), false, null);
    expect(route).toBe("/people");
  });

  it("returns null when the user can access nothing", () => {
    const route = resolveDefaultRoute(nav, perms([]), false, "inbox");
    expect(route).toBeNull();
  });
});
