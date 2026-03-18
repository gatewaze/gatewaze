import { useState, useEffect, useCallback, useRef } from 'react';
import { Sun, Moon, Monitor, Palette, Upload, Loader2, Check } from 'lucide-react';
import { useTheme } from '@/app/contexts/theme/ThemeProvider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { getSupabase } from '@/lib/supabase';
import { LegalPagesCard } from './LegalPagesCard';

type PortalTheme = 'blobs' | 'gradient_wave' | 'basic';
type CornerStyle = 'square' | 'rounded' | 'pill';

interface ThemeColorsMap {
  blobs: { background: string; blob1: string; blob2: string; blob3: string };
  gradient_wave: { start: string; middle: string; end: string };
  basic: { background: string };
}

const DEFAULT_THEME_COLORS: ThemeColorsMap = {
  blobs: { background: '#0d1218', blob1: '#ca2b7f', blob2: '#4086c6', blob3: '#1e2837' },
  gradient_wave: { start: '#ca2b7f', middle: '#4086c6', end: '#0d1218' },
  basic: { background: '#0d1218' },
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
  app_name: 'Gatewaze',
  primary_color: '#6366f1',
  secondary_color: '#0d1218',
  tertiary_color: '#1e2837',
  font_heading: 'Poppins',
  font_heading_weight: '600',
  font_body: 'Inter',
  font_body_weight: '400',
  body_text_size: '16',
  logo_url: '',
  logo_icon_url: '',
  favicon_url: '',
  contact_email: '',
  tracking_head: '',
  tracking_body: '',
};

function ColorInput({ label, description, value, onChange }: {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex items-center gap-3">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 cursor-pointer rounded border border-input bg-transparent p-1"
        />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#000000"
          className="max-w-[140px] font-mono text-sm"
        />
        <div className="h-10 flex-1 rounded border border-input bg-white p-0.5">
          <div
            className="h-full w-full rounded-sm"
            style={{ backgroundColor: value }}
          />
        </div>
      </div>
    </div>
  );
}

