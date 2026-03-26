'use client'

import { useRef, useEffect, ReactNode } from 'react'
import { useGlowPosition } from './GlowContext'

interface Props {
  children: ReactNode
  className?: string
  borderRadius?: string
  useDarkTheme?: boolean
  /** Auto-rotate the glow in a clockwise direction, ignoring mouse movements */
  autoRotate?: boolean
  /** Speed of auto-rotation in degrees per second (default: 30) */
  autoRotateSpeed?: number
  /** Fixed size of the glow in pixels (default: 200) */
  glowSize?: number
  /** Border thickness in pixels (default: 1) */
  borderWidth?: number
}

// Calculate position on border given an angle (0 = top center, clockwise)
function getPositionOnBorder(angle: number, width: number, height: number): { x: number; y: number } {
  // Convert angle to radians, adjust so 0 is at top
  const rad = ((angle - 90) * Math.PI) / 180

  // Calculate direction vector
  const dx = Math.cos(rad)
  const dy = Math.sin(rad)

  // Find intersection with rectangle border
  // Scale factor to reach the edge
  const halfW = width / 2
  const halfH = height / 2

  let scale: number
  if (Math.abs(dx) * halfH > Math.abs(dy) * halfW) {
    // Hits left or right edge
    scale = halfW / Math.abs(dx)
  } else {
    // Hits top or bottom edge
    scale = halfH / Math.abs(dy)
  }

  // Position from center
  const x = halfW + dx * scale
  const y = halfH + dy * scale

  return { x, y }
}

export function GlowBorder({
  children,
  className = '',
  borderRadius = 'var(--radius-card)',
  useDarkTheme = false,
  autoRotate = false,
  autoRotateSpeed = 30,
  glowSize = 200,
  borderWidth = 1,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const glowStateRef = useRef({ angle: 0, intensity: 1 })
  const dimensionsRef = useRef({ width: 0, height: 0 })
  const glowPosition = useGlowPosition()

  const updateOverlay = () => {
    const overlay = overlayRef.current
    const dims = dimensionsRef.current
    const glow = glowStateRef.current
    if (!overlay) return

    const glowColor = useDarkTheme ? 'rgba(0, 0, 0, 0.5)' : 'rgba(255, 255, 255, 0.7)'
    const baseColor = useDarkTheme ? 'rgba(0, 0, 0, 0.05)' : 'rgba(255, 255, 255, 0.08)'

    const glowPos1 = getPositionOnBorder(glow.angle, dims.width, dims.height)
    const glowPos2 = getPositionOnBorder((glow.angle + 180) % 360, dims.width, dims.height)

    const glow1X = dims.width > 0 ? (glowPos1.x / dims.width) * 100 : 50
    const glow1Y = dims.height > 0 ? (glowPos1.y / dims.height) * 100 : 0
    const glow2X = dims.width > 0 ? (glowPos2.x / dims.width) * 100 : 50
    const glow2Y = dims.height > 0 ? (glowPos2.y / dims.height) * 100 : 100

    overlay.style.background = `
      radial-gradient(${glowSize}px ${glowSize}px at ${glow1X}% ${glow1Y}%, ${glowColor} 0%, transparent 70%),
      radial-gradient(${glowSize}px ${glowSize}px at ${glow2X}% ${glow2Y}%, ${glowColor} 0%, transparent 70%),
      ${baseColor}
    `
    overlay.style.opacity = String(0.1 + glow.intensity * 0.9)
  }

  // Track container dimensions
  useEffect(() => {
    if (!containerRef.current) return

    const updateDimensions = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        dimensionsRef.current = { width: rect.width, height: rect.height }
        updateOverlay()
      }
    }

    updateDimensions()

    const resizeObserver = new ResizeObserver(updateDimensions)
    resizeObserver.observe(containerRef.current)

    return () => resizeObserver.disconnect()
  }, [])

  // Auto-rotate effect — updates ref + DOM directly, no setState
  useEffect(() => {
    if (!autoRotate) return

    let animationFrame: number
    let lastTime = performance.now()

    const animate = (currentTime: number) => {
      const deltaTime = (currentTime - lastTime) / 1000
      lastTime = currentTime

      glowStateRef.current = {
        angle: (glowStateRef.current.angle + autoRotateSpeed * deltaTime) % 360,
        intensity: 1,
      }
      updateOverlay()

      animationFrame = requestAnimationFrame(animate)
    }

    animationFrame = requestAnimationFrame(animate)

    return () => cancelAnimationFrame(animationFrame)
  }, [autoRotate, autoRotateSpeed])

  // Mouse-following effect (only when not auto-rotating)
  useEffect(() => {
    if (autoRotate) return
    if (!containerRef.current || glowPosition.source === 'none') return

    const rect = containerRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2

    const angle = Math.atan2(glowPosition.y - centerY, glowPosition.x - centerX)
    const angleDeg = ((angle * 180) / Math.PI + 90 + 360) % 360

    glowStateRef.current = { angle: angleDeg, intensity: 1 }
    updateOverlay()
  }, [glowPosition, autoRotate])

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      style={{ borderRadius }}
    >
      {children}
      {/* Glow border overlay */}
      <div
        ref={overlayRef}
        className="absolute inset-0 pointer-events-none"
        style={{
          borderRadius,
          padding: `${borderWidth}px`,
          WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          WebkitMaskComposite: 'xor',
          mask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
          maskComposite: 'exclude',
          transition: 'opacity 0.15s ease-out',
        }}
      />
    </div>
  )
}
