import type { Viewport } from 'next'
import { getServerBrandConfig, buildGoogleFontsUrl, buildFontStack, isLightColor } from '@/config/brand'
import '@/styles/globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

/**
 * Root layout for portal embeds (`/embed/<widget>`, shown in an iframe on
 * another site) and the embed sign-in popup (`/embed-auth`).
 *
 * The bare layout minus the brand's tracking markup: inside an iframe the
 * embedding site's cookie consent governs, and our analytics would set
 * third-party cookies under it. Framing is allowed for these paths only, by
 * the origins in EMBED_FRAME_ANCESTORS (middleware + lib/frame-policy).
 */
export default async function EmbedLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const brandConfig = await getServerBrandConfig()
  const fontsUrl = buildGoogleFontsUrl(brandConfig)
  const fontStack = buildFontStack(brandConfig)
  const uiMode = brandConfig.portalUiMode
  const lightBg = uiMode === 'obsidian' || uiMode === 'paper'

  return (
    <html lang="en" data-brand={brandConfig.id} data-corners={brandConfig.cornerStyle} data-ui-mode={uiMode} className={lightBg ? 'light-brand' : ''} style={{ fontFamily: fontStack, fontSize: `${brandConfig.bodyTextSize || '16'}px`, '--font-weight-heading': brandConfig.fontHeadingWeight || '600', '--font-weight-body': brandConfig.fontBodyWeight || '400', '--primary-text': isLightColor(brandConfig.primaryColor) ? '#000000' : '#ffffff', '--glass-opacity': String(brandConfig.gradientWaveConfig.glassOpacity ?? 0.05), '--glass-blur': `${brandConfig.gradientWaveConfig.glassBlur ?? 4}px`, '--glass-border-opacity': String(brandConfig.gradientWaveConfig.glassBorderOpacity ?? 0.1) } as React.CSSProperties} suppressHydrationWarning>
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
      </head>
      <body suppressHydrationWarning className="gw-embed" style={{ background: 'transparent' }}>
        {children}
      </body>
    </html>
  )
}
