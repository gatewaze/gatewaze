import { useState, useEffect, useCallback, useMemo } from "react";
import {
  ArrowsRightLeftIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { useNavigate } from "react-router";

import { ModuleCard, ModuleInfoModal } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Page } from "@/components/shared/Page";
import { useAuthContext } from "@/app/contexts/auth/context";
import { useModulesContext } from "@/app/contexts/modules/context";
import { ModuleService } from "@/utils/moduleService";
import type { InstalledModuleRow } from "@gatewaze/shared/modules";

/** Modules that have a dedicated settings page under /admin/integrations/:id */
const SETTINGS_ROUTES = new Set(["people-enrichment", "people-warehouse"]);

interface IntegrationCardData {
  id: string;
  name: string;
  description: string;
  version: string;
  installedVersion: string;
  status: "enabled" | "disabled" | "error" | "not_installed";
  hasSettings: boolean;
  installed_at?: string;
  source: string;
  guide?: string;
}

export default function IntegrationsPage() {
  const { user } = useAuthContext();
  const isSuperAdmin = user?.role === "super_admin";
  const navigate = useNavigate();
  const { refresh: refreshModulesContext } = useModulesContext();

  const [installedModules, setInstalledModules] = useState<
    InstalledModuleRow[]
  >([]);
  const [availableModules, setAvailableModules] = useState<{ id: string; name: string; description: string; version: string; type: string; group: string; features: string[]; guide?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [infoModule, setInfoModule] = useState<IntegrationCardData | null>(null);

  const loadInstalledModules = useCallback(async () => {
    const { modules: installed, error } =
      await ModuleService.getInstalledModules();
    if (error) {
      toast.error("Failed to load integrations");
    }
    setInstalledModules(installed ?? []);
    setLoading(false);
  }, []);

  const loadAvailableModules = useCallback(async () => {
    const { modules: available, error } = await ModuleService.getAvailableModules();
    if (error) {
      console.error("Failed to load available modules:", error);
    }
    setAvailableModules(available ?? []);
  }, []);

  useEffect(() => {
    loadInstalledModules();
    loadAvailableModules();
  }, [loadInstalledModules, loadAvailableModules]);

  const integrationCards: IntegrationCardData[] = useMemo(() => {
    const cards: IntegrationCardData[] = [];
    const availableSet = new Set(availableModules.map((m) => m.id));

    for (const mod of availableModules) {
      if ((mod.type ?? "feature") !== "integration") continue;

      const installed = installedModules.find(
        (m: InstalledModuleRow) => m.id === mod.id
      );

      cards.push({
        id: mod.id,
        name: mod.name,
        description: mod.description,
        version: mod.version,
        installedVersion: installed?.version ?? mod.version,
        status: installed?.status ?? "not_installed",
        hasSettings: SETTINGS_ROUTES.has(mod.id),
        installed_at: installed?.installed_at,
        source: "source",
        guide: mod.guide,
      });
    }

    for (const installed of installedModules) {
      if ((installed.type ?? "feature") !== "integration") continue;
      if (availableSet.has(installed.id)) continue;

      cards.push({
        id: installed.id,
        name: installed.name,
        description: installed.description ?? "Third-party integration",
        version: installed.version,
        installedVersion: installed.version,
        status: installed.status,
        hasSettings: SETTINGS_ROUTES.has(installed.id),
        installed_at: installed.installed_at,
        source: installed.source ?? "custom",
      });
    }

    cards.sort((a, b) => {
      if (a.status === "enabled" && b.status !== "enabled") return -1;
      if (a.status !== "enabled" && b.status === "enabled") return 1;
      return a.name.localeCompare(b.name);
    });

    return cards;
  }, [availableModules, installedModules]);

  const handleToggle = async (
    moduleId: string,
    currentlyEnabled: boolean
  ) => {
    if (!isSuperAdmin) {
      toast.error("Only super admins can manage integrations");
      return;
    }

    setTogglingId(moduleId);

    const result = currentlyEnabled
      ? await ModuleService.disableModule(moduleId)
      : await ModuleService.enableModule(moduleId);

    if (result.success) {
      toast.success(
        currentlyEnabled ? "Integration disabled" : "Integration enabled"
      );
      await Promise.all([loadInstalledModules(), refreshModulesContext()]);
    } else {
      toast.error(result.error ?? "Failed to update integration");
    }

    setTogglingId(null);
  };

  return (
    <Page title="Integrations">
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
            Integrations
          </h1>
          <p className="text-[var(--gray-11)] mt-1">
            Connect Gatewaze with external platforms.
            Click a card for details, or use the toggle to enable.
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="size-6 border-2 border-[var(--accent-9)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : integrationCards.length === 0 ? (
          <div className="text-center py-16">
            <ArrowsRightLeftIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-[var(--gray-12)]">
              No integrations available
            </h3>
            <p className="mt-2 text-[var(--gray-11)] max-w-md mx-auto">
              No integration modules found in your configured module sources.
              Add a module source in the Modules page to discover available
              integrations.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {integrationCards.map((mod) => {
              const isEnabled = mod.status === "enabled";

              return (
                <ModuleCard
                  key={mod.id}
                  id={mod.id}
                  name={mod.name}
                  description={mod.description}
                  version={mod.installedVersion}
                  enabled={isEnabled}
                  disabled={!isSuperAdmin}
                  toggling={togglingId === mod.id}
                  onToggle={() => handleToggle(mod.id, isEnabled)}
                  onInfo={mod.guide ? () => setInfoModule(mod) : undefined}
                >
                  {isEnabled && mod.hasSettings && (
                    <div className="mt-3 pt-3 border-t border-[var(--gray-a5)]" onClick={(e) => e.stopPropagation()}>
                      <Button
                        onClick={() => navigate(`/admin/integrations/${mod.id}`)}
                        variant="outline"
                        size="1"
                      >
                        <Cog6ToothIcon className="size-3.5 mr-1" />
                        Settings
                      </Button>
                    </div>
                  )}
                </ModuleCard>
              );
            })}
          </div>
        )}

        {infoModule?.guide && (
          <ModuleInfoModal
            isOpen
            onClose={() => setInfoModule(null)}
            moduleName={infoModule.name}
            guide={infoModule.guide}
            enabled={infoModule.status === "enabled"}
            toggleDisabled={!isSuperAdmin || togglingId === infoModule.id}
            onToggle={() => {
              const isEnabled = infoModule.status === "enabled";
              handleToggle(infoModule.id, isEnabled);
              setInfoModule((prev) =>
                prev ? { ...prev, status: isEnabled ? "disabled" : "enabled" } : null
              );
            }}
          />
        )}
      </div>
    </Page>
  );
}
