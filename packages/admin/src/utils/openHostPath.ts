import { isSafeHubUrl } from "@gatewaze/shared";
import { isEmbedded } from "@/embed/embedMode";
import { getHostNavigate } from "@/embed/hostNavigate";

/**
 * Open a path (starting with '/') in the app that owns the page. Inside the
 * admin embed that is the host app (e.g. another part of LFX), through the
 * host's navigateHost hook when it gave one, else a full page load. In the
 * standalone admin it is an admin route. Anything other than a safe path
 * starting with a single '/' is ignored, so a careless caller can't turn this
 * into a `javascript:` navigation.
 */
export function openHostPath(path: string, navigate: (to: string) => void | Promise<void>): void {
  if (!path.startsWith("/") || !isSafeHubUrl(path)) return;
  if (isEmbedded()) {
    const navigateHost = getHostNavigate();
    if (navigateHost) navigateHost(path);
    else window.location.assign(path);
    return;
  }
  void navigate(path);
}
