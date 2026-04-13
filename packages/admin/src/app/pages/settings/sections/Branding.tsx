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
import { useThemeContext } from "@/app/contexts/theme/context";
import { colors as colorPalettes } from "@/constants/colors";
import type { PrimaryColor } from "@/configs/@types/theme";

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
import {
  GradientWaveEditor,
  DEFAULT_GRADIENT_WAVE_CONFIG,
  type GradientWaveConfig,
} from "@/components/shared/branding/GradientWaveEditor";
import { PortalNavEditor, type PortalNavOverrides } from "@/components/shared/branding/PortalNavEditor";

// ── BrandingCard ───────────────────────────────────────────────────

const RADIX_ACCENTS: { name: PrimaryColor; hex: string }[] = [
  { name: "red", hex: "#e5484d" },
  { name: "crimson", hex: "#e93d82" },
  { name: "pink", hex: "#d6409f" },
  { name: "plum", hex: "#ab4aba" },
  { name: "purple", hex: "#8e4ec6" },
  { name: "violet", hex: "#6e56cf" },
  { name: "indigo", hex: "#3e63dd" },
  { name: "blue", hex: "#3b82f6" },
  { name: "cyan", hex: "#00a2c7" },
  { name: "teal", hex: "#12a594" },
  { name: "green", hex: "#22c55e" },
  { name: "amber", hex: "#f59e0b" },
  { name: "orange", hex: "#f76b15" },
  { name: "rose", hex: "#f43f5e" },
];