function LogoUploadField({ label, description, value, settingKey, onChange }: {
  label: string;
  description: string;
  value: string;
  settingKey: string;
  onChange: (value: string) => void;
}) {
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const supabase = getSupabase();
      const ext = file.name.split('.').pop();
      const filePath = `branding/${settingKey}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('media')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('media')
        .getPublicUrl(filePath);

      onChange(publicUrl);
    } catch (err) {
      console.error('Upload failed:', err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex items-center gap-3">
        {value && (
          <div className="flex h-12 w-24 items-center justify-center rounded border border-input bg-muted/30 p-1">
            <img src={value} alt={label} className="max-h-full max-w-full object-contain" />
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild disabled={uploading}>
            <label className="cursor-pointer">
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              {uploading ? 'Uploading...' : 'Upload'}
              <input type="file" accept="image/*" className="hidden" onChange={handleUpload} />
            </label>
          </Button>
          {value && (
            <Button variant="ghost" size="sm" onClick={() => onChange('')}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {value && (
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://..."
          className="text-xs font-mono"
        />
      )}
    </div>
  );
}

function BrandingCard() {
  const [settings, setSettings] = useState<BrandingSettings>(BRANDING_DEFAULTS);
  const [originalSettings, setOriginalSettings] = useState<BrandingSettings>(BRANDING_DEFAULTS);
  const [portalTheme, setPortalTheme] = useState<PortalTheme>('blobs');
  const [originalPortalTheme, setOriginalPortalTheme] = useState<PortalTheme>('blobs');
  const [themeColors, setThemeColors] = useState<ThemeColorsMap>(DEFAULT_THEME_COLORS);
  const [originalThemeColors, setOriginalThemeColors] = useState<ThemeColorsMap>(DEFAULT_THEME_COLORS);
  const [cornerStyle, setCornerStyle] = useState<CornerStyle>('rounded');
  const [originalCornerStyle, setOriginalCornerStyle] = useState<CornerStyle>('rounded');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);

  const loadSettings = useCallback(async () => {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', [...Object.keys(BRANDING_DEFAULTS), 'portal_theme', 'theme_colors', 'corner_style']);

    if (data) {
      const loaded = { ...BRANDING_DEFAULTS };
      let loadedTheme: PortalTheme = 'blobs';
      let loadedColors: ThemeColorsMap = { ...DEFAULT_THEME_COLORS };
      let loadedCornerStyle: CornerStyle = 'rounded';

      for (const row of data) {
        if (row.key === 'portal_theme') {
          if (row.value === 'blobs' || row.value === 'gradient_wave' || row.value === 'basic') {
            loadedTheme = row.value;
          }
        } else if (row.key === 'corner_style') {
          if (row.value === 'square' || row.value === 'rounded' || row.value === 'pill') {
            loadedCornerStyle = row.value;
          }
        } else if (row.key === 'theme_colors') {
          try {
            const parsed = JSON.parse(row.value);
            // Merge parsed colors into the appropriate theme slot
            if (parsed.blob1 !== undefined) loadedColors.blobs = { ...DEFAULT_THEME_COLORS.blobs, ...parsed };
            else if (parsed.start !== undefined) loadedColors.gradient_wave = { ...DEFAULT_THEME_COLORS.gradient_wave, ...parsed };
            else if (parsed.background !== undefined && !parsed.blob1) loadedColors.basic = { ...DEFAULT_THEME_COLORS.basic, ...parsed };
            // Store all theme colors if they were saved as a full map
            if (parsed.blobs) loadedColors.blobs = { ...DEFAULT_THEME_COLORS.blobs, ...parsed.blobs };
            if (parsed.gradient_wave) loadedColors.gradient_wave = { ...DEFAULT_THEME_COLORS.gradient_wave, ...parsed.gradient_wave };
            if (parsed.basic) loadedColors.basic = { ...DEFAULT_THEME_COLORS.basic, ...parsed.basic };
          } catch { /* use defaults */ }
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
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadSettings(); }, [loadSettings]);

  const hasChanges = JSON.stringify(settings) !== JSON.stringify(originalSettings)
    || portalTheme !== originalPortalTheme
    || JSON.stringify(themeColors) !== JSON.stringify(originalThemeColors)
    || cornerStyle !== originalCornerStyle;

  const [saveError, setSaveError] = useState<string | null>(null);

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const supabase = getSupabase();

      // Build all key-value pairs to upsert
      const allSettings: Record<string, string> = { ...settings };
      allSettings.portal_theme = portalTheme;
      allSettings.corner_style = cornerStyle;
      // Save only the active theme's colors as the theme_colors value,
      // but also persist the full map so switching themes preserves colors
      allSettings.theme_colors = JSON.stringify(themeColors);

      // Batch upsert all settings in a single request with a timeout
      const rows = Object.entries(allSettings).map(([key, value]) => ({ key, value }));
      const { error } = await Promise.race([
        supabase.from('app_settings').upsert(rows, { onConflict: 'key' }),
        new Promise<{ error: { message: string }; data: null }>(resolve =>
          setTimeout(() => resolve({ error: { message: 'Save timed out. Please try again.' }, data: null }), 10000)
        ),
      ]);

      if (error) {
        console.error('Failed to save settings:', error);
        setSaveError(`Failed to save settings: ${error.message}`);
        return;
      }

      setOriginalSettings(settings);
      setOriginalPortalTheme(portalTheme);
      setOriginalThemeColors(themeColors);
      setOriginalCornerStyle(cornerStyle);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Failed to save branding:', err);
      setSaveError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const updateSetting = (key: keyof BrandingSettings, value: string) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const updateThemeColor = <T extends PortalTheme>(theme: T, key: keyof ThemeColorsMap[T], value: string) => {
    setThemeColors(prev => ({
      ...prev,
      [theme]: { ...prev[theme], [key]: value },
    }));
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Branding
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="h-5 w-5" />
          Branding
        </CardTitle>
        <CardDescription>
          Configure your event portal's name, colors, and logos. Changes are reflected on the public portal.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* App Name */}
        <div className="space-y-2">
          <Label>App Name</Label>
          <p className="text-xs text-muted-foreground">
            Displayed in the portal header, page titles, and emails.
          </p>
          <Input
            value={settings.app_name}
            onChange={(e) => updateSetting('app_name', e.target.value)}
            placeholder="My Events Platform"
          />
        </div>

        {/* Contact Email */}
        <div className="space-y-2">
          <Label>Contact Email</Label>
          <p className="text-xs text-muted-foreground">
            Shown on privacy, terms, and legal pages. If empty, defaults to the first admin user's email.
          </p>
          <Input
            type="email"
            value={settings.contact_email}
            onChange={(e) => updateSetting('contact_email', e.target.value)}
            placeholder="privacy@example.com"
          />
        </div>

        <Separator />

        {/* Brand Colors */}
        <div>
          <h4 className="mb-4 text-sm font-medium">Brand Colors</h4>
          <div className="space-y-4">
            <ColorInput
              label="Primary Color"
              description="Used for buttons, links, form focus borders, and accent elements across the portal."
              value={settings.primary_color}
              onChange={(v) => updateSetting('primary_color', v)}
            />
            <ColorInput
              label="Secondary Color"
              description="Fallback background color used when the theme background is unavailable."
              value={settings.secondary_color}
              onChange={(v) => updateSetting('secondary_color', v)}
            />
          </div>
        </div>

        <Separator />

        {/* Portal Theme */}
        <div>
          <h4 className="mb-4 text-sm font-medium">Portal Background Theme</h4>
          <p className="mb-4 text-xs text-muted-foreground">
            Choose the background style for your event portal. Each theme has its own color settings.
          </p>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {([
              { value: 'blobs' as const, label: 'Blobs', desc: 'Animated floating blobs' },
              { value: 'gradient_wave' as const, label: 'Gradient Wave', desc: 'Smooth animated gradient' },
              { value: 'basic' as const, label: 'Basic', desc: 'Solid background color' },
            ]).map((t) => (
              <button
                key={t.value}
                onClick={() => setPortalTheme(t.value)}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  portalTheme === t.value
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:border-primary/50'
                }`}
              >
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-xs text-muted-foreground">{t.desc}</div>
              </button>
            ))}
          </div>

          {/* Theme-specific colors */}
          <div className="space-y-4">
            {portalTheme === 'blobs' && (
              <>
                <ColorInput
                  label="Background"
                  description="Base background color behind the animated blobs."
                  value={themeColors.blobs.background}
                  onChange={(v) => updateThemeColor('blobs', 'background', v)}
                />
                <ColorInput
                  label="Blob 1"
                  description="Color of the first animated blob."
                  value={themeColors.blobs.blob1}
                  onChange={(v) => updateThemeColor('blobs', 'blob1', v)}
                />
                <ColorInput
                  label="Blob 2"
                  description="Color of the second animated blob."
                  value={themeColors.blobs.blob2}
                  onChange={(v) => updateThemeColor('blobs', 'blob2', v)}
                />
                <ColorInput
                  label="Blob 3"
                  description="Color of the third animated blob."
                  value={themeColors.blobs.blob3}
                  onChange={(v) => updateThemeColor('blobs', 'blob3', v)}
                />
              </>
            )}
            {portalTheme === 'gradient_wave' && (
              <>
                <ColorInput
                  label="Start"
                  description="Starting color of the gradient wave."
                  value={themeColors.gradient_wave.start}
                  onChange={(v) => updateThemeColor('gradient_wave', 'start', v)}
                />
                <ColorInput
                  label="Middle"
                  description="Middle color of the gradient wave."
                  value={themeColors.gradient_wave.middle}
                  onChange={(v) => updateThemeColor('gradient_wave', 'middle', v)}
                />
                <ColorInput
                  label="End"
                  description="Ending color of the gradient wave."
                  value={themeColors.gradient_wave.end}
                  onChange={(v) => updateThemeColor('gradient_wave', 'end', v)}
                />
              </>
            )}
            {portalTheme === 'basic' && (
              <ColorInput
                label="Background"
                description="Solid background color for the portal."
                value={themeColors.basic.background}
                onChange={(v) => updateThemeColor('basic', 'background', v)}
              />
            )}
          </div>
        </div>

        <Separator />

        {/* Corner Style */}
        <div>
          <h4 className="mb-4 text-sm font-medium">Button & Input Corners</h4>
          <p className="mb-4 text-xs text-muted-foreground">
            Controls the border radius of buttons, form inputs, tabs, and other interactive elements on the portal.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {([
              { value: 'square' as const, label: 'Square', preview: 'rounded-none' },
              { value: 'rounded' as const, label: 'Rounded', preview: 'rounded-lg' },
              { value: 'pill' as const, label: 'Pill', preview: 'rounded-full' },
            ]).map((s) => (
              <button
                key={s.value}
                onClick={() => setCornerStyle(s.value)}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  cornerStyle === s.value
                    ? 'border-primary bg-primary/5'
                    : 'border-input hover:border-primary/50'
                }`}
              >
                <div className="text-sm font-medium mb-2">{s.label}</div>
                <div
                  className={`h-8 w-full ${s.preview} border-2 border-muted-foreground/30`}
                  style={{ backgroundColor: settings.primary_color + '30' }}
                />
              </button>
            ))}
          </div>
        </div>

        <Separator />

        {/* Fonts */}
        <div>
          <h4 className="mb-4 text-sm font-medium">Fonts</h4>
          <p className="mb-4 text-xs text-muted-foreground">
            Enter the name of any <a href="https://fonts.google.com" target="_blank" rel="noopener noreferrer" className="underline">Google Font</a>. The font will be loaded automatically on the portal.
          </p>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Heading Font</Label>
              <p className="text-xs text-muted-foreground">Primary font used for headings and UI text.</p>
              <div className="flex items-center gap-3">
                <Input
                  value={settings.font_heading}
                  onChange={(e) => updateSetting('font_heading', e.target.value)}
                  placeholder="Poppins"
                  className="flex-1"
                />
                <div className="w-24">
                  <Input
                    value={settings.font_heading_weight}
                    onChange={(e) => updateSetting('font_heading_weight', e.target.value)}
                    placeholder="600"
                    className="text-center font-mono text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Weight: 100 (thin) to 900 (black). This weight is loaded from Google Fonts.</p>
            </div>
            <div className="space-y-2">
              <Label>Body Font</Label>
              <p className="text-xs text-muted-foreground">Secondary font used as a fallback.</p>
              <div className="flex items-center gap-3">
                <Input
                  value={settings.font_body}
                  onChange={(e) => updateSetting('font_body', e.target.value)}
                  placeholder="Inter"
                  className="flex-1"
                />
                <div className="w-24">
                  <Input
                    value={settings.font_body_weight}
                    onChange={(e) => updateSetting('font_body_weight', e.target.value)}
                    placeholder="400"
                    className="text-center font-mono text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">Weight: 100 (thin) to 900 (black). This weight is loaded from Google Fonts.</p>
            </div>
            <div className="space-y-2">
              <Label>Body Text Size</Label>
              <p className="text-xs text-muted-foreground">Base text size in pixels. All other sizes (headings, small text) scale proportionally.</p>
              <div className="flex items-center gap-3">
                <select
                  value={settings.body_text_size}
                  onChange={(e) => updateSetting('body_text_size', e.target.value)}
                  className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="12">12px — Small</option>
                  <option value="14">14px — Compact</option>
                  <option value="16">16px — Default</option>
                  <option value="18">18px — Large</option>
                  <option value="20">20px — Extra Large</option>
                </select>
                <span className="text-sm text-muted-foreground" style={{ fontSize: `${settings.body_text_size}px` }}>
                  Preview text
                </span>
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Preview */}
        <div>
          <Label className="mb-2 block">Preview</Label>
          <div
            className="relative h-24 overflow-hidden rounded-lg border border-input"
            style={{
              fontFamily: [settings.font_heading, settings.font_body, 'ui-sans-serif', 'system-ui', 'sans-serif'].filter(Boolean).join(', '),
              background: portalTheme === 'blobs'
                ? `radial-gradient(ellipse 100% 100% at 100% 100%, ${themeColors.blobs.blob1} 0%, transparent 80%),
                   radial-gradient(ellipse 80% 80% at 0% 0%, ${themeColors.blobs.blob2} 0%, transparent 70%),
                   linear-gradient(135deg, ${themeColors.blobs.background} 0%, ${themeColors.blobs.blob3} 100%),
                   ${themeColors.blobs.background}`
                : portalTheme === 'gradient_wave'
                ? `linear-gradient(135deg, ${themeColors.gradient_wave.start} 0%, ${themeColors.gradient_wave.middle} 50%, ${themeColors.gradient_wave.end} 100%)`
                : themeColors.basic.background,
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div
                className="rounded-md px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: settings.primary_color }}
              >
                {settings.app_name || 'Sample Button'}
              </div>
            </div>
          </div>
        </div>

        <Separator />

        {/* Logos */}
        <div>
          <h4 className="mb-4 text-sm font-medium">Logos</h4>
          <div className="space-y-4">
            <LogoUploadField
              label="Full Logo"
              description="Shown in the portal header on the homepage. Recommended: SVG or PNG, max height 40px."
              value={settings.logo_url}
              settingKey="logo"
              onChange={(v) => updateSetting('logo_url', v)}
            />
            <LogoUploadField
              label="Logo Icon"
              description="Compact icon shown on event pages. Recommended: square SVG or PNG, 32×32px."
              value={settings.logo_icon_url}
              settingKey="logo_icon"
              onChange={(v) => updateSetting('logo_icon_url', v)}
            />
            <LogoUploadField
              label="Favicon"
              description="Browser tab icon. Recommended: .ico or 32×32 PNG."
              value={settings.favicon_url}
              settingKey="favicon"
              onChange={(v) => updateSetting('favicon_url', v)}
            />
          </div>
        </div>

        <Separator />

        {/* Tracking Code */}
        <div>
          <h4 className="mb-4 text-sm font-medium">Tracking & Analytics</h4>
          <p className="mb-4 text-xs text-muted-foreground">
            Paste tracking scripts from any analytics platform (Google Tag Manager, Segment, Plausible, etc.).
            These are injected into the public event portal.
          </p>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Head tracking code</Label>
              <p className="text-xs text-muted-foreground">
                Injected into {'<head>'}. Use for GTM, Segment, or any script that should load early.
              </p>
              <textarea
                value={settings.tracking_head}
                onChange={(e) => updateSetting('tracking_head', e.target.value)}
                placeholder={'<!-- Google Tag Manager -->\n<script>...</script>'}
                rows={6}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
            <div className="space-y-2">
              <Label>Body tracking code</Label>
              <p className="text-xs text-muted-foreground">
                Injected before {'</body>'}. Use for pixels, chat widgets, or scripts that should load last.
              </p>
              <textarea
                value={settings.tracking_body}
                onChange={(e) => updateSetting('tracking_body', e.target.value)}
                placeholder={'<!-- GTM noscript -->\n<noscript>...</noscript>'}
                rows={6}
                className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Save */}
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={!hasChanges || saving}>
            {saving ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving...</>
            ) : saved ? (
              <><Check className="mr-2 h-4 w-4" /> Saved</>
            ) : (
              'Save Changes'
            )}
          </Button>
          {hasChanges && !saving && !saveError && (
            <span className="text-xs text-muted-foreground">You have unsaved changes</span>
          )}
          {saveError && (
            <span className="text-xs text-red-500">Error: {saveError}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">Manage your admin panel preferences.</p>
      </div>

      {/* Branding */}
      <BrandingCard />

      <Separator />

      {/* Legal Pages */}
      <LegalPagesCard />

      <Separator />

      {/* Admin Appearance */}
      <Card>
        <CardHeader>
          <CardTitle>Admin Appearance</CardTitle>
          <CardDescription>
            Customize the look of the admin panel. Currently using{' '}
            <span className="font-medium">{resolvedTheme}</span> mode.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <Label>Theme</Label>
            <div className="grid grid-cols-3 gap-4">
              <Button
                variant={theme === 'light' ? 'default' : 'outline'}
                className="flex flex-col items-center gap-2 py-6"
                onClick={() => setTheme('light')}
              >
                <Sun className="h-6 w-6" />
                <span className="text-sm">Light</span>
              </Button>
              <Button
                variant={theme === 'dark' ? 'default' : 'outline'}
                className="flex flex-col items-center gap-2 py-6"
                onClick={() => setTheme('dark')}
              >
                <Moon className="h-6 w-6" />
                <span className="text-sm">Dark</span>
              </Button>
              <Button
                variant={theme === 'system' ? 'default' : 'outline'}
                className="flex flex-col items-center gap-2 py-6"
                onClick={() => setTheme('system')}
              >
                <Monitor className="h-6 w-6" />
                <span className="text-sm">System</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
