import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  PuzzlePieceIcon,
  PlusIcon,
  TrashIcon,
  ArrowUpTrayIcon,
  ArrowPathIcon,
  FolderIcon,
  PencilSquareIcon,
  CheckIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

import { Badge, Card, Modal, ModuleInfoModal, ModuleCard } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form/Input";
import { Page } from "@/components/shared/Page";
import { useAuthContext } from "@/app/contexts/auth/context";
import { useModulesContext } from "@/app/contexts/modules/context";
import { ModuleService } from "@/utils/moduleService";
import type { InstalledModuleRow, ModuleSourceRow } from "@gatewaze/shared/modules";

const SECTION_LABELS: Record<string, string> = {
  events: "Event Features",
  feature: "Features",
  integration: "Integrations",
};

const SECTION_ORDER = ["events", "feature", "integration"];

interface ModuleUpdateInfo {
  id: string;
  name: string;
  installedVersion: string;
  availableVersion: string;
  minPlatformVersion?: string;
  platformCompatible: boolean;
}

interface ModuleCardData {
  id: string;
  name: string;
  description: string;
  version: string;
  installedVersion: string;
  features: string[];
  type: string;
  group: string;
  source: string;
  sourceLabel: string;
  status: "enabled" | "disabled" | "error" | "not_installed";
  installed_at?: string;
  updateAvailable: boolean;
  platformCompatible: boolean;
  minPlatformVersion?: string;
  guide?: string;
}

const ALL_SOURCES_TAB = "__all__";

