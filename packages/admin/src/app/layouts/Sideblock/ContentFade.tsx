import { useMemo, type ReactNode } from "react";
import { useLocation } from "react-router";
import { useNavigation } from "@/hooks/useNavigation";
import { useContentTransitions } from "@/app/contexts/contentTransitions";
import type { NavigationTree } from "@/@types/navigation";

/**
 * Route-level fade for the main content column. It re-mounts (triggering a
 * CSS fade-in) only when the *dashboard root* changes — i.e. when you pick a
 * different sidebar item or settings card. Navigating between tabs/sub-routes
 * within the same dashboard keeps the same root key, so the whole column does
 * NOT fade; WorkspaceLayout fades just the tab content in that case.
 */

function collectPaths(nodes: NavigationTree[], acc: string[] = []): string[] {
  for (const node of nodes) {
    if (node.path) acc.push(node.path);
    if (node.childs) collectPaths(node.childs, acc);
  }
  return acc;
}

/** The longest nav-item path that prefixes the current location. */
function dashboardRootKey(navigation: NavigationTree[], pathname: string): string {
  const matches = collectPaths(navigation)
    .filter((p) => pathname === p || pathname.startsWith(p + "/"))
    .sort((a, b) => b.length - a.length);
  // Fall back to the first path segment when no nav item matches.
  return matches[0] ?? "/" + (pathname.split("/")[1] ?? "");
}

export function ContentFade({ children }: { children: ReactNode }) {
  const { enabled } = useContentTransitions();
  const { pathname } = useLocation();
  const navigation = useNavigation();

  const key = useMemo(
    () => dashboardRootKey(navigation, pathname),
    [navigation, pathname],
  );

  if (!enabled) return <>{children}</>;
  return (
    <div key={key} className="content-fade-enter">
      {children}
    </div>
  );
}
