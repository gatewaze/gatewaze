'use client'

import { ReactNode } from 'react'
import { GlowBorder } from './GlowBorder'

interface Props {
  children: ReactNode
  className?: string
  /** Additional padding classes (default: 'p-6 sm:p-8') */
  padding?: string
  /** Use dark theme for glow border (default: false) */
  useDarkTheme?: boolean
  /** Auto-rotate the glow border */
  autoRotate?: boolean
  /** Speed of auto-rotation in degrees per second */
  autoRotateSpeed?: number
}

/**
 * A glassmorphism panel with animated glow border.
 * Combines GlowBorder with consistent glass styling (bg-white/15, backdrop-blur, border).
 */
export function GlassPanel({
  children,
  className = '',
  padding = 'p-6 sm:p-8',
  useDarkTheme = false,
  autoRotate,
  autoRotateSpeed,
}: Props) {
  return (
    <GlowBorder
      borderRadius="var(--radius-card)"
      useDarkTheme={useDarkTheme}
      autoRotate={autoRotate}
      autoRotateSpeed={autoRotateSpeed}
    >
      <div
        className={`bg-white/15 backdrop-blur-[10px] rounded-2xl shadow-2xl border border-white/20 ${padding} ${className}`}
      >
        {children}
      </div>
    </GlowBorder>
  )
}