export default function ModulesPage() {
  const { user } = useAuthContext();
  const isSuperAdmin = user?.role === "super_admin";
  const { refresh: refreshModulesContext } = useModulesContext();

  const [installedModules, setInstalledModules] = useState<
    InstalledModuleRow[]
  >([]);
  const [moduleSources, setModuleSources] = useState<ModuleSourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [showInstallModal, setShowInstallModal] = useState(false);
  const [showAddSourceModal, setShowAddSourceModal] = useState(false);
  const [removingSourceId, setRemovingSourceId] = useState<string | null>(null);
  const [editingLabelId, setEditingLabelId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState("");
  const [savingLabelId, setSavingLabelId] = useState<string | null>(null);
  const [refreshingSources, setRefreshingSources] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);
  const [availableUpdates, setAvailableUpdates] = useState<ModuleUpdateInfo[]>([]);
  const [availableModules, setAvailableModules] = useState<{ id: string; name: string; description: string; version: string; type: string; group: string; features: string[]; sourceLabel?: string }[]>([]);
  const [activeSourceTab, setActiveSourceTab] = useState<string>(ALL_SOURCES_TAB);
  const [infoModule, setInfoModule] = useState<ModuleCardData | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadAvailableModules = useCallback(async () => {
    const { modules: available, error } = await ModuleService.getAvailableModules();
    if (error) {
      console.error("Failed to load available modules:", error);
      toast.error("Failed to load available modules");
      return;
    }
    setAvailableModules(available ?? []);
  }, []);

  const loadInstalledModules = useCallback(async () => {
    const { modules: installed, error } =
      await ModuleService.getInstalledModules();
    if (error) {
      toast.error("Failed to load module status");
    }
    setInstalledModules(installed ?? []);
  }, []);

  const loadModuleSources = useCallback(async () => {
    const { sources, error } = await ModuleService.getModuleSources();
    if (error) {
      console.error("Failed to load module sources:", error);
    }
    setModuleSources(sources ?? []);
  }, []);

  const checkForUpdates = useCallback(async () => {
    const { updates } = await ModuleService.checkUpdates();
    setAvailableUpdates(updates);
  }, []);

  useEffect(() => {
    // Refresh the global modules context on page-mount. Without this,
    // the top-of-app ModuleUpdateBanner can show stale data after a
    // module is applied elsewhere — the context's availableUpdates only
    // refreshes when something explicitly calls refresh().
    refreshModulesContext();
    Promise.all([
      loadAvailableModules(),
      loadInstalledModules(),
      loadModuleSources(),
      checkForUpdates(),
    ]).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadAvailableModules, loadInstalledModules, loadModuleSources, checkForUpdates]);

  // Merge config modules with DB status — excludes integration-type modules
  // (those are managed in the Integrations page instead)
  const moduleCards: ModuleCardData[] = useMemo(() => {
    const updateMap = new Map(availableUpdates.map((u) => [u.id, u]));
    const availableSet = new Set(availableModules.map((m) => m.id));

    const cards: ModuleCardData[] = availableModules
      .filter((mod) => (mod.type ?? "feature") !== "integration")
      .map((mod) => {
      const installed = installedModules.find((m) => m.id === mod.id);
      const update = updateMap.get(mod.id);
      const installedVersion = installed?.version ?? mod.version;
      return {
        id: mod.id,
        name: mod.name,
        description: mod.description,
        version: mod.version,
        installedVersion,
        features: mod.features,
        type: mod.type ?? "feature",
        group: mod.group ?? mod.type ?? "feature",
        source: "source",
        sourceLabel: mod.sourceLabel ?? "Modules",
        status: installed?.status ?? "not_installed",
        installed_at: installed?.installed_at,
        updateAvailable: !!update,
        platformCompatible: update?.platformCompatible ?? true,
        minPlatformVersion: update?.minPlatformVersion,
        guide: mod.guide,
      };
    });

    // Also show installed modules not found in current sources
    // (e.g. from a source that was removed but module still installed)
    for (const installed of installedModules) {
      if (!availableSet.has(installed.id)) {
        if ((installed.type ?? "feature") === "integration") continue;
        cards.push({
          id: installed.id,
          name: installed.name,
          description: installed.description ?? "Custom module",
          version: installed.version,
          installedVersion: installed.version,
          features: installed.features,
          type: installed.type ?? "feature",
          group: installed.type ?? "feature",
          source: installed.source ?? "custom",
          sourceLabel: "Custom",
          status: installed.status,
          installed_at: installed.installed_at,
          updateAvailable: false,
          platformCompatible: true,
        });
      }
    }

    return cards;
  }, [availableModules, installedModules, availableUpdates]);

  // Unique source labels for tabs
  const sourceTabs = useMemo(() => {
    const labels = new Set<string>();
    for (const mod of moduleCards) {
      labels.add(mod.sourceLabel);
    }
    return Array.from(labels).sort();
  }, [moduleCards]);

  // Filter cards by active source tab
  const filteredCards = useMemo(() => {
    if (activeSourceTab === ALL_SOURCES_TAB) return moduleCards;
    return moduleCards.filter((mod) => mod.sourceLabel === activeSourceTab);
  }, [moduleCards, activeSourceTab]);

  // Group by group field
  const grouped = useMemo(() => {
    const groups: Record<string, ModuleCardData[]> = {};
    for (const mod of filteredCards) {
      const section = mod.group;
      if (!groups[section]) groups[section] = [];
      groups[section].push(mod);
    }
    return groups;
  }, [filteredCards]);

  const sortedSections = useMemo(() => {
    const sections = Object.keys(grouped);
    return sections.sort((a, b) => {
      const ai = SECTION_ORDER.indexOf(a);
      const bi = SECTION_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [grouped]);

  const handleToggle = async (moduleId: string, currentlyEnabled: boolean) => {
    if (!isSuperAdmin) {
      toast.error("Only super admins can manage modules");
      return;
    }

    setTogglingId(moduleId);

    const result = currentlyEnabled
      ? await ModuleService.disableModule(moduleId)
      : await ModuleService.enableModule(moduleId);

    if (result.success) {
      toast.success(
        currentlyEnabled ? "Module disabled" : "Module enabled"
      );
      await Promise.all([loadInstalledModules(), refreshModulesContext()]);
    } else {
      toast.error(result.error ?? "Failed to update module");
    }

    setTogglingId(null);
  };

  const handleUpdate = async (moduleId: string) => {
    setUpdatingId(moduleId);
    const result = await ModuleService.updateModule(moduleId);
    if (result.success) {
      toast.success(`Updated to v${result.newVersion}`);
      if (result.edgeFunctionsDeployed?.length) {
        toast.info(`Deployed ${result.edgeFunctionsDeployed.length} edge function(s)`);
      }
      await Promise.all([loadInstalledModules(), checkForUpdates(), refreshModulesContext()]);
    } else {
      toast.error(result.error ?? "Update failed");
    }
    setUpdatingId(null);
  };

  const handleUpdateAll = async () => {
    setIsUpdatingAll(true);
    const result = await ModuleService.updateAllModules();
    if (result.success) {
      const count = result.updated?.length ?? 0;
      toast.success(`Updated ${count} module(s)`);
      if (result.edgeFunctionsDeployed?.length) {
        toast.info(`Deployed ${result.edgeFunctionsDeployed.length} edge function(s)`);
      }
      await Promise.all([loadInstalledModules(), checkForUpdates(), refreshModulesContext()]);
    } else {
      toast.error(result.error ?? "Update failed");
    }
    setIsUpdatingAll(false);
  };

  const handleRefreshSources = async () => {
    setRefreshingSources(true);
    const result = await ModuleService.refreshSources();
    if (result.success) {
      const parts: string[] = [];
      if (typeof result.sourcesRefreshed === "number") parts.push(`${result.sourcesRefreshed} source(s)`);
      if (typeof result.updatesAvailable === "number") parts.push(`${result.updatesAvailable} update(s)`);
      toast.success(`Sources refreshed${parts.length ? ` — ${parts.join(", ")}` : ""}`);
      if (result.errors?.length) {
        for (const e of result.errors) {
          toast.error(`${e.code}: ${e.url}`);
        }
      }
      await Promise.all([loadAvailableModules(), loadInstalledModules(), loadModuleSources(), checkForUpdates()]);
    } else {
      toast.error(result.error ?? "Refresh failed");
    }
    setRefreshingSources(false);
  };

  const beginEditLabel = (source: ModuleSourceRow) => {
    setEditingLabelId(source.id);
    setLabelDraft(source.label ?? "");
  };

  const cancelEditLabel = () => {
    setEditingLabelId(null);
    setLabelDraft("");
  };

  const saveLabel = async (sourceId: string) => {
    setSavingLabelId(sourceId);
    const result = await ModuleService.updateModuleSource(sourceId, {
      label: labelDraft.trim() || null,
    });
    if (result.success) {
      toast.success("Label updated");
      await Promise.all([loadModuleSources(), loadAvailableModules()]);
      setEditingLabelId(null);
      setLabelDraft("");
    } else {
      toast.error(result.error ?? "Failed to update label");
    }
    setSavingLabelId(null);
  };

  const handleRemoveSource = async (sourceId: string) => {
    setRemovingSourceId(sourceId);
    const result = await ModuleService.removeModuleSource(sourceId);
    if (result.success) {
      toast.success("Source removed");
      await loadModuleSources();
    } else {
      toast.error(result.error ?? "Failed to remove source");
    }
    setRemovingSourceId(null);
  };

  const handleUploadModule = async (file: File) => {
    setIsUploading(true);
    const result = await ModuleService.uploadModule(file);
    if (result.success) {
      toast.success(`Module "${result.slug}" uploaded`);
      toast.info("Reconciling modules...");
      const reconcileResult = await ModuleService.reconcileModules();
      if (!reconcileResult.success) {
        toast.error(reconcileResult.error ?? "Reconciliation failed");
      }
      await Promise.all([
        loadAvailableModules(),
        loadInstalledModules(),
        loadModuleSources(),
        checkForUpdates(),
        refreshModulesContext(),
      ]);
    } else {
      toast.error(result.error ?? "Upload failed");
    }
    setIsUploading(false);
  };

  const renderModuleCard = (mod: ModuleCardData) => {
    const isEnabled = mod.status === "enabled";
    const isInstalled = mod.status !== "not_installed";

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
        update={mod.updateAvailable ? {
          fromVersion: mod.installedVersion,
          toVersion: mod.version,
          compatible: mod.platformCompatible,
          minPlatformVersion: mod.minPlatformVersion,
          updating: updatingId === mod.id,
          onUpdate: () => handleUpdate(mod.id),
        } : undefined}
      />
    );
  };

  if (loading) {
    return (
      <Page title="Modules">
        <div className="flex justify-center py-24">
          <div className="size-6 border-2 border-[var(--accent-9)] border-t-transparent rounded-full animate-spin" />
        </div>
      </Page>
    );
  }

  return (
    <Page title="Modules">
      <div className="p-6">
        <div className="mb-6">
          <div className="flex items-start justify-between gap-4">
            <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
              Modules
            </h1>
            {isSuperAdmin && (
              <div className="flex gap-2 flex-shrink-0">
              <Button
                onClick={handleRefreshSources}
                variant="outline"
                size="2"
                disabled={refreshingSources}
                title="Pull latest from all git sources and detect available updates"
              >
                <ArrowPathIcon className={`size-4 mr-1.5 ${refreshingSources ? "animate-spin" : ""}`} />
                {refreshingSources ? "Refreshing..." : "Refresh Sources"}
              </Button>
              {availableUpdates.length > 0 && (() => {
                const compatibleCount = availableUpdates.filter((u) => u.platformCompatible).length;
                return compatibleCount > 0 ? (
                  <Button
                    onClick={handleUpdateAll}
                    variant="outline"
                    size="2"
                    disabled={isUpdatingAll}
                  >
                    <ArrowPathIcon className={`size-4 mr-1.5 ${isUpdatingAll ? "animate-spin" : ""}`} />
                    {isUpdatingAll
                      ? "Updating..."
                      : `Update All (${compatibleCount})`}
                  </Button>
                ) : null;
              })()}
              <Button
                onClick={() => fileInputRef.current?.click()}
                variant="outline"
                size="2"
                disabled={isUploading}
              >
                <ArrowUpTrayIcon className="size-4 mr-1.5" />
                {isUploading ? "Uploading..." : "Upload Module"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    handleUploadModule(file);
                    e.target.value = "";
                  }
                }}
              />
              <Button
                onClick={() => setShowInstallModal(true)}
                size="2"
              >
                <PlusIcon className="size-4 mr-1.5" />
                Install Custom Module
              </Button>
              </div>
            )}
          </div>
          <p className="text-[var(--gray-11)] mt-2">
            Manage installed modules and their features. Modules extend
            Gatewaze with additional functionality.
          </p>
        </div>

        {/* Module Sources */}
        {isSuperAdmin && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-[var(--gray-12)]">
                Module Sources
              </h2>
              <Button
                onClick={() => setShowAddSourceModal(true)}
                variant="outline"
                size="1"
              >
                <PlusIcon className="size-3.5 mr-1" />
                Add Source
              </Button>
            </div>
            {moduleSources.length === 0 ? (
              <p className="text-sm text-[var(--gray-a9)]">
                No module sources configured. Add a git repository to get started.
              </p>
            ) : (
              <div className="space-y-2">
                {moduleSources.map((source) => {
                  const isEditing = editingLabelId === source.id;
                  const isSaving = savingLabelId === source.id;
                  return (
                    <div key={source.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-[var(--gray-a5)] bg-[var(--color-surface)]">
                      <FolderIcon className="size-4 text-[var(--gray-a9)] shrink-0" />
                      {isEditing ? (
                        <>
                          <Input
                            value={labelDraft}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setLabelDraft(e.target.value)}
                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                              if (e.key === "Enter") saveLabel(source.id);
                              else if (e.key === "Escape") cancelEditLabel();
                            }}
                            placeholder="Label (e.g. Premium)"
                            autoFocus
                            className="flex-1 min-w-0"
                          />
                          <span className="text-xs text-[var(--gray-a9)] truncate max-w-[30%]">
                            {source.url}{source.path ? ` / ${source.path}` : ""}
                          </span>
                          <button
                            onClick={() => saveLabel(source.id)}
                            disabled={isSaving}
                            className="p-1 rounded hover:bg-green-500/10 text-[var(--gray-a8)] hover:text-green-600 transition-colors shrink-0"
                            title="Save"
                          >
                            <CheckIcon className="size-3.5" />
                          </button>
                          <button
                            onClick={cancelEditLabel}
                            className="p-1 rounded hover:bg-[var(--gray-a4)] text-[var(--gray-a8)] transition-colors shrink-0"
                            title="Cancel"
                          >
                            <XMarkIcon className="size-3.5" />
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="text-sm text-[var(--gray-12)] truncate min-w-0 flex-1">
                            {source.label ? (
                              <>
                                <span className="font-medium">{source.label}</span>
                                <span className="text-[var(--gray-a9)]"> — {source.url}</span>
                              </>
                            ) : (
                              source.url
                            )}
                            {source.path ? <span className="text-[var(--gray-a9)]"> / {source.path}</span> : ""}
                            {source.branch ? <span className="text-[var(--gray-a9)]"> ({source.branch})</span> : ""}
                          </span>
                          <Badge
                            color={
                              source.origin === "config" ? "gray"
                              : source.origin === "env" ? "orange"
                              : source.origin === "upload" ? "blue"
                              : "green"
                            }
                          >
                            {source.origin}
                          </Badge>
                          <button
                            onClick={() => beginEditLabel(source)}
                            className="p-1 rounded hover:bg-[var(--accent-a4)] text-[var(--gray-a8)] hover:text-[var(--accent-11)] transition-colors shrink-0"
                            title="Edit label"
                          >
                            <PencilSquareIcon className="size-3.5" />
                          </button>
                          <button
                            onClick={() => handleRemoveSource(source.id)}
                            disabled={removingSourceId === source.id}
                            className="p-1 rounded hover:bg-red-500/10 text-[var(--gray-a8)] hover:text-red-500 transition-colors shrink-0"
                            title="Remove source"
                          >
                            <TrashIcon className="size-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {/* Source Tabs — only shown when modules come from multiple sources */}
        {sourceTabs.length > 1 && (
          <div className="mb-6 flex gap-1 border-b border-[var(--gray-a5)]">
            <button
              onClick={() => setActiveSourceTab(ALL_SOURCES_TAB)}
              className={`px-4 py-2 text-sm font-medium transition-colors -mb-px ${
                activeSourceTab === ALL_SOURCES_TAB
                  ? "border-b-2 border-[var(--accent-9)] text-[var(--accent-11)]"
                  : "text-[var(--gray-a9)] hover:text-[var(--gray-12)]"
              }`}
            >
              All
            </button>
            {sourceTabs.map((label) => (
              <button
                key={label}
                onClick={() => setActiveSourceTab(label)}
                className={`px-4 py-2 text-sm font-medium transition-colors -mb-px ${
                  activeSourceTab === label
                    ? "border-b-2 border-[var(--accent-9)] text-[var(--accent-11)]"
                    : "text-[var(--gray-a9)] hover:text-[var(--gray-12)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {moduleCards.length === 0 ? (
          <div className="text-center py-16">
            <PuzzlePieceIcon className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-medium text-[var(--gray-12)]">
              No modules available
            </h3>
            <p className="mt-2 text-[var(--gray-11)] max-w-md mx-auto">
              No modules are configured. Add a module source above,
              upload a module zip, or install a custom module.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {sortedSections.map((section) => (
              <section key={section}>
                <h2 className="text-lg font-semibold text-[var(--gray-12)] mb-4">
                  {SECTION_LABELS[section] ?? section}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {grouped[section].map(renderModuleCard)}
                </div>
              </section>
            ))}
          </div>
        )}

        {showInstallModal && (
          <InstallCustomModuleModal
            onClose={() => setShowInstallModal(false)}
            onInstalled={async () => {
              setShowInstallModal(false);
              await Promise.all([loadInstalledModules(), refreshModulesContext()]);
            }}
          />
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
              // Update local state so the modal reflects the change
              setInfoModule((prev) =>
                prev ? { ...prev, status: isEnabled ? "disabled" : "enabled" } : null
              );
            }}
          />
        )}

        {showAddSourceModal && (
          <AddSourceModal
            onClose={() => setShowAddSourceModal(false)}
            onAdded={async () => {
              setShowAddSourceModal(false);
              await loadModuleSources();
              toast.info("Reconciling modules...");
              const result = await ModuleService.reconcileModules();
              if (!result.success) {
                toast.error(result.error ?? "Reconciliation failed");
              }
              await Promise.all([
                loadAvailableModules(),
                loadInstalledModules(),
                checkForUpdates(),
                refreshModulesContext(),
              ]);
            }}
          />
        )}
      </div>
    </Page>
  );
}

function InstallCustomModuleModal({
  onClose,
  onInstalled,
}: {
  onClose: () => void;
  onInstalled: () => void;
}) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [type, setType] = useState<string>("integration");
  const [source, setSource] = useState("");
  const [features, setFeatures] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleInstall = async () => {
    if (!id.trim() || !name.trim()) {
      toast.error("Module ID and name are required");
      return;
    }

    setIsSubmitting(true);
    const result = await ModuleService.installCustomModule({
      id: id.trim(),
      name: name.trim(),
      description: description.trim(),
      version: version.trim() || "1.0.0",
      type,
      visibility: "public",
      features: features
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
      source: source.trim() || "custom",
    });

    if (result.success) {
      toast.success(`Module "${name}" installed`);
      onInstalled();
    } else {
      toast.error(result.error ?? "Failed to install module");
    }
    setIsSubmitting(false);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Install Custom Module"
      footer={
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="outline" size="2">
            Cancel
          </Button>
          <Button
            onClick={handleInstall}
            disabled={isSubmitting || !id.trim() || !name.trim()}
            size="2"
          >
            {isSubmitting ? "Installing..." : "Install Module"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input
          label="Module ID"
          value={id}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setId(e.target.value)}
          placeholder="my-custom-module"
          required
        />
        <Input
          label="Name"
          value={name}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
          placeholder="My Custom Module"
          required
        />
        <Input
          label="Description"
          value={description}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setDescription(e.target.value)
          }
          placeholder="What this module does..."
        />
        <Input
          label="Version"
          value={version}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setVersion(e.target.value)}
          placeholder="1.0.0"
        />
        <div>
          <label className="block text-sm font-medium text-[var(--gray-12)] mb-1">
            Type
          </label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="w-full rounded-md border border-[var(--gray-a6)] bg-[var(--gray-a2)] px-3 py-2 text-sm text-[var(--gray-12)]"
          >
            <option value="feature">Feature</option>
            <option value="integration">Integration</option>
          </select>
        </div>
        <Input
          label="Source URL / Package"
          value={source}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSource(e.target.value)}
          placeholder="https://github.com/org/module or npm package name"
        />
        <Input
          label="Features (comma-separated)"
          value={features}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setFeatures(e.target.value)
          }
          placeholder="feature.one, feature.two"
        />
      </div>
    </Modal>
  );
}

function AddSourceModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [url, setUrl] = useState("");
  const [path, setPath] = useState("");
  const [branch, setBranch] = useState("");
  const [label, setLabel] = useState("");
  const [token, setToken] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleAdd = async () => {
    if (!url.trim()) {
      toast.error("URL is required");
      return;
    }

    setIsSubmitting(true);
    const result = await ModuleService.addModuleSource({
      url: url.trim(),
      path: path.trim() || undefined,
      branch: branch.trim() || undefined,
      label: label.trim() || undefined,
      token: token.trim() || undefined,
    });

    if (result.success) {
      toast.success("Module source added");
      onAdded();
    } else {
      toast.error(result.error ?? "Failed to add source");
    }
    setIsSubmitting(false);
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Add Module Source"
      footer={
        <div className="flex justify-end gap-3">
          <Button onClick={onClose} variant="outline" size="2">
            Cancel
          </Button>
          <Button
            onClick={handleAdd}
            disabled={isSubmitting || !url.trim()}
            size="2"
          >
            {isSubmitting ? "Adding..." : "Add Source"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input
          label="Git Repository URL"
          value={url}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setUrl(e.target.value)
          }
          placeholder="https://github.com/org/modules.git"
          required
        />
        <Input
          label="Subdirectory (optional)"
          value={path}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setPath(e.target.value)
          }
          placeholder="modules"
        />
        <Input
          label="Branch (optional)"
          value={branch}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setBranch(e.target.value)
          }
          placeholder="main"
        />
        <Input
          label="Label (optional)"
          value={label}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setLabel(e.target.value)
          }
          placeholder="My Custom Modules"
        />
        <Input
          label="Access Token (optional, for private repos)"
          value={token}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setToken(e.target.value)
          }
          placeholder="ghp_xxxxxxxxxxxx"
          type="password"
        />
      </div>
    </Modal>
  );
}
