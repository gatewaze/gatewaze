import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

import { setEmbeddedMode } from "@/embed/embedMode";
import { setHostNavigate } from "@/embed/hostNavigate";
import { NavHubCardTile } from "../NavHubCardTile";

function renderTile(props: Partial<Parameters<typeof NavHubCardTile>[0]> = {}) {
  return render(
    <MemoryRouter initialEntries={["/marketing-os"]}>
      <Routes>
        <Route path="/marketing-os" element={<NavHubCardTile title="Newsletters" index={0} {...props} />} />
        <Route path="*" element={<p>landed on another route</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  setEmbeddedMode(false);
  setHostNavigate(null);
});

describe("NavHubCardTile", () => {
  it("shows the title, line above it, description and tags", () => {
    renderTile({ eyebrow: "Agent 1", description: "Send email", tags: ["Email", "✓ v1 generated"] });
    expect(screen.getByRole("heading", { name: "Newsletters" })).toBeTruthy();
    expect(screen.getByText("Agent 1")).toBeTruthy();
    expect(screen.getByText("Send email")).toBeTruthy();
    expect(screen.getByText("Email")).toBeTruthy();
    // A ✓ tag renders the tick as an icon, not as text.
    expect(screen.getByText("v1 generated")).toBeTruthy();
  });

  it("links a module card to its admin route", () => {
    renderTile({ to: "/newsletters" });
    fireEvent.click(screen.getByRole("link"));
    expect(screen.getByText("landed on another route")).toBeTruthy();
  });

  it("links an absolute URL directly, in a new tab when asked", () => {
    renderTile({ url: "https://example.org/x", newTab: true });
    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://example.org/x");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("hands a host path to the host app when embedded", () => {
    const navigateHost = vi.fn();
    setEmbeddedMode(true);
    setHostNavigate(navigateHost);
    renderTile({ url: "/foundation/events?project=x" });
    fireEvent.click(screen.getByRole("link"));
    expect(navigateHost).toHaveBeenCalledWith("/foundation/events?project=x");
  });

  it("opens a host path as an admin route when not embedded", () => {
    renderTile({ url: "/people" });
    fireEvent.click(screen.getByRole("link"));
    expect(screen.getByText("landed on another route")).toBeTruthy();
  });

  it("leaves a modified click on a host path to the browser", () => {
    const navigateHost = vi.fn();
    setEmbeddedMode(true);
    setHostNavigate(navigateHost);
    renderTile({ url: "/foundation/events" });
    fireEvent.click(screen.getByRole("link"), { metaKey: true });
    expect(navigateHost).not.toHaveBeenCalled();
  });

  it("does not link a coming-soon card, and marks it", () => {
    renderTile({ url: "https://example.org", comingSoon: true });
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Coming soon")).toBeTruthy();
  });

  it("does not link a preview", () => {
    renderTile({ to: "/newsletters", preview: true });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("ignores an icon name that is an inherited Object property", () => {
    expect(() => renderTile({ icon: "constructor" })).not.toThrow();
  });
});