function BrandingCard({ section }: { section: "system" | "admin" | "portal" }) {
  const activeTheme = useActiveThemeModule();
  const lockedSettings = activeTheme?.themeOverrides.lockedSettings ?? [];
  const { isFeatureEnabled } = useModulesContext();
  const hasEvents = isFeatureEnabled('events');
  const isLocked = (key: string) => lockedSettings.includes(key);
  const { setPrimaryColorScheme } = useThemeContext();

  const [settings, setSettings] =
    useState<BrandingSettings>(BRANDING_DEFAULTS);
  const [originalSettings, setOriginalSettings] =
    useState<BrandingSettings>(BRANDING_DEFAULTS);
  const [portalTheme, setPortalTheme] = useState<PortalTheme>("gradient_wave");
  const [originalPortalTheme, setOriginalPortalTheme] =
    useState<PortalTheme>("gradient_wave");
  const [themeColors, setThemeColors] =
    useState<ThemeColorsMap>(DEFAULT_THEME_COLORS);
  const [originalThemeColors, setOriginalThemeColors] =
    useState<ThemeColorsMap>(DEFAULT_THEME_COLORS);
  const [adminAccentColor, setAdminAccentColor] = useState<PrimaryColor>("cyan");
  const [originalAdminAccentColor, setOriginalAdminAccentColor] = useState<PrimaryColor>("cyan");
  const [portalUiMode, setPortalUiMode] = useState<"frost" | "smoke" | "obsidian" | "paper">("smoke");
  const [originalPortalUiMode, setOriginalPortalUiMode] = useState<"frost" | "smoke" | "obsidian" | "paper">("smoke");
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
  const [gradientWaveConfig, setGradientWaveConfig] =
    useState<GradientWaveConfig>(DEFAULT_GRADIENT_WAVE_CONFIG);
  const [originalGradientWaveConfig, setOriginalGradientWaveConfig] =
    useState<GradientWaveConfig>(DEFAULT_GRADIENT_WAVE_CONFIG);
  const [portalNavOverrides, setPortalNavOverrides] = useState<PortalNavOverrides>({ items: [] });
  const [originalPortalNavOverrides, setOriginalPortalNavOverrides] = useState<PortalNavOverrides>({ items: [] });
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
        "gradient_wave_config",
        "portal_ui_mode",
        "admin_accent_color",
        "portal_nav_overrides",
      ]);

    if (data) {
      const loaded = { ...BRANDING_DEFAULTS };
      let loadedTheme: PortalTheme = "gradient_wave";
      let loadedColors: ThemeColorsMap = { ...DEFAULT_THEME_COLORS };
      let loadedAdminAccentColor: PrimaryColor = "cyan";
      let loadedPortalNavOverrides: PortalNavOverrides = { items: [] };
      let loadedPortalUiMode: "frost" | "smoke" | "obsidian" | "paper" = "smoke";
      let loadedCornerStyle: CornerStyle = "rounded";
      let loadedEventTypes: EventTypeOption[] = DEFAULT_EVENT_TYPES;
      let loadedContentCategories: ContentCategoryOption[] = [];
      let loadedPeopleAttributes: PeopleAttributeConfig[] = DEFAULT_PEOPLE_ATTRIBUTES;
      let loadedGradientWaveConfig: GradientWaveConfig = { ...DEFAULT_GRADIENT_WAVE_CONFIG };

      for (const row of data) {
        if (row.key === "portal_theme") {
          if (row.value === "gradient_wave" || row.value === "basic")
            loadedTheme = row.value;
          // Legacy: treat "blobs" as gradient_wave
          else if (row.value === "blobs")
            loadedTheme = "gradient_wave";
        } else if (row.key === "portal_nav_overrides") {
          try {
            const parsed = JSON.parse(row.value);
            if (parsed && Array.isArray(parsed.items)) loadedPortalNavOverrides = parsed;
          } catch { /* use defaults */ }
        } else if (row.key === "admin_accent_color") {
          const val = row.value as PrimaryColor;
          if (RADIX_ACCENTS.some((a) => a.name === val)) loadedAdminAccentColor = val;
        } else if (row.key === "portal_ui_mode") {
          if (row.value === "frost" || row.value === "smoke" || row.value === "obsidian" || row.value === "paper")
            loadedPortalUiMode = row.value;
          else if (row.value === "dark" || row.value === "auto")
            loadedPortalUiMode = "smoke";
          else if (row.value === "light")
            loadedPortalUiMode = "paper";
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
        } else if (row.key === "gradient_wave_config") {
          try {
            const parsed = JSON.parse(row.value);
            loadedGradientWaveConfig = { ...DEFAULT_GRADIENT_WAVE_CONFIG, ...parsed };
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
      setAdminAccentColor(loadedAdminAccentColor);
      setOriginalAdminAccentColor(loadedAdminAccentColor);
      setPortalUiMode(loadedPortalUiMode);
      setOriginalPortalUiMode(loadedPortalUiMode);
      setCornerStyle(loadedCornerStyle);
      setOriginalCornerStyle(loadedCornerStyle);
      setEventTypes(loadedEventTypes);
      setOriginalEventTypes(loadedEventTypes);
      setContentCategories(loadedContentCategories);
      setOriginalContentCategories(loadedContentCategories);
      setPeopleAttributes(loadedPeopleAttributes);
      setOriginalPeopleAttributes(loadedPeopleAttributes);
      setGradientWaveConfig(loadedGradientWaveConfig);
      setOriginalGradientWaveConfig(loadedGradientWaveConfig);
      setPortalNavOverrides(loadedPortalNavOverrides);
      setOriginalPortalNavOverrides(loadedPortalNavOverrides);
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
    adminAccentColor !== originalAdminAccentColor ||
    portalUiMode !== originalPortalUiMode ||
    cornerStyle !== originalCornerStyle ||
    JSON.stringify(eventTypes) !== JSON.stringify(originalEventTypes) ||
    JSON.stringify(contentCategories) !== JSON.stringify(originalContentCategories) ||
    JSON.stringify(peopleAttributes) !== JSON.stringify(originalPeopleAttributes) ||
    JSON.stringify(gradientWaveConfig) !== JSON.stringify(originalGradientWaveConfig) ||
    JSON.stringify(portalNavOverrides) !== JSON.stringify(originalPortalNavOverrides);

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const allSettings: Record<string, string> = { ...settings };
      allSettings.portal_theme = portalTheme;
      allSettings.admin_accent_color = adminAccentColor;
      allSettings.portal_ui_mode = portalUiMode;
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
      allSettings.gradient_wave_config = JSON.stringify(gradientWaveConfig);
      allSettings.portal_nav_overrides = JSON.stringify(portalNavOverrides);
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
      setOriginalAdminAccentColor(adminAccentColor);
      setOriginalPortalUiMode(portalUiMode);
      setOriginalCornerStyle(cornerStyle);
      setOriginalEventTypes(eventTypes);
      setOriginalContentCategories(contentCategories);
      setOriginalPeopleAttributes(peopleAttributes);
      setOriginalGradientWaveConfig(gradientWaveConfig);
      setOriginalPortalNavOverrides(portalNavOverrides);
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

      {/* ══════════════ SYSTEM SECTION ══════════════ */}
      {section === "system" && (
      <RadixTabs.Root value={settingsTab} onValueChange={setSettingsTab}>
        <RadixTabs.List className="mb-6">
          <RadixTabs.Trigger value="branding">Branding</RadixTabs.Trigger>
          <RadixTabs.Trigger value="people-attributes">People</RadixTabs.Trigger>
          {hasEvents && <RadixTabs.Trigger value="event-types">Event Types</RadixTabs.Trigger>}
          <RadixTabs.Trigger value="categories">Categories</RadixTabs.Trigger>
          <RadixTabs.Trigger value="tracking">Tracking</RadixTabs.Trigger>
        </RadixTabs.List>

        {/* ── Branding Tab ── */}
        <RadixTabs.Content value="branding">
          <div className="space-y-6">
            {/* App Name */}
            <div>
              <Text as="label" size="2" weight="medium">
                App Name
              </Text>
              <Text as="p" size="1" color="gray" className="pb-2">
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
            <div>
              <Text as="label" size="2" weight="medium">
                Contact Email
              </Text>
              <Text as="p" size="1" color="gray" className="pb-2">
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
              <Heading size="3" className="pb-1">
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

        {/* ── People Attributes Tab ── */}
        <RadixTabs.Content value="people-attributes">
          <div className="space-y-6">
            <PeopleAttributesEditor
              value={peopleAttributes}
              onChange={setPeopleAttributes}
            />

            <hr className="border-[var(--gray-5)]" />

            {/* Save */}
            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={!hasChanges || saving} variant="solid">
                {saving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>) : saved ? (<><Check className="mr-2 h-4 w-4" /> Saved</>) : "Save Changes"}
              </Button>
              {hasChanges && !saving && !saveError && (<Text size="1" color="gray">You have unsaved changes</Text>)}
              {saveError && (<Text size="1" color="red">Error: {saveError}</Text>)}
            </div>
          </div>
        </RadixTabs.Content>

        {/* ── Event Types Tab ── */}
        <RadixTabs.Content value="event-types">
          <div className="space-y-6">
            <div>
              <Heading size="3" className="pb-1">
                Event Types
              </Heading>
              <Text as="p" size="1" color="gray" className="pb-4">
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
              <Heading size="3" className="pb-1">
                Content Categories
              </Heading>
              <Text as="p" size="1" color="gray" className="pb-4">
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
              <Heading size="3" className="pb-1">
                Tracking & Analytics
              </Heading>
              <Text as="p" size="1" color="gray" className="pb-4">
                Paste tracking scripts from any analytics platform (Google Tag
                Manager, Segment, Plausible, etc.). These are injected into the
                public event portal.
              </Text>
              <div className="space-y-4">
                <div>
                  <Text as="label" size="2" weight="medium">
                    Head tracking code
                  </Text>
                  <Text as="p" size="1" color="gray" className="pb-2">
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
                <div>
                  <Text as="label" size="2" weight="medium">
                    Body tracking code
                  </Text>
                  <Text as="p" size="1" color="gray" className="pb-2">
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

      </RadixTabs.Root>
      )}

      {/* ══════════════ ADMIN SECTION ══════════════ */}
      {section === "admin" && (
        <div className="space-y-6">
          <Heading size="3" className="pb-1">
            Admin Accent Color
          </Heading>
          <Text as="p" size="1" color="gray" className="pb-4">
            Accent color used throughout the admin dashboard for buttons, links, and interactive elements.
          </Text>
          <div className="grid grid-cols-7 gap-3">
            {RADIX_ACCENTS.map((accent) => (
              <button
                key={accent.name}
                type="button"
                onClick={() => {
                  setAdminAccentColor(accent.name);
                  setPrimaryColorScheme(accent.name);
                }}
                className={`flex flex-col items-center gap-1.5 rounded-lg p-2 transition-all ${
                  adminAccentColor === accent.name
                    ? "ring-2 ring-offset-2 ring-[var(--accent-9)] bg-[var(--accent-2)]"
                    : "hover:bg-[var(--gray-3)]"
                }`}
              >
                <div
                  className="w-8 h-8 rounded-full border border-black/10"
                  style={{ backgroundColor: accent.hex }}
                />
                <span className="text-[10px] font-medium text-[var(--gray-11)] capitalize">
                  {accent.name}
                </span>
              </button>
            ))}
          </div>

          <hr className="border-[var(--gray-5)]" />

          <div className="flex items-center gap-3">
            <Button onClick={handleSave} disabled={!hasChanges || saving} variant="solid">
              {saving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>) : saved ? (<><Check className="mr-2 h-4 w-4" /> Saved</>) : "Save Changes"}
            </Button>
            {hasChanges && !saving && !saveError && (<Text size="1" color="gray">You have unsaved changes</Text>)}
            {saveError && (<Text size="1" color="red">Error: {saveError}</Text>)}
          </div>
        </div>
      )}

      {/* ══════════════ PORTAL SECTION ══════════════ */}
      {section === "portal" && (
      <RadixTabs.Root value={settingsTab === "branding" ? "theme" : settingsTab} onValueChange={setSettingsTab}>
        <RadixTabs.List className="mb-6">
          <RadixTabs.Trigger value="theme">Theme</RadixTabs.Trigger>
          <RadixTabs.Trigger value="navigation">Navigation</RadixTabs.Trigger>
          <RadixTabs.Trigger value="fonts">Fonts</RadixTabs.Trigger>
          <RadixTabs.Trigger value="pages">Pages</RadixTabs.Trigger>
        </RadixTabs.List>

        <RadixTabs.Content value="theme">
          <div className="space-y-6">
            <GradientWaveEditor
              config={gradientWaveConfig}
              onChange={setGradientWaveConfig}
              colors={themeColors.gradient_wave}
              onColorsChange={(c) =>
                setThemeColors((prev) => ({
                  ...prev,
                  gradient_wave: c,
                }))
              }
              uiMode={portalUiMode}
              onUiModeChange={setPortalUiMode}
              accentColor={settings.primary_color}
              onAccentColorChange={(v) => updateSetting("primary_color", v)}
              cornerStyle={cornerStyle}
              onCornerStyleChange={setCornerStyle}
            />

            <hr className="border-[var(--gray-5)]" />

            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={!hasChanges || saving} variant="solid">
                {saving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>) : saved ? (<><Check className="mr-2 h-4 w-4" /> Saved</>) : "Save Changes"}
              </Button>
              {hasChanges && !saving && !saveError && (<Text size="1" color="gray">You have unsaved changes</Text>)}
              {saveError && (<Text size="1" color="red">Error: {saveError}</Text>)}
            </div>
            {saved && (
              <div className="flex items-center gap-2 rounded-md bg-[var(--accent-2)] border border-[var(--accent-6)] px-3 py-2">
                <Info className="h-4 w-4 shrink-0 text-[var(--accent-9)]" />
                <Text size="1" color="gray">Changes may take up to a minute to appear on the portal.</Text>
              </div>
            )}
          </div>
        </RadixTabs.Content>

        <RadixTabs.Content value="navigation">
          <div className="space-y-6">
            <PortalNavEditor
              value={portalNavOverrides}
              onChange={setPortalNavOverrides}
            />

            <hr className="border-[var(--gray-5)]" />

            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={!hasChanges || saving} variant="solid">
                {saving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>) : saved ? (<><Check className="mr-2 h-4 w-4" /> Saved</>) : "Save Changes"}
              </Button>
              {hasChanges && !saving && !saveError && (<Text size="1" color="gray">You have unsaved changes</Text>)}
              {saveError && (<Text size="1" color="red">Error: {saveError}</Text>)}
            </div>
          </div>
        </RadixTabs.Content>

        <RadixTabs.Content value="fonts">
          <div className="space-y-6">
            <div>
              <Heading size="3" className="pb-1">Fonts</Heading>
              <Text as="p" size="1" color="gray" className="pb-4">
                Enter the name of any{" "}
                <a href="https://fonts.google.com" target="_blank" rel="noopener noreferrer" className="underline">Google Font</a>.
                The font will be loaded automatically on the portal.
              </Text>
              <div className="space-y-4">
                <div className={`space-y-1.5 ${isLocked("font_heading") ? "opacity-60" : ""}`}>
                  <Text as="label" size="2" weight="medium" className="flex items-center gap-1.5">
                    Heading Font
                    {isLocked("font_heading") && <Lock className="h-3 w-3 text-[var(--gray-9)]" />}
                  </Text>
                  <div className="flex items-center gap-3">
                    <input value={settings.font_heading} onChange={(e) => updateSetting("font_heading", e.target.value)} disabled={isLocked("font_heading")} placeholder="Poppins" className="flex-1 rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-sm disabled:cursor-not-allowed" />
                    <input value={settings.font_heading_weight} onChange={(e) => updateSetting("font_heading_weight", e.target.value)} disabled={isLocked("font_heading_weight")} placeholder="600" className="w-24 rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-center font-mono text-sm disabled:cursor-not-allowed" />
                  </div>
                </div>
                <div className={`space-y-1.5 ${isLocked("font_body") ? "opacity-60" : ""}`}>
                  <Text as="label" size="2" weight="medium" className="flex items-center gap-1.5">
                    Body Font
                    {isLocked("font_body") && <Lock className="h-3 w-3 text-[var(--gray-9)]" />}
                  </Text>
                  <div className="flex items-center gap-3">
                    <input value={settings.font_body} onChange={(e) => updateSetting("font_body", e.target.value)} disabled={isLocked("font_body")} placeholder="Inter" className="flex-1 rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-sm disabled:cursor-not-allowed" />
                    <input value={settings.font_body_weight} onChange={(e) => updateSetting("font_body_weight", e.target.value)} disabled={isLocked("font_body_weight")} placeholder="400" className="w-24 rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-center font-mono text-sm disabled:cursor-not-allowed" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Text as="label" size="2" weight="medium">Body Text Size</Text>
                  <div className="flex items-center gap-3">
                    <select value={settings.body_text_size} onChange={(e) => updateSetting("body_text_size", e.target.value)} className="rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-3 py-2 text-sm">
                      <option value="12">12px — Small</option>
                      <option value="14">14px — Compact</option>
                      <option value="16">16px — Default</option>
                      <option value="18">18px — Large</option>
                      <option value="20">20px — Extra Large</option>
                    </select>
                    <span className="text-sm text-[var(--gray-9)]" style={{ fontSize: `${settings.body_text_size}px` }}>Preview text</span>
                  </div>
                </div>
              </div>
            </div>

            <hr className="border-[var(--gray-5)]" />

            <div className="flex items-center gap-3">
              <Button onClick={handleSave} disabled={!hasChanges || saving} variant="solid">
                {saving ? (<><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>) : saved ? (<><Check className="mr-2 h-4 w-4" /> Saved</>) : "Save Changes"}
              </Button>
              {hasChanges && !saving && !saveError && (<Text size="1" color="gray">You have unsaved changes</Text>)}
              {saveError && (<Text size="1" color="red">Error: {saveError}</Text>)}
            </div>
          </div>
        </RadixTabs.Content>

        <RadixTabs.Content value="pages">
          <LegalPagesContent />
        </RadixTabs.Content>
      </RadixTabs.Root>
      )}
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
      <Text as="p" size="2" color="gray" className="pb-4">
        Configure which attributes are collected when someone registers for an
        event. Toggle attributes on or off and mark them as required for
        registration.
      </Text>

      <PeopleAttributesEditor value={attributes} onChange={setAttributes} />

      <hr className="border-[var(--gray-5)]" />

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
  const [topTab, setTopTab] = useState("system");

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
            <RadixTabs.Trigger value="system">System</RadixTabs.Trigger>
            <RadixTabs.Trigger value="admin">Admin</RadixTabs.Trigger>
            <RadixTabs.Trigger value="portal">Portal</RadixTabs.Trigger>
          </RadixTabs.List>

          <RadixTabs.Content value="system">
            <BrandingCard section="system" />
          </RadixTabs.Content>

          <RadixTabs.Content value="admin">
            <BrandingCard section="admin" />
          </RadixTabs.Content>

          <RadixTabs.Content value="portal">
            <BrandingCard section="portal" />
          </RadixTabs.Content>
        </RadixTabs.Root>
      </div>
    </Page>
  );
}
