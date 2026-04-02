'use client'

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'

interface GlowPosition {
  x: number
  y: number
  source: 'mouse' | 'tilt' | 'none'
}

const GlowContext = createContext<GlowPosition>({ x: 0, y: 0, source: 'none' })

export function useGlowPosition() {
  return useContext(GlowContext)
}

interface Props {
  children: ReactNode
}

export function GlowProvider({ children }: Props) {
  const [position, setPosition] = useState<GlowPosition>({ x: 0, y: 0, source: 'none' })

  // Mouse movement handler
  const handleMouseMove = useCallback((e: MouseEvent) => {
    setPosition({ x: e.clientX, y: e.clientY, source: 'mouse' })
  }, [])

  // Device orientation handler (for mobile tilt)
  const handleOrientation = useCallback((e: DeviceOrientationEvent) => {
    // beta: front-to-back tilt (-180 to 180, 0 = flat)
    // gamma: left-to-right tilt (-90 to 90, 0 = flat)
    const beta = e.beta ?? 0
    const gamma = e.gamma ?? 0

    // Normalize tilt to screen coordinates
    // Map gamma (-45 to 45 degrees) to screen width
    // Map beta (0 to 45 degrees from upright ~45deg) to screen height
    const normalizedX = ((gamma + 45) / 90) * window.innerWidth
    const normalizedY = ((beta - 20) / 50) * window.innerHeight

    // Clamp values to screen bounds
    const x = Math.max(0, Math.min(window.innerWidth, normalizedX))
    const y = Math.max(0, Math.min(window.innerHeight, normalizedY))

    setPosition({ x, y, source: 'tilt' })
  }, [])

  useEffect(() => {
    // Always listen for mouse movement
    window.addEventListener('mousemove', handleMouseMove)

    // For touch devices, try to add orientation listener
    // This works on Android and older iOS without permission
    // On iOS 13+ it silently fails without prompting - that's fine for this minor effect
    const supportsOrientation = 'DeviceOrientationEvent' in window
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0

    if (supportsOrientation && isTouchDevice) {
      window.addEventListener('deviceorientation', handleOrientation)
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('deviceorientation', handleOrientation)
    }
  }, [handleMouseMove, handleOrientation])

  return (
    <GlowContext.Provider value={position}>
      {children}
    </GlowContext.Provider>
  )
}
