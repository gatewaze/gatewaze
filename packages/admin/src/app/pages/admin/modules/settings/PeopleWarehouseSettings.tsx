import { useState, useEffect, useCallback } from "react";
import {
  CircleStackIcon,
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

export default function PeopleWarehouseSettings() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [config, setConfig] = useState<Record<string, string>>({
    CUSTOMERIO_SITE_ID: "",
    CUSTOMERIO_API_KEY: "",
    CUSTOMERIO_APP_API_KEY: "",
    SYNC_ON_CREATE: "true",
    SYNC_ON_UPDATE: "true",
    IMPORT_SEGMENTS: "true",
  });

  const loadConfig = useCallback(async () => {
    const { modules } = await ModuleService.getInstalledModules();
    const mod = modules?.find(
      (m: InstalledModuleRow) => m.id === "people-warehouse"
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
      "people-warehouse",
      config
    );
    if (result.success) {
      toast.success("Warehouse settings saved");
    } else {
      toast.error(result.error ?? "Failed to save settings");
    }
    setSaving(false);
  };

  const handleTestConnection = async () => {
    if (!config.CUSTOMERIO_APP_API_KEY) {
      toast.error("App API key is required to test the connection");
      return;
    }
    setTesting(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(`${apiUrl}/api/customerio/segments`);
      if (res.ok) {
        const data = await res.json();
        toast.success(
          `Connected! Found ${data.segments?.length ?? 0} segments`
        );
      } else {
        toast.error("Connection failed — check your App API key");
      }
    } catch {
      toast.error("Connection failed — could not reach the API");
    }
    setTesting(false);
  };

  const handleChange = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const isConfigured =
    config.CUSTOMERIO_SITE_ID &&
    config.CUSTOMERIO_API_KEY &&
    config.CUSTOMERIO_APP_API_KEY;

  if (loading) {
    return (
      <Page title="People Warehouse">
        <div className="flex justify-center py-12">
          <div className="size-6 border-2 border-[var(--accent-9)] border-t-transparent rounded-full animate-spin" />
        </div>
      </Page>
    );
  }

  return (
    <Page title="People Warehouse Settings">
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
            <CircleStackIcon className="size-5 text-[var(--accent-9)]" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
              People Warehouse
            </h1>
            <p className="text-sm text-[var(--gray-11)]">
              Bi-directional sync with Customer.io
            </p>
          </div>
        </div>

        {/* Status Banner */}
        <div
          className={`mb-6 flex items-center gap-3 rounded-lg px-4 py-3 ${
            isConfigured
              ? "bg-green-500/10 border border-green-500/20"
              : "bg-amber-500/10 border border-amber-500/20"
          }`}
        >
          {isConfigured ? (
            <CheckCircleIcon className="size-5 text-green-500 shrink-0" />
          ) : (
            <ExclamationTriangleIcon className="size-5 text-amber-500 shrink-0" />
          )}
          <div>
            <p
              className={`text-sm font-medium ${
                isConfigured ? "text-green-500" : "text-amber-500"
              }`}
            >
              {isConfigured
                ? "Warehouse is configured"
                : "Configuration required"}
            </p>
            <p className="text-xs text-[var(--gray-a9)]">
              {isConfigured
                ? "People data will be synced bi-directionally with Customer.io"
                : "Add your Customer.io credentials below to enable the warehouse"}
            </p>
          </div>
        </div>

        {/* Customer.io Credentials */}
        <Card className="p-5 mb-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-[var(--gray-12)]">
              Customer.io Credentials
            </h2>
            <Button
              onClick={handleTestConnection}
              variant="outline"
              size="1"
              disabled={testing || !config.CUSTOMERIO_APP_API_KEY}
            >
              {testing ? (
                <>
                  <ArrowPathIcon className="size-3.5 mr-1 animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </Button>
          </div>
          <div className="space-y-4">
            <div>
              <Input
                label="Site ID"
                value={config.CUSTOMERIO_SITE_ID}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  handleChange("CUSTOMERIO_SITE_ID", e.target.value)
                }
                placeholder="abc123def456..."
              />
              <p className="text-xs text-[var(--gray-a9)] mt-1">
                Found in Customer.io under Settings &gt; API Credentials &gt;
                Track API
              </p>
            </div>
            <div>
              <Input
                label="Track API Key"
                type="password"
                value={config.CUSTOMERIO_API_KEY}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  handleChange("CUSTOMERIO_API_KEY", e.target.value)
                }
                placeholder="..."
              />
              <p className="text-xs text-[var(--gray-a9)] mt-1">
                Track API key — used to push data to Customer.io
              </p>
            </div>
            <div>
              <Input
                label="App API Key"
                type="password"
                value={config.CUSTOMERIO_APP_API_KEY}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  handleChange("CUSTOMERIO_APP_API_KEY", e.target.value)
                }
                placeholder="..."
              />
              <p className="text-xs text-[var(--gray-a9)] mt-1">
                App API key — used to read segments and customer data from
                Customer.io
              </p>
            </div>
          </div>
        </Card>

        {/* Sync Behavior */}
        <Card className="p-5 mb-5">
          <h2 className="text-lg font-semibold text-[var(--gray-12)] mb-4">
            Sync Behavior
          </h2>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--gray-12)]">
                  Sync on create
                </p>
                <p className="text-xs text-[var(--gray-a9)]">
                  Automatically push new people to Customer.io when they are
                  created
                </p>
              </div>
              <Switch
                checked={config.SYNC_ON_CREATE === "true"}
                onChange={() =>
                  handleChange(
                    "SYNC_ON_CREATE",
                    config.SYNC_ON_CREATE === "true" ? "false" : "true"
                  )
                }
                color="cyan"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--gray-12)]">
                  Sync on update
                </p>
                <p className="text-xs text-[var(--gray-a9)]">
                  Push attribute changes to Customer.io when a person is updated
                </p>
              </div>
              <Switch
                checked={config.SYNC_ON_UPDATE === "true"}
                onChange={() =>
                  handleChange(
                    "SYNC_ON_UPDATE",
                    config.SYNC_ON_UPDATE === "true" ? "false" : "true"
                  )
                }
                color="cyan"
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-[var(--gray-12)]">
                  Import segments
                </p>
                <p className="text-xs text-[var(--gray-a9)]">
                  Sync Customer.io segments and their membership back to
                  Gatewaze
                </p>
              </div>
              <Switch
                checked={config.IMPORT_SEGMENTS === "true"}
                onChange={() =>
                  handleChange(
                    "IMPORT_SEGMENTS",
                    config.IMPORT_SEGMENTS === "true" ? "false" : "true"
                  )
                }
                color="cyan"
              />
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
