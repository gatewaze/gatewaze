// Import Dependencies
import { useMemo } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import clsx from "clsx";

// Local Imports
import { Page } from "@/components/shared/Page";
import { useNavigation } from "@/hooks/useNavigation";
import { useFeaturePermissions } from "@/hooks/useFeaturePermissions";
import { useModulesContext } from "@/app/contexts/modules/context";
import { filterNavigationByPermissions } from "@/utils/navigationPermissions";
import { navigationIcons } from "@/app/navigation/icons";
import type { NavigationTree } from "@/@types/navigation";

// ----------------------------------------------------------------------

// Core admin items keyed by nav id.
const CORE_DESCRIPTIONS: Record<string, string> = {
  "admin.users": "Manage team members and their roles.",
  "admin.emails": "Email templates, topic labels, and delivery logs.",
  "admin.settings": "Branding, appearance, storage, and general settings.",
  "admin.navigation": "Group, reorder, and place sidebar and settings menu items.",
  "admin.modules": "Install, enable, and configure platform modules.",
  "admin.api_keys": "Create and revoke API keys for integrations.",
};

// Module-contributed items keyed by their human-readable title.
// Module nav items don't carry descriptions today, so we provide them here.
const TITLE_DESCRIPTIONS: Record<string, string> = {
  Inbox: "Triage and respond to incoming messages.",
  "Budget Categories": "Define categories for tracking budgets and spend.",
  Topics: "Tag content and people with topical labels.",
  Tasks: "Background tasks, queues, and recent job activity.",
  Analytics: "Workspace metrics, dashboards, and exports.",
  Lists: "Saved segments and dynamic audience lists.",
  Scrapers: "Configure web scrapers and their schedules.",
  AI: "Models, prompts, and AI feature configuration.",
  Compliance: "Audit logs, data retention, and compliance controls.",
  Content: "Manage content sources, drafts, and library.",
  Payments: "Payment providers, plans, and transactions.",
  Scheduler: "Cron schedules and queued background runs.",
  Cost: "Usage costs, budgets, and billing breakdowns.",
  "Custom Domains": "Connect and verify custom domains.",
  Environments: "Manage runtime environments and their config.",
  Webhooks: "Outgoing webhooks and delivery history.",
};

function getDescription(
  item: NavigationTree,
  label: string | undefined,
  moduleDescriptions: Map<string, string>,
): string | undefined {
  // Module cards reuse the module's own manifest description (the same text
  // the Modules page shows) so nothing is blank; core items use the static map.
  const moduleId = item.id.startsWith("module.") ? item.id.split(".")[1] : undefined;
  return (
    CORE_DESCRIPTIONS[item.id] ??
    (moduleId ? moduleDescriptions.get(moduleId) : undefined) ??
    (label ? TITLE_DESCRIPTIONS[label] : undefined)
  );
}

// Per-card color theming so each settings tile is instantly recognizable.
// `bg` is the icon container background; `text` is the icon stroke color;
// `hoverBorder` is applied to the whole card on hover so the border picks
// up the card's accent color instead of the global UI primary.
type IconColor = { bg: string; text: string; hoverBorder: string };

const COLOR_PALETTE: IconColor[] = [
  { bg: "bg-indigo-500/15 group-hover:bg-indigo-500/25", text: "text-indigo-500 dark:text-indigo-400", hoverBorder: "hover:border-indigo-500/60 focus-visible:border-indigo-500/60" },
  { bg: "bg-sky-500/15 group-hover:bg-sky-500/25", text: "text-sky-500 dark:text-sky-400", hoverBorder: "hover:border-sky-500/60 focus-visible:border-sky-500/60" },
  { bg: "bg-emerald-500/15 group-hover:bg-emerald-500/25", text: "text-emerald-500 dark:text-emerald-400", hoverBorder: "hover:border-emerald-500/60 focus-visible:border-emerald-500/60" },
  { bg: "bg-amber-500/15 group-hover:bg-amber-500/25", text: "text-amber-600 dark:text-amber-400", hoverBorder: "hover:border-amber-500/60 focus-visible:border-amber-500/60" },
  { bg: "bg-rose-500/15 group-hover:bg-rose-500/25", text: "text-rose-500 dark:text-rose-400", hoverBorder: "hover:border-rose-500/60 focus-visible:border-rose-500/60" },
  { bg: "bg-violet-500/15 group-hover:bg-violet-500/25", text: "text-violet-500 dark:text-violet-400", hoverBorder: "hover:border-violet-500/60 focus-visible:border-violet-500/60" },
  { bg: "bg-fuchsia-500/15 group-hover:bg-fuchsia-500/25", text: "text-fuchsia-500 dark:text-fuchsia-400", hoverBorder: "hover:border-fuchsia-500/60 focus-visible:border-fuchsia-500/60" },
  { bg: "bg-teal-500/15 group-hover:bg-teal-500/25", text: "text-teal-500 dark:text-teal-400", hoverBorder: "hover:border-teal-500/60 focus-visible:border-teal-500/60" },
  { bg: "bg-orange-500/15 group-hover:bg-orange-500/25", text: "text-orange-500 dark:text-orange-400", hoverBorder: "hover:border-orange-500/60 focus-visible:border-orange-500/60" },
  { bg: "bg-lime-500/15 group-hover:bg-lime-500/25", text: "text-lime-600 dark:text-lime-400", hoverBorder: "hover:border-lime-500/60 focus-visible:border-lime-500/60" },
  { bg: "bg-cyan-500/15 group-hover:bg-cyan-500/25", text: "text-cyan-500 dark:text-cyan-400", hoverBorder: "hover:border-cyan-500/60 focus-visible:border-cyan-500/60" },
  { bg: "bg-pink-500/15 group-hover:bg-pink-500/25", text: "text-pink-500 dark:text-pink-400", hoverBorder: "hover:border-pink-500/60 focus-visible:border-pink-500/60" },
];

