/**
 * Brand Configuration
 *
 * Database-driven config: branding is stored in the `app_settings` table
 * (key-value store) in the instance's own Supabase database.
 *
 * For server components, use getServerBrand() and getServerBrandConfig().
 * For client components, use getClientBrand() and getClientBrandConfig().
 */

import { createClient } from '@supabase/supabase-js'

export type PortalTheme = 'blobs' | 'gradient_wave' | 'basic'

export interface BlobsThemeColors {
  background: string
  blob1: string
  blob2: string
  blob3: string
}

export interface GradientWaveThemeColors {
  start: string
  middle: string
  end: string
}

export interface BasicThemeColors {
  background: string
}

export type ThemeColors = BlobsThemeColors | GradientWaveThemeColors | BasicThemeColors

export const DEFAULT_THEME_COLORS: Record<PortalTheme, ThemeColors> = {
  blobs: { background: '#0a0a0a', blob1: '#00a2c7', blob2: '#0e7490', blob3: '#1a1a1a' },
  gradient_wave: { start: '#00a2c7', middle: '#0e7490', end: '#0a0a0a' },
  basic: { background: '#0a0a0a' },
}

export interface GradientWaveConfig {
  type: 'plane' | 'sphere' | 'waterPlane'
  uStrength: number
  uDensity: number
  uAmplitude: number
  uFrequency: number
  pixelDensity: number
  grain: 'on' | 'off'
  lightType: '3d' | 'env'
  envPreset: 'city' | 'dawn' | 'lobby'
  brightness: number
  reflection: number
  animate: 'on' | 'off'
  uSpeed: number
  uTime: number
  cameraZoom: number
  cAzimuthAngle: number
  cPolarAngle: number
  cDistance: number
  fov: number
  positionX: number
  positionY: number
  positionZ: number
  rotationX: number
  rotationY: number
  rotationZ: number
  fallbackColor: string
  glassOpacity: number
  glassBlur: number
  glassBorderOpacity: number
  glowEffects: boolean
}

export const DEFAULT_GRADIENT_WAVE_CONFIG: GradientWaveConfig = {
  type: 'plane',
  uStrength: 1.5,
  uDensity: 1.3,
  uAmplitude: 0.5,
  uFrequency: 4.5,
  pixelDensity: 1,
  grain: 'off',
  lightType: '3d',
  envPreset: 'city',
  brightness: 1.2,
  reflection: 0.1,
  animate: 'on',
  uSpeed: 0.2,
  uTime: 0,
  cameraZoom: 1,
  cAzimuthAngle: 180,
  cPolarAngle: 90,
  cDistance: 3.6,
  fov: 45,
  positionX: -1.4,
  positionY: 0,
  positionZ: 0,
  rotationX: 0,
  rotationY: 10,
  rotationZ: 50,
  fallbackColor: '#0a0a0a',
  glassOpacity: 0.05,
  glassBlur: 4,
  glassBorderOpacity: 0.1,
  glowEffects: true,
}

export type CornerStyle = 'square' | 'rounded' | 'pill'

export interface EventTypeOption {
  value: string
  label: string
}

export interface ContentCategoryOption {
  value: string
  label: string
}

export const DEFAULT_EVENT_TYPES: EventTypeOption[] = [
  { value: 'conference', label: 'Conference' },
  { value: 'workshop', label: 'Workshop' },
  { value: 'meetup', label: 'Meetup' },
  { value: 'webinar', label: 'Webinar' },
  { value: 'hackathon', label: 'Hackathon' },
]

export interface BrandConfig {
  id: string
  name: string
  supabaseUrl: string
  supabaseAnonKey: string
  primaryColor: string
  secondaryColor: string
  tertiaryColor: string
  portalTheme: PortalTheme
  themeColors: ThemeColors
  cornerStyle: CornerStyle
  fontHeading: string
  fontHeadingWeight: string
  fontBody: string
  fontBodyWeight: string
  bodyTextSize: string
  logoUrl: string
  logoIconUrl: string
  faviconUrl: string
  domain: string
  contactEmail: string
  trackingHead: string
  trackingBody: string
  eventTypes: EventTypeOption[]
  contentCategories: ContentCategoryOption[]
  eventTopicsEnabled: boolean
  gradientWaveConfig: GradientWaveConfig
  portalUiMode: 'auto' | 'dark' | 'light'
}

