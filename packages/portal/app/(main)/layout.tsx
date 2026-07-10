import type { Metadata, Viewport } from 'next'
import { headers, cookies } from 'next/headers'
import { CookieConsentLoader } from '@/components/CookieConsentLoader'
import { DevIndicatorNudge } from '@/components/DevIndicatorNudge'
import { getAppSetting } from '@/lib/appSettings'
import { sanitizeHtml } from '@/lib/sanitize-html'
import { CardGlowClock } from '@/components/CardGlowClock'
import { TrackingProvider } from '@/components/TrackingProvider'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}
import { getEnabledModules, isModuleEnabled } from '@/lib/modules/enabledModules'
import { GlowProvider } from '@/components/ui/GlowContext'
import { WhiteLabelHeader } from '@/components/WhiteLabelHeader'
import { WhiteLabelFooter } from '@/components/ui/WhiteLabelFooter'
import { PersistentBackground } from '@/components/ui/PersistentBackground'
import { WorkspaceShell } from '@/components/shell/WorkspaceShell'
import { resolvePortalAccess, ZERO_ACCESS } from '@/lib/permissions/resolve'
import { permittedDraftRailItems } from '@/lib/modules/draftAccess'
import { getModuleAccess } from '@/lib/modules/access'
import { ProfileCompletionWrapper } from '@/components/wizard'
import { ModuleSlot } from '@/lib/modules/ModuleSlot'
import { GeoTouch } from '@/components/GeoTouch'
import { AnalyticsProvider } from '@/components/AnalyticsProvider'
import { TrackingMarkup } from '@/components/TrackingMarkup'
import { getServerBrandConfig, buildGoogleFontsUrl, buildFontStack, isLightColor, getThemeBackgroundColor, resolveEventTheme, deriveAccentTints, type ThemeColors } from '@/config/brand'
import { OrganizationJsonLd } from '@/components/structured-data'
import { createServerSupabase, createAuthenticatedServerSupabase } from '@/lib/supabase/server'
// ChatWidgetLoader currently disabled — see comment near the JSX use site.
// import { ChatWidgetLoader } from '@/components/chat/ChatWidgetLoader'
import '@/styles/globals.css'
import '@/styles/shell.css'

const EVENT_META_FIELDS =
  'event_title, event_logo, gradient_color_1, gradient_color_2, gradient_color_3, portal_theme, theme_colors'

async function getCustomDomainEvent(eventIdentifier: string, brandId: string) {
  const supabase = await createServerSupabase(brandId)
  const { data } = await supabase
    .from('events')
    .select(EVENT_META_FIELDS)
    .or(`event_slug.eq.${eventIdentifier},event_id.eq.${eventIdentifier}`)
    .eq('is_live_in_production', true)
    .maybeSingle()
  return data
}

/** Look up a custom-domain event by its UUID (id). The new custom_domains
 *  module routes via `x-content-id` (the events.id UUID) — older ones
 *  routed via the `x-event-identifier` slug. Both paths should resolve to
 *  the same event record. */
async function getCustomDomainEventByUuid(uuid: string, brandId: string) {
  const supabase = await createServerSupabase(brandId)
  const { data } = await supabase
    .from('events')
    .select(EVENT_META_FIELDS)
    .eq('id', uuid)
    .eq('is_live_in_production', true)
    .maybeSingle()
  return data
}

/** Resolve the custom-domain event from either the legacy or new set of
 *  middleware headers. Returns null when the request isn't on a custom
 *  domain or we can't find a matching event. */
async function resolveCustomDomainEvent(
  headersList: Headers,
  brandId: string,
): Promise<{ event_title: string; event_logo: string | null; gradient_color_1: string | null; gradient_color_2: string | null; gradient_color_3: string | null; portal_theme: string | null; theme_colors: ThemeColors | null } | null> {
  if (headersList.get('x-custom-domain') !== 'true') return null

  const eventIdentifier = headersList.get('x-event-identifier')
  if (eventIdentifier) {
    return getCustomDomainEvent(eventIdentifier, brandId) as never
  }

  const contentType = headersList.get('x-content-type')
  const contentId = headersList.get('x-content-id')
  if ((contentType === 'events' || contentType === 'event') && contentId) {
    return getCustomDomainEventByUuid(contentId, brandId) as never
  }

  return null
}

