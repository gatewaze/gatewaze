import type { Metadata, Viewport } from 'next'
import { headers } from 'next/headers'
import { CookieConsentLoader } from '@/components/CookieConsentLoader'
import { TrackingProvider } from '@/components/TrackingProvider'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}
import { getEnabledModules, isModuleEnabled } from '@/lib/modules/enabledModules'
import { GlowProvider } from '@/components/ui/GlowContext'
import { Header } from '@/components/Header'
import { Footer } from '@/components/ui/Footer'
import { WhiteLabelHeader } from '@/components/WhiteLabelHeader'
import { WhiteLabelFooter } from '@/components/ui/WhiteLabelFooter'
import { PersistentBackground } from '@/components/ui/PersistentBackground'
import { ProfileCompletionWrapper } from '@/components/wizard'
import { AnalyticsProvider } from '@/components/AnalyticsProvider'
import { getServerBrandConfig, buildGoogleFontsUrl, buildFontStack, isLightColor, getThemeBackgroundColor, resolveEventTheme } from '@/config/brand'
import { OrganizationJsonLd } from '@/components/structured-data'
import { createServerSupabase } from '@/lib/supabase/server'
import { ChatWidgetLoader } from '@/components/chat/ChatWidgetLoader'
import '@/styles/globals.css'

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
): Promise<{ event_title: string; event_logo: string | null; gradient_color_1: string | null; gradient_color_2: string | null; gradient_color_3: string | null; portal_theme: string | null; theme_colors: unknown } | null> {
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
      default: `Event Portal | ${brandConfig.name}`,
      template: `%s | ${brandConfig.name}`,
    },
    description: `Discover and register for events from ${brandConfig.name}`,
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
  const fontsUrl = buildGoogleFontsUrl(brandConfig)
  const fontStack = buildFontStack(brandConfig)
  const themeBgColor = getThemeBackgroundColor(brandConfig.portalTheme, brandConfig.themeColors, brandConfig.secondaryColor)
  const uiMode = brandConfig.portalUiMode
  const lightBg = uiMode === 'obsidian' || uiMode === 'paper'

  // Detect custom domain via middleware headers (legacy + new paths)
  const headersList = await headers()
  const isCustomDomain = headersList.get('x-custom-domain') === 'true'

  // Fetch event data for white-label header
  const customDomainEvent = isCustomDomain
    ? await resolveCustomDomainEvent(headersList, brand)
    : null

  return (
    <html lang="en" data-brand={brandConfig.id} data-custom-domain={isCustomDomain ? 'true' : undefined} data-corners={brandConfig.cornerStyle} data-glow={brandConfig.gradientWaveConfig.glowEffects ? 'true' : 'false'} data-ui-mode={uiMode} className={lightBg ? 'light-brand' : ''} style={{ fontFamily: fontStack, fontSize: `${brandConfig.bodyTextSize || '16'}px`, '--font-weight-heading': brandConfig.fontHeadingWeight || '600', '--font-weight-body': brandConfig.fontBodyWeight || '400', '--primary-text': isLightColor(brandConfig.primaryColor) ? '#000000' : '#ffffff', '--glass-opacity': String(brandConfig.gradientWaveConfig.glassOpacity ?? 0.05), '--glass-blur': `${brandConfig.gradientWaveConfig.glassBlur ?? 4}px`, '--glass-border-opacity': String(brandConfig.gradientWaveConfig.glassBorderOpacity ?? 0.1) } as React.CSSProperties} suppressHydrationWarning>
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
        {brandConfig.trackingHead && (
          <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: brandConfig.trackingHead }} />
        )}
        <OrganizationJsonLd
          name={brandConfig.name}
          url={`https://${brandConfig.domain}`}
          logoUrl={brandConfig.logoUrl}
        />
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
                <WhiteLabelHeader event={customDomainEvent} brandConfig={brandConfig} />
              ) : (
                <Header brandConfig={brandConfig} navItems={modules.portalNavItems} />
              )}
              <div className="relative z-10 flex-1">
                {children}
              </div>
              {isCustomDomain ? (
                <WhiteLabelFooter />
              ) : (
                <Footer />
              )}
              {!isCustomDomain && (
                <ProfileCompletionWrapper brandConfig={brandConfig} />
              )}
            </GlowProvider>
          </TrackingProvider>
        </AnalyticsProvider>
        {complianceEnabled && <CookieConsentLoader />}
        {process.env.NEXT_PUBLIC_ENABLE_CHAT === 'true' && <ChatWidgetLoader />}
        {brandConfig.trackingBody && (
          <script dangerouslySetInnerHTML={{ __html: brandConfig.trackingBody }} />
        )}
      </body>
    </html>
  )
}
