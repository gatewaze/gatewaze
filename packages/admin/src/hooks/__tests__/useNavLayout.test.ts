import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

// Each table read resolves to whatever the test queues for that table.
const results: Record<string, Array<{ data: unknown; error: unknown }>> = {};

vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => results[table].shift() ?? { data: null, error: null },
      };
      return chain;
    },
  }),
}));

import { useNavLayout } from "../useNavLayout";

const orgLayout = { version: 1, sidebar: [], settings: [], hidden: [] };

beforeEach(() => {
  results.platform_settings = [];
  results.admin_ui_preferences = [];
});

describe("useNavLayout", () => {
  it("reports no error when both layers load", async () => {
    results.platform_settings.push({ data: { value: JSON.stringify(orgLayout) }, error: null });
    results.admin_ui_preferences.push({ data: null, error: null });
    const { result } = renderHook(() => useNavLayout());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.layout).toEqual(orgLayout);
  });

  it("reports a failed layer, keeps what did load, and recovers on reload", async () => {
    results.platform_settings.push({ data: { value: JSON.stringify(orgLayout) }, error: null });
    results.admin_ui_preferences.push({ data: null, error: { message: "permission denied" } });
    const { result } = renderHook(() => useNavLayout());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error?.message).toBe("permission denied");
    expect(result.current.layout).toEqual(orgLayout);

    results.platform_settings.push({ data: { value: JSON.stringify(orgLayout) }, error: null });
    results.admin_ui_preferences.push({ data: null, error: null });
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.ready).toBe(true);
  });
});