// ---------------------------------------------------------------------------
// In-memory cache (60-second TTL)
// ---------------------------------------------------------------------------

let cachedConfig: BrandConfig | null = null
let cacheTimestamp = 0
const CACHE_TTL_MS = 60_000

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const defaults: BrandConfig = {
  id: process.env.INSTANCE_NAME || 'gatewaze',
  name: 'Gatewaze',
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
  primaryColor: '#00a2c7',
  secondaryColor: '#0a0a0a',
  tertiaryColor: '#1a1a1a',
  portalTheme: 'gradient_wave',
  themeColors: { ...DEFAULT_THEME_COLORS.gradient_wave },
  cornerStyle: 'rounded' as CornerStyle,
  fontHeading: 'Poppins',
  fontHeadingWeight: '600',
  fontBody: 'Inter',
  fontBodyWeight: '400',
  bodyTextSize: '16',
  logoUrl: '',
  logoIconUrl: '',
  faviconUrl: '',
  domain: '',
  contactEmail: '',
  trackingHead: '',
  trackingBody: '',
  eventTypes: DEFAULT_EVENT_TYPES,
  contentCategories: [],
  eventTopicsEnabled: false,
  gradientWaveConfig: { ...DEFAULT_GRADIENT_WAVE_CONFIG },
  portalUiMode: 'auto' as const,
}

// Mapping from app_settings keys to BrandConfig fields + defaults
const settingsMap: Record<string, { field: keyof BrandConfig; defaultValue: string }> = {
  app_name: { field: 'name', defaultValue: defaults.name },
  primary_color: { field: 'primaryColor', defaultValue: defaults.primaryColor },
  secondary_color: { field: 'secondaryColor', defaultValue: defaults.secondaryColor },
  tertiary_color: { field: 'tertiaryColor', defaultValue: defaults.tertiaryColor },
  font_heading: { field: 'fontHeading', defaultValue: defaults.fontHeading },
  font_heading_weight: { field: 'fontHeadingWeight', defaultValue: defaults.fontHeadingWeight },
  font_body: { field: 'fontBody', defaultValue: defaults.fontBody },
  font_body_weight: { field: 'fontBodyWeight', defaultValue: defaults.fontBodyWeight },
  body_text_size: { field: 'bodyTextSize', defaultValue: defaults.bodyTextSize },
  logo_url: { field: 'logoUrl', defaultValue: defaults.logoUrl },
  logo_icon_url: { field: 'logoIconUrl', defaultValue: defaults.logoIconUrl },
  favicon_url: { field: 'faviconUrl', defaultValue: defaults.faviconUrl },
  domain: { field: 'domain', defaultValue: defaults.domain },
  contact_email: { field: 'contactEmail', defaultValue: defaults.contactEmail },
  tracking_head: { field: 'trackingHead', defaultValue: defaults.trackingHead },
  tracking_body: { field: 'trackingBody', defaultValue: defaults.trackingBody },
}

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

/**
 * Server-side brand detection.
 * Returns the instance name (single-instance model).
 */
export async function getServerBrand(): Promise<string> {
  return process.env.INSTANCE_NAME || 'gatewaze'
}

/**
 * Get brand config for server components.
 * Fetches branding from the `app_settings` table with a 60-second cache.
 */
