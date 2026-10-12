import { describe, expect, it } from "vitest";
import type { NavLayout } from "@gatewaze/shared/modules";
import type { NavigationTree } from "@/@types/navigation";
import { buildPool, SETTINGS_ROOT_ID } from "@/app/navigation/resolveNavLayout";
import {
  HIDDEN,
  UNSORTED,
  addableItems,
  compactCard,
  hubCardError,
  isCustomCard,
  layoutToState,
  newLinkKey,
  secId,
  stateToLayout,
  withHubCards,
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
    sidebar: [{ id: "main", items: [{ key: HUB_KEY }, { key: "inbox" }] }],
    settings: [{ key: "admin.users" }],
    hidden: [],
    ...overrides,
  };
}

describe("layoutToState / stateToLayout", () => {
  it("round-trips hub cards with all their fields, in order", () => {
    const cards = [
      { key: "people", label: "Contacts", description: "d", tags: ["CRM"], eyebrow: "Agent 1", accent: "violet" as const },
      { key: "link:events", label: "Events", url: "/foundation/events", newTab: true, comingSoon: true },
    ];
    const state = layoutToState(layout({ hubs: { "marketing-os": cards } }), buildPool(tree()));
    expect(state.hubCards["marketing-os"]).toEqual(cards);
    expect(stateToLayout(state).hubs).toEqual({ "marketing-os": cards });
  });

  it("keeps a page in the sidebar when it is also on a hub", () => {
    const state = layoutToState(layout({ hubs: { "marketing-os": [{ key: "inbox" }] } }), buildPool(tree()));
    expect(state.containers[secId("main")]).toContain("inbox");
    expect(state.hubCards["marketing-os"].map((c) => c.key)).toEqual(["inbox"]);
    const saved = stateToLayout(state);
    expect(saved.sidebar[0].items.map((i) => i.key)).toContain("inbox");
    expect(saved.hubs?.["marketing-os"].map((c) => c.key)).toEqual(["inbox"]);
  });

  it("gives every installed hub an empty card list for a layout saved before hubs existed", () => {
    const state = layoutToState(layout(), buildPool(tree()));
    expect(state.hubIds).toEqual(["marketing-os"]);
    expect(state.hubCards).toEqual({ "marketing-os": [] });
  });

  it("drops a hub's own page, uninstalled modules and repeated keys, but keeps custom cards", () => {
    const state = layoutToState(
      layout({
        hubs: {
          "marketing-os": [
            { key: HUB_KEY },
            { key: "module.gone..gone" },
            { key: "people" },
            { key: "people" },
            { key: "link:x", label: "X", url: "/x" },
          ],
        },
      }),
      buildPool(tree()),
    );
    expect(state.hubCards["marketing-os"].map((c) => c.key)).toEqual(["people", "link:x"]);
  });

  it("writes no hubs field when no hub is installed", () => {
    const state = layoutToState(layout({ sidebar: [{ id: "main", items: [{ key: "inbox" }] }] }), buildPool(tree(false)));
    expect(stateToLayout(state)).not.toHaveProperty("hubs");
  });

  it("drops a default page that is not in the sidebar or settings", () => {
    const state = layoutToState(layout({ defaultRoute: "inbox" }), buildPool(tree()));
    expect(stateToLayout(state).defaultRoute).toBe("inbox");

    state.containers[secId("main")] = [HUB_KEY];
    state.containers[UNSORTED] = [...state.containers[UNSORTED], "inbox"];
    expect(stateToLayout(state)).not.toHaveProperty("defaultRoute");

    state.containers[UNSORTED] = state.containers[UNSORTED].filter((k) => k !== "inbox");
    state.containers[HIDDEN] = ["inbox"];
    expect(stateToLayout(state)).not.toHaveProperty("defaultRoute");
  });

  it("keeps a default page given as a route path", () => {
    const state = layoutToState(layout({ defaultRoute: "/inbox" }), buildPool(tree()));
    expect(stateToLayout(state).defaultRoute).toBe("/inbox");
  });

  it("replaces one hub's cards without touching the rest of the state", () => {
    const state = layoutToState(layout(), buildPool(tree()));
    const next = withHubCards(state, "marketing-os", [{ key: "people" }]);
    expect(next.hubCards["marketing-os"]).toEqual([{ key: "people" }]);
    expect(next.containers).toBe(state.containers);
    expect(state.hubCards["marketing-os"]).toEqual([]);
  });
});

describe("hub card helpers", () => {
  const pool = buildPool(tree());

  it("offers every page except the hub's own and the ones already on it", () => {
    const keys = addableItems(pool, "marketing-os", [{ key: "people" }]).map((n) => n.id);
    expect(keys).toEqual(["inbox", "admin.users"]);
  });

  it("tells custom cards from module cards", () => {
    expect(isCustomCard({ key: "link:events" })).toBe(true);
    expect(isCustomCard({ key: "people" })).toBe(false);
  });

  it("derives a unique link key from the title", () => {
    expect(newLinkKey("LFX Events!", [])).toBe("link:lfx-events");
    expect(newLinkKey("LFX Events", [{ key: "link:lfx-events" }, { key: "link:lfx-events-2" }])).toBe("link:lfx-events-3");
    expect(newLinkKey("!!!", [])).toBe("link:card");
  });

  it("explains why a custom card can't be saved", () => {
    expect(hubCardError({ key: "link:x", url: "/x" })).toMatch(/title/);
    expect(hubCardError({ key: "link:x", label: "X" })).toMatch(/link/);
    expect(hubCardError({ key: "link:x", label: "X", url: "javascript:alert(1)" })).toMatch(/https/);
    expect(hubCardError({ key: "link:x", label: "X", url: "//evil.example.org" })).toMatch(/https/);
    expect(hubCardError({ key: "link:x", label: "X", url: "https://example.org" })).toBeNull();
    expect(hubCardError({ key: "link:x", label: "X", comingSoon: true })).toBeNull();
    expect(hubCardError({ key: "people" })).toBeNull();
  });

  it("drops empty fields, trims text, and keeps url and newTab on custom cards only", () => {
    expect(
      compactCard({
        key: "people",
        label: "  ",
        description: " Find people ",
        tags: [" CRM ", "", "CRM"],
        url: "/x",
        newTab: true,
        comingSoon: false,
      }),
    ).toEqual({ key: "people", description: "Find people", tags: ["CRM"] });
    expect(compactCard({ key: "link:x", label: "X", url: " /x ", newTab: true })).toEqual({
      key: "link:x",
      label: "X",
      url: "/x",
      newTab: true,
    });
    expect(compactCard({ key: "link:x", label: "X", newTab: true, comingSoon: true })).toEqual({
      key: "link:x",
      label: "X",
      comingSoon: true,
    });
  });
});
