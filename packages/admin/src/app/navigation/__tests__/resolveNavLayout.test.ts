import { describe, it, expect } from "vitest";
import type { NavLayout } from "@gatewaze/shared/modules";
import type { NavigationTree } from "@/@types/navigation";
import {
  applyNavLayout,
  resolveNavigation,
  seedLayoutFromTree,
  buildPool,
  SETTINGS_ROOT_ID,
} from "../resolveNavLayout";

// A representative base tree: flat sidebar items + the settings root.
function baseTree(): NavigationTree[] {
  return [
    { id: "inbox", type: "item", path: "/inbox", title: "Inbox", icon: "admin.inbox", requiredFeature: "content-platform.inbox" },
    { id: "people", type: "item", path: "/people", title: "People", icon: "dashboards.members", requiredFeature: "dashboard_people" },
    { id: "module.newsletter.admin.newsletter", type: "item", path: "/admin/newsletter", title: "Newsletter", icon: "Mail", requiredFeature: "newsletter" },
    {
      id: SETTINGS_ROOT_ID,
      type: "root",
      title: "Settings",
      childs: [
        { id: "admin.users", type: "item", path: "/admin/users", title: "Team Members", icon: "admin.users", requiredFeature: "users" },
        { id: "admin.api_keys", type: "item", path: "/admin/api-keys", title: "API Keys", icon: "Key", requiredFeature: "settings" },
      ],
    },
  ];
}

describe("applyNavLayout", () => {
  it("is a passthrough when no layout is set (identical render)", () => {
    const tree = baseTree();
    expect(applyNavLayout(tree, null)).toBe(tree);
  });

  it("preserves requiredFeature so downstream permission filtering still works", () => {
    const layout: NavLayout = {
      version: 1,
      sidebar: [{ id: "main", items: [{ key: "inbox" }] }],
      settings: [],
      hidden: [],
    };
    const out = applyNavLayout(baseTree(), layout);
    const inbox = out.find((n) => n.id === "inbox");
    expect(inbox?.requiredFeature).toBe("content-platform.inbox");
  });

  it("re-emits the settings root with the layout's settings items as children", () => {
    const layout: NavLayout = {
      version: 1,
      sidebar: [{ id: "main", items: [{ key: "inbox" }] }],
      settings: [{ key: "admin.users" }],
      hidden: [],
    };
    const out = applyNavLayout(baseTree(), layout);
    const root = out.find((n) => n.id === SETTINGS_ROOT_ID);
    expect(root?.type).toBe("root");
    expect(root?.childs?.map((c) => c.id)).toEqual(["admin.users"]);
  });
});

describe("seedLayoutFromTree", () => {
  function sectionedTree(): NavigationTree[] {
    return [
      { id: "inbox", type: "item", path: "/inbox", title: "Inbox", order: 5 },
      { id: "people", type: "item", path: "/people", title: "People", defaultSection: "Community", order: 200 },
      { id: "module.blog..blog", type: "item", path: "/blog", title: "Blog", defaultSection: "Content", order: 20 },
      { id: "module.news..news", type: "item", path: "/news", title: "News", defaultSection: "Content", order: 10 },
      { id: "module.events..events", type: "item", path: "/events", title: "Events", defaultSection: "Events", order: 100 },
      {
        id: SETTINGS_ROOT_ID,
        type: "root",
        title: "Settings",
        childs: [
          { id: "admin.users", type: "item", path: "/admin/users", title: "Team", order: 10 },
          { id: "module.ai..ai", type: "item", path: "/admin/ai", title: "AI", order: 5 },
        ],
      },
    ];
  }

  it("groups sidebar items by defaultSection, untitled first, ordered by min item order", () => {
    const layout = seedLayoutFromTree(sectionedTree());
    // Untitled 'main' (inbox) leads; then Content (min 10), Events (100), Community (200).
    expect(layout.sidebar.map((s) => s.title ?? null)).toEqual([
      null,
      "Content",
      "Events",
      "Community",
    ]);
    // Items within Content sorted by order: news(10) before blog(20).
    const content = layout.sidebar.find((s) => s.title === "Content");
    expect(content?.items.map((i) => i.key)).toEqual([
      "module.news..news",
      "module.blog..blog",
    ]);
  });

  it("places settings-dashboard items flat, ordered by order", () => {
    const layout = seedLayoutFromTree(sectionedTree());
    expect(layout.settings.map((i) => i.key)).toEqual(["module.ai..ai", "admin.users"]);
  });

  it("round-trips through applyNavLayout into grouped sidebar + settings root", () => {
    const tree = sectionedTree();
    const out = applyNavLayout(tree, seedLayoutFromTree(tree));
    const titles = out.filter((n) => n.type === "group").map((n) => n.title);
    expect(titles).toEqual(["Content", "Events", "Community"]);
    const root = out.find((n) => n.id === SETTINGS_ROOT_ID);
    expect(root?.childs?.map((c) => c.id)).toEqual(["module.ai..ai", "admin.users"]);
  });
});

