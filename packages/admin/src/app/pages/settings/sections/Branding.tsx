import { useState, useEffect, useCallback, useRef } from "react";
import { useModulesContext } from "@/app/contexts/modules/context";
import { Tabs as RadixTabs, Text, Heading, Callout } from "@radix-ui/themes";
import {
  Sun,
  Moon,
  Monitor,
  Palette,
  Upload,
  Loader2,
  Check,
  FileText,
  Info,
  Users,
  Lock,
  Tags,
} from "lucide-react";
import { useActiveThemeModule } from "@/hooks/useActiveThemeModule";
import { EventTypesEditor } from "@/components/shared/branding/EventTypesEditor";
import { ContentCategoriesEditor } from "@/components/shared/branding/ContentCategoriesEditor";
import { PeopleAttributesEditor } from "@/components/shared/branding/PeopleAttributesEditor";
import {
  type EventTypeOption,
  DEFAULT_EVENT_TYPES,
  saveEventTypes,
} from "@/hooks/useEventTypes";
import {
  type ContentCategoryOption,
} from "@/hooks/useContentCategories";
import {
  type PeopleAttributeConfig,
  DEFAULT_PEOPLE_ATTRIBUTES,
  savePeopleAttributes,
} from "@/hooks/usePeopleAttributes";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { RichTextEditor } from "@/components/ui/RichTextEditor";
import { Page } from "@/components/shared/Page";
import { supabase } from "@/lib/supabase";
import { updateFavicon } from "@/utils/favicon";

// ── Types ──────────────────────────────────────────────────────────

type PortalTheme = "blobs" | "gradient_wave" | "basic";
type CornerStyle = "square" | "rounded" | "pill";

interface ThemeColorsMap {
  blobs: { background: string; blob1: string; blob2: string; blob3: string };
  gradient_wave: { start: string; middle: string; end: string };
  basic: { background: string };
}

const DEFAULT_THEME_COLORS: ThemeColorsMap = {
  blobs: {
    background: "#0a0a0a",
    blob1: "#00a2c7",
    blob2: "#0e7490",
    blob3: "#1a1a1a",
  },
  gradient_wave: { start: "#00a2c7", middle: "#0e7490", end: "#0a0a0a" },
  basic: { background: "#0a0a0a" },
};

interface BrandingSettings {
  app_name: string;
  primary_color: string;
  secondary_color: string;
  tertiary_color: string;
  font_heading: string;
  font_heading_weight: string;
  font_body: string;
  font_body_weight: string;
  body_text_size: string;
  logo_url: string;
  logo_icon_url: string;
  favicon_url: string;
  contact_email: string;
  tracking_head: string;
  tracking_body: string;
}

const BRANDING_DEFAULTS: BrandingSettings = {
  app_name: "Gatewaze",
  primary_color: "#00a2c7",
  secondary_color: "#0a0a0a",
  tertiary_color: "#1a1a1a",
  font_heading: "Poppins",
  font_heading_weight: "600",
  font_body: "Inter",
  font_body_weight: "400",
  body_text_size: "16",
  logo_url: "",
  logo_icon_url: "",
  favicon_url: "",
  contact_email: "",
  tracking_head: "",
  tracking_body: "",
};

// ── Helpers ────────────────────────────────────────────────────────

import { ColorInput } from "@/components/shared/branding/ColorInput";
import { LogoUploadField } from "@/components/shared/branding/LogoUploadField";

// ── BrandingCard ───────────────────────────────────────────────────