export async function getServerBrandConfig(): Promise<BrandConfig> {
  const now = Date.now()
  if (cachedConfig && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedConfig
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('[brand] Missing Supabase env vars — returning defaults')
    cachedConfig = { ...defaults }
    cacheTimestamp = now
    return cachedConfig
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { fetch: (url, options = {}) => fetch(url, { ...options, cache: 'no-store' }) },
    })
    const { data, error } = await supabase.from('platform_settings').select('key, value')

    if (error) {
      console.warn('[brand] Failed to fetch app_settings:', error.message)
      cachedConfig = { ...defaults }
      cacheTimestamp = now
      return cachedConfig
    }

    const config: BrandConfig = { ...defaults }

    if (data) {
      const kvMap = new Map(data.map((row: { key: string; value: string }) => [row.key, row.value]))

      for (const [settingsKey, { field, defaultValue }] of Object.entries(settingsMap)) {
        const value = kvMap.get(settingsKey)
        ;(config as unknown as Record<string, unknown>)[field] = value ?? defaultValue
      }

      // Parse theme settings
      const themeValue = kvMap.get('portal_theme')
      if (themeValue === 'gradient_wave' || themeValue === 'basic') {
        config.portalTheme = themeValue
      } else if (themeValue === 'blobs') {
        // Legacy: blobs removed, fall back to gradient_wave
        config.portalTheme = 'gradient_wave'
      }

      const cornerValue = kvMap.get('corner_style')
      if (cornerValue && (cornerValue === 'square' || cornerValue === 'rounded' || cornerValue === 'pill')) {
        config.cornerStyle = cornerValue
      }

      const themeColorsValue = kvMap.get('theme_colors')
      if (themeColorsValue) {
        try {
          const parsed = JSON.parse(themeColorsValue)
          // Admin saves the full map { blobs: {...}, gradient_wave: {...}, basic: {...} }
          // Extract the active theme's colors
          if (parsed[config.portalTheme]) {
            config.themeColors = { ...DEFAULT_THEME_COLORS[config.portalTheme], ...parsed[config.portalTheme] }
          } else {
            // Might be stored as flat theme colors (e.g. { blob1: '...', blob2: '...' })
            config.themeColors = { ...DEFAULT_THEME_COLORS[config.portalTheme], ...parsed }
          }
        } catch {
          config.themeColors = { ...DEFAULT_THEME_COLORS[config.portalTheme] }
        }
      } else {
        config.themeColors = { ...DEFAULT_THEME_COLORS[config.portalTheme] }
      }

      // Parse portal UI mode
      const uiModeValue = kvMap.get('portal_ui_mode')
      if (uiModeValue === 'dark' || uiModeValue === 'light' || uiModeValue === 'auto') {
        config.portalUiMode = uiModeValue
      }

      // Parse gradient wave config
      const gwcValue = kvMap.get('gradient_wave_config')
      if (gwcValue) {
        try {
          const parsed = JSON.parse(gwcValue)
          config.gradientWaveConfig = { ...DEFAULT_GRADIENT_WAVE_CONFIG, ...parsed }
        } catch {
          config.gradientWaveConfig = { ...DEFAULT_GRADIENT_WAVE_CONFIG }
        }
      }

      // Parse event types
      const eventTypesValue = kvMap.get('event_types')
      if (eventTypesValue) {
        try {
          const parsed = JSON.parse(eventTypesValue)
          if (Array.isArray(parsed) && parsed.length > 0) {
            config.eventTypes = parsed
          }
        } catch {
          // use defaults
        }
      }

      // Parse content categories
      const contentCategoriesValue = kvMap.get('content_categories')
      if (contentCategoriesValue) {
        try {
          const parsed = JSON.parse(contentCategoriesValue)
          if (Array.isArray(parsed)) {
            config.contentCategories = parsed
          }
        } catch {
          // no categories
        }
      }

      // Check if event-topics module is enabled
      const { data: topicsModule } = await supabase
        .from('installed_modules')
        .select('status')
        .eq('module_id', 'event-topics')
        .maybeSingle()
      config.eventTopicsEnabled = topicsModule?.status === 'enabled'
    }

    // Apply theme module overrides (if an active theme module exists)
    try {
      const { data: themeModule } = await supabase
        .from('installed_modules')
        .select('config')
        .eq('type', 'theme')
        .eq('status', 'enabled')
        .maybeSingle()

      if (themeModule?.config) {
        const portalOverrides = (themeModule.config as Record<string, unknown>).portalThemeOverrides as {
          brandingDefaults?: Record<string, string>
          portalTheme?: string
          themeColors?: Record<string, Record<string, string>>
          cornerStyle?: string
        } | undefined

        if (portalOverrides) {
          // Apply branding defaults overrides via the settingsMap
          if (portalOverrides.brandingDefaults) {
            for (const [settingsKey, value] of Object.entries(portalOverrides.brandingDefaults)) {
              const mapping = settingsMap[settingsKey]
              if (mapping) {
                ;(config as unknown as Record<string, unknown>)[mapping.field] = value
              }
            }
          }

          // Override portal theme
          if (portalOverrides.portalTheme && ['blobs', 'gradient_wave', 'basic'].includes(portalOverrides.portalTheme)) {
            config.portalTheme = portalOverrides.portalTheme as PortalTheme
          }

          // Override theme colors
          if (portalOverrides.themeColors?.[config.portalTheme]) {
            config.themeColors = {
              ...DEFAULT_THEME_COLORS[config.portalTheme],
              ...portalOverrides.themeColors[config.portalTheme],
            }
          }

          // Override corner style
          if (portalOverrides.cornerStyle && ['square', 'rounded', 'pill'].includes(portalOverrides.cornerStyle)) {
            config.cornerStyle = portalOverrides.cornerStyle as CornerStyle
          }
        }
      }
    } catch {
      // Theme override lookup failed — continue with base config
    }

    // Fall back to first admin user's email if contact_email not set
    if (!config.contactEmail) {
      try {
        const { data: admin } = await supabase
          .from('admin_profiles')
          .select('email')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle()
        if (admin?.email) config.contactEmail = admin.email
      } catch {
        // ignore — contact email is optional
      }
    }

    cachedConfig = config
    cacheTimestamp = now
    return config
  } catch (err) {
    console.warn('[brand] Error fetching app_settings:', err)
    cachedConfig = { ...defaults }
    cacheTimestamp = now
    return cachedConfig
  }
}

