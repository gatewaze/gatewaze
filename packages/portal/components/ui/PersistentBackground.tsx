'use client'

import dynamic from 'next/dynamic'
import type { PortalTheme, ThemeColors, GradientWaveThemeColors, BasicThemeColors, GradientWaveConfig } from '@/config/brand'

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
  gradientWaveConfig?: GradientWaveConfig
}

/**
 * Persistent background that stays mounted across page transitions.
 * Placed in the root layout to avoid re-mounting on navigation.
 * Renders the appropriate background component based on the active theme.
 */
export function PersistentBackground({ theme, themeColors, fallbackBg, gradientWaveConfig }: Props) {
  let wrapperStyle: React.CSSProperties
  if (theme === 'gradient_wave' && gradientWaveConfig?.fallbackColor) {
    wrapperStyle = { backgroundColor: gradientWaveConfig.fallbackColor }
  } else {
    wrapperStyle = { backgroundColor: fallbackBg }
  }

  return (
    <div
      className="fixed inset-0 overflow-hidden pointer-events-none z-0"
      style={wrapperStyle}
    >
      {theme === 'gradient_wave' && (() => {
        const c = themeColors as GradientWaveThemeColors
        return (
          <GradientWaveBackground
            startColor={c.start}
            middleColor={c.middle}
            endColor={c.end}
            config={gradientWaveConfig}
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
