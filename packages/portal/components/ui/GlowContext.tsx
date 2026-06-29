'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

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
  // Mouse/tilt tracking removed — the cursor-following glow (GlowBorder) is gone,
  // so we no longer attach a global mousemove/deviceorientation listener. The
  // context stays for API compatibility but reports a static, no-source position.
  const [position] = useState<GlowPosition>({ x: 0, y: 0, source: 'none' })

  return (
    <GlowContext.Provider value={position}>
      {children}
    </GlowContext.Provider>
  )
}
