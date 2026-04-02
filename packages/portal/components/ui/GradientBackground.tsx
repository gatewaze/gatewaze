'use client'

import { useEffect, useRef } from 'react'

interface Props {
  color1?: string
  color2?: string
  color3?: string
}

/** Convert hex (#rrggbb) to "r, g, b" for use in CSS custom properties */
function hexToRgb(hex: string): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.substring(0, 2), 16)
  const g = parseInt(h.substring(2, 4), 16)
  const b = parseInt(h.substring(4, 6), 16)
  return `${r}, ${g}, ${b}`
}

export function GradientBackground({
  color1 = '#ca2b7f',
  color2 = '#4086c6',
  color3 = '#1e2837',
}: Props) {
  const interactiveRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Set CSS custom properties for gradient colors
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--gradient-g1', hexToRgb(color1))
    root.style.setProperty('--gradient-g2', hexToRgb(color2))
    root.style.setProperty('--gradient-g3', hexToRgb(color3))
    root.style.setProperty('--gradient-interactive', hexToRgb(color1))
  }, [color1, color2, color3])

  // Mouse-tracking interactive gradient
  useEffect(() => {
    let curX = 0
    let curY = 0
    let tgX = 0
    let tgY = 0
    let animationFrameId: number

    const el = interactiveRef.current
    const container = containerRef.current
    if (!el || !container) return

    function move() {
      curX += (tgX - curX) / 5
      curY += (tgY - curY) / 5
      el!.style.transform = `translate(${Math.round(curX)}px, ${Math.round(curY)}px)`
      animationFrameId = requestAnimationFrame(move)
    }

    function handleMouseMove(event: MouseEvent) {
      const rect = container!.getBoundingClientRect()
      tgX = event.clientX - rect.left
      tgY = event.clientY - rect.top
    }

    window.addEventListener('mousemove', handleMouseMove)
    move()

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      cancelAnimationFrame(animationFrameId)
    }
  }, [])

  return (
    <div className="gradient-bg" ref={containerRef}>
      <svg xmlns="http://www.w3.org/2000/svg" className="hidden">
        <defs>
          <filter id="gw-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
            <feColorMatrix
              in="blur"
              mode="matrix"
              values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
              result="goo"
            />
            <feBlend in="SourceGraphic" in2="goo" />
          </filter>
        </defs>
      </svg>
      <div className="gradients-container">
        <div className="g1" />
        <div className="g2" />
        <div className="g3" />
        <div className="interactive" ref={interactiveRef} />
      </div>
    </div>
  )
}
