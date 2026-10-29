/**
 * A custom domain's own look (custom_domains.theme).
 *
 * Tokens only: colours, two font families, a logo, a corner radius and
 * whether the page is light or dark. The middleware reads the row,
 * checks the shape here and hands it to the layout in a header; the
 * layout turns it into CSS variables on <html>, a solid background and
 * a Google Fonts link. A page served on the domain reads the variables
 * (`--cd-*`) and falls back to its own defaults where a token is unset.
 *
 * No raw CSS and no URLs other than https: the row is written by admins
 * through the custom-domains module, but what reaches the page must be
 * a value we can vouch for whatever was written.
 */

export type ThemeMode = 'dark' | 'light'
export type ThemeRadius = 'sharp' | 'soft' | 'round'

export interface CustomDomainTheme {
  mode?: ThemeMode
  colors?: {
    background?: string
    surface?: string
    text?: string
    muted?: string
    primary?: string
    primaryText?: string
    border?: string
  }
  fonts?: {
    heading?: string
    body?: string
  }
  logoUrl?: string
  radius?: ThemeRadius
}

const HEX = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/
/** A Google Fonts family name as typed by a person: letters, digits, spaces, plus and hyphen. No quote of either kind, since the name is emitted inside one. */
const FONT = /^[A-Za-z0-9][A-Za-z0-9 +-]{0,60}$/
const COLOR_KEYS = ['background', 'surface', 'text', 'muted', 'primary', 'primaryText', 'border'] as const
const RADIUS: Record<ThemeRadius, string> = { sharp: '2px', soft: '10px', round: '22px' }

function httpsUrl(v: unknown): string | undefined {
  // A backslash survives URL serialisation in a query or fragment and would end the CSS url("…") early.
  if (typeof v !== 'string' || v.length > 500 || v.includes('\\')) return undefined
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.toString() : undefined
  } catch {
    return undefined
  }
}

/** The theme as stored, or null when there is nothing usable in it. Unknown or malformed fields are dropped, never passed on. */
export function parseCustomDomainTheme(raw: unknown): CustomDomainTheme | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const out: CustomDomainTheme = {}
  if (r.mode === 'dark' || r.mode === 'light') out.mode = r.mode
  if (r.colors && typeof r.colors === 'object' && !Array.isArray(r.colors)) {
    const c = r.colors as Record<string, unknown>
    const colors: NonNullable<CustomDomainTheme['colors']> = {}
    for (const k of COLOR_KEYS) if (typeof c[k] === 'string' && HEX.test(c[k] as string)) colors[k] = (c[k] as string).toLowerCase()
    if (Object.keys(colors).length) out.colors = colors
  }
  if (r.fonts && typeof r.fonts === 'object' && !Array.isArray(r.fonts)) {
    const f = r.fonts as Record<string, unknown>
    const fonts: NonNullable<CustomDomainTheme['fonts']> = {}
    for (const k of ['heading', 'body'] as const) if (typeof f[k] === 'string' && FONT.test((f[k] as string).trim())) fonts[k] = (f[k] as string).trim()
    if (Object.keys(fonts).length) out.fonts = fonts
  }
  const logo = httpsUrl(r.logoUrl)
  if (logo) out.logoUrl = logo
  if (r.radius === 'sharp' || r.radius === 'soft' || r.radius === 'round') out.radius = r.radius
  return Object.keys(out).length ? out : null
}

// Headers carry ASCII, the theme carries JSON: base64url in between, with
// only Web APIs so the same code runs in the edge middleware and in Node.
function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): string | null {
  try {
    const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export function encodeThemeHeader(theme: CustomDomainTheme): string {
  return toBase64Url(JSON.stringify(theme))
}

/** The theme the middleware forwarded, re-checked: a header is still input. */
export function decodeThemeHeader(header: string | null | undefined): CustomDomainTheme | null {
  if (!header || header.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(header)) return null
  const json = fromBase64Url(header)
  if (!json) return null
  try {
    return parseCustomDomainTheme(JSON.parse(json))
  } catch {
    return null
  }
}

/**
 * The CSS variables a theme sets on <html>. The `--cd-*` names are what a
 * page on the domain reads; the portal's own variables are overridden
 * alongside so the shared pieces (sign-in, legal pages) follow the look.
 */
export function themeCssVariables(theme: CustomDomainTheme): Record<string, string> {
  const vars: Record<string, string> = {}
  const c = theme.colors ?? {}
  if (c.background) vars['--cd-bg'] = c.background
  if (c.surface) vars['--cd-surface'] = c.surface
  if (c.text) vars['--cd-text'] = c.text
  if (c.muted) vars['--cd-muted'] = c.muted
  if (c.border) vars['--cd-border'] = c.border
  if (c.primary) {
    vars['--cd-primary'] = c.primary
    vars['--primary-color'] = c.primary
    vars['--pb-accent'] = c.primary
  }
  if (c.primaryText) {
    vars['--cd-primary-text'] = c.primaryText
    vars['--primary-text'] = c.primaryText
  }
  // Quoted, so a name with digits or spaces ("Source Sans 3") is one family to CSS.
  if (theme.fonts?.heading) {
    vars['--cd-font-heading'] = `"${theme.fonts.heading}", ui-sans-serif, system-ui, sans-serif`
    vars['--font-display'] = vars['--cd-font-heading']
  }
  if (theme.fonts?.body) {
    vars['--cd-font-body'] = `"${theme.fonts.body}", ui-sans-serif, system-ui, sans-serif`
    vars['--font-sans'] = vars['--cd-font-body']
  }
  if (theme.radius) vars['--cd-radius'] = RADIUS[theme.radius]
  if (theme.logoUrl) vars['--cd-logo'] = `url("${theme.logoUrl}")`
  return vars
}

/** One Google Fonts stylesheet for the theme's families, or null when it names none. */
export function themeFontsUrl(theme: CustomDomainTheme): string | null {
  const names = [...new Set([theme.fonts?.heading, theme.fonts?.body].filter((v): v is string => Boolean(v)))]
  if (names.length === 0) return null
  const families = names.map((n) => `family=${encodeURIComponent(n).replace(/%20/g, '+')}:wght@400;500;600;700`)
  return `https://fonts.googleapis.com/css2?${families.join('&')}&display=swap`
}
