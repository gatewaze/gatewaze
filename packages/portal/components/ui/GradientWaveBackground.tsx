'use client'

import { Component, useState, useEffect, useRef } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { ShaderGradientCanvas, ShaderGradient } from '@shadergradient/react'
import type { GradientWaveConfig } from '@/config/brand'
import { DEFAULT_GRADIENT_WAVE_CONFIG } from '@/config/brand'

interface Props {
  startColor?: string
  middleColor?: string
  endColor?: string
  config?: Partial<GradientWaveConfig>
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
  config: configOverride,
}: Props) {
  const cfg = { ...DEFAULT_GRADIENT_WAVE_CONFIG, ...configOverride }
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

  // Mobile accelerometer: map device tilt to camera position (replaces mouse interaction)
  useEffect(() => {
    if (!mounted) return
    if (typeof window === 'undefined') return

    // Only enable on touch devices with accelerometer
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0
    if (!isTouchDevice) return

    // Three.js Camera shape (subset). The full PerspectiveCamera type
    // would require importing from 'three'; we only touch position.
    interface Camera {
      position: { x: number; y: number; z: number }
    }
    let camera: Camera | null = null
    let baseX = 0
    let baseY = 0
    let hasBase = false
    let animRafId: number

    // Find the Three.js camera from the R3F store
    function findCamera(): boolean {
      const container = containerRef.current
      if (!container) return false
      const canvas = container.querySelector('canvas')
      if (!canvas) return false
      const r3f = (canvas as any).__r3f
      if (!r3f?.store) return false
      const state = r3f.store.getState()
      if (!state.camera) return false
      camera = state.camera
      baseX = camera.position.x
      baseY = camera.position.y
      return true
    }

    // Retry finding camera
    let attempts = 0
    let findRafId: number
    function tryFindCamera() {
      if (findCamera()) return
      if (attempts++ < 30) findRafId = requestAnimationFrame(tryFindCamera)
    }

    const findTimer = setTimeout(() => {
      findRafId = requestAnimationFrame(tryFindCamera)
    }, 200)

    // Smooth interpolation values
    let targetOffsetX = 0
    let targetOffsetY = 0
    let currentOffsetX = 0
    let currentOffsetY = 0

    function handleOrientation(event: DeviceOrientationEvent) {
      if (!camera) return
      if (!hasBase) {
        baseX = camera.position.x
        baseY = camera.position.y
        hasBase = true
      }

      // beta: front-back tilt (-180 to 180), gamma: left-right tilt (-90 to 90)
      const beta = event.beta ?? 0
      const gamma = event.gamma ?? 0

      // Map tilt to camera offset (subtle movement, ±0.5 units)
      const range = 0.5
      targetOffsetX = (gamma / 45) * range
      targetOffsetY = ((beta - 45) / 45) * range
    }

    // Smooth animation loop
    function animate() {
      if (camera && hasBase) {
        currentOffsetX += (targetOffsetX - currentOffsetX) * 0.05
        currentOffsetY += (targetOffsetY - currentOffsetY) * 0.05
        camera.position.x = baseX + currentOffsetX
        camera.position.y = baseY + currentOffsetY
      }
      animRafId = requestAnimationFrame(animate)
    }

    // Request permission on iOS 13+ (requires user gesture)
    const startAccelerometer = async () => {
      if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
        try {
          const permission = await (DeviceOrientationEvent as any).requestPermission()
          if (permission !== 'granted') return
        } catch {
          return
        }
      }
      window.addEventListener('deviceorientation', handleOrientation, { passive: true })
      animRafId = requestAnimationFrame(animate)
    }

    startAccelerometer()

    return () => {
      clearTimeout(findTimer)
      cancelAnimationFrame(findRafId)
      cancelAnimationFrame(animRafId)
      window.removeEventListener('deviceorientation', handleOrientation)
    }
  }, [mounted])

  return (
    <>
      {/* Flat color placeholder - always present, fades out when WebGL is ready */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          backgroundColor: cfg.fallbackColor,
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
                fov={cfg.fov}
                pixelDensity={cfg.pixelDensity}
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
                  animate={cfg.animate}
                  brightness={cfg.brightness}
                  cAzimuthAngle={cfg.cAzimuthAngle}
                  cDistance={cfg.cDistance}
                  cPolarAngle={cfg.cPolarAngle}
                  cameraZoom={cfg.cameraZoom}
                  color1={startColor}
                  color2={middleColor}
                  color3={endColor}
                  envPreset={cfg.envPreset}
                  grain={cfg.grain}
                  lightType={cfg.lightType}
                  positionX={cfg.positionX}
                  positionY={cfg.positionY}
                  positionZ={cfg.positionZ}
                  reflection={cfg.reflection}
                  rotationX={cfg.rotationX}
                  rotationY={cfg.rotationY}
                  rotationZ={cfg.rotationZ}
                  type={cfg.type}
                  uAmplitude={cfg.uAmplitude}
                  uDensity={cfg.uDensity}
                  uFrequency={cfg.uFrequency}
                  uSpeed={cfg.uSpeed}
                  uStrength={cfg.uStrength}
                  uTime={cfg.uTime}
                />
              </ShaderGradientCanvas>
            )}
          </div>
        </WebGLErrorBoundary>
      )}
    </>
  )
}
