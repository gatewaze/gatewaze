'use client'

import { Component, useState, useEffect, useRef } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { ShaderGradientCanvas, ShaderGradient } from '@shadergradient/react'

interface Props {
  startColor?: string
  middleColor?: string
  endColor?: string
}

// Error boundary to catch WebGL context creation failures
class WebGLErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('WebGL background disabled:', error.message, info.componentStack)
  }
  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}

function hasWebGLSupport(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl') || canvas.getContext('webgl2'))
  } catch {
    return false
  }
}

// Cap time delta at ~30fps to prevent animation jumps when rAF is starved during scroll
const MAX_DELTA = 0.033

export function GradientWaveBackground({
  startColor = '#ca2b7f',
  middleColor = '#4086c6',
  endColor = '#0d1218',
}: Props) {
  const [mounted, setMounted] = useState(false)
  const [canvasReady, setCanvasReady] = useState(false)
  const [webglSupported, setWebglSupported] = useState(true)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!hasWebGLSupport()) {
      setWebglSupported(false)
      return
    }
    // Small delay to ensure DOM is ready for WebGL context
    const timer = setTimeout(() => setMounted(true), 50)
    return () => clearTimeout(timer)
  }, [])

  // Mark canvas as ready after it has time to render
  useEffect(() => {
    if (mounted) {
      const timer = setTimeout(() => setCanvasReady(true), 500)
      return () => clearTimeout(timer)
    }
  }, [mounted])

  // Patch the Three.js clock to cap time deltas (prevents animation jumps during scroll)
  useEffect(() => {
    if (!mounted) return

    let attempts = 0
    let rafId: number

    function patchClock() {
      const container = containerRef.current
      if (!container) return

      const canvas = container.querySelector('canvas')
      if (!canvas) {
        if (attempts++ < 30) rafId = requestAnimationFrame(patchClock)
        return
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r3f = (canvas as any).__r3f
      if (!r3f?.store) {
        if (attempts++ < 30) rafId = requestAnimationFrame(patchClock)
        return
      }

      const state = r3f.store.getState()
      const clock = state.clock
      if (!clock) return

      // Replace getDelta to cap time jumps — this prevents the animation from
      // leaping forward when rAF is starved (e.g. during macOS trackpad scroll)
      clock.getDelta = function (this: { oldTime: number; elapsedTime: number; running: boolean }) {
        const now = performance.now()

        if (!this.running) {
          this.running = true
          this.oldTime = now
          return 0
        }

        const diff = (now - this.oldTime) / 1000
        this.oldTime = now
        const capped = Math.min(diff, MAX_DELTA)
        this.elapsedTime += capped
        return capped
      }
    }

    // Start trying after a short delay to give R3F time to mount
    const timer = setTimeout(() => {
      rafId = requestAnimationFrame(patchClock)
    }, 100)

    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(rafId)
    }
  }, [mounted])

  return (
    <>
      {/* Static gradient placeholder - always present, fades out when WebGL is ready */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: `radial-gradient(ellipse 100% 100% at 100% 100%, ${startColor} 0%, transparent 80%),
                       radial-gradient(ellipse 80% 80% at 0% 0%, ${middleColor} 0%, transparent 70%),
                       linear-gradient(135deg, ${middleColor} 0%, ${startColor}60 100%),
                       ${endColor}`,
          opacity: canvasReady ? 0 : 1,
          transition: 'opacity 0.5s ease-out',
          zIndex: 0,
        }}
      />
      {/* WebGL canvas - fades in on top, skipped if WebGL unavailable */}
      {webglSupported && (
        <WebGLErrorBoundary>
          <div ref={containerRef}>
            {mounted && (
              <ShaderGradientCanvas
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: '100%',
                  pointerEvents: 'none',
                  opacity: canvasReady ? 1 : 0,
                  transition: 'opacity 0.5s ease-out',
                  zIndex: 1,
                }}
              >
                <ShaderGradient
                  animate="on"
                  brightness={1.2}
                  cAzimuthAngle={180}
                  cDistance={3.6}
                  cPolarAngle={90}
                  color1={startColor}
                  color2={middleColor}
                  color3={endColor}
                  envPreset="city"
                  grain="off"
                  lightType="3d"
                  positionX={-1.4}
                  positionY={0}
                  positionZ={0}
                  reflection={0.1}
                  rotationX={0}
                  rotationY={10}
                  rotationZ={50}
                  type="plane"
                  uAmplitude={0.5}
                  uDensity={1.3}
                  uFrequency={4.5}
                  uSpeed={0.2}
                  uStrength={1.5}
                  uTime={0}
                />
              </ShaderGradientCanvas>
            )}
          </div>
        </WebGLErrorBoundary>
      )}
    </>
  )
}
