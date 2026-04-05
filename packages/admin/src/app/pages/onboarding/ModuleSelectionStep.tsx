import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { Loader2, CheckCircle2, AlertTriangle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ModuleCard } from "@/components/ui";
import { ModuleService } from "@/utils/moduleService";
import OnboardingWizardLayout from "./OnboardingWizardLayout";

const SECTION_LABELS: Record<string, string> = {
  events: "Event Features",
  feature: "Features",
  integration: "Integrations",
};

const SECTION_ORDER = ["events", "feature", "integration"];

interface ProgressEvent {
  step: string;
  module?: string;
  message: string;
  current: number;
  total: number;
}

interface ModuleStatus {
  module: string;
  name: string;
  status: "ok" | "warning" | "error";
  message?: string;
}

export default function ModuleSelectionStep() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isInstalling, setIsInstalling] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [moduleStatuses, setModuleStatuses] = useState<ModuleStatus[]>([]);
  const [installComplete, setInstallComplete] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [availableModules, setAvailableModules] = useState<{ id: string; name: string; description: string; version: string; type: string; group: string; features: string[]; visibility?: string }[]>([]);
  const [loadingModules, setLoadingModules] = useState(true);

  const loadAvailableModules = useCallback(async () => {
    const { modules: available, error } = await ModuleService.getAvailableModules();
    if (error) {
      console.error("Failed to load available modules:", error);
    }
    setAvailableModules(available ?? []);
    setLoadingModules(false);
  }, []);

  useEffect(() => {
    loadAvailableModules();
  }, [loadAvailableModules]);

  const visibleModules = useMemo(
    () => availableModules.filter((m) => (m.visibility ?? "public") !== "hidden"),
    [availableModules]
  );

  const grouped = useMemo(() => {
    const groups: Record<string, typeof visibleModules> = {};
    for (const mod of visibleModules) {
      const section = mod.group ?? mod.type ?? "feature";
      if (!groups[section]) groups[section] = [];
      groups[section].push(mod);
    }
    return groups;
  }, [visibleModules]);

  const sortedSections = useMemo(() => {
    const sections = Object.keys(grouped);
    return sections.sort((a, b) => {
      const ai = SECTION_ORDER.indexOf(a);
      const bi = SECTION_ORDER.indexOf(b);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  }, [grouped]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleContinue = async () => {
    setIsInstalling(true);
    setProgress(null);
    setModuleStatuses([]);
    setInstallComplete(false);
    setInstallError(null);

    try {
      const enabled = visibleModules.filter((m) => selected.has(m.id)).map((m) => m.id);
      const disabled = visibleModules.filter((m) => !selected.has(m.id)).map((m) => m.id);

      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const response = await fetch(`${apiUrl}/api/modules/select-stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, disabled }),
      });

      if (!response.ok || !response.body) {
        throw new Error("Failed to connect to module installer");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEventType = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");

        for (let i = 0; i < lines.length - 1; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          if (line.startsWith("event:")) {
            currentEventType = line.substring(6).trim();
          } else if (line.startsWith("data:")) {
            try {
              const data = JSON.parse(line.substring(5).trim());

              if (currentEventType === "progress") {
                setProgress(data);
              } else if (currentEventType === "module-complete") {
                setModuleStatuses((prev) => [...prev, data]);
              } else if (currentEventType === "complete") {
                setInstallComplete(true);
                if (data.migrationErrors?.length > 0) {
                  console.warn("Migration warnings:", data.migrationErrors);
                }
              } else if (currentEventType === "error") {
                setInstallError(data.message);
              }
            } catch {
              // malformed JSON line, skip
            }
          }
        }
        buffer = lines[lines.length - 1];
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Installation failed");
      toast.error("Failed to install modules");
    }
  };

  const handleDone = () => {
    navigate("/onboarding/setup", { replace: true });
  };

  if (loadingModules) {
    return (
      <OnboardingWizardLayout currentStep={2} hideFooter>
        <div className="flex h-full items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--gray-a9)]" />
        </div>
      </OnboardingWizardLayout>
    );
  }

  // Installation progress view
  if (isInstalling) {
    const warnings = moduleStatuses.filter((s) => s.status === "warning");
    const errors = moduleStatuses.filter((s) => s.status === "error");
    const successes = moduleStatuses.filter((s) => s.status === "ok");

    return (
      <OnboardingWizardLayout
        currentStep={2}
        hideFooter={!installComplete && !installError}
        onNext={installComplete || installError ? handleDone : undefined}
        nextLabel={installError ? "Continue anyway" : "Continue"}
      >
        <div className="space-y-5">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {installComplete ? "Modules installed" : installError ? "Installation error" : "Installing modules..."}
            </h2>
            <p className="mt-1 text-sm text-[var(--gray-a9)]">
              {installComplete
                ? `${successes.length} modules installed${warnings.length > 0 ? `, ${warnings.length} with warnings` : ""}`
                : installError
                  ? "An error occurred during installation"
                  : progress?.message ?? "Preparing..."}
            </p>
          </div>

          {/* Progress bar */}
          {!installComplete && !installError && progress && progress.total > 0 && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-[var(--gray-a9)]">
                <span>{progress.step === "deploy" ? "Deploying functions" : "Applying migrations"}</span>
                <span>{progress.current} / {progress.total}</span>
              </div>
              <div className="h-2 rounded-full bg-[var(--gray-a3)] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[var(--accent-9)] transition-all duration-300"
                  style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Spinner when no measurable progress */}
          {!installComplete && !installError && (!progress || progress.total === 0) && (
            <div className="flex items-center gap-2 text-sm text-[var(--gray-a9)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{progress?.message ?? "Preparing..."}</span>
            </div>
          )}

          {/* Error message */}
          {installError && (
            <Card className="p-3 border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950">
              <div className="flex items-start gap-2">
                <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
                <p className="text-sm text-red-800 dark:text-red-200">{installError}</p>
              </div>
            </Card>
          )}

          {/* Module status list */}
          {moduleStatuses.length > 0 && (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {moduleStatuses.map((s, i) => (
                <div key={i} className="flex items-start gap-2 py-1 text-sm">
                  {s.status === "ok" && <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 shrink-0" />}
                  {s.status === "warning" && <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />}
                  {s.status === "error" && <XCircle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />}
                  <div className="min-w-0">
                    <span className="font-medium text-[var(--gray-12)]">{s.name}</span>
                    {s.message && (
                      <p className="text-xs text-[var(--gray-a9)] truncate">{s.message}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </OnboardingWizardLayout>
    );
  }

  // Module selection view
  return (
    <OnboardingWizardLayout
      currentStep={2}
      onNext={handleContinue}
      onPrevious={() => navigate("/onboarding", { replace: true })}
      nextLabel={`Continue (${selected.size} selected)`}
      nextDisabled={isInstalling}
      nextLoading={isInstalling}
    >
      <div className="space-y-5">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Choose your modules
          </h2>
          <p className="mt-1 text-sm text-[var(--gray-a9)]">
            Select the features and integrations you need. You can change
            these anytime in Settings &rarr; Modules.
          </p>
        </div>

        {sortedSections.map((section) => (
          <div key={section}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[var(--gray-a9)]">
              {SECTION_LABELS[section] ?? section}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {grouped[section].map((mod) => (
                <ModuleCard
                  key={mod.id}
                  id={mod.id}
                  name={mod.name}
                  description={mod.description}
                  enabled={selected.has(mod.id)}
                  onToggle={() => toggle(mod.id)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </OnboardingWizardLayout>
  );
}
