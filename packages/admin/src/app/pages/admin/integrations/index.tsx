import { useState, useEffect, useCallback, useMemo } from "react";
import {
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  Cog6ToothIcon,
  ArrowsRightLeftIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { useNavigate } from "react-router";

import { Card, Badge, Switch } from "@/components/ui";
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
  configuredKeys: number;
  totalKeys: number;
  installed_at?: string;
  source: string;
}

export default function IntegrationsPage() {
  const { user } = useAuthContext();
  const isSuperAdmin = user?.role === "super_admin";
  const navigate = useNavigate();
  const { refresh: refreshModulesContext } = useModulesContext();

  const [installedModules, setInstalledModules] = useState<
    InstalledModuleRow[]
  >([]);
  const [availableModules, setAvailableModules] = useState<{ id: string; name: string; description: string; version: string; type: string; group: string; features: string[] }[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);

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

  // Build card data from integration-type modules available from sources
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
        configuredKeys: 0,
        totalKeys: 0,
        installed_at: installed?.installed_at,
        source: "source",
      });
    }

    // Also include installed integration modules not in current sources
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
        configuredKeys: 0,
        totalKeys: 0,
        installed_at: installed.installed_at,
        source: installed.source ?? "custom",
      });
    }

    // Sort: enabled first, then alphabetically
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

  const statusBadge = (status: IntegrationCardData["status"]) => {
    switch (status) {
      case "enabled":
        return <Badge color="green">Active</Badge>;
      case "disabled":
        return <Badge color="gray">Disabled</Badge>;
      case "error":
        return <Badge color="red">Error</Badge>;
      case "not_installed":
        return <Badge color="orange">Not Installed</Badge>;
    }
  };

  const statusIcon = (status: IntegrationCardData["status"]) => {
    switch (status) {
      case "enabled":
        return <CheckCircleIcon className="size-5 text-green-500" />;
      case "disabled":
        return <XCircleIcon className="size-5 text-gray-400" />;
      case "error":
        return (
          <ExclamationTriangleIcon className="size-5 text-red-500" />
        );
      case "not_installed":
        return (
          <ExclamationTriangleIcon className="size-5 text-orange-400" />
        );
    }
  };

  const configStatus = (mod: IntegrationCardData) => {
    if (mod.status !== "enabled") return null;
    if (mod.totalKeys === 0) return null;

    const isConfigured = mod.configuredKeys >= mod.totalKeys;
    return (
      <div
        className={`mt-3 flex items-center gap-2 text-xs ${
          isConfigured ? "text-green-500" : "text-amber-500"
        }`}
      >
        {isConfigured ? (
          <CheckCircleIcon className="size-3.5" />
        ) : (
          <ExclamationTriangleIcon className="size-3.5" />
        )}
        <span>
          {isConfigured
            ? "API keys configured"
            : `${mod.totalKeys - mod.configuredKeys} API key(s) need configuration`}
        </span>
      </div>
    );
  };

  return (
    <Page title="Integrations">
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
            Integrations
          </h1>
          <p className="text-[var(--gray-11)] mt-1">
            Integration modules for connecting Gatewaze with external platforms.
            Enable a module and configure its settings to get started.
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {integrationCards.map((mod) => (
              <Card key={mod.id} className="p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {statusIcon(mod.status)}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-[var(--gray-12)] truncate">
                          {mod.name}
                        </h3>
                        {mod.source !== "bundled" && (
                          <Badge color="blue">Custom</Badge>
                        )}
                      </div>
                      <p className="text-xs text-[var(--gray-a9)]">
                        v{mod.installedVersion}
                      </p>
                    </div>
                  </div>
                  {statusBadge(mod.status)}
                </div>

                <p className="mt-3 text-sm text-[var(--gray-11)] line-clamp-2">
                  {mod.description}
                </p>

                {configStatus(mod)}

                <div className="mt-4 pt-4 border-t border-[var(--gray-a5)] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--gray-11)]">
                      {mod.status === "enabled" ? "Active" : "Inactive"}
                    </span>
                    <Switch
                      checked={mod.status === "enabled"}
                      onChange={() =>
                        handleToggle(mod.id, mod.status === "enabled")
                      }
                      disabled={!isSuperAdmin || togglingId === mod.id}
                      color="cyan"
                    />
                  </div>
                  {mod.status === "enabled" && mod.hasSettings && (
                    <Button
                      onClick={() =>
                        navigate(`/admin/integrations/${mod.id}`)
                      }
                      variant="outline"
                      size="1"
                    >
                      <Cog6ToothIcon className="size-3.5 mr-1" />
                      Settings
                    </Button>
                  )}
                </div>

                {mod.installed_at && (
                  <p className="mt-2 text-xs text-[var(--gray-a9)]">
                    Installed{" "}
                    {new Date(mod.installed_at).toLocaleDateString()}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
