import { useState } from "react";
import { useNavigate } from "react-router";
import { ArrowPathIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useModulesContext } from "@/app/contexts/modules/context";
import { useAuthContext } from "@/app/contexts/auth/context";

/**
 * Global notification banner shown when module updates are available.
 * Renders at the top of the admin app for users with admin privileges.
 */
export function ModuleUpdateBanner() {
  const { user } = useAuthContext();
  const { availableUpdates } = useModulesContext();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const compatibleUpdates = availableUpdates.filter((u) => u.platformCompatible);
  const blockedUpdates = availableUpdates.filter((u) => !u.platformCompatible);

  // Deployment-level off switch (runtime config / env). Git-source-served instances (staging) track
  // module code continuously, so "an update is available" is the permanent steady state there and
  // the banner is pure noise — updates remain visible on the Modules page itself.
  // NOTE: exact non-optional member access — Vite's static define replacement (and the runtime-config
  // rewrite) only match this form.
  if (import.meta.env.VITE_HIDE_MODULE_UPDATE_BANNER === "1") {
    return null;
  }

  if (!isAdmin || availableUpdates.length === 0 || dismissed) {
    return null;
  }

  const hasBlocked = blockedUpdates.length > 0;
  const bannerColor = hasBlocked && compatibleUpdates.length === 0
    ? "bg-amber-600"
    : "bg-red-600";

  return (
    <div className={`${bannerColor} text-white px-4 py-2 text-sm flex items-center justify-between gap-4 xl:ltr:ml-[var(--sidebar-panel-width)] xl:rtl:mr-[var(--sidebar-panel-width)]`}>
      <div className="flex items-center gap-2 min-w-0">
        <ArrowPathIcon className="size-4 shrink-0" />
        <span className="truncate">
          {compatibleUpdates.length === 1 && blockedUpdates.length === 0
            ? `Module update available: ${compatibleUpdates[0].name} v${compatibleUpdates[0].availableVersion}`
            : compatibleUpdates.length > 0 && blockedUpdates.length === 0
            ? `${compatibleUpdates.length} module updates available`
            : compatibleUpdates.length > 0 && blockedUpdates.length > 0
            ? `${compatibleUpdates.length} update(s) available, ${blockedUpdates.length} blocked (platform upgrade required)`
            : `${blockedUpdates.length} module update(s) blocked — platform upgrade required`}
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => navigate("/admin/modules")}
          className="px-3 py-1 rounded text-xs font-medium bg-white/20 hover:bg-white/30 transition-colors"
        >
          View Updates
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="p-0.5 rounded hover:bg-white/20 transition-colors"
          title="Dismiss"
        >
          <XMarkIcon className="size-4" />
        </button>
      </div>
    </div>
  );
}
