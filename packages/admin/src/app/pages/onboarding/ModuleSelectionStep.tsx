import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui";
import { ModuleService } from "@/utils/moduleService";
import OnboardingWizardLayout from "./OnboardingWizardLayout";

const SECTION_LABELS: Record<string, string> = {
  events: "Event Features",
  feature: "Features",
  integration: "Integrations",
};

const SECTION_ORDER = ["events", "feature", "integration"];

export default function ModuleSelectionStep() {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
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
    setIsSubmitting(true);
    try {
      const enabled = visibleModules.filter((m) => selected.has(m.id)).map((m) => m.id);
      const disabled = visibleModules.filter((m) => !selected.has(m.id)).map((m) => m.id);

      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(`${apiUrl}/api/modules/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, disabled }),
      });

      if (!res.ok) {
        throw new Error("Failed to save module selection");
      }

      navigate("/onboarding/setup", { replace: true });
    } catch {
      toast.error("Failed to save module selection");
    } finally {
      setIsSubmitting(false);
    }
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

  return (
    <OnboardingWizardLayout
      currentStep={2}
      onNext={handleContinue}
      onPrevious={() => navigate("/onboarding", { replace: true })}
      nextLabel={`Continue (${selected.size} selected)`}
      nextDisabled={isSubmitting}
      nextLoading={isSubmitting}
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
                <Card
                  key={mod.id}
                  className={`p-3 cursor-pointer transition-colors ${
                    selected.has(mod.id)
                      ? "ring-2 ring-[var(--accent-9)] bg-[var(--accent-a2)]"
                      : ""
                  }`}
                  onClick={() => toggle(mod.id)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-semibold text-[var(--gray-12)] text-sm">
                        {mod.name}
                      </h4>
                      <p className="mt-0.5 text-xs text-[var(--gray-11)] line-clamp-2">
                        {mod.description}
                      </p>
                    </div>
                    <Switch
                      checked={selected.has(mod.id)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggle(mod.id)}
                      color="primary"
                    />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </OnboardingWizardLayout>
  );
}