// Explicit color assignments for known items so semantically-related cards
// keep stable, recognizable colors (e.g. API Keys is always amber).
const EXPLICIT_COLORS: Record<string, IconColor> = {
  "admin.users": COLOR_PALETTE[0],       // indigo
  "admin.emails": COLOR_PALETTE[1],      // sky
  "admin.settings": COLOR_PALETTE[7],    // teal
  "admin.modules": COLOR_PALETTE[5],     // violet
  "admin.api_keys": COLOR_PALETTE[3],    // amber
};

const TITLE_COLORS: Record<string, IconColor> = {
  Inbox: COLOR_PALETTE[1],               // sky
  "Budget Categories": COLOR_PALETTE[2], // emerald
  Topics: COLOR_PALETTE[6],              // fuchsia
  Tasks: COLOR_PALETTE[8],               // orange
  Analytics: COLOR_PALETTE[10],          // cyan
  Lists: COLOR_PALETTE[9],               // lime
  Scrapers: COLOR_PALETTE[5],            // violet
  AI: COLOR_PALETTE[11],                 // pink
  Compliance: COLOR_PALETTE[2],          // emerald
  Content: COLOR_PALETTE[0],             // indigo
  Payments: COLOR_PALETTE[2],            // emerald
  Scheduler: COLOR_PALETTE[8],           // orange
  Cost: COLOR_PALETTE[3],                // amber
  "Custom Domains": COLOR_PALETTE[10],   // cyan
  Environments: COLOR_PALETTE[7],        // teal
  Webhooks: COLOR_PALETTE[4],            // rose
};

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function getColor(item: NavigationTree, label?: string): IconColor {
  if (EXPLICIT_COLORS[item.id]) return EXPLICIT_COLORS[item.id];
  if (label && TITLE_COLORS[label]) return TITLE_COLORS[label];
  // Fallback: deterministic hash so the same card always gets the same color.
  return COLOR_PALETTE[hashString(item.id) % COLOR_PALETTE.length];
}

export default function AdminIndex() {
  const { t } = useTranslation();
  const { permissions, isSuperAdmin, isLoading } = useFeaturePermissions();
  const { isFeatureEnabled, allModuleFeatures, ready: modulesReady, rows } =
    useModulesContext();
  const navigation = useNavigation();

  const moduleDescriptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) if (row.description) map.set(row.id, row.description);
    return map;
  }, [rows]);

  const adminChildren = useMemo<NavigationTree[]>(() => {
    if (isLoading || !modulesReady) return [];
    const filtered = filterNavigationByPermissions(
      navigation,
      permissions,
      isSuperAdmin,
      isFeatureEnabled,
      allModuleFeatures,
    );
    const adminSection = filtered.find((item) => item.id === "admin");
    return adminSection?.childs ?? [];
  }, [
    navigation,
    permissions,
    isSuperAdmin,
    isLoading,
    modulesReady,
    isFeatureEnabled,
    allModuleFeatures,
  ]);

  return (
    <Page title="Settings">
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
            Settings
          </h1>
          <p className="mt-1 text-[var(--gray-11)]">
            Administer your workspace, modules, and integrations.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {adminChildren.map((item) => {
            if (!item.path) return null;
            const Icon = item.icon ? navigationIcons[item.icon] : undefined;
            const label = item.transKey ? t(item.transKey) : item.title;
            const description = getDescription(item, label, moduleDescriptions);
            const color = getColor(item, label);

            return (
              <Link
                key={item.id}
                to={item.path}
                className={clsx(
                  "group flex h-full items-stretch overflow-hidden rounded-lg border border-[var(--gray-a6)] bg-[var(--color-panel-solid)] transition-all focus:outline-none hover:shadow-md focus-visible:shadow-md",
                  color.hoverBorder,
                )}
              >
                {Icon && (
                  <div
                    className={clsx(
                      "flex w-16 shrink-0 items-center justify-center transition-colors",
                      color.bg,
                      color.text,
                    )}
                  >
                    <Icon className="size-7" />
                  </div>
                )}
                <div className="min-w-0 flex-1 px-4 py-4">
                  <h3 className="text-sm font-semibold text-[var(--gray-12)]">
                    {label}
                  </h3>
                  {description && (
                    <p className="mt-1 text-xs text-[var(--gray-11)] line-clamp-2">
                      {description}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </Page>
  );
}
