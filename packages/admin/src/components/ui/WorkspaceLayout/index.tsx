import type { ReactNode } from "react";
import { ChevronRightIcon } from "@heroicons/react/20/solid";
import { Tabs, type Tab } from "../Tabs";
import { isRtl } from "@/utils/localeUtils";

/**
 * Trailing edge of the primary-coloured breadcrumb "flag" in the combined
 * sub-nav row: a forward-slash diagonal cut on the side facing the sub-tabs.
 * Mirrored for RTL so the slant always points toward the tabs.
 */
const BREADCRUMB_FLAG_CLIP = isRtl
  ? "polygon(0 0, 100% 0, 100% 100%, 1.25rem 100%)"
  : "polygon(0 0, 100% 0, calc(100% - 1.25rem) 100%, 0 100%)";

/**
 * A single crumb in the drill-in breadcrumb trail. The last crumb is the
 * current entity (static text); earlier crumbs carry a `to` and render as
 * clickable links back up the hierarchy.
 */
export interface WorkspaceBreadcrumb {
  label: string;
  /** Navigation target; omit on the current (last) crumb to render static text. */
  to?: string;
}

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

  /**
   * Primary tab strip directly under the hero. Omit (or pass an empty
   * array) for top-level pages that don't have a tabbed view —
   * e.g. /calendars, /events list, etc. The hero still renders; the
   * tab strip is skipped entirely.
   */
  tabs?: Tab[];
  activeTabId?: string;
  onTabChange?: (tabId: string) => void;

  /**
   * Optional breadcrumb trail for drill-in pages (e.g. a single series
   * under the Series tab). Rendered as a slim bar directly above the
   * sub-tab strip so the current entity's name and its path back up the
   * hierarchy stay visible while you move between its sub-tabs. Omit on
   * collection/list pages. Navigation is delegated to the consumer via
   * `onBreadcrumbNavigate` so this shell stays router-agnostic.
   */
  breadcrumbs?: WorkspaceBreadcrumb[];
  onBreadcrumbNavigate?: (to: string) => void;

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
  breadcrumbs,
  onBreadcrumbNavigate,
  subTabs,
  activeSubTabId,
  onSubTabChange,
  children,
}: WorkspaceLayoutProps) {
  const hasTabs = Boolean(tabs && tabs.length > 0 && activeTabId !== undefined && onTabChange);
  const hasSubTabs = Boolean(subTabs && subTabs.length > 0 && activeSubTabId !== undefined && onSubTabChange);
  const hasBreadcrumbs = Boolean(breadcrumbs && breadcrumbs.length > 0);

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
        {/* Animated pastel streaks that slide across the hero. The
            streaks fade into var(--accent-9) at both ends so the
            effect works against any brand primary. See
            workspaceHero.css for the full breakdown. */}
        <div className="workspace-hero-rainbow" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="workspace-hero-rainbow__band" />
          ))}
          <div className="workspace-hero-rainbow__h" />
          <div className="workspace-hero-rainbow__v" />
        </div>

        <div
          className="relative flex items-center gap-4 flex-wrap py-5"
          style={{ paddingLeft: "calc(var(--margin-x) + 1.5rem)", paddingRight: "calc(var(--margin-x) + 1.5rem)" }}
        >
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        </div>
      </div>

      {/* Primary tab strip — only rendered if tabs were supplied.
          Top-level pages without tabbed views (e.g. /calendars) get
          just the hero. Tabs.List inline padding is overridden to
          calc(var(--margin-x) + 1rem); the Radix trigger's own
          ~0.5rem internal padding then lands the active underline at
          calc(var(--margin-x) + 1.5rem), aligned with the hero title
          and the content gutter below. */}
      {hasTabs && (
        <div
          className="-mx-(--margin-x)
                     [&_.rt-BaseTabList]:!pl-[calc(var(--margin-x)+1rem)]
                     [&_.rt-BaseTabList]:!pr-[calc(var(--margin-x)+1rem)]
                     [&_.rt-BaseTabList]:!bg-[var(--accent-3)]"
        >
          <Tabs
            fullWidth
            value={activeTabId!}
            onChange={onTabChange!}
            tabs={tabs!}
          />
        </div>
      )}

      {/* Drill-in pages that carry BOTH a breadcrumb and sub-tabs render
          them on one line: the crumb trail first, a full-height divider,
          then the sub-tab strip. The bottom border runs the full width so
          the underline tabs read as part of the same strip — the trade-off
          is that the first sub-tab no longer aligns to the content gutter. */}
      {hasBreadcrumbs && hasSubTabs && (
        <div className="-mx-(--margin-x) border-b border-[var(--gray-a4)] bg-[var(--secondary-1)]">
          <div
            className="flex items-stretch"
            style={{ paddingRight: "calc(var(--margin-x) + 1.5rem)" }}
          >
            <nav
              aria-label="Breadcrumb"
              className="flex shrink-0 flex-wrap items-center gap-1.5 py-2.5 text-sm font-medium text-white bg-[var(--secondary-9)] ltr:mr-3 ltr:pl-[calc(var(--margin-x)+1.5rem)] ltr:pr-7 rtl:ml-3 rtl:pr-[calc(var(--margin-x)+1.5rem)] rtl:pl-7"
              style={{ clipPath: BREADCRUMB_FLAG_CLIP }}
            >
              {breadcrumbs!.map((crumb, i) => {
                const isLast = i === breadcrumbs!.length - 1;
                return (
                  <span key={i} className="inline-flex items-center gap-1.5">
                    {crumb.to && !isLast ? (
                      <button
                        type="button"
                        onClick={() => onBreadcrumbNavigate?.(crumb.to!)}
                        className="font-medium text-white hover:underline"
                      >
                        {crumb.label}
                      </button>
                    ) : (
                      <span className={isLast ? "font-semibold text-white" : "text-white"}>
                        {crumb.label}
                      </span>
                    )}
                    {!isLast && (
                      <ChevronRightIcon className="w-3.5 h-3.5 shrink-0 text-white" aria-hidden="true" />
                    )}
                  </span>
                );
              })}
            </nav>
            <Tabs
              variant="underline"
              value={activeSubTabId!}
              onChange={onSubTabChange!}
              tabs={subTabs!}
              // Active sub-tab text + underline track the secondary colour so
              // these tabs coordinate with the secondary-coloured breadcrumb
              // flag. Scoped here (not in the shared Tabs component) so plain
              // sub-tab strips elsewhere keep the primary accent.
              // `!border-b-0` drops the tablist's own divider so it doesn't
              // stack on top of the wrapper's full-width border (which would
              // read as a thicker/darker line than the section above).
              className="!border-b-0 [&_button]:!px-3 [&_[aria-selected=true]]:!border-[var(--secondary-9)] [&_[aria-selected=true]]:!text-[var(--secondary-11)]"
            />
          </div>
        </div>
      )}

      {/* Breadcrumb-only bar (drill-in pages with no sub-tabs). */}
      {hasBreadcrumbs && !hasSubTabs && (
        <div className="-mx-(--margin-x) bg-[var(--accent-2)] border-b border-[var(--gray-a4)]">
          <nav
            aria-label="Breadcrumb"
            className="flex items-center gap-1.5 flex-wrap py-2.5 text-sm"
            style={{
              paddingLeft: "calc(var(--margin-x) + 1.5rem)",
              paddingRight: "calc(var(--margin-x) + 1.5rem)",
            }}
          >
            {breadcrumbs!.map((crumb, i) => {
              const isLast = i === breadcrumbs!.length - 1;
              return (
                <span key={i} className="inline-flex items-center gap-1.5">
                  {crumb.to && !isLast ? (
                    <button
                      type="button"
                      onClick={() => onBreadcrumbNavigate?.(crumb.to!)}
                      className="font-medium text-[var(--accent-11)] hover:underline"
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <span className={isLast ? "font-medium text-[var(--gray-12)]" : "text-[var(--gray-11)]"}>
                      {crumb.label}
                    </span>
                  )}
                  {!isLast && (
                    <ChevronRightIcon className="w-3.5 h-3.5 shrink-0 text-[var(--gray-a8)]" aria-hidden="true" />
                  )}
                </span>
              );
            })}
          </nav>
        </div>
      )}

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
      {hasSubTabs && !hasBreadcrumbs && (
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

      {/* Page-level actions sub-bar — sits between the tab strip and
          the tab content. The actions are CTAs that apply to whatever
          tab is currently active (e.g. "New cohort" while on the
          Cohorts tab, "Add ambassador" while on the Roster tab) so
          they sit closer to the content they affect rather than in
          the hero. Skipped entirely when the page passes no actions. */}
      {actions ? (
        <div className="px-6 pt-6 flex items-center justify-end gap-2 flex-wrap">
          {actions}
        </div>
      ) : null}

      {/* Tab content — px-6 to match the hero title's horizontal
          inset so cards line up with the title and tab underline
          above. pt-8 below the tabs (or pt-4 when an actions bar
          already supplied breathing room). */}
      <div className={(actions ? "pt-4 " : "pt-8 ") + "px-6 pb-6"}>{children}</div>
    </div>
  );
}

export default WorkspaceLayout;