// ---------------------------------------------------------------------------
// Client helpers
// ---------------------------------------------------------------------------

/**
 * Client-side brand detection.
 * Reads the id from the injected brand config or falls back to defaults.
 */
export function getClientBrand(): string {
  const config = getClientBrandConfig()
  return config.id
}

/**
 * Get brand config for client components.
 * Reads from a <script id="__brand_config__"> JSON blob injected by the
 * layout, or from the data-brand-config attribute on <html>.
 */
export function getClientBrandConfig(): BrandConfig {
  if (typeof window === 'undefined') {
    // During SSR, return defaults (server components should use getServerBrandConfig)
    return { ...defaults }
  }

  // Try <script id="__brand_config__"> first
  try {
    const scriptEl = document.getElementById('__brand_config__')
    if (scriptEl?.textContent) {
      return JSON.parse(scriptEl.textContent) as BrandConfig
    }
  } catch {
    // ignore parse errors
  }

  // Fall back to data-brand-config attribute on <html>
  try {
    const attr = document.documentElement.dataset.brandConfig
    if (attr) {
      return JSON.parse(attr) as BrandConfig
    }
  } catch {
    // ignore parse errors
  }

  return { ...defaults }
}

// ---------------------------------------------------------------------------
// Font helpers
// ---------------------------------------------------------------------------

/**
 * Build a Google Fonts CSS URL from the brand config's heading and body fonts.
 * Deduplicates if both are the same font.
 */
export function buildGoogleFontsUrl(config: BrandConfig): string {
  // Base weights the UI always needs, plus the configured brand weight for each font
  const baseWeights = [400, 500, 600, 700]

  const fonts: { name: string; weights: string }[] = []
  if (config.fontHeading) {
    const w = new Set(baseWeights)
    if (config.fontHeadingWeight) w.add(Number(config.fontHeadingWeight))
    fonts.push({ name: config.fontHeading, weights: [...w].sort((a, b) => a - b).join(';') })
  }
  if (config.fontBody && config.fontBody !== config.fontHeading) {
    const w = new Set(baseWeights)
    if (config.fontBodyWeight) w.add(Number(config.fontBodyWeight))
    fonts.push({ name: config.fontBody, weights: [...w].sort((a, b) => a - b).join(';') })
  }
  if (fonts.length === 0) return ''
  const params = fonts
    .map((f) => `family=${encodeURIComponent(f.name)}:wght@${f.weights}`)
    .join('&')
  return `https://fonts.googleapis.com/css2?${params}&display=swap`
}

