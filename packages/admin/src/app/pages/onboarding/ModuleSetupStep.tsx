import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { CheckCircle2, Loader2, AlertCircle, Package } from "lucide-react";
import { ModuleService } from "@/utils/moduleService";
import { useModulesContext } from "@/app/contexts/modules/context";
import GradientBackground from "@/components/shared/GradientBackground";

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

        // Modules were already reconciled and migrations applied by /select
        // in the previous step. Fetch current state to confirm.
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

        // Refresh module context so nav items appear immediately
        await refreshModulesContext();

        // Update onboarding step via API (service_role) to bypass RLS
        const apiUrl = import.meta.env.VITE_API_URL ?? "";
        await fetch(`${apiUrl}/api/modules/settings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings: [{ key: "onboarding_step", value: "modules_setup" }] }),
        });

        // Short delay so user sees the success state
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
    <>
      <GradientBackground />
      <div className="flex min-h-[100svh] items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="flex justify-center">
            {status === "running" && (
              <div className="relative">
                <Package className="h-12 w-12 text-[var(--accent-9)]" />
                <Loader2 className="absolute -bottom-1 -right-1 h-5 w-5 animate-spin text-[var(--accent-9)]" />
              </div>
            )}
            {status === "done" && (
              <CheckCircle2 className="h-12 w-12 text-green-500" />
            )}
            {status === "error" && (
              <AlertCircle className="h-12 w-12 text-red-500" />
            )}
          </div>

          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              {status === "running" && "Setting up modules"}
              {status === "done" && "Modules ready"}
              {status === "error" && "Setup failed"}
            </h1>
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
              <p className="text-sm text-red-400">{errorMessage}</p>
              <div className="flex justify-center gap-3">
                <button
                  onClick={handleRetry}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-[var(--accent-9)] text-white hover:bg-[var(--accent-10)]"
                >
                  Retry
                </button>
                <button
                  onClick={handleSkip}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-[var(--gray-a3)] text-[var(--gray-11)] hover:bg-[var(--gray-a4)]"
                >
                  Skip for now
                </button>
              </div>
            </div>
          )}

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
