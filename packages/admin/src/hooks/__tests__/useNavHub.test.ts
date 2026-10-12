import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { NavHubCard } from "@/app/navigation/resolveNavLayout";

const state: { cards: NavHubCard[]; error: Error | null } = { cards: [], error: null };

vi.mock("@/hooks/useNavigation", () => ({
  useNavHubs: () => ({ hubs: { "marketing-os": state.cards }, ready: true, error: state.error, reload: () => {} }),
}));
vi.mock("@/hooks/useFeaturePermissions", () => ({
  useFeaturePermissions: () => ({ permissions: {}, isSuperAdmin: true, isLoading: false }),
}));
vi.mock("@/app/contexts/modules/context", () => ({
  useModulesContext: () => ({
    ready: true,
    allModuleFeatures: new Set(["newsletters", "broadcasts"]),
    isFeatureEnabled: (f: string) => f === "newsletters",
  }),
}));

import { useNavHub } from "../useNavHub";

const card = (key: string, extra: Partial<NavHubCard> = {}): NavHubCard => ({
  key,
  title: key,
  tags: [],
  comingSoon: false,
  newTab: false,
  ...extra,
});

describe("useNavHub", () => {
  it("drops module cards for disabled features and keeps custom cards", () => {
    state.error = null;
    state.cards = [
      card("module.newsletters..newsletters", { node: { id: "n", type: "item", path: "/newsletters", requiredFeature: "newsletters" } }),
      card("module.broadcasts..broadcasts", { node: { id: "b", type: "item", path: "/broadcasts", requiredFeature: "broadcasts" } }),
      card("link:events", { url: "/foundation/events" }),
    ];
    const { result } = renderHook(() => useNavHub("marketing-os"));
    expect(result.current.cards.map((c) => c.key)).toEqual(["module.newsletters..newsletters", "link:events"]);
  });

  it("still offers the deprecated items list, built from module cards", () => {
    state.error = null;
    state.cards = [
      card("module.newsletters..newsletters", {
        title: "Weekly digest",
        icon: "Envelope",
        node: { id: "n", type: "item", path: "/newsletters", title: "Newsletters", requiredFeature: "newsletters" },
      }),
      card("link:events", { url: "/foundation/events" }),
    ];
    const { result } = renderHook(() => useNavHub("marketing-os"));
    expect(result.current.items).toEqual([
      { id: "n", type: "item", path: "/newsletters", title: "Weekly digest", icon: "Envelope", requiredFeature: "newsletters" },
    ]);
  });

  it("returns no cards when the layout failed to load", () => {
    state.error = new Error("boom");
    state.cards = [card("link:events", { url: "/x" })];
    const { result } = renderHook(() => useNavHub("marketing-os"));
    expect(result.current.cards).toEqual([]);
    expect(result.current.error?.message).toBe("boom");
  });

  it("returns no cards for an unknown hub", () => {
    state.error = null;
    const { result } = renderHook(() => useNavHub("constructor"));
    expect(result.current.cards).toEqual([]);
  });
});