/**
 * Build the CSS font-family string for the page body.
 * Uses the heading font as primary, body font as secondary fallback.
 */
export function buildFontStack(config: BrandConfig): string {
  const fonts: string[] = []
  if (config.fontHeading) fonts.push(config.fontHeading)
  if (config.fontBody && config.fontBody !== config.fontHeading) fonts.push(config.fontBody)
  fonts.push('ui-sans-serif', 'system-ui', 'sans-serif')
  return fonts.join(', ')
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a hex color is "light" (relative luminance > 0.5).
 * Used to decide if text on top of this color should be dark or light.
 */
export function isLightColor(hex: string): boolean {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16) / 255
  const g = parseInt(h.substring(2, 4), 16) / 255
  const b = parseInt(h.substring(4, 6), 16) / 255
  // sRGB relative luminance (ITU-R BT.709)
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.5
}

// ---------------------------------------------------------------------------
// Theme helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the effective theme and colors for an event page.
 * Event-level overrides take precedence over brand defaults.
 * Also supports legacy gradient_color_1/2/3 fields for backward compatibility.
 */
export function resolveEventTheme(
  event: { portal_theme?: string | null; theme_colors?: ThemeColors | null; gradient_color_1?: string | null; gradient_color_2?: string | null; gradient_color_3?: string | null },
  brandConfig: BrandConfig
): { theme: PortalTheme; colors: ThemeColors; primaryColor: string; secondaryColor: string } {
  const theme = (event.portal_theme as PortalTheme) || brandConfig.portalTheme
  let colors: ThemeColors

  if (event.theme_colors) {
    colors = event.theme_colors
  } else if (event.gradient_color_1 || event.gradient_color_2 || event.gradient_color_3) {
    // Map legacy gradient_color_1/2/3 to the active theme's color structure
    const c1 = event.gradient_color_1 || brandConfig.primaryColor
    const c2 = event.gradient_color_2 || brandConfig.secondaryColor
    const c3 = event.gradient_color_3 || '#1a1a1a'

    if (theme === 'gradient_wave') {
      colors = {
        start: c1,
        middle: c2,
        end: c3,
      } as GradientWaveThemeColors
    } else if (theme === 'basic') {
      colors = {
        background: c1,
      } as BasicThemeColors
    } else {
      // Default: blobs theme
      colors = {
        background: (brandConfig.themeColors as BlobsThemeColors).background || '#0a0a0a',
        blob1: c1,
        blob2: c2,
        blob3: c3,
      }
    }
  } else {
    colors = brandConfig.themeColors
  }

  // primaryColor is the portal accent (for buttons, links) — always from brandConfig.
  // secondaryColor is derived from the theme background for contrast decisions.
  const primaryColor = brandConfig.primaryColor
  let secondaryColor = brandConfig.secondaryColor

  if (theme === 'blobs') {
    const c = colors as BlobsThemeColors
    secondaryColor = c.background || brandConfig.secondaryColor
  } else if (theme === 'gradient_wave') {
    const c = colors as GradientWaveThemeColors
    secondaryColor = c.end || brandConfig.secondaryColor
  } else if (theme === 'basic') {
    const c = colors as BasicThemeColors
    secondaryColor = c.background || brandConfig.secondaryColor
  }

  return { theme, colors, primaryColor, secondaryColor }
}

/**
 * Get the background color for a given theme config (used for body/fallback background).
 */
export function getThemeBackgroundColor(theme: PortalTheme, colors: ThemeColors, fallback: string): string {
  if (theme === 'blobs') return (colors as BlobsThemeColors).background || fallback
  if (theme === 'gradient_wave') return (colors as GradientWaveThemeColors).end || fallback
  if (theme === 'basic') return (colors as BasicThemeColors).background || fallback
  return fallback
}

// ---------------------------------------------------------------------------
// Backward-compatible helpers
// ---------------------------------------------------------------------------

/**
 * Get brand config by ID.
 * In the single-instance model this ignores the id and returns the
 * instance's own config from the database.
 */
export async function getBrandConfigById(_id: string): Promise<BrandConfig> {
  return getServerBrandConfig()
}
