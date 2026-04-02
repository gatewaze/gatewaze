import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { CheckCircle2, Loader2, AlertCircle, Package } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ModuleService } from "@/utils/moduleService";
import { useModulesContext } from "@/app/contexts/modules/context";
import OnboardingWizardLayout from "./OnboardingWizardLayout";

type SetupStatus = "running" | "done" | "error";

export default function ModuleSetupStep() {
  const navigate = useNavigate();
  const { refresh: refreshModulesContext } = useModulesContext();
  const [status, setStatus] = useState<SetupStatus>("running");
  const [statusText, setStatusText] = useState("Preparing modules...");
  const [errorMessage, setErrorMessage] = useState("");
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    async function run() {
      try {
        setStatusText("Verifying module configuration...");

        const { modules: installed, error: fetchErr } = await ModuleService.getInstalledModules();

        if (fetchErr) {
          setStatus("error");
          setErrorMessage(fetchErr);
          return;
        }

        const enabledCount =
          (installed ?? []).filter((m) => m.status === "enabled").length;

        setStatusText(
          `${enabledCount} module${enabledCount !== 1 ? "s" : ""} configured successfully`
        );
        setStatus("done");

        await refreshModulesContext();

        const apiUrl = import.meta.env.VITE_API_URL ?? "";
        await fetch(`${apiUrl}/api/modules/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: [{ key: "onboarding_step", value: "modules_setup" }] }),
        });

        setTimeout(() => {
          navigate("/onboarding/theme", { replace: true });
        }, 1500);
      } catch {
        setStatus("error");
        setErrorMessage("Failed to set up modules");
      }
    }

    run();
  }, [navigate]);

  const handleRetry = () => {
    setStatus("running");
    setStatusText("Retrying...");
    setErrorMessage("");
    hasStarted.current = false;
  };

  const handleSkip = async () => {
    const apiUrl = import.meta.env.VITE_API_URL ?? "";
    await fetch(`${apiUrl}/api/modules/settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: [{ key: "onboarding_step", value: "modules_setup" }] }),
    });
    navigate("/onboarding/theme", { replace: true });
  };

  return (
    <OnboardingWizardLayout currentStep={3} hideFooter>
      <div className="flex h-full flex-col items-center justify-center text-center space-y-6">
        <div className="flex justify-center">
          {status === "running" && (
            <div className="relative">
              <Package className="h-12 w-12 text-[var(--accent-9)]" />
              <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-[var(--accent-9)]" />
            </div>
          )}
          {status === "done" && (
            <CheckCircle2 className="h-12 w-12 text-[var(--accent-9)]" />
          )}
          {status === "error" && (
            <AlertCircle className="h-12 w-12 text-red-500" />
          )}
        </div>

        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {status === "running" && "Setting up modules"}
            {status === "done" && "Modules ready"}
            {status === "error" && "Setup failed"}
          </h2>
          <p className="mt-2 text-sm text-[var(--gray-a9)]">{statusText}</p>
        </div>

        {status === "running" && (
          <div className="flex justify-center">
            <div className="h-1.5 w-48 rounded-full bg-[var(--gray-a3)] overflow-hidden">
              <div className="h-full w-full rounded-full bg-[var(--accent-9)] animate-pulse" />
            </div>
          </div>
        )}

        {status === "error" && (
          <div className="space-y-3">
            <p className="text-sm text-red-500">{errorMessage}</p>
            <div className="flex justify-center gap-3">
              <Button onClick={handleRetry} size="2">
                Retry
              </Button>
              <Button onClick={handleSkip} variant="ghost" size="2">
                Skip for now
              </Button>
            </div>
          </div>
        )}
      </div>
    </OnboardingWizardLayout>
  );
}
