import type { ReactNode } from "react";
import { Tabs, type Tab } from "../Tabs";

/**
 * WorkspaceLayout — shared shell for top-level module workspace pages.
 *
 * A full-bleed hero (accent-9 background + auto-contrast foreground)
 * with a title, optional tagline, optional right-aligned `actions`,
 * followed by a Radix-based primary tab strip whose bg spans the full
 * chrome width and whose first-trigger underline lines up with the
 * page's content column. Optionally a secondary (underline-variant)
 * tab strip can be rendered below the primary one for pages that
 * carry sub-navigation (settings, content-hub, etc.).
 *
 * Originally derived from the ambassadors module's AmbassadorsLayout;
 * moved here so every top-level workspace page in the admin (events
 * list, blog, podcasts, scrapers, compliance, ai, cost-governance,
 * inbox/email management, content-hub, ambassadors, etc.) can adopt
 * the same look by passing in their own title + tabs.
 *
 *   <WorkspaceLayout
 *     title="Podcasts"
 *     tagline="Episodes, guests, and outreach."
 *     tabs={PRIMARY_TABS}
 *     activeTabId={tabId}
 *     onTabChange={setTabId}
 *     actions={<Button>New episode</Button>}
 *   >
 *     {tab content}
 *   </WorkspaceLayout>
 *
 * Consumer manages active-tab state. For URL-driven pages, derive
 * `activeTabId` from `useLocation()` and call `navigate()` in
 * `onTabChange` — see ambassadors AmbassadorsLayout for the pattern.
 *
 * Pages with sub-tabs (content-hub, settings) pass `subTabs` +
 * `activeSubTabId` + `onSubTabChange`. The sub-tabs render as an
 * underline-variant strip below the primary tabs so the two
 * hierarchies are visually distinct.
 */
export interface WorkspaceLayoutProps {
  /** Hero title — typically the module name (e.g. "Ambassadors"). */
  title: string;
  /**
   * Short subtitle under the title.
   * @deprecated Kept on the type for back-compat with already-migrated
   * pages; the layout no longer renders it. New pages should omit it.
   * Will be removed once all consumers drop the prop.
   */
  tagline?: string;
  /** Right-aligned actions in the hero (CTAs, dropdowns, etc.). */
  actions?: ReactNode;

  /** Primary tab strip directly under the hero. */
  tabs: Tab[];
  activeTabId: string;
  onTabChange: (tabId: string) => void;

  /** Optional secondary (sub) tab strip below the primary one. */
  subTabs?: Tab[];
  activeSubTabId?: string;
  onSubTabChange?: (tabId: string) => void;

  /** Active-tab content. */
  children: ReactNode;
}

export function WorkspaceLayout({
  title,
  // tagline intentionally unused — see prop deprecation note above.
  tagline: _tagline,
  actions,
  tabs,
  activeTabId,
  onTabChange,
  subTabs,
  activeSubTabId,
  onSubTabChange,
  children,
}: WorkspaceLayoutProps) {
  const hasSubTabs = Boolean(subTabs && subTabs.length > 0 && activeSubTabId !== undefined && onSubTabChange);

  return (
    <div className="workspace-layout">
      {/* Full-bleed hero — escapes the page's --margin-x so the
          section runs chrome-to-chrome. Background uses the brand's
          exact primary color (var(--accent-9)); foreground uses
          var(--accent-contrast) so the text auto-adapts to a readable
          tone for whatever palette the Theme is set to (white for
          most accents, dark for yellow/lime/etc.). */}
      <div
        className="relative overflow-hidden -mx-(--margin-x) -mt-(--margin-x) border-b border-[var(--gray-a4)]"
        style={{ backgroundColor: "var(--accent-9)", color: "var(--accent-contrast)" }}
      >
        <div
          className="relative flex items-center justify-between gap-4 flex-wrap py-7"
          style={{ paddingLeft: "calc(var(--margin-x) + 1.5rem)", paddingRight: "calc(var(--margin-x) + 1.5rem)" }}
        >
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {actions ? (
            <div
              className={
                // Buttons rendered inside the hero sit on var(--accent-9);
                // restyle to a transparent / outline look using
                // var(--accent-contrast) for text + border + icon. Radix
                // computes accent-contrast as a readable foreground for
                // whatever accent-9 resolves to (white for dark accents,
                // near-black for bright ones), so a single rule covers
                // both the "primary is dark → white outline" and
                // "primary is light → dark outline" cases the user asked
                // for. Hover keeps the same colors but adds a faint tint.
                "flex items-center gap-2 " +
                "[&_button]:!bg-transparent " +
                "[&_button]:!text-[var(--accent-contrast)] " +
                "[&_button]:!border " +
                "[&_button]:!border-[var(--accent-contrast)] " +
                "[&_button_svg]:!text-[var(--accent-contrast)] " +
                "[&_button:hover]:!bg-[color-mix(in_srgb,var(--accent-contrast)_12%,transparent)]"
              }
            >
              {actions}
            </div>
          ) : null}
        </div>
      </div>

      {/* Primary tab strip — full-bleed bg via -mx-(--margin-x).
          Tabs.List inline padding is overridden to
          calc(var(--margin-x) + 1rem); the Radix trigger's own
          ~0.5rem internal padding then lands the active underline at
          calc(var(--margin-x) + 1.5rem), aligned with the hero title
          and the content gutter below. */}
      <div
        className="-mx-(--margin-x)
                   [&_.rt-BaseTabList]:!pl-[calc(var(--margin-x)+1rem)]
                   [&_.rt-BaseTabList]:!pr-[calc(var(--margin-x)+1rem)]
                   [&_.rt-BaseTabList]:!bg-[var(--accent-3)]"
      >
        <Tabs
          fullWidth
          value={activeTabId}
          onChange={onTabChange}
          tabs={tabs}
        />
      </div>

      {/* Optional sub-tab strip — slimmer underline-variant tabs so
          the two hierarchies read as visually distinct.

          Two arbitrary-selector overrides on the underline variant:
            1. Tablist padding-left = calc(var(--margin-x) + 1.5rem)
               so the first sub-tab button sits flush under the
               primary tab text + content cards.
            2. Each button's px-4 (1rem) default is overridden to
               px-3 (0.75rem) — tighter than the original but a
               touch more breathing room than px-2 so adjacent items
               don't crowd each other. */}
      {hasSubTabs && (
        <div
          className="-mx-(--margin-x) border-b border-[var(--gray-a4)] bg-[var(--accent-2)]"
        >
          <Tabs
            fullWidth
            variant="underline"
            value={activeSubTabId!}
            onChange={onSubTabChange!}
            tabs={subTabs!}
            className="!pl-[calc(var(--margin-x)+1.5rem)] !pr-[calc(var(--margin-x)+1.5rem)]
                       [&_button]:!px-3"
          />
        </div>
      )}

      {/* Tab content — pt-8 for breathing room under the tab strip;
          px-6 + pb-6 to match the hero title's horizontal inset so
          cards line up with the title and tab underline above. */}
      <div className="pt-8 px-6 pb-6">{children}</div>
    </div>
  );
}

export default WorkspaceLayout;
