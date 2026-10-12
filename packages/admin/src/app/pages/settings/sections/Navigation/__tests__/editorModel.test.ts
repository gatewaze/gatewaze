import { describe, expect, it } from "vitest";
import type { NavLayout } from "@gatewaze/shared/modules";
import type { NavigationTree } from "@/@types/navigation";
import { buildPool } from "@/app/navigation/resolveNavLayout";
import { SETTINGS_ROOT_ID } from "@/app/navigation/resolveNavLayout";
import {
  UNSORTED,
  canDropInto,
  hubContainerId,
  layoutToState,
  secId,
  stateToLayout,
} from "../editorModel";

const HUB_KEY = "module.marketing-os..marketing-os";

function tree(withHub = true): NavigationTree[] {
  return [
    { id: "inbox", type: "item", path: "/inbox", title: "Inbox" },
    { id: "people", type: "item", path: "/people", title: "People" },
    ...(withHub
      ? [{ id: HUB_KEY, type: "item", path: "/marketing-os", title: "Marketing OS", hub: "marketing-os" } as NavigationTree]
      : []),
    {
      id: SETTINGS_ROOT_ID,
      type: "root",
      title: "Settings",
      childs: [{ id: "admin.users", type: "item", path: "/admin/users", title: "Team Members" }],
    },
  ];
}

function layout(overrides: Partial<NavLayout> = {}): NavLayout {
  return {
    version: 1,
    sidebar: [{ id: "main", items: [{ key: HUB_KEY }] }],
    settings: [{ key: "admin.users" }],
    hidden: [],
    ...overrides,
  };
}

describe("layoutToState / stateToLayout", () => {
  it("round-trips hub placements with their overrides, in order", () => {
    const saved = layout({ hubs: { "marketing-os": [{ key: "people", label: "Contacts" }, { key: "inbox" }] } });
    const state = layoutToState(saved, buildPool(tree()));
    expect(state.containers[hubContainerId("marketing-os")]).toEqual(["people", "inbox"]);
    expect(stateToLayout(state).hubs).toEqual(saved.hubs);
  });

  it("gives every installed hub a container, empty for a layout saved before hubs existed", () => {
    const state = layoutToState(layout(), buildPool(tree()));
    expect(state.hubIds).toEqual(["marketing-os"]);
    expect(state.containers[hubContainerId("marketing-os")]).toEqual([]);
    expect(state.containers[UNSORTED]).toEqual(["inbox", "people"]);
  });

  it("leaves a hub's own page off its hub", () => {
    const saved = layout({ sidebar: [], hubs: { "marketing-os": [{ key: HUB_KEY }, { key: "people" }] } });
    const state = layoutToState(saved, buildPool(tree()));
    expect(state.containers[hubContainerId("marketing-os")]).toEqual(["people"]);
    expect(state.containers[UNSORTED]).toContain(HUB_KEY);
  });

  it("writes no hubs field when no hub is installed", () => {
    const state = layoutToState(layout({ sidebar: [{ id: "main", items: [{ key: "inbox" }] }] }), buildPool(tree(false)));
    expect(stateToLayout(state)).not.toHaveProperty("hubs");
  });

  it("drops a default page that has been filed onto a hub", () => {
    const saved = layout({ defaultRoute: "people", sidebar: [{ id: "main", items: [{ key: "people" }] }] });
    const state = layoutToState(saved, buildPool(tree()));
    expect(stateToLayout(state).defaultRoute).toBe("people");

    state.containers[secId("main")] = [];
    state.containers[hubContainerId("marketing-os")] = ["people"];
    expect(stateToLayout(state)).not.toHaveProperty("defaultRoute");
  });
});

describe("canDropInto", () => {
  const pool = buildPool(tree());

  it("refuses to drop a hub's page onto its own hub", () => {
    expect(canDropInto(hubContainerId("marketing-os"), pool.items.get(HUB_KEY))).toBe(false);
  });

  it("allows other items onto a hub, and a hub page anywhere else", () => {
    expect(canDropInto(hubContainerId("marketing-os"), pool.items.get("people"))).toBe(true);
    expect(canDropInto(secId("main"), pool.items.get(HUB_KEY))).toBe(true);
    expect(canDropInto("settings", pool.items.get(HUB_KEY))).toBe(true);
  });
});