function BrandingCard() {
  const activeTheme = useActiveThemeModule();
  const lockedSettings = activeTheme?.themeOverrides.lockedSettings ?? [];
  const { isFeatureEnabled } = useModulesContext();
  const hasEvents = isFeatureEnabled('events');
  const isLocked = (key: string) => lockedSettings.includes(key);

  const [settings, setSettings] =
    useState<BrandingSettings>(BRANDING_DEFAULTS);
  const [originalSettings, setOriginalSettings] =
    useState<BrandingSettings>(BRANDING_DEFAULTS);
  const [portalTheme, setPortalTheme] = useState<PortalTheme>("blobs");
  const [originalPortalTheme, setOriginalPortalTheme] =
    useState<PortalTheme>("blobs");
  const [themeColors, setThemeColors] =
    useState<ThemeColorsMap>(DEFAULT_THEME_COLORS);
  const [originalThemeColors, setOriginalThemeColors] =
    useState<ThemeColorsMap>(DEFAULT_THEME_COLORS);
  const [cornerStyle, setCornerStyle] = useState<CornerStyle>("rounded");
  const [originalCornerStyle, setOriginalCornerStyle] =
    useState<CornerStyle>("rounded");
  const [eventTypes, setEventTypes] =
    useState<EventTypeOption[]>(DEFAULT_EVENT_TYPES);
  const [originalEventTypes, setOriginalEventTypes] =
    useState<EventTypeOption[]>(DEFAULT_EVENT_TYPES);
  const [contentCategories, setContentCategories] =
    useState<ContentCategoryOption[]>([]);
  const [originalContentCategories, setOriginalContentCategories] =
    useState<ContentCategoryOption[]>([]);
  const [peopleAttributes, setPeopleAttributes] =
    useState<PeopleAttributeConfig[]>(DEFAULT_PEOPLE_ATTRIBUTES);
  const [originalPeopleAttributes, setOriginalPeopleAttributes] =
    useState<PeopleAttributeConfig[]>(DEFAULT_PEOPLE_ATTRIBUTES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [settingsTab, setSettingsTab] = useState("branding");

  const loadSettings = useCallback(async () => {
    const { data } = await supabase
      .from("platform_settings")
      .select("key, value")
      .in("key", [
        ...Object.keys(BRANDING_DEFAULTS),
        "portal_theme",
        "theme_colors",
        "corner_style",
        "event_types",
        "content_categories",
        "people_attributes",
      ]);

    if (data) {
      const loaded = { ...BRANDING_DEFAULTS };
      let loadedTheme: PortalTheme = "blobs";
      let loadedColors: ThemeColorsMap = { ...DEFAULT_THEME_COLORS };
      let loadedCornerStyle: CornerStyle = "rounded";
      let loadedEventTypes: EventTypeOption[] = DEFAULT_EVENT_TYPES;
      let loadedContentCategories: ContentCategoryOption[] = [];
      let loadedPeopleAttributes: PeopleAttributeConfig[] = DEFAULT_PEOPLE_ATTRIBUTES;

      for (const row of data) {
        if (row.key === "portal_theme") {
          if (
            row.value === "blobs" ||
            row.value === "gradient_wave" ||
            row.value === "basic"
          )
            loadedTheme = row.value;
        } else if (row.key === "corner_style") {
          if (
            row.value === "square" ||
            row.value === "rounded" ||
            row.value === "pill"
          )
            loadedCornerStyle = row.value;
        } else if (row.key === "event_types") {
          try {
            const parsed = JSON.parse(row.value);
            if (Array.isArray(parsed) && parsed.length > 0) {
              loadedEventTypes = parsed;
            }
          } catch {
            /* use defaults */
          }
        } else if (row.key === "content_categories") {
          try {
            const parsed = JSON.parse(row.value);
            if (Array.isArray(parsed)) {
              loadedContentCategories = parsed;
            }
          } catch {
            /* use defaults */
          }
        } else if (row.key === "people_attributes") {
          try {
            const parsed = JSON.parse(row.value);
            if (Array.isArray(parsed) && parsed.length > 0) {
              loadedPeopleAttributes = parsed;
            }
          } catch {
            /* use defaults */
          }
        } else if (row.key === "theme_colors") {
          try {
            const parsed = JSON.parse(row.value);
            if (parsed.blob1 !== undefined)
              loadedColors.blobs = {
                ...DEFAULT_THEME_COLORS.blobs,
                ...parsed,
              };
            else if (parsed.start !== undefined)
              loadedColors.gradient_wave = {
                ...DEFAULT_THEME_COLORS.gradient_wave,
                ...parsed,
              };
            else if (parsed.background !== undefined && !parsed.blob1)
              loadedColors.basic = {
                ...DEFAULT_THEME_COLORS.basic,
                ...parsed,
              };
            if (parsed.blobs)
              loadedColors.blobs = {
                ...DEFAULT_THEME_COLORS.blobs,
                ...parsed.blobs,
              };
            if (parsed.gradient_wave)
              loadedColors.gradient_wave = {
                ...DEFAULT_THEME_COLORS.gradient_wave,
                ...parsed.gradient_wave,
              };
            if (parsed.basic)
              loadedColors.basic = {
                ...DEFAULT_THEME_COLORS.basic,
                ...parsed.basic,
              };
          } catch {
            /* use defaults */
          }
        } else if (row.key in loaded) {
          (loaded as Record<string, string>)[row.key] = row.value;
        }
      }
      setSettings(loaded);
      setOriginalSettings(loaded);
      setPortalTheme(loadedTheme);
      setOriginalPortalTheme(loadedTheme);
      setThemeColors(loadedColors);
      setOriginalThemeColors(loadedColors);
      setCornerStyle(loadedCornerStyle);
      setOriginalCornerStyle(loadedCornerStyle);
      setEventTypes(loadedEventTypes);
      setOriginalEventTypes(loadedEventTypes);
      setContentCategories(loadedContentCategories);
      setOriginalContentCategories(loadedContentCategories);
      setPeopleAttributes(loadedPeopleAttributes);
      setOriginalPeopleAttributes(loadedPeopleAttributes);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const hasChanges =
    JSON.stringify(settings) !== JSON.stringify(originalSettings) ||
    portalTheme !== originalPortalTheme ||
    JSON.stringify(themeColors) !== JSON.stringify(originalThemeColors) ||
    cornerStyle !== originalCornerStyle ||
    JSON.stringify(eventTypes) !== JSON.stringify(originalEventTypes) ||
    JSON.stringify(contentCategories) !== JSON.stringify(originalContentCategories) ||
    JSON.stringify(peopleAttributes) !== JSON.stringify(originalPeopleAttributes);

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const allSettings: Record<string, string> = { ...settings };
      allSettings.portal_theme = portalTheme;
      allSettings.corner_style = cornerStyle;
      allSettings.theme_colors = JSON.stringify(themeColors);
      allSettings.event_types = JSON.stringify(
        eventTypes.filter((t) => t.value && t.label)
      );
      allSettings.content_categories = JSON.stringify(
        contentCategories.filter((c) => c.value && c.label)
      );
      allSettings.people_attributes = JSON.stringify(
        peopleAttributes.filter((a) => a.key && a.label)
      );
      const rows = Object.entries(allSettings).map(([key, value]) => ({
        key,
        value,
      }));
      const { error } = await Promise.race([
        supabase.from("platform_settings").upsert(rows, { onConflict: "key" }),
        new Promise<{ error: { message: string }; data: null }>((resolve) =>
          setTimeout(
            () =>
              resolve({
                error: { message: "Save timed out. Please try again." },
                data: null,
              }),
            10000
          )
        ),
      ]);
      if (error) {
        setSaveError(`Failed to save settings: ${error.message}`);
        return;
      }
      setOriginalSettings(settings);
      setOriginalPortalTheme(portalTheme);
      setOriginalThemeColors(themeColors);
      setOriginalCornerStyle(cornerStyle);
      setOriginalEventTypes(eventTypes);
      setOriginalContentCategories(contentCategories);
      setOriginalPeopleAttributes(peopleAttributes);
      setSaved(true);
      setTimeout(() => setSaved(false), 5000);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const updateSetting = (key: keyof BrandingSettings, value: string) =>
    setSettings((prev) => ({ ...prev, [key]: value }));

  const updateThemeColor = <T extends PortalTheme>(
    theme: T,
    key: keyof ThemeColorsMap[T],
    value: string
  ) =>
    setThemeColors((prev) => ({
      ...prev,
      [theme]: { ...prev[theme], [key]: value },
    }));

  if (loading) {
    return (
      <Card size="4">
        <div className="flex items-center gap-2 mb-4">
          <Palette className="h-5 w-5" />
          <Heading size="4">Branding</Heading>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--gray-9)]" />
        </div>
      </Card>
    );
  }

  return (
    <Card size="4">
      <div className="flex items-center gap-2 mb-2">
        <Palette className="h-5 w-5" />
        <Heading size="4">Portal Settings</Heading>
      </div>
      <Text as="p" size="2" color="gray" className="mb-4">
        Configure your event portal's appearance. Changes may take up to a
        minute to appear on the portal.
      </Text>

      {activeTheme && (
        <Callout.Root color="blue" className="mb-6">
          <Callout.Icon>
            <Lock className="h-4 w-4" />
          </Callout.Icon>
          <Callout.Text>
            The <strong>{activeTheme.name}</strong> theme module is active. Some settings are managed by the theme and cannot be edited.
          </Callout.Text>
        </Callout.Root>
      )}

      <RadixTabs.Root value={settingsTab} onValueChange={setSettingsTab}>
        <RadixTabs.List className="mb-6">
          <RadixTabs.Trigger value="branding">Branding</RadixTabs.Trigger>
          <RadixTabs.Trigger value="theme">Theme</RadixTabs.Trigger>
          {hasEvents && <RadixTabs.Trigger value="event-types">Event Types</RadixTabs.Trigger>}
          <RadixTabs.Trigger value="categories">Categories</RadixTabs.Trigger>
          <RadixTabs.Trigger value="tracking">Tracking</RadixTabs.Trigger>
          <RadixTabs.Trigger value="pages">Pages</RadixTabs.Trigger>
        </RadixTabs.List>

        {/* ── Branding Tab ── */}
        <RadixTabs.Content value="branding">
          <div className="space-y-6">
            {/* App Name */}
            <div className="space-y-1.5">
              <Text as="label" size="2" weight="medium">
                App Name
              </Text>
              <Text as="p" size="1" color="gray">
                Displayed in the portal header, page titles, and emails.
              </Text>
              <input
                value={settings.app_name}
                onChange={(e) => updateSetting("app_name", e.target.value)}
                placeholder="My Events Platform"
                className="w-full rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              />
            </div>

            {/* Contact Email */}
            <div className="space-y-1.5">
              <Text as="label" size="2" weight="medium">
                Contact Email
              </Text>
              <Text as="p" size="1" color="gray">
                Shown on privacy, terms, and legal pages. If empty, defaults to
                the first admin user's email.
              </Text>
              <input
                type="email"
                value={settings.contact_email}
                onChange={(e) => updateSetting("contact_email", e.target.value)}
                placeholder="privacy@example.com"
                className="w-full rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-sm"
              />
            </div>

            <hr className="border-[var(--gray-5)]" />

            {/* Logos */}
            <div>
              <Heading size="3" className="mb-4">
                Logos & Icons
              </Heading>
              <div className="space-y-4">
                <LogoUploadField
                  label="Full Logo"
                  description="Shown in the portal header on the homepage. Recommended: SVG or PNG, max height 40px."
                  value={settings.logo_url}
                  settingKey="logo"
                  onChange={(v) => updateSetting("logo_url", v)}
                />
                <LogoUploadField
                  label="Logo Icon"
                  description="Compact icon shown on event pages. Recommended: square SVG or PNG, 32x32px."
                  value={settings.logo_icon_url}
                  settingKey="logo_icon"
                  onChange={(v) => updateSetting("logo_icon_url", v)}
                />
                <LogoUploadField
                  label="Favicon / Brand Icon"
                  description="Square icon used as the browser tab favicon and default event image. Minimum 512×512px PNG."
                  value={settings.favicon_url}
                  settingKey="favicon"
                  onChange={(v) => { updateSetting("favicon_url", v); updateFavicon(v); }}
                  minWidth={512}
                  minHeight={512}
                />
              </div>
            </div>

            <hr className="border-[var(--gray-5)]" />

            {/* Save */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={!hasChanges || saving}
                variant="solid"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                  </>
                ) : saved ? (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Saved
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
              {hasChanges && !saving && !saveError && (
                <Text size="1" color="gray">
                  You have unsaved changes
                </Text>
              )}
              {saveError && (
                <Text size="1" color="red">
                  Error: {saveError}
                </Text>
              )}
            </div>
            {saved && (
              <div className="flex items-center gap-2 rounded-md bg-[var(--accent-2)] border border-[var(--accent-6)] px-3 py-2">
                <Info className="h-4 w-4 shrink-0 text-[var(--accent-9)]" />
                <Text size="1" color="gray">
                  Changes may take up to a minute to appear on the portal.
                </Text>
              </div>
            )}
          </div>
        </RadixTabs.Content>

        {/* ── Theme Tab ── */}
        <RadixTabs.Content value="theme">
          <div className="space-y-6">
            {/* Brand Colors */}
            <div>
              <Heading size="3" className="mb-4">
                Brand Colors
              </Heading>
          <div className="space-y-4">
            <ColorInput
              label="Primary Color"
              description="Used for buttons, links, form focus borders, and accent elements across the portal."
              value={settings.primary_color}
              onChange={(v) => updateSetting("primary_color", v)}
              disabled={isLocked("primary_color")}
            />
            <ColorInput
              label="Secondary Color"
              description="Fallback background color used when the theme background is unavailable."
              value={settings.secondary_color}
              onChange={(v) => updateSetting("secondary_color", v)}
              disabled={isLocked("secondary_color")}
            />
          </div>
        </div>

        <hr className="border-[var(--gray-5)]" />

        {/* Portal Theme */}
        <div>
          <Heading size="3" className="mb-2">
            Portal Background Theme
          </Heading>
          <Text as="p" size="1" color="gray" className="mb-4">
            Choose the background style for your event portal. Each theme has
            its own color settings.
          </Text>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {(
              [
                {
                  value: "blobs" as const,
                  label: "Blobs",
                  desc: "Animated floating blobs",
                },
                {
                  value: "gradient_wave" as const,
                  label: "Gradient Wave",
                  desc: "Smooth animated gradient",
                },
                {
                  value: "basic" as const,
                  label: "Basic",
                  desc: "Solid background color",
                },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                onClick={() => setPortalTheme(t.value)}
                disabled={isLocked("portal_theme")}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  portalTheme === t.value
                    ? "border-[var(--accent-9)] bg-[var(--accent-2)]"
                    : "border-[var(--gray-6)] hover:border-[var(--accent-7)]"
                } ${isLocked("portal_theme") ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-xs text-[var(--gray-9)]">{t.desc}</div>
              </button>
            ))}
          </div>

          <div className="space-y-4">
            {portalTheme === "blobs" && (
              <>
                <ColorInput
                  label="Background"
                  description="Base background color behind the animated blobs."
                  value={themeColors.blobs.background}
                  onChange={(v) => updateThemeColor("blobs", "background", v)}
                />
                <ColorInput
                  label="Blob 1"
                  description="Color of the first animated blob."
                  value={themeColors.blobs.blob1}
                  onChange={(v) => updateThemeColor("blobs", "blob1", v)}
                />
                <ColorInput
                  label="Blob 2"
                  description="Color of the second animated blob."
                  value={themeColors.blobs.blob2}
                  onChange={(v) => updateThemeColor("blobs", "blob2", v)}
                />
                <ColorInput
                  label="Blob 3"
                  description="Color of the third animated blob."
                  value={themeColors.blobs.blob3}
                  onChange={(v) => updateThemeColor("blobs", "blob3", v)}
                />
              </>
            )}
            {portalTheme === "gradient_wave" && (
              <>
                <ColorInput
                  label="Start"
                  description="Starting color of the gradient wave."
                  value={themeColors.gradient_wave.start}
                  onChange={(v) =>
                    updateThemeColor("gradient_wave", "start", v)
                  }
                />
                <ColorInput
                  label="Middle"
                  description="Middle color of the gradient wave."
                  value={themeColors.gradient_wave.middle}
                  onChange={(v) =>
                    updateThemeColor("gradient_wave", "middle", v)
                  }
                />
                <ColorInput
                  label="End"
                  description="Ending color of the gradient wave."
                  value={themeColors.gradient_wave.end}
                  onChange={(v) => updateThemeColor("gradient_wave", "end", v)}
                />
              </>
            )}
            {portalTheme === "basic" && (
              <ColorInput
                label="Background"
                description="Solid background color for the portal."
                value={themeColors.basic.background}
                onChange={(v) => updateThemeColor("basic", "background", v)}
              />
            )}
          </div>
        </div>

        <hr className="border-[var(--gray-5)]" />

        {/* Corner Style */}
        <div>
          <Heading size="3" className="mb-2">
            Button & Input Corners
          </Heading>
          <Text as="p" size="1" color="gray" className="mb-4">
            Controls the border radius of buttons, form inputs, tabs, and other
            interactive elements on the portal.
          </Text>
          <div className="grid grid-cols-3 gap-3">
            {(
              [
                {
                  value: "square" as const,
                  label: "Square",
                  preview: "rounded-none",
                },
                {
                  value: "rounded" as const,
                  label: "Rounded",
                  preview: "rounded-lg",
                },
                {
                  value: "pill" as const,
                  label: "Pill",
                  preview: "rounded-full",
                },
              ] as const
            ).map((s) => (
              <button
                key={s.value}
                onClick={() => setCornerStyle(s.value)}
                disabled={isLocked("corner_style")}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  cornerStyle === s.value
                    ? "border-[var(--accent-9)] bg-[var(--accent-2)]"
                    : "border-[var(--gray-6)] hover:border-[var(--accent-7)]"
                } ${isLocked("corner_style") ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <div className="text-sm font-medium mb-2">{s.label}</div>
                <div
                  className={`h-8 w-full ${s.preview} border-2 border-[var(--gray-7)]`}
                  style={{
                    backgroundColor: settings.primary_color + "30",
                  }}
                />
              </button>
            ))}
          </div>
        </div>

        <hr className="border-[var(--gray-5)]" />

        {/* Fonts */}
        <div>
          <Heading size="3" className="mb-2">
            Fonts
          </Heading>
          <Text as="p" size="1" color="gray" className="mb-4">
            Enter the name of any{" "}
            <a
              href="https://fonts.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              Google Font
            </a>
            . The font will be loaded automatically on the portal.
          </Text>
          <div className="space-y-4">
            <div className={`space-y-1.5 ${isLocked("font_heading") ? "opacity-60" : ""}`}>
              <Text as="label" size="2" weight="medium" className="flex items-center gap-1.5">
                Heading Font
                {isLocked("font_heading") && <Lock className="h-3 w-3 text-[var(--gray-9)]" />}
              </Text>
              <div className="flex items-center gap-3">
                <input
                  value={settings.font_heading}
                  onChange={(e) =>
                    updateSetting("font_heading", e.target.value)
                  }
                  disabled={isLocked("font_heading")}
                  placeholder="Poppins"
                  className="flex-1 rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-sm disabled:cursor-not-allowed"
                />
                <input
                  value={settings.font_heading_weight}
                  onChange={(e) =>
                    updateSetting("font_heading_weight", e.target.value)
                  }
                  disabled={isLocked("font_heading_weight")}
                  placeholder="600"
                  className="w-24 rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-center font-mono text-sm disabled:cursor-not-allowed"
                />
              </div>
            </div>
            <div className={`space-y-1.5 ${isLocked("font_body") ? "opacity-60" : ""}`}>
              <Text as="label" size="2" weight="medium" className="flex items-center gap-1.5">
                Body Font
                {isLocked("font_body") && <Lock className="h-3 w-3 text-[var(--gray-9)]" />}
              </Text>
              <div className="flex items-center gap-3">
                <input
                  value={settings.font_body}
                  onChange={(e) => updateSetting("font_body", e.target.value)}
                  disabled={isLocked("font_body")}
                  placeholder="Inter"
                  className="flex-1 rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-sm disabled:cursor-not-allowed"
                />
                <input
                  value={settings.font_body_weight}
                  onChange={(e) =>
                    updateSetting("font_body_weight", e.target.value)
                  }
                  disabled={isLocked("font_body_weight")}
                  placeholder="400"
                  className="w-24 rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-center font-mono text-sm disabled:cursor-not-allowed"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Text as="label" size="2" weight="medium">
                Body Text Size
              </Text>
              <div className="flex items-center gap-3">
                <select
                  value={settings.body_text_size}
                  onChange={(e) =>
                    updateSetting("body_text_size", e.target.value)
                  }
                  className="rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-sm"
                >
                  <option value="12">12px — Small</option>
                  <option value="14">14px — Compact</option>
                  <option value="16">16px — Default</option>
                  <option value="18">18px — Large</option>
                  <option value="20">20px — Extra Large</option>
                </select>
                <span
                  className="text-sm text-[var(--gray-9)]"
                  style={{ fontSize: `${settings.body_text_size}px` }}
                >
                  Preview text
                </span>
              </div>
            </div>
          </div>
        </div>

        <hr className="border-[var(--gray-5)]" />

        {/* Preview */}
        <div>
          <Text as="label" size="2" weight="medium" className="mb-2 block">
            Preview
          </Text>
          <div
            className="relative h-24 overflow-hidden rounded-lg border border-[var(--gray-6)]"
            style={{
              fontFamily: [
                settings.font_heading,
                settings.font_body,
                "ui-sans-serif",
                "system-ui",
                "sans-serif",
              ]
                .filter(Boolean)
                .join(", "),
              background:
                portalTheme === "blobs"
                  ? `radial-gradient(ellipse 100% 100% at 100% 100%, ${themeColors.blobs.blob1} 0%, transparent 80%),
                     radial-gradient(ellipse 80% 80% at 0% 0%, ${themeColors.blobs.blob2} 0%, transparent 70%),
                     linear-gradient(135deg, ${themeColors.blobs.background} 0%, ${themeColors.blobs.blob3} 100%),
                     ${themeColors.blobs.background}`
                  : portalTheme === "gradient_wave"
                    ? `linear-gradient(135deg, ${themeColors.gradient_wave.start} 0%, ${themeColors.gradient_wave.middle} 50%, ${themeColors.gradient_wave.end} 100%)`
                    : themeColors.basic.background,
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="rounded-md px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: settings.primary_color }}
              >
                {settings.app_name || "Sample Button"}
              </div>
            </div>
          </div>
        </div>

            <hr className="border-[var(--gray-5)]" />

            {/* Save */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={!hasChanges || saving}
                variant="solid"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                  </>
                ) : saved ? (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Saved
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
              {hasChanges && !saving && !saveError && (
                <Text size="1" color="gray">
                  You have unsaved changes
                </Text>
              )}
              {saveError && (
                <Text size="1" color="red">
                  Error: {saveError}
                </Text>
              )}
            </div>
            {saved && (
              <div className="flex items-center gap-2 rounded-md bg-[var(--accent-2)] border border-[var(--accent-6)] px-3 py-2">
                <Info className="h-4 w-4 shrink-0 text-[var(--accent-9)]" />
                <Text size="1" color="gray">
                  Changes may take up to a minute to appear on the portal.
                </Text>
              </div>
            )}
          </div>
        </RadixTabs.Content>

        {/* ── Event Types Tab ── */}
        <RadixTabs.Content value="event-types">
          <div className="space-y-6">
            <div>
              <Heading size="3" className="mb-2">
                Event Types
              </Heading>
              <Text as="p" size="2" color="gray" className="mb-4">
                Define the types of events you manage. These appear as filter
                options on your portal and in the event type dropdown when
                creating or editing events. You can add up to 6.
              </Text>
              <EventTypesEditor
                value={eventTypes}
                onChange={setEventTypes}
              />
            </div>

            <hr className="border-[var(--gray-5)]" />

            {/* Save */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={!hasChanges || saving}
                variant="solid"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                  </>
                ) : saved ? (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Saved
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
              {hasChanges && !saving && !saveError && (
                <Text size="1" color="gray">
                  You have unsaved changes
                </Text>
              )}
              {saveError && (
                <Text size="1" color="red">
                  Error: {saveError}
                </Text>
              )}
            </div>
            {saved && (
              <div className="flex items-center gap-2 rounded-md bg-[var(--accent-2)] border border-[var(--accent-6)] px-3 py-2">
                <Info className="h-4 w-4 shrink-0 text-[var(--accent-9)]" />
                <Text size="1" color="gray">
                  Changes may take up to a minute to appear on the portal.
                </Text>
              </div>
            )}
          </div>
        </RadixTabs.Content>

        {/* ── Categories Tab ── */}
        <RadixTabs.Content value="categories">
          <div className="space-y-6">
            <div>
              <Heading size="3" className="mb-2">
                Content Categories
              </Heading>
              <Text as="p" size="2" color="gray" className="mb-4">
                Define categories for your content (events, blogs, etc.).
                The order determines priority — category #1 is the most
                important and its content will be featured first on the portal.
                Use the arrows to reorder.
              </Text>
              <ContentCategoriesEditor
                value={contentCategories}
                onChange={setContentCategories}
              />
            </div>

            <hr className="border-[var(--gray-5)]" />

            {/* Save */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={!hasChanges || saving}
                variant="solid"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                  </>
                ) : saved ? (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Saved
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
              {hasChanges && !saving && !saveError && (
                <Text size="1" color="gray">
                  You have unsaved changes
                </Text>
              )}
              {saveError && (
                <Text size="1" color="red">
                  Error: {saveError}
                </Text>
              )}
            </div>
            {saved && (
              <div className="flex items-center gap-2 rounded-md bg-[var(--accent-2)] border border-[var(--accent-6)] px-3 py-2">
                <Info className="h-4 w-4 shrink-0 text-[var(--accent-9)]" />
                <Text size="1" color="gray">
                  Changes may take up to a minute to appear on the portal.
                </Text>
              </div>
            )}
          </div>
        </RadixTabs.Content>

        {/* ── Tracking Tab ── */}
        <RadixTabs.Content value="tracking">
          <div className="space-y-6">
            <div>
              <Heading size="3" className="mb-2">
                Tracking & Analytics
              </Heading>
              <Text as="p" size="1" color="gray" className="mb-4">
                Paste tracking scripts from any analytics platform (Google Tag
                Manager, Segment, Plausible, etc.). These are injected into the
                public event portal.
              </Text>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Text as="label" size="2" weight="medium">
                    Head tracking code
                  </Text>
                  <Text as="p" size="1" color="gray">
                    Injected into {"<head>"}. Use for GTM, Segment, or any script
                    that should load early.
                  </Text>
                  <textarea
                    value={settings.tracking_head}
                    onChange={(e) =>
                      updateSetting("tracking_head", e.target.value)
                    }
                    placeholder={
                      "<!-- Google Tag Manager -->\n<script>...</script>"
                    }
                    rows={6}
                    className="w-full rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Text as="label" size="2" weight="medium">
                    Body tracking code
                  </Text>
                  <Text as="p" size="1" color="gray">
                    Injected before {"</body>"}. Use for pixels, chat widgets, or
                    scripts that should load last.
                  </Text>
                  <textarea
                    value={settings.tracking_body}
                    onChange={(e) =>
                      updateSetting("tracking_body", e.target.value)
                    }
                    placeholder={
                      "<!-- GTM noscript -->\n<noscript>...</noscript>"
                    }
                    rows={6}
                    className="w-full rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 font-mono text-xs"
                  />
                </div>
              </div>
            </div>

            <hr className="border-[var(--gray-5)]" />

            {/* Save */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleSave}
                disabled={!hasChanges || saving}
                variant="solid"
              >
                {saving ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
                  </>
                ) : saved ? (
                  <>
                    <Check className="mr-2 h-4 w-4" /> Saved
                  </>
                ) : (
                  "Save Changes"
                )}
              </Button>
              {hasChanges && !saving && !saveError && (
                <Text size="1" color="gray">
                  You have unsaved changes
                </Text>
              )}
              {saveError && (
                <Text size="1" color="red">
                  Error: {saveError}
                </Text>
              )}
            </div>
            {saved && (
              <div className="flex items-center gap-2 rounded-md bg-[var(--accent-2)] border border-[var(--accent-6)] px-3 py-2">
                <Info className="h-4 w-4 shrink-0 text-[var(--accent-9)]" />
                <Text size="1" color="gray">
                  Changes may take up to a minute to appear on the portal.
                </Text>
              </div>
            )}
          </div>
        </RadixTabs.Content>

        {/* ── Pages Tab ── */}
        <RadixTabs.Content value="pages">
          <LegalPagesContent />
        </RadixTabs.Content>
      </RadixTabs.Root>
    </Card>
  );
}

// ── LegalPagesContent ─────────────────────────────────────────────

const LEGAL_KEYS = [
  "privacy_policy_html",
  "terms_of_service_html",
  "do_not_sell_html",
] as const;
type LegalKey = (typeof LEGAL_KEYS)[number];

const TAB_LABELS: Record<LegalKey, string> = {
  privacy_policy_html: "Privacy Policy",
  terms_of_service_html: "Terms of Service",
  do_not_sell_html: "Do Not Sell",
};

function LegalPagesContent() {
  const [content, setContent] = useState<Record<LegalKey, string>>({
    privacy_policy_html: "",
    terms_of_service_html: "",
    do_not_sell_html: "",
  });
  const [original, setOriginal] = useState<Record<LegalKey, string>>({
    privacy_policy_html: "",
    terms_of_service_html: "",
    do_not_sell_html: "",
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [activeTab, setActiveTab] = useState<string>("privacy_policy_html");

  const loadContent = useCallback(async () => {
    const { data } = await supabase
      .from("platform_settings")
      .select("key, value")
      .in("key", [...LEGAL_KEYS]);

    if (data) {
      const loaded = { ...content };
      for (const row of data) {
        if (row.key in loaded) {
          (loaded as Record<string, string>)[row.key] = row.value;
        }
      }
      setContent(loaded);
      setOriginal(loaded);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadContent();
  }, [loadContent]);

  const hasChanges = JSON.stringify(content) !== JSON.stringify(original);

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setSaveError(null);

    try {
      const changedEntries = LEGAL_KEYS.filter(
        (k) => content[k] !== original[k]
      );
      const rows = changedEntries.map((key) => ({ key, value: content[key] }));
      const { error } = await Promise.race([
        supabase.from("platform_settings").upsert(rows, { onConflict: "key" }),
        new Promise<{ error: { message: string }; data: null }>((resolve) =>
          setTimeout(
            () =>
              resolve({
                error: { message: "Save timed out. Please try again." },
                data: null,
              }),
            10000
          )
        ),
      ]);

      if (error) {
        setSaveError(`Failed to save: ${error.message}`);
        return;
      }

      setOriginal({ ...content });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--gray-9)]" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <RadixTabs.Root value={activeTab} onValueChange={setActiveTab}>
        <RadixTabs.List>
          {LEGAL_KEYS.map((key) => (
            <RadixTabs.Trigger key={key} value={key}>
              {TAB_LABELS[key]}
            </RadixTabs.Trigger>
          ))}
        </RadixTabs.List>

        {LEGAL_KEYS.map((key) => (
          <RadixTabs.Content key={key} value={key}>
            <div className="mt-4 rounded-lg border border-[var(--gray-6)]">
              <RichTextEditor
                content={content[key]}
                onChange={(html: string) =>
                  setContent((prev) => ({ ...prev, [key]: html }))
                }
                placeholder={`Enter your ${TAB_LABELS[key]} content here...`}
              />
            </div>
            <Text as="p" size="1" color="gray" className="mt-2">
              This content will be displayed on a dark background on the portal.
              Text colors will be automatically inverted.
            </Text>
          </RadixTabs.Content>
        ))}
      </RadixTabs.Root>

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          variant="solid"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
            </>
          ) : saved ? (
            <>
              <Check className="mr-2 h-4 w-4" /> Saved
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
        {hasChanges && !saving && !saveError && (
          <Text size="1" color="gray">
            You have unsaved changes
          </Text>
        )}
        {saveError && (
          <Text size="1" color="red">
            Error: {saveError}
          </Text>
        )}
      </div>
    </div>
  );
}

// ── People Attributes Card ─────────────────────────────────────────

function PeopleAttributesCard() {
  const [attributes, setAttributes] =
    useState<PeopleAttributeConfig[]>(DEFAULT_PEOPLE_ATTRIBUTES);
  const [originalAttributes, setOriginalAttributes] =
    useState<PeopleAttributeConfig[]>(DEFAULT_PEOPLE_ATTRIBUTES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savingRef = useRef(false);

  const loadAttributes = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("platform_settings")
        .select("value")
        .eq("key", "people_attributes")
        .maybeSingle();

      if (!error && data?.value) {
        const parsed = JSON.parse(data.value);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAttributes(parsed);
          setOriginalAttributes(parsed);
        }
      }
    } catch {
      // use defaults
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAttributes();
  }, [loadAttributes]);

  const hasChanges =
    JSON.stringify(attributes) !== JSON.stringify(originalAttributes);

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setSaveError(null);

    try {
      const { error } = await savePeopleAttributes(
        attributes.filter((a) => a.key && a.label)
      );
      if (error) {
        setSaveError(`Failed to save: ${error}`);
        return;
      }
      setOriginalAttributes(attributes);
      setSaved(true);
      setTimeout(() => setSaved(false), 5000);
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "An unexpected error occurred"
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card size="4">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-5 w-5" />
          <Heading size="4">People Attributes</Heading>
        </div>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--gray-9)]" />
        </div>
      </Card>
    );
  }

  return (
    <Card size="4">
      <div className="flex items-center gap-2 mb-2">
        <Users className="h-5 w-5" />
        <Heading size="4">People Attributes</Heading>
      </div>
      <Text as="p" size="2" color="gray" className="mb-8">
        Configure which attributes are collected when someone registers for an
        event. Toggle attributes on or off and mark them as required for
        registration.
      </Text>

      <PeopleAttributesEditor value={attributes} onChange={setAttributes} />

      <hr className="border-[var(--gray-5)] my-6" />

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={!hasChanges || saving}
          variant="solid"
        >
          {saving ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...
            </>
          ) : saved ? (
            <>
              <Check className="mr-2 h-4 w-4" /> Saved
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
        {hasChanges && !saving && !saveError && (
          <Text size="1" color="gray">
            You have unsaved changes
          </Text>
        )}
        {saveError && (
          <Text size="1" color="red">
            Error: {saveError}
          </Text>
        )}
      </div>
      {saved && (
        <div className="mt-4 flex items-center gap-2 rounded-md bg-[var(--accent-2)] border border-[var(--accent-6)] px-3 py-2">
          <Info className="h-4 w-4 shrink-0 text-[var(--accent-9)]" />
          <Text size="1" color="gray">
            Registration forms will use these settings for future events.
          </Text>
        </div>
      )}
    </Card>
  );
}

// ── Main Page Component ────────────────────────────────────────────

export default function Branding() {
  const [topTab, setTopTab] = useState("portal");

  return (
    <Page title="Settings">
      <div className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
            Settings
          </h1>
          <p className="text-[var(--gray-11)] mt-1">
            Configure your platform settings
          </p>
        </div>

        <RadixTabs.Root value={topTab} onValueChange={setTopTab}>
          <RadixTabs.List className="mb-6">
            <RadixTabs.Trigger value="portal">
              <Palette className="mr-1.5 h-4 w-4 inline-block" />
              Portal Settings
            </RadixTabs.Trigger>
            <RadixTabs.Trigger value="people">
              <Users className="mr-1.5 h-4 w-4 inline-block" />
              People Attributes
            </RadixTabs.Trigger>
          </RadixTabs.List>

          <RadixTabs.Content value="portal">
            <div className="space-y-6">
              <BrandingCard />
            </div>
          </RadixTabs.Content>

          <RadixTabs.Content value="people">
            <div className="space-y-6">
              <PeopleAttributesCard />
            </div>
          </RadixTabs.Content>
        </RadixTabs.Root>
      </div>
    </Page>
  );
}
