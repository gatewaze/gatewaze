'use client'

import dynamic from 'next/dynamic'
import type { PortalTheme, ThemeColors, BlobsThemeColors, GradientWaveThemeColors, BasicThemeColors } from '@/config/brand'

// Dynamic imports with SSR disabled — CSS animations are client-only
const GradientBackground = dynamic(
  () => import('@/components/ui/GradientBackground').then((mod) => mod.GradientBackground),
  { ssr: false }
)

const GradientWaveBackground = dynamic(
  () => import('@/components/ui/GradientWaveBackground').then((mod) => mod.GradientWaveBackground),
  { ssr: false }
)

const BasicBackground = dynamic(
  () => import('@/components/ui/BasicBackground').then((mod) => mod.BasicBackground),
  { ssr: false }
)

interface Props {
  theme: PortalTheme
  themeColors: ThemeColors
  fallbackBg: string
}

/**
 * Persistent background that stays mounted across page transitions.
 * Placed in the root layout to avoid re-mounting on navigation.
 * Renders the appropriate background component based on the active theme.
 */
export function PersistentBackground({ theme, themeColors, fallbackBg }: Props) {
  // For gradient_wave, use a rich multi-layer CSS gradient behind the WebGL canvas
  // (matches gatewaze-admin). The WebGL mesh has semi-transparent areas, so a flat
  // background color causes visible banding — the layered gradient smooths this out.
  let wrapperStyle: React.CSSProperties
  if (theme === 'gradient_wave') {
    const c = themeColors as GradientWaveThemeColors
    wrapperStyle = {
      background: `radial-gradient(ellipse 100% 100% at 100% 100%, ${c.start} 0%, transparent 80%),
                   radial-gradient(ellipse 80% 80% at 0% 0%, ${c.middle} 0%, transparent 70%),
                   linear-gradient(135deg, ${c.middle} 0%, ${c.start}60 100%),
                   ${c.end}`,
    }
  } else {
    wrapperStyle = { backgroundColor: fallbackBg }
  }

  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none z-0"
      style={wrapperStyle}
    >
      {theme === 'blobs' && (() => {
        const c = themeColors as BlobsThemeColors
        return (
          <GradientBackground
            color1={c.blob1}
            color2={c.blob2}
            color3={c.blob3}
          />
        )
      })()}
      {theme === 'gradient_wave' && (() => {
        const c = themeColors as GradientWaveThemeColors
        return (
          <GradientWaveBackground
            startColor={c.start}
            middleColor={c.middle}
            endColor={c.end}
          />
        )
      })()}
      {theme === 'basic' && (() => {
        const c = themeColors as BasicThemeColors
        return <BasicBackground backgroundColor={c.background} />
      })()}
    </div>
  )
}
