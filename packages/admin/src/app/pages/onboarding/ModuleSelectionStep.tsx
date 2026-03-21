import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router";
import { ArrowRight, Loader2, Puzzle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Switch } from "@/components/ui";
import GradientBackground from "@/components/shared/GradientBackground";
import { ModuleService } from "@/utils/moduleService";

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

  // Only show public modules
  const visibleModules = useMemo(
    () => availableModules.filter((m) => (m.visibility ?? "public") !== "hidden"),
    [availableModules]
  );

  // Group by group field first, then fall back to type
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

      // Use API (service_role) to bypass RLS during onboarding
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
      <>
        <GradientBackground />
        <div className="flex min-h-[100svh] items-center justify-center p-4">
          <Loader2 className="h-8 w-8 animate-spin text-[var(--gray-a9)]" />
        </div>
      </>
    );
  }

  return (
    <>
      <GradientBackground />
      <div className="flex min-h-[100svh] items-center justify-center p-4">
        <div className="w-full max-w-3xl space-y-6">
          <div className="text-center">
            <Puzzle className="mx-auto h-10 w-10 text-[var(--accent-9)]" />
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              Choose your modules
            </h1>
            <p className="mt-1 text-sm text-[var(--gray-a9)]">
              Select the features and integrations you need. You can change
              these anytime in Settings &rarr; Modules.
            </p>
          </div>

          {sortedSections.map((section) => (
            <div key={section}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-[var(--gray-a9)]">
                {SECTION_LABELS[section] ?? section}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {grouped[section].map((mod) => (
                  <Card
                    key={mod.id}
                    className={`p-4 cursor-pointer transition-colors ${
                      selected.has(mod.id)
                        ? "ring-2 ring-[var(--accent-9)] bg-[var(--accent-a2)]"
                        : ""
                    }`}
                    onClick={() => toggle(mod.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-[var(--gray-12)] text-sm">
                          {mod.name}
                        </h3>
                        <p className="mt-1 text-xs text-[var(--gray-11)] line-clamp-2">
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

          <div className="space-y-2 pt-2">
            <p className="text-sm text-[var(--gray-a9)]">
              {selected.size} module{selected.size !== 1 ? "s" : ""} selected
            </p>
            <Button onClick={handleContinue} disabled={isSubmitting} size="3" className="w-full">
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>

          <div className="flex justify-center">
            <img
              src="/theme/gatewaze/gatewaze-poweredby-white.svg"
              alt="Powered by Gatewaze"
              className="h-6 opacity-50"
            />
          </div>
        </div>
      </div>
    </>
  );
}
