import { afterEach, describe, expect, it, vi } from "vitest";
import { setEmbeddedMode } from "@/embed/embedMode";
import { setHostNavigate } from "@/embed/hostNavigate";
import { openHostPath } from "../openHostPath";

afterEach(() => {
  setEmbeddedMode(false);
  setHostNavigate(null);
  vi.unstubAllGlobals();
});

describe("openHostPath", () => {
  it("uses the router when not embedded", () => {
    const navigate = vi.fn();
    openHostPath("/people", navigate);
    expect(navigate).toHaveBeenCalledWith("/people");
  });

  it("uses the host's navigateHost when embedded", () => {
    const navigate = vi.fn();
    const navigateHost = vi.fn();
    setEmbeddedMode(true);
    setHostNavigate(navigateHost);
    openHostPath("/foundation/events", navigate);
    expect(navigateHost).toHaveBeenCalledWith("/foundation/events");
    expect(navigate).not.toHaveBeenCalled();
  });

  it.each(["javascript:alert(1)", "//evil.example.org", "https://example.org", "/a b"])(
    "ignores %s",
    (path) => {
      const navigate = vi.fn();
      const navigateHost = vi.fn();
      openHostPath(path, navigate);
      setEmbeddedMode(true);
      setHostNavigate(navigateHost);
      openHostPath(path, navigate);
      expect(navigate).not.toHaveBeenCalled();
      expect(navigateHost).not.toHaveBeenCalled();
    },
  );

  it("falls back to a full page load when embedded without navigateHost", () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    setEmbeddedMode(true);
    openHostPath("/foundation/events", vi.fn());
    expect(assign).toHaveBeenCalledWith("/foundation/events");
  });
});