describe("resolveNavigation", () => {
  it("renders titled sections as groups and untitled sections inline", () => {
    const layout: NavLayout = {
      version: 1,
      sidebar: [
        { id: "content", title: "Content", icon: "Folder", items: [{ key: "inbox" }, { key: "module.newsletter.admin.newsletter" }] },
        { id: "loose", items: [{ key: "people" }] },
      ],
      settings: [],
      hidden: [],
    };
    const { sidebar } = resolveNavigation(baseTree(), layout);

    expect(sidebar).toHaveLength(2);
    const group = sidebar[0];
    expect(group.type).toBe("group");
    expect(group.title).toBe("Content");
    expect(group.icon).toBe("Folder");
    expect(group.childs?.map((c) => c.id)).toEqual([
      "inbox",
      "module.newsletter.admin.newsletter",
    ]);
    // Untitled section spreads its item at the top level (not wrapped).
    expect(sidebar[1].id).toBe("people");
    expect(sidebar[1].type).toBe("item");
  });

  it("applies per-item icon and label overrides", () => {
    const layout: NavLayout = {
      version: 1,
      sidebar: [{ id: "main", items: [{ key: "inbox", label: "Triage", icon: "Bolt" }] }],
      settings: [],
      hidden: [],
    };
    const { sidebar } = resolveNavigation(baseTree(), layout);
    expect(sidebar[0].title).toBe("Triage");
    expect(sidebar[0].icon).toBe("Bolt");
  });

  it("excludes hidden keys and drops empty sections", () => {
    const layout: NavLayout = {
      version: 1,
      sidebar: [{ id: "content", title: "Content", items: [{ key: "inbox" }] }],
      settings: [],
      hidden: ["inbox"],
    };
    const { sidebar } = resolveNavigation(baseTree(), layout);
    expect(sidebar).toHaveLength(0);
  });

  it("routes unreferenced pool items into unsorted (hidden from live surfaces)", () => {
    const layout: NavLayout = {
      version: 1,
      sidebar: [{ id: "main", items: [{ key: "inbox" }] }],
      settings: [{ key: "admin.users" }],
      hidden: [],
    };
    const { unsorted } = resolveNavigation(baseTree(), layout);
    const ids = unsorted.map((n) => n.id).sort();
    expect(ids).toEqual(["admin.api_keys", "module.newsletter.admin.newsletter", "people"]);
  });

  it("drops references to uninstalled modules and de-dupes repeated keys", () => {
    const layout: NavLayout = {
      version: 1,
      sidebar: [
        { id: "main", items: [{ key: "inbox" }, { key: "inbox" }, { key: "ghost.module" }] },
      ],
      settings: [],
      hidden: [],
    };
    const { sidebar } = resolveNavigation(baseTree(), layout);
    expect(sidebar.filter((n) => n.id === "inbox")).toHaveLength(1);
    expect(sidebar.some((n) => n.id === "ghost.module")).toBe(false);
  });

  it("does not count an unsorted item as hidden when it is neither placed nor hidden", () => {
    const layout: NavLayout = {
      version: 1,
      sidebar: [],
      settings: [],
      hidden: ["people"],
    };
    const { unsorted } = resolveNavigation(baseTree(), layout);
    expect(unsorted.some((n) => n.id === "people")).toBe(false);
    expect(unsorted.some((n) => n.id === "inbox")).toBe(true);
  });

  it("builds a collapsible group from a nested entry and excludes its children from unsorted", () => {
    const layout: NavLayout = {
      version: 1,
      sidebar: [
        {
          id: "main",
          items: [
            {
              key: "group:content",
              label: "Content",
              children: [{ key: "inbox" }, { key: "module.newsletter.admin.newsletter" }],
            },
          ],
        },
      ],
      settings: [],
      hidden: [],
    };
    const { sidebar, unsorted } = resolveNavigation(baseTree(), layout);
    const group = sidebar[0];
    expect(group.type).toBe("collapse");
    expect(group.title).toBe("Content");
    expect(group.childs?.map((c) => c.id)).toEqual([
      "inbox",
      "module.newsletter.admin.newsletter",
    ]);
    // Nested children are "used", so they don't reappear in unsorted.
    expect(unsorted.some((n) => n.id === "inbox")).toBe(false);
    expect(unsorted.some((n) => n.id === "module.newsletter.admin.newsletter")).toBe(false);
  });

  it("drops a group whose children are all uninstalled", () => {
    const layout: NavLayout = {
      version: 1,
      sidebar: [
        { id: "main", items: [{ key: "group:ghosts", label: "Ghosts", children: [{ key: "gone" }] }] },
      ],
      settings: [],
      hidden: [],
    };
    const { sidebar } = resolveNavigation(baseTree(), layout);
    expect(sidebar).toHaveLength(0);
  });
});

