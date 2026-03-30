import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, Loader2, Palette } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ColorInput } from "@/components/shared/branding/ColorInput";
import { LogoUploadField } from "@/components/shared/branding/LogoUploadField";
import { EventTypesEditor } from "@/components/shared/branding/EventTypesEditor";
import { type EventTypeOption, DEFAULT_EVENT_TYPES } from "@/hooks/useEventTypes";
import { useAuthContext } from "@/app/contexts/auth/context";
import { useModulesContext } from "@/app/contexts/modules/context";
import GradientBackground from "@/components/shared/GradientBackground";

type PortalTheme = "blobs" | "gradient_wave" | "basic";

const THEME_OPTIONS: { value: PortalTheme; label: string; description: string }[] = [
  {
    value: "blobs",
    label: "Blobs",
    description: "Animated gradient blobs on a dark background",
  },
  {
    value: "gradient_wave",
    label: "Gradient Wave",
    description: "Smooth gradient wave animation",
  },
  {
    value: "basic",
    label: "Basic",
    description: "Clean solid background",
  },
];

export default function ThemeSetupStep() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { isFeatureEnabled } = useModulesContext();
  const hasEvents = isFeatureEnabled('events');
  const [primaryColor, setPrimaryColor] = useState("#20dd20");
  const [secondaryColor, setSecondaryColor] = useState("#0a0a0a");
  const [logoUrl, setLogoUrl] = useState("");
  const [portalTheme, setPortalTheme] = useState<PortalTheme>("blobs");
  const [eventTypes, setEventTypes] = useState<EventTypeOption[]>(DEFAULT_EVENT_TYPES);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleComplete = async () => {
    setIsSubmitting(true);
    try {
      const validTypes = eventTypes.filter((t) => t.value && t.label);
      const settings = [
        { key: "primary_color", value: primaryColor },
        { key: "secondary_color", value: secondaryColor },
        { key: "logo_url", value: logoUrl },
        { key: "portal_theme", value: portalTheme },
        ...(hasEvents ? [{ key: "event_types", value: JSON.stringify(validTypes) }] : []),
        { key: "onboarding_step", value: "complete" },
      ];

      // Use API (service_role) to bypass RLS during onboarding
      const apiUrl = import.meta.env.VITE_API_URL ?? "";
      const res = await fetch(`${apiUrl}/api/modules/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });

      if (!res.ok) throw new Error("Failed to save settings");

      // Clear onboarding cache (scoped to user ID)
      if (user?.id) {
        sessionStorage.setItem(`gatewaze-onboarding-step:${user.id}`, 'complete');
      }

      navigate("/home", { replace: true });
    } catch {
      toast.error("Failed to save theme settings");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <GradientBackground />
      <div className="flex min-h-[100svh] items-center justify-center p-4">
        <div className="w-full max-w-xl space-y-6">
          <div className="text-center">
            <Palette className="mx-auto h-10 w-10 text-[var(--accent-9)]" />
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">
              Set up your brand
            </h1>
            <p className="mt-1 text-sm text-[var(--gray-a9)]">
              Configure your platform's look and feel. You can refine these
              later in Settings &rarr; Branding.
            </p>
          </div>

          <Card className="p-6 space-y-6">
            <ColorInput
              label="Primary Color"
              description="Used for buttons, links, and accent elements"
              value={primaryColor}
              onChange={setPrimaryColor}
            />

            <ColorInput
              label="Secondary Color"
              description="Background and fallback color"
              value={secondaryColor}
              onChange={setSecondaryColor}
            />

            <LogoUploadField
              label="Logo"
              description="Your brand logo — displayed in the sidebar and login page"
              value={logoUrl}
              settingKey="logo_url"
              onChange={setLogoUrl}
            />

            {hasEvents && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Event Types</p>
                <p className="text-xs text-[var(--gray-a9)]">
                  What kinds of events will you manage? You can change these later
                  in Settings.
                </p>
                <EventTypesEditor
                  value={eventTypes}
                  onChange={setEventTypes}
                />
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium">Portal Theme</p>
              <p className="text-xs text-[var(--gray-a9)]">
                The visual style for your public-facing portal
              </p>
              <div className="grid grid-cols-3 gap-3">
                {THEME_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setPortalTheme(opt.value)}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      portalTheme === opt.value
                        ? "border-[var(--accent-9)] bg-[var(--accent-a2)] ring-1 ring-[var(--accent-9)]"
                        : "border-[var(--gray-a5)] hover:border-[var(--gray-a8)]"
                    }`}
                  >
                    <p className="text-sm font-medium text-[var(--gray-12)]">
                      {opt.label}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--gray-a9)]">
                      {opt.description}
                    </p>
                  </button>
                ))}
              </div>
            </div>
          </Card>

          <div>
            <Button onClick={handleComplete} disabled={isSubmitting} size="3" className="w-full">
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Check className="mr-2 h-4 w-4" />
                  Complete Setup
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