export async function generateMetadata(): Promise<Metadata> {
  const brandConfig = await getServerBrandConfig()
  const brandId = brandConfig.id

  // Check if this is a custom domain request (either the legacy
  // events.custom_domain path or the newer custom_domains module path).
  const headersList = await headers()
  const isCustomDomain = headersList.get('x-custom-domain') === 'true'

  // Favicon: use DB-configured URL if set, otherwise fall back to static 96x96 PNG
  const faviconIcons = brandConfig.faviconUrl
    ? { icon: [{ url: brandConfig.faviconUrl, sizes: 'any' }], shortcut: brandConfig.faviconUrl }
    : {
        icon: [
          { url: `/theme/${brandId}/favicon-96x96.png`, sizes: '96x96', type: 'image/png' },
          { url: `/theme/${brandId}/favicon-32x32.png`, sizes: '32x32', type: 'image/png' },
        ],
        shortcut: `/theme/${brandId}/favicon-96x96.png`,
      }

  if (isCustomDomain) {
    const event = await resolveCustomDomainEvent(headersList, brandId)
    if (event) {
      return {
        title: {
          default: event.event_title,
          // Child pages already include the event title in their own
          // `title` (e.g. "Open RSVP - Andy's 50th"), so a template that
          // appends it would read "Open RSVP - Andy's 50th | Andy's 50th".
          // "%s" keeps the child's title verbatim; the root falls through
          // to `default` above.
          template: '%s',
        },
        description: `Welcome to ${event.event_title}`,
        icons: faviconIcons,
      }
    }
  }

  return {
    title: {
      // Pages set their own leaf titles via the template; the default is the
      // bare brand name (what the home page shows). "Event Portal" was a relic
      // from when the portal was events-only.
      default: brandConfig.name,
      template: `%s | ${brandConfig.name}`,
    },
    description: `${brandConfig.name} — events, news and resources from the community.`,
    icons: faviconIcons,
  }
}

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const brandConfig = await getServerBrandConfig()
  const brand = brandConfig.id
  const modules = await getEnabledModules()
  const complianceEnabled = isModuleEnabled(modules, 'compliance')
  // Footer precedence: the configurable legal line (admin → Settings → Branding →
  // Legal) always wins when set — even with compliance enabled, so a tenant can
  // use compliance purely for cookie consent without the Privacy/Terms/Do-Not-Sell
  // links. Those links are the fallback for compliance tenants with no custom
  // text. Sanitised server-side so the shell can render it directly.
  const rawFooterLegal = await getAppSetting('footer_legal_html')
  const footerLegalHtml = rawFooterLegal ? sanitizeHtml(rawFooterLegal, 'marketing-page') : null
  const fontsUrl = buildGoogleFontsUrl(brandConfig)
  const fontStack = buildFontStack(brandConfig)
  const themeBgColor = getThemeBackgroundColor(brandConfig.portalTheme, brandConfig.themeColors, brandConfig.secondaryColor)
  const uiMode = brandConfig.portalUiMode
  const lightBg = uiMode === 'obsidian' || uiMode === 'paper'

  // Accent tints: use the per-instance settings when present, else derive from the primary color
  // so the workspace shell always has sensible hover/soft accent variants (white-label, no AAIF
  // hard-coding). Mono font stack falls back through common monospace families.
  const derivedTints = deriveAccentTints(brandConfig.primaryColor)
  const primaryColorLight = brandConfig.primaryColorLight || derivedTints.light
  const primaryColorSoft = brandConfig.primaryColorSoft || derivedTints.soft
  const fontMonoStack = `${brandConfig.fontMono || 'JetBrains Mono'}, ui-monospace, SFMono-Regular, Menlo, monospace`

  // Detect custom domain via middleware headers (legacy + new paths)
  const headersList = await headers()
  const isCustomDomain = headersList.get('x-custom-domain') === 'true'

  // Fetch event data for white-label header
  const customDomainEvent = isCustomDomain
    ? await resolveCustomDomainEvent(headersList, brand)
    : null

  // Workspace-shell access map (skipped on custom-domain microsites, which stay flat).
  // §9.2a anonymous fast-path: only validate the session when a Supabase auth cookie is present,
  // so anonymous public traffic incurs no auth round-trip or RBAC RPCs.
  let portalAccess = ZERO_ACCESS
  let railItems = modules.railItems
  let accessMap = getModuleAccess(railItems, portalAccess, false)
  let isSignedIn = false
  if (!isCustomDomain) {
    const cookieStore = await cookies()
    const hasAuthCookie = cookieStore.getAll().some((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    if (hasAuthCookie) {
      const supabase = await createAuthenticatedServerSupabase(brand)
      const { data } = await supabase.auth.getUser()
      const userId = data.user?.id ?? null
      isSignedIn = Boolean(userId)
      portalAccess = await resolvePortalAccess(supabase, userId)
      // Draft nav items (Settings → Portal navigation) surface only for
      // authorised viewers: super admins and holders of that module's
      // feature grant. The public railItems set never contains them.
      const drafts = permittedDraftRailItems(modules.draftRailItems, portalAccess)
      if (drafts.length > 0) {
        railItems = [...modules.railItems, ...drafts].sort((a, b) => a.order - b.order)
      }
      accessMap = getModuleAccess(railItems, portalAccess, Boolean(userId))
    }
  }

  // Feed autodiscovery is gated on nav visibility — a module hidden from the
  // site navigation (content "not ready for public consumption") is not
  // syndicated, so its <link rel="alternate" rss> is suppressed too.
  const navVisibleIds = new Set(modules.railItems.filter((r) => r.moduleId !== 'home').map((r) => r.moduleId))

  return (
    <html lang="en" data-brand={brandConfig.id} data-custom-domain={isCustomDomain ? 'true' : undefined} data-corners={brandConfig.cornerStyle} data-glow={brandConfig.gradientWaveConfig.glowEffects ? 'true' : 'false'} data-ui-mode={uiMode} className={lightBg ? 'light-brand' : ''} style={{ fontFamily: fontStack, fontSize: `${brandConfig.bodyTextSize || '16'}px`, '--font-weight-heading': brandConfig.fontHeadingWeight || '600', '--font-weight-body': brandConfig.fontBodyWeight || '400', '--primary-text': isLightColor(brandConfig.primaryColor) ? '#000000' : '#ffffff', '--primary-color': brandConfig.primaryColor, '--glass-opacity': String(brandConfig.gradientWaveConfig.glassOpacity ?? 0.05), '--glass-blur': `${brandConfig.gradientWaveConfig.glassBlur ?? 4}px`, '--glass-border-opacity': String(brandConfig.gradientWaveConfig.glassBorderOpacity ?? 0.1), '--font-mono': fontMonoStack, '--font-display': `${brandConfig.fontHeading}, ui-sans-serif, system-ui, sans-serif`, '--font-sans': `${brandConfig.fontBody}, ui-sans-serif, system-ui, sans-serif`, '--success-color': brandConfig.successColor, '--warning-color': brandConfig.warningColor, '--danger-color': brandConfig.dangerColor, '--info-color': brandConfig.infoColor, '--primary-color-light': primaryColorLight, '--primary-color-soft': primaryColorSoft } as React.CSSProperties} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {fontsUrl && (
          <link href={fontsUrl} rel="stylesheet" />
        )}
        <script
          id="__brand_config__"
          type="application/json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify((() => {
              const { trackingHead: _, trackingBody: __, ...clientSafe } = brandConfig
              return clientSafe
            })()),
          }}
        />
        <TrackingMarkup html={brandConfig.trackingHead} />
        <OrganizationJsonLd
          name={brandConfig.name}
          url={`https://${brandConfig.domain}`}
          logoUrl={brandConfig.logoUrl}
        />
        {!isCustomDomain && navVisibleIds.has('newsletters') && (
          <link
            rel="alternate"
            type="application/rss+xml"
            title={`${brandConfig.name} — Newsletters`}
            href={`https://${brandConfig.domain}/feeds/newsletters.xml`}
          />
        )}
        {!isCustomDomain && navVisibleIds.has('events') && (
          <link
            rel="alternate"
            type="application/rss+xml"
            title={`${brandConfig.name} — Events`}
            href={`https://${brandConfig.domain}/feeds/events.xml`}
          />
        )}
        {!isCustomDomain && navVisibleIds.has('blog') && (
          <link
            rel="alternate"
            type="application/rss+xml"
            title={`${brandConfig.name} — Blog`}
            href={`https://${brandConfig.domain}/feeds/blog.xml`}
          />
        )}
      </head>
      <body className="flex flex-col min-h-screen" style={{ backgroundColor: (brandConfig.portalTheme === 'gradient_wave' && brandConfig.gradientWaveConfig?.fallbackColor) || getThemeBackgroundColor(brandConfig.portalTheme, brandConfig.themeColors, brandConfig.secondaryColor) }} suppressHydrationWarning>
        {(() => {
          // For custom domain events, resolve theme from event overrides
          const resolved = customDomainEvent
            ? resolveEventTheme(customDomainEvent, brandConfig)
            : { theme: brandConfig.portalTheme, colors: brandConfig.themeColors }
          return (
            <PersistentBackground
              theme={resolved.theme}
              themeColors={resolved.colors}
              fallbackBg={getThemeBackgroundColor(resolved.theme, resolved.colors, brandConfig.secondaryColor)}
              gradientWaveConfig={brandConfig.gradientWaveConfig}
            />
          )
        })()}
        <AnalyticsProvider>
          <TrackingProvider>
            <GlowProvider>
              {isCustomDomain ? (
                <>
                  <WhiteLabelHeader event={customDomainEvent} brandConfig={brandConfig} />
                  <div className="relative z-10 flex-1">
                    {children}
                  </div>
                  <WhiteLabelFooter />
                </>
              ) : (
                <div className="relative z-10 flex-1 flex">
                  <WorkspaceShell
                    railItems={railItems}
                    access={accessMap}
                    featureKeys={portalAccess.featureKeys}
                    isSuperAdmin={portalAccess.isSuperAdmin}
                    isSignedIn={isSignedIn}
                    brandName={brandConfig.name}
                    logoUrl={brandConfig.logoUrl || undefined}
                    logoIconUrl={brandConfig.logoIconUrl || undefined}
                    complianceEnabled={complianceEnabled}
                    footerLegalHtml={footerLegalHtml}
                  >
                    {children}
                  </WorkspaceShell>
                </div>
              )}
              {!isCustomDomain && (
                // The AI onboarding module (lf-gatewaze-modules/onboarding) replaces the
                // step-form wizard when enabled: render its 'app:profile-gate' slot. The
                // wizard remains the disabled-module degradation floor (flag-flip rollback,
                // no data migration). See spec-onboarding-module.md §1.1 / Migration.
                isModuleEnabled(modules, 'onboarding') ? (
                  <ModuleSlot
                    name="app:profile-gate"
                    enabledModuleIds={[...modules.enabledIds]}
                    enabledFeatures={[...modules.enabledFeatures]}
                  />
                ) : (
                  <ProfileCompletionWrapper brandConfig={brandConfig} listsEnabled={isModuleEnabled(modules, 'lists')} />
                )
              )}
              <GeoTouch />
            </GlowProvider>
          </TrackingProvider>
        </AnalyticsProvider>
        {complianceEnabled && <CookieConsentLoader />}
        <DevIndicatorNudge />
        <CardGlowClock />
        {/*
          ChatWidgetLoader is currently disabled across all brands — the
          underlying agent isn't wired up. Re-enable by uncommenting the
          conditional below once chat actually works end-to-end.

          NOTE: NEXT_PUBLIC_* env vars are baked into the client bundle at
          build time but read at runtime on the server. If the bake-time
          value disagrees with the runtime value, hydration fails (React
          #418). When re-enabling, gate the widget on a server-side prop
          (passed via cookies, brand config, or a server component) rather
          than `process.env.NEXT_PUBLIC_*` directly.
        */}
        {/* {process.env.NEXT_PUBLIC_ENABLE_CHAT === 'true' && <ChatWidgetLoader />} */}
        <TrackingMarkup html={brandConfig.trackingBody} />
      </body>
    </html>
  )
}
