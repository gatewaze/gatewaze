import { useState, useEffect, useCallback } from "react";
import {
  SparklesIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ArrowLeftIcon,
} from "@heroicons/react/24/outline";
import { toast } from "sonner";
import { useNavigate } from "react-router";

import { Card } from "@/components/ui";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Form/Input";
import { Switch } from "@/components/ui/Form/Switch";
import { Page } from "@/components/shared/Page";
import { ModuleService } from "@/utils/moduleService";
import type { InstalledModuleRow } from "@gatewaze/shared/modules";

export default function PeopleEnrichmentSettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({
    CLEARBIT_API_KEY: "",
    ENRICHLAYER_API_KEY: "",
    AUTO_ENRICH_ON_CREATE: "true",
    ENRICHMENT_MODE: "full",
  });

  const loadConfig = useCallback(async () => {
    const { modules } = await ModuleService.getInstalledModules();
    const mod = modules?.find(
      (m: InstalledModuleRow) => m.id === "people-enrichment"
    );
    if (mod?.config) {
      const saved = mod.config as Record<string, string>;
      setConfig((prev) => ({
        ...prev,
        ...Object.fromEntries(
          Object.entries(saved).filter(([, v]) => v !== undefined)
        ),
      }));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  const handleSave = async () => {
    setSaving(true);
    const result = await ModuleService.saveModuleConfig(
      "people-enrichment",
      config
    );
    if (result.success) {
      toast.success("Enrichment settings saved");
    } else {
      toast.error(result.error ?? "Failed to save settings");
    }
    setSaving(false);
  };

  const handleChange = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const hasApiKey = config.CLEARBIT_API_KEY || config.ENRICHLAYER_API_KEY;

  if (loading) {
    return (
      <Page title="People Enrichment">
        <div className="flex justify-center py-12">
          <div className="size-6 border-2 border-[var(--accent-9)] border-t-transparent rounded-full animate-spin" />
        </div>
      </Page>
    );
  }

  return (
    <Page title="People Enrichment Settings">
      <div className="p-6 max-w-3xl">
        <button
          onClick={() => navigate("/admin/modules")}
          className="flex items-center gap-1.5 text-sm text-[var(--gray-a9)] hover:text-[var(--gray-12)] transition-colors mb-4"
        >
          <ArrowLeftIcon className="size-3.5" />
          Back to Modules
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[var(--accent-a3)]">
            <SparklesIcon className="size-5 text-[var(--accent-9)]" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
              People Enrichment
            </h1>
            <p className="text-sm text-[var(--gray-11)]">
              Configure API keys and enrichment behavior
            </p>
          </div>
        </div>

        {/* Status Banner */}
        <div
          className={`mb-6 flex items-center gap-3 rounded-lg px-4 py-3 ${
            hasApiKey
              ? "bg-green-500/10 border border-green-500/20"
              : "bg-amber-500/10 border border-amber-500/20"
          }`}
        >
          {hasApiKey ? (
            <CheckCircleIcon className="size-5 text-green-500 shrink-0" />
          ) : (
            <ExclamationTriangleIcon className="size-5 text-amber-500 shrink-0" />
          )}
          <div>
            <p
              className={`text-sm font-medium ${
                hasApiKey ? "text-green-500" : "text-amber-500"
              }`}
            >
              {hasApiKey ? "Enrichment is configured" : "API keys required"}
            </p>
            <p className="text-xs text-[var(--gray-a9)]">
              {hasApiKey
                ? "New people will be automatically enriched when created"
                : "Add at least one API key below to enable enrichment"}
            </p>
          </div>
        </div>

        {/* API Keys */}
        <Card className="p-5 mb-5">
          <h2 className="text-lg font-semibold text-[var(--gray-12)] mb-4">
            API Keys
          </h2>
          <div className="space-y-4">
            <div>
              <Input
                label="Clearbit API Key"
                type="password"
                value={config.CLEARBIT_API_KEY}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  handleChange("CLEARBIT_API_KEY", e.target.value)
                }
                placeholder="sk_live_..."
              />
              <p className="text-xs text-[var(--gray-a9)] mt-1">
                Used for person and company data enrichment. Get your key at
                clearbit.com
              </p>
            </div>
            <div>
              <Input
                label="EnrichLayer API Key"
                type="password"
                value={config.ENRICHLAYER_API_KEY}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  handleChange("ENRICHLAYER_API_KEY", e.target.value)
                }
                placeholder="el_..."
              />
              <p className="text-xs text-[var(--gray-a9)] mt-1">
                Used for LinkedIn-based profile enrichment. Get your key at
                enrichlayer.com
              </p>
            </div>
          </div>
        </Card>

        {/* Behavior */}
        <Card className="p-5 mb-5">
          <h2 className="text-lg font-semibold text-[var(--gray-12)] mb-4">
            Behavior
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--gray-12)]">
                  Auto-enrich on create
                </p>
                <p className="text-xs text-[var(--gray-a9)]">
                  Automatically enrich new people when they sign up or are added
                </p>
              </div>
              <Switch
                checked={config.AUTO_ENRICH_ON_CREATE === "true"}
                onChange={() =>
                  handleChange(
                    "AUTO_ENRICH_ON_CREATE",
                    config.AUTO_ENRICH_ON_CREATE === "true" ? "false" : "true"
                  )
                }
                color="cyan"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[var(--gray-12)] mb-1">
                Enrichment Mode
              </label>
              <select
                value={config.ENRICHMENT_MODE}
                onChange={(e) =>
                  handleChange("ENRICHMENT_MODE", e.target.value)
                }
                className="w-full rounded-md border border-[var(--gray-a6)] bg-[var(--gray-a2)] px-3 py-2 text-sm text-[var(--gray-12)]"
              >
                <option value="initial">
                  Initial — Find LinkedIn URL only
                </option>
                <option value="full">
                  Full — Complete enrichment from all providers
                </option>
              </select>
              <p className="text-xs text-[var(--gray-a9)] mt-1">
                &quot;Initial&quot; is faster and uses fewer API credits.
                &quot;Full&quot; provides the most data.
              </p>
            </div>
          </div>
        </Card>

        {/* Save */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving} size="2">
            {saving ? (
              <>
                <ArrowPathIcon className="size-4 mr-1.5 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Settings"
            )}
          </Button>
        </div>
      </div>
    </Page>
  );
}