describe("module hub pages", () => {
  const HUB_KEY = "module.marketing-os..marketing-os";

  function treeWithHub(): NavigationTree[] {
    const tree = baseTree();
    tree.splice(3, 0, {
      id: HUB_KEY,
      type: "item",
      path: "/marketing-os",
      title: "Marketing OS",
      icon: "RocketLaunch",
      requiredFeature: "marketing-os",
      hub: "marketing-os",
    });
    return tree;
  }

  function layout(hubs: NavLayout["hubs"]): NavLayout {
    return {
      version: 1,
      sidebar: [{ id: "main", items: [{ key: "inbox" }, { key: HUB_KEY }] }],
      settings: [],
      hubs,
      hidden: [],
    };
  }

  const ids = (cards: { key: string }[]) => cards.map((c) => c.key);

  it("resolves an installed hub's cards in order, with overrides", () => {
    const { hubs } = resolveNavigation(
      treeWithHub(),
      layout({ "marketing-os": [{ key: "module.newsletter.admin.newsletter", label: "Newsletters" }, { key: "people" }] }),
    );
    expect(ids(hubs["marketing-os"])).toEqual(["module.newsletter.admin.newsletter", "people"]);
    expect(hubs["marketing-os"][0].title).toBe("Newsletters");
    expect(hubs["marketing-os"][0].node?.path).toBe("/admin/newsletter");
    expect(hubs["marketing-os"][1].title).toBe("People");
  });

  it("carries the card fields through", () => {
    const { hubs } = resolveNavigation(
      treeWithHub(),
      layout({
        "marketing-os": [
          { key: "people", description: "Find people", tags: ["CRM"], eyebrow: "Agent 1", accent: "violet", comingSoon: true },
        ],
      }),
    );
    expect(hubs["marketing-os"][0]).toMatchObject({
      description: "Find people",
      tags: ["CRM"],
      eyebrow: "Agent 1",
      accent: "violet",
      comingSoon: true,
      icon: "dashboards.members",
    });
  });

  it("drops an accent that isn't one of the known colours", () => {
    const { hubs } = resolveNavigation(
      treeWithHub(),
      layout({ "marketing-os": [{ key: "people", accent: "constructor" as never }] }),
    );
    expect(hubs["marketing-os"][0].accent).toBeUndefined();
  });

  it("keeps an item in the sidebar and on a hub at once", () => {
    const l = layout({ "marketing-os": [{ key: "inbox" }] });
    const { sidebar, hubs } = resolveNavigation(treeWithHub(), l);
    expect(sidebar.map((n) => n.id)).toContain("inbox");
    expect(ids(hubs["marketing-os"])).toEqual(["inbox"]);
  });

  it("keeps an item on the settings page and on a hub at once", () => {
    const l = layout({ "marketing-os": [{ key: "admin.users" }] });
    l.settings = [{ key: "admin.users" }];
    const { settings, hubs } = resolveNavigation(treeWithHub(), l);
    expect(settings.map((n) => n.id)).toEqual(["admin.users"]);
    expect(ids(hubs["marketing-os"])).toEqual(["admin.users"]);
  });

  it("shows a hub card even when the item is hidden from the sidebar", () => {
    const l = layout({ "marketing-os": [{ key: "people" }] });
    l.hidden = ["people"];
    const { hubs, sidebar } = resolveNavigation(treeWithHub(), l);
    expect(ids(hubs["marketing-os"])).toEqual(["people"]);
    expect(sidebar.map((n) => n.id)).not.toContain("people");
  });

  it("leaves an item that is only on a hub in unsorted, since it isn't in the sidebar", () => {
    const { unsorted, hubs } = resolveNavigation(treeWithHub(), layout({ "marketing-os": [{ key: "people" }] }));
    expect(ids(hubs["marketing-os"])).toEqual(["people"]);
    expect(unsorted.map((n) => n.id)).toContain("people");
  });

  it("does not render hub-only items in the sidebar tree", () => {
    const out = applyNavLayout(treeWithHub(), layout({ "marketing-os": [{ key: "people" }] }));
    const flat = out.flatMap((n) => [n.id, ...(n.childs ?? []).map((c) => c.id)]);
    expect(flat).not.toContain("people");
  });

  it("gives every installed hub an entry, empty when nothing is filed", () => {
    const { hubs } = resolveNavigation(treeWithHub(), layout(undefined));
    expect(hubs).toEqual({ "marketing-os": [] });
  });

  it("never lists a hub's own page on that hub", () => {
    const { hubs } = resolveNavigation(treeWithHub(), layout({ "marketing-os": [{ key: HUB_KEY }, { key: "people" }] }));
    expect(ids(hubs["marketing-os"])).toEqual(["people"]);
  });

  it("shows each key once", () => {
    const { hubs } = resolveNavigation(treeWithHub(), layout({ "marketing-os": [{ key: "people" }, { key: "people", label: "x" }] }));
    expect(hubs["marketing-os"]).toHaveLength(1);
    expect(hubs["marketing-os"][0].title).toBe("People");
  });

  it("resolves nothing for an uninstalled hub", () => {
    const { hubs } = resolveNavigation(baseTree(), layout({ "marketing-os": [{ key: "people" }] }));
    expect(hubs).toEqual({});
  });

  it("drops a card whose module is not installed", () => {
    const { hubs } = resolveNavigation(treeWithHub(), layout({ "marketing-os": [{ key: "module.gone..gone" }] }));
    expect(hubs["marketing-os"]).toEqual([]);
  });

  it("gives a hub id declared twice to the first declarer, and keeps both pages off that hub", () => {
    const tree = treeWithHub();
    tree.splice(4, 0, { id: "module.other..other", type: "item", path: "/other", title: "Other", hub: "marketing-os" });
    expect(buildPool(tree).hubs.get("marketing-os")?.id).toBe(HUB_KEY);
    const { hubs } = resolveNavigation(tree, layout({ "marketing-os": [{ key: "module.other..other" }, { key: "people" }] }));
    expect(ids(hubs["marketing-os"])).toEqual(["people"]);
  });

  it("ignores a hub id the layout sanitiser would reject", () => {
    const tree = treeWithHub();
    tree[3] = { ...tree[3], hub: "MarketingOS" };
    expect(buildPool(tree).hubs.size).toBe(0);
    expect(resolveNavigation(tree, layout({ MarketingOS: [{ key: "people" }] })).hubs).toEqual({});
  });

  it("does not read inherited keys of the hubs record", () => {
    const tree = treeWithHub();
    tree[3] = { ...tree[3], hub: "constructor" };
    expect(resolveNavigation(tree, layout({})).hubs).toEqual({ constructor: [] });
  });

  it("passes the item's i18n key through only when the layout doesn't override the title", () => {
    const tree = treeWithHub();
    tree[1] = { ...tree[1], transKey: "nav.people" };
    const plain = resolveNavigation(tree, layout({ "marketing-os": [{ key: "people" }] })).hubs["marketing-os"][0];
    expect(plain.titleKey).toBe("nav.people");
    const labelled = resolveNavigation(tree, layout({ "marketing-os": [{ key: "people", label: "Contacts" }] })).hubs["marketing-os"][0];
    expect(labelled.titleKey).toBeUndefined();
    expect(labelled.title).toBe("Contacts");
  });

  it("keeps only string tags", () => {
    const { hubs } = resolveNavigation(
      treeWithHub(),
      layout({ "marketing-os": [{ key: "people", tags: ["a", 3, null] as never }] }),
    );
    expect(hubs["marketing-os"][0].tags).toEqual(["a"]);
  });

  it("drops a module card whose item has no route", () => {
    const tree = treeWithHub();
    tree[1] = { ...tree[1], path: undefined };
    expect(resolveNavigation(tree, layout({ "marketing-os": [{ key: "people" }] })).hubs["marketing-os"]).toEqual([]);
  });

  describe("custom link cards", () => {
    it("resolves a custom card with a safe URL", () => {
      const { hubs } = resolveNavigation(
        treeWithHub(),
        layout({ "marketing-os": [{ key: "link:events", label: "Events", url: "/foundation/events", newTab: true, icon: "Calendar" }] }),
      );
      expect(hubs["marketing-os"]).toEqual([
        expect.objectContaining({ key: "link:events", title: "Events", url: "/foundation/events", newTab: true, icon: "Calendar" }),
      ]);
      expect(hubs["marketing-os"][0].node).toBeUndefined();
    });

    it("drops a custom card with an unsafe URL, even if it reached storage unsanitised", () => {
      const { hubs } = resolveNavigation(
        treeWithHub(),
        layout({ "marketing-os": [{ key: "link:x", label: "X", url: "javascript:alert(1)" }] }),
      );
      expect(hubs["marketing-os"]).toEqual([]);
    });

    it("drops a custom card with no title", () => {
      const { hubs } = resolveNavigation(treeWithHub(), layout({ "marketing-os": [{ key: "link:x", url: "/x" }] }));
      expect(hubs["marketing-os"]).toEqual([]);
    });

    it("keeps a coming-soon custom card with no URL, and never opens it in a new tab", () => {
      const { hubs } = resolveNavigation(
        treeWithHub(),
        layout({ "marketing-os": [{ key: "link:deck", label: "Pitch deck", comingSoon: true, newTab: true }] }),
      );
      expect(hubs["marketing-os"][0]).toMatchObject({ title: "Pitch deck", comingSoon: true, newTab: false });
      expect(hubs["marketing-os"][0].url).toBeUndefined();
    });
  });
});
