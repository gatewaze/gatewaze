import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import type { NavLayoutItem } from "@gatewaze/shared/modules";
import type { NavigationTree } from "@/@types/navigation";
import { buildPool, SETTINGS_ROOT_ID } from "@/app/navigation/resolveNavLayout";
import { HubPanel } from "../HubPanel";

const HUB_KEY = "module.marketing-os..marketing-os";
const pool = buildPool([
  { id: "inbox", type: "item", path: "/inbox", title: "Inbox", icon: "Inbox" },
  { id: "module.newsletters..newsletters", type: "item", path: "/newsletters", title: "Newsletters" },
  { id: HUB_KEY, type: "item", path: "/marketing-os", title: "Marketing OS", hub: "marketing-os" },
  { id: SETTINGS_ROOT_ID, type: "root", title: "Settings", childs: [] },
] as NavigationTree[]);

function renderPanel(cards: NavLayoutItem[] = []) {
  const onChange = vi.fn();
  render(
    <MemoryRouter>
      <HubPanel
        title="Marketing OS"
        hubId="marketing-os"
        cards={cards}
        pool={pool}
        moduleDescriptions={new Map([["newsletters", "Send newsletters"]])}
        onChange={onChange}
      />
    </MemoryRouter>,
  );
  return onChange;
}

describe("HubPanel", () => {
  it("adds a page from the picker, never offering the hub's own page or pages already on it", () => {
    const onChange = renderPanel([{ key: "inbox" }]);
    const select = screen.getByLabelText(/Add a page to the Marketing OS page/);
    const options = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Add a page…", "Newsletters"]);
    fireEvent.change(select, { target: { value: "module.newsletters..newsletters" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenCalledWith([{ key: "inbox" }, { key: "module.newsletters..newsletters" }]);
  });

  it("removes a card", () => {
    const onChange = renderPanel([{ key: "inbox" }, { key: "link:x", label: "X", url: "/x" }]);
    fireEvent.click(screen.getByRole("button", { name: "Remove Inbox" }));
    expect(onChange).toHaveBeenCalledWith([{ key: "link:x", label: "X", url: "/x" }]);
  });

  it("marks a card whose module isn't enabled", () => {
    renderPanel([{ key: "module.gone..gone" }]);
    expect(screen.getByText("module not enabled")).toBeTruthy();
  });

  it("adds a custom card with a key derived from its title", () => {
    const onChange = renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "+ Add custom card" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("e.g. Events"), { target: { value: "LFX Events" } });
    fireEvent.change(within(dialog).getByPlaceholderText("https://… or /path"), {
      target: { value: "/foundation/events" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith([
      { key: "link:lfx-events", label: "LFX Events", icon: "Link", url: "/foundation/events" },
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("won't apply a custom card with an unsafe link, and says why", () => {
    const onChange = renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "+ Add custom card" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("e.g. Events"), { target: { value: "Bad" } });
    fireEvent.change(within(dialog).getByPlaceholderText("https://… or /path"), {
      target: { value: "javascript:alert(1)" },
    });
    expect(within(dialog).getByText(/Use a full https/)).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("edits a module card, showing the module's own text as the defaults, and keeps its key", () => {
    const onChange = renderPanel([{ key: "module.newsletters..newsletters" }]);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByPlaceholderText("Newsletters")).toBeTruthy();
    expect(within(dialog).getByPlaceholderText("Send newsletters")).toBeTruthy();
    fireEvent.change(within(dialog).getByPlaceholderText("e.g. Brand, Identity"), { target: { value: "Email, Copy" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply" }));
    expect(onChange).toHaveBeenCalledWith([{ key: "module.newsletters..newsletters", tags: ["Email", "Copy"] }]);
  });

  it("keeps the dialog and its draft open when the icon picker is closed from its backdrop", () => {
    renderPanel([]);
    fireEvent.click(screen.getByRole("button", { name: "+ Add custom card" }));
    fireEvent.change(within(screen.getByRole("dialog")).getByPlaceholderText("e.g. Events"), {
      target: { value: "Draft title" },
    });
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: /Change/ }));
    const pickerBackdrop = screen.getByText("Choose an icon").closest(".fixed");
    expect(pickerBackdrop).toBeTruthy();
    fireEvent.click(pickerBackdrop!);
    expect(screen.queryByText("Choose an icon")).toBeNull();
    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByPlaceholderText("e.g. Events") as HTMLInputElement).value).toBe("Draft title");
  });
});
