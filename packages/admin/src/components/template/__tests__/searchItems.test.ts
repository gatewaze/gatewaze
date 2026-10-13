import { describe, expect, it } from "vitest";
import type { NavigationTree } from "@/@types/navigation";
import { buildSearchItems } from "../searchItems";

describe("buildSearchItems", () => {
  it("lists each routed page once, even when it is in two trees", () => {
    const inbox: NavigationTree = { id: "inbox", type: "item", path: "/inbox", title: "Inbox" };
    const items = buildSearchItems([
      inbox,
      { id: "admin", type: "root", title: "Settings", childs: [{ id: "admin.users", type: "item", path: "/admin/users", title: "Users" }] },
      { id: "group:x", type: "collapse", path: "group:x", title: "Group", childs: [{ id: "people", type: "item", path: "/people" }] },
      inbox,
    ]);
    expect(items.map((i) => i.id)).toEqual(["inbox", "admin.users", "people"]);
  });

  it("drops the translation key from the results", () => {
    const [item] = buildSearchItems([{ id: "x", type: "item", path: "/x", transKey: "nav.x" }]);
    expect(item).not.toHaveProperty("transKey");
  });
});
