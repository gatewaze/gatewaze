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

async function getCustomDomainEvent(eventIdentifier: string, brandId: string) {
  const supabase = await createServerSupabase(brandId)
  const { data } = await supabase
    .from('events')
    .select('event_title, event_logo, gradient_color_1, gradient_color_2, gradient_color_3, portal_theme, theme_colors')
    .or(`event_slug.eq.${eventIdentifier},event_id.eq.${eventIdentifier}`)
    .eq('is_live_in_production', true)
    .maybeSingle()
  return data
}

export async function generateMetadata(): Promise<Metadata> {
  const brandConfig = await getServerBrandConfig()
  const brandId = brandConfig.id

  // Check if this is a custom domain request
  const headersList = await headers()
  const isCustomDomain = headersList.get('x-custom-domain') === 'true'
  const eventIdentifier = headersList.get('x-event-identifier')

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

  if (isCustomDomain && eventIdentifier) {
    const event = await getCustomDomainEvent(eventIdentifier, brandId)
    if (event) {
      return {
        title: {
          default: event.event_title,
          template: `%s | ${event.event_title}`,
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
  const lightBg = brandConfig.portalUiMode === 'light' ? true
    : brandConfig.portalUiMode === 'dark' ? false
    : isLightColor(themeBgColor)

  // Detect custom domain via middleware headers
  const headersList = await headers()
  const isCustomDomain = headersList.get('x-custom-domain') === 'true'
  const eventIdentifier = headersList.get('x-event-identifier')

  // Fetch event data for white-label header
  let customDomainEvent = null
  if (isCustomDomain && eventIdentifier) {
    customDomainEvent = await getCustomDomainEvent(eventIdentifier, brand)
  }

  return (
    <html lang="en" data-brand={brandConfig.id} data-custom-domain={isCustomDomain ? 'true' : undefined} data-corners={brandConfig.cornerStyle} data-glow={brandConfig.gradientWaveConfig.glowEffects ? 'true' : 'false'} className={lightBg ? 'light-brand' : ''} style={{ fontFamily: fontStack, fontSize: `${brandConfig.bodyTextSize || '16'}px`, color: lightBg ? '#000000' : '#ffffff', '--font-weight-heading': brandConfig.fontHeadingWeight || '600', '--font-weight-body': brandConfig.fontBodyWeight || '400', '--primary-text': isLightColor(brandConfig.primaryColor) ? '#000000' : '#ffffff', '--glass-opacity': String(brandConfig.gradientWaveConfig.glassOpacity ?? 0.05), '--glass-blur': `${brandConfig.gradientWaveConfig.glassBlur ?? 4}px`, '--glass-border-opacity': String(brandConfig.gradientWaveConfig.glassBorderOpacity ?? 0.1) } as React.CSSProperties} suppressHydrationWarning>
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
