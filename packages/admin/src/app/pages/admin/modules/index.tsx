import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  PuzzlePieceIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  PlusIcon,
  TrashIcon,
  ArrowUpTrayIcon,
  ArrowPathIcon,
  FolderIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";

import { Card, Badge, Switch, Modal } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form/Input";
import { Page } from "@/components/shared/Page";
import { useAuthContext } from "@/app/contexts/auth/context";
import { useModulesContext } from "@/app/contexts/modules/context";
import { ModuleService } from "@/utils/moduleService";
import type { InstalledModuleRow, ModuleSourceRow } from "@gatewaze/shared/modules";
import modules from "virtual:gatewaze-modules";

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
  status: "enabled" | "disabled" | "error" | "not_installed";
  installed_at?: string;
  updateAvailable: boolean;
  platformCompatible: boolean;
  minPlatformVersion?: string;
}

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
  const [isUploading, setIsUploading] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [isUpdatingAll, setIsUpdatingAll] = useState(false);
  const [availableUpdates, setAvailableUpdates] = useState<ModuleUpdateInfo[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadInstalledModules = useCallback(async () => {
    const { modules: installed, error } =
      await ModuleService.getInstalledModules();
    if (error) {
      toast.error("Failed to load module status");
    }
    setInstalledModules(installed ?? []);
    setLoading(false);
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
    loadInstalledModules();
    loadModuleSources();
    checkForUpdates();
  }, [loadInstalledModules, loadModuleSources, checkForUpdates]);

  // Merge config modules with DB status
  const moduleCards: ModuleCardData[] = useMemo(() => {
    const updateMap = new Map(availableUpdates.map((u) => [u.id, u]));

    const cards: ModuleCardData[] = modules.map((mod) => {
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
        source: "bundled",
        status: installed?.status ?? "not_installed",
        installed_at: installed?.installed_at,
        updateAvailable: !!update,
        platformCompatible: update?.platformCompatible ?? true,
        minPlatformVersion: update?.minPlatformVersion,
      };
    });

    // Also show custom/orphaned modules from DB not in bundled config
    for (const installed of installedModules) {
      if (!modules.find((m) => m.id === installed.id)) {
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
          status: installed.status,
          installed_at: installed.installed_at,
          updateAvailable: false,
          platformCompatible: true,
        });
      }
    }

    return cards;
  }, [installedModules, availableUpdates]);

  // Group by group field
  const grouped = useMemo(() => {
    const groups: Record<string, ModuleCardData[]> = {};
    for (const mod of moduleCards) {
      const section = mod.group;
      if (!groups[section]) groups[section] = [];
      groups[section].push(mod);
    }
    return groups;
  }, [moduleCards]);

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
      await ModuleService.reconcileModules();
      await Promise.all([
        loadInstalledModules(),
        loadModuleSources(),
        refreshModulesContext(),
      ]);
    } else {
      toast.error(result.error ?? "Upload failed");
    }
    setIsUploading(false);
  };

  const statusBadge = (status: ModuleCardData["status"]) => {
    switch (status) {
      case "enabled":
        return <Badge color="green">Enabled</Badge>;
      case "disabled":
        return <Badge color="gray">Disabled</Badge>;
      case "error":
        return <Badge color="red">Error</Badge>;
      case "not_installed":
        return <Badge color="orange">Not Installed</Badge>;
    }
  };

  const statusIcon = (status: ModuleCardData["status"]) => {
    switch (status) {
      case "enabled":
        return <CheckCircleIcon className="size-5 text-green-500" />;
      case "disabled":
        return <XCircleIcon className="size-5 text-gray-400" />;
      case "error":
        return <ExclamationTriangleIcon className="size-5 text-red-500" />;
      case "not_installed":
        return <ExclamationTriangleIcon className="size-5 text-orange-400" />;
    }
  };

  const renderModuleCard = (mod: ModuleCardData) => (
    <Card key={mod.id} className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {statusIcon(mod.status)}
          <div className="min-w-0">
            <h3 className="font-semibold text-[var(--gray-12)] truncate">
              {mod.name}
            </h3>
            <div className="flex items-center gap-2">
              <p className="text-xs text-[var(--gray-a9)]">v{mod.installedVersion}</p>
              {mod.source !== "bundled" && (
                <Badge color="blue">Custom</Badge>
              )}
            </div>
          </div>
        </div>
        {statusBadge(mod.status)}
      </div>

      <p className="mt-3 text-sm text-[var(--gray-11)] line-clamp-2">
        {mod.description}
      </p>

      {mod.updateAvailable && (
        <div className={`mt-3 flex items-center justify-between gap-3 rounded-md px-3 py-2 ${
          mod.platformCompatible
            ? "bg-blue-500/10 border border-blue-500/20"
            : "bg-amber-500/10 border border-amber-500/20"
        }`}>
          <div>
            <p className={`text-xs font-medium ${mod.platformCompatible ? "text-blue-400" : "text-amber-400"}`}>
              {mod.platformCompatible ? "Update available" : "Update blocked"}
            </p>
            <p className="text-xs text-[var(--gray-a9)]">
              v{mod.installedVersion} → v{mod.version}
            </p>
            {!mod.platformCompatible && mod.minPlatformVersion && (
              <p className="text-xs text-amber-400/80 mt-0.5">
                Requires platform v{mod.minPlatformVersion}
              </p>
            )}
          </div>
          <Button
            onClick={() => handleUpdate(mod.id)}
            size="1"
            disabled={updatingId === mod.id || !mod.platformCompatible}
            title={!mod.platformCompatible ? `Requires platform v${mod.minPlatformVersion}` : undefined}
          >
            <ArrowPathIcon className={`size-3.5 mr-1 ${updatingId === mod.id ? "animate-spin" : ""}`} />
            {updatingId === mod.id ? "Updating..." : "Update"}
          </Button>
        </div>
      )}

      {mod.features.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mod.features.map((feature) => (
            <span
              key={feature}
              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-[var(--gray-a3)] text-[var(--gray-11)]"
            >
              {feature}
            </span>
          ))}
        </div>
      )}

      {(mod.status === "enabled" || mod.status === "disabled") && (
        <div className="mt-4 pt-4 border-t border-[var(--gray-a5)] flex items-center justify-between">
          <span className="text-sm text-[var(--gray-11)]">
            {mod.status === "enabled" ? "Active" : "Inactive"}
          </span>
          <Switch
            checked={mod.status === "enabled"}
            onChange={() =>
              handleToggle(mod.id, mod.status === "enabled")
            }
            disabled={!isSuperAdmin || togglingId === mod.id}
            color="primary"
          />
        </div>
      )}

      {mod.installed_at && (
        <p className="mt-2 text-xs text-[var(--gray-a9)]">
          Installed {new Date(mod.installed_at).toLocaleDateString()}
        </p>
      )}
    </Card>
  );

  return (
    <Page title="Modules">
      <div className="p-6">
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
              Modules
            </h1>
            <p className="text-[var(--gray-11)] mt-1">
              Manage installed modules and their features. Modules extend
              Gatewaze with additional functionality.
            </p>
          </div>
          {isSuperAdmin && (
            <div className="flex gap-2">
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

        {/* Module Sources */}
        {isSuperAdmin && (
          <section className="mb-8">
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
                No module sources configured. Add a git repository or local path.
              </p>
            ) : (
              <div className="space-y-2">
                {moduleSources.map((source) => (
                  <Card key={source.id} className="px-4 py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <FolderIcon className="size-5 text-[var(--gray-a9)] shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-[var(--gray-12)] truncate">
                            {source.label || source.url}
                          </p>
                          <Badge
                            color={
                              source.origin === "config"
                                ? "gray"
                                : source.origin === "upload"
                                ? "blue"
                                : "green"
                            }
                          >
                            {source.origin}
                          </Badge>
                        </div>
                        <p className="text-xs text-[var(--gray-a9)] truncate">
                          {source.url}
                          {source.path ? ` / ${source.path}` : ""}
                          {source.branch ? ` (${source.branch})` : ""}
                        </p>
                      </div>
                    </div>
                    {source.origin !== "config" && (
                      <button
                        onClick={() => handleRemoveSource(source.id)}
                        disabled={removingSourceId === source.id}
                        className="p-1.5 rounded hover:bg-[var(--gray-a3)] text-[var(--gray-a9)] hover:text-red-500 transition-colors shrink-0"
                        title="Remove source"
                      >
                        <TrashIcon className="size-4" />
                      </button>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </section>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="size-6 border-2 border-[var(--accent-9)] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : moduleCards.length === 0 ? (
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

        {showAddSourceModal && (
          <AddSourceModal
            onClose={() => setShowAddSourceModal(false)}
            onAdded={async () => {
              setShowAddSourceModal(false);
              await loadModuleSources();
              toast.info("Reconciling modules...");
              await ModuleService.reconcileModules();
              await Promise.all([loadInstalledModules(), refreshModulesContext()]);
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
      <div className="space-y-3">
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
      <div className="space-y-3">
        <Input
          label="Repository URL or Path"
          value={url}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setUrl(e.target.value)
          }
          placeholder="https://github.com/org/modules.git or ../local-modules"
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
      </div>
    </Modal>
  );
}
