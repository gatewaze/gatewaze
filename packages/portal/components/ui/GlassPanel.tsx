'use client'

import { ReactNode } from 'react'
import { GlowBorder } from './GlowBorder'
import { useViewportBlur } from '@/hooks/useViewportBlur'

interface Props {
  children: ReactNode
  className?: string
  padding?: string
  useDarkTheme?: boolean
  autoRotate?: boolean
  autoRotateSpeed?: number
}

/**
 * Glassmorphism panel with animated glow border.
 * Glass opacity, blur, and border opacity are driven by CSS custom properties
 * (--glass-opacity, --glass-blur, --glass-border-opacity) set on <html>
 * from the brand config's gradient wave settings.
 *
 * Backdrop blur is only applied when the element is in (or near) the viewport
 * to limit GPU compositing cost on long pages.
 */
export function GlassPanel({
  children,
  className = '',
  padding = 'p-6 sm:p-8',
  useDarkTheme = false,
  autoRotate,
  autoRotateSpeed,
}: Props) {
  const { ref, inView } = useViewportBlur()

  return (
    <GlowBorder
      borderRadius="var(--radius-card)"
      useDarkTheme={useDarkTheme}
      autoRotate={autoRotate}
      autoRotateSpeed={autoRotateSpeed}
    >
      <div
        ref={ref}
        className={`rounded-2xl shadow-2xl ${padding} ${className}`}
        style={{
          backgroundColor: `rgba(255, 255, 255, var(--glass-opacity, 0.05))`,
          backdropFilter: inView ? `blur(var(--glass-blur, 4px))` : undefined,
          WebkitBackdropFilter: inView ? `blur(var(--glass-blur, 4px))` : undefined,
          borderWidth: 1,
          borderStyle: 'solid',
          borderColor: `rgba(255, 255, 255, var(--glass-border-opacity, 0.1))`,
        }}
      >
        {children}
      </div>
    </GlowBorder>
  )
}
