import { describe, it, expect } from "vitest";
import type { NavLayout } from "@gatewaze/shared/modules";
import type { NavigationTree } from "@/@types/navigation";
import {
  applyNavLayout,
  resolveNavigation,
  seedLayoutFromTree,
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
});
