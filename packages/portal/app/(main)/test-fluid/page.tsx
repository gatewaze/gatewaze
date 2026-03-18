'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'

// Dynamic import to avoid SSR issues with WebGL
const FluidBackground = dynamic(
  () => import('@/components/ui/FluidBackground').then(mod => ({ default: mod.FluidBackground })),
  { ssr: false }
)

type BrandKey = 'mlops' | 'techtickets'

const brandColors: Record<BrandKey, { color1: string; color2: string; color3: string }> = {
  mlops: {
    color1: '#ca2b7f',
    color2: '#4086c6',
    color3: '#1e2837',
  },
  techtickets: {
    color1: '#ee4443',
    color2: '#1e2837',
    color3: '#000000',
  },
}

export default function TestFluidPage() {
  const [strength, setStrength] = useState(0.12)
  const [radius, setRadius] = useState(0.35)
  const [roughness, setRoughness] = useState(0.4)
  const [metalness, setMetalness] = useState(0.1)
  const [activeBrand, setActiveBrand] = useState<BrandKey>('mlops')

  const colors = brandColors[activeBrand]

  // Material presets
  const presets = {
    silky: { roughness: 0.3, metalness: 0.0, strength: 0.1, radius: 0.4 },
    latex: { roughness: 0.2, metalness: 0.05, strength: 0.15, radius: 0.35 },
    velvet: { roughness: 0.7, metalness: 0.0, strength: 0.08, radius: 0.5 },
    metallic: { roughness: 0.25, metalness: 0.6, strength: 0.12, radius: 0.3 },
  }

  const applyPreset = (preset: keyof typeof presets) => {
    const p = presets[preset]
    setRoughness(p.roughness)
    setMetalness(p.metalness)
    setStrength(p.strength)
    setRadius(p.radius)
  }

  return (
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <FluidBackground
        color1={colors.color1}
        color2={colors.color2}
        color3={colors.color3}
        strength={strength}
        radius={radius}
        roughness={roughness}
        metalness={metalness}
      />

      {/* Control panel */}
      <div
        style={{
          position: 'absolute',
          top: 80,
          left: 20,
          background: 'rgba(0,0,0,0.8)',
          padding: '20px',
          borderRadius: '12px',
          color: 'white',
          fontFamily: 'system-ui, sans-serif',
          zIndex: 10,
          minWidth: '280px',
          maxHeight: 'calc(100vh - 100px)',
          overflowY: 'auto',
        }}
      >
        <h2 style={{ margin: '0 0 16px 0', fontSize: '18px' }}>Fluid Material Test</h2>

        {/* Material Presets */}
        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
            Material Presets:
          </label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {Object.keys(presets).map((preset) => (
              <button
                key={preset}
                onClick={() => applyPreset(preset as keyof typeof presets)}
                style={{
                  padding: '6px 12px',
                  borderRadius: '6px',
                  border: 'none',
                  background: '#444',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '12px',
                  textTransform: 'capitalize',
                }}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '16px 0' }} />

        {/* Deformation controls */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
            Strength: {strength.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.02"
            max="0.3"
            step="0.01"
            value={strength}
            onChange={(e) => setStrength(parseFloat(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }}
          />
        </div>

        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
            Radius: {radius.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.1"
            max="0.7"
            step="0.05"
            value={radius}
            onChange={(e) => setRadius(parseFloat(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }}
          />
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '16px 0' }} />

        {/* Material controls */}
        <div style={{ marginBottom: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
            Roughness: {roughness.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.1"
            max="1.0"
            step="0.05"
            value={roughness}
            onChange={(e) => setRoughness(parseFloat(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '11px', color: '#888' }}>Glossy ← → Matte</span>
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px' }}>
            Metalness: {metalness.toFixed(2)}
          </label>
          <input
            type="range"
            min="0.0"
            max="0.8"
            step="0.05"
            value={metalness}
            onChange={(e) => setMetalness(parseFloat(e.target.value))}
            style={{ width: '100%', cursor: 'pointer' }}
          />
          <span style={{ fontSize: '11px', color: '#888' }}>Fabric ← → Metal</span>
        </div>

        <hr style={{ border: 'none', borderTop: '1px solid #444', margin: '16px 0' }} />

        {/* Brand colors */}
        <div style={{ marginBottom: '8px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '14px', fontWeight: 500 }}>
            Brand Colors:
          </label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveBrand('mlops')}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: activeBrand === 'mlops' ? '2px solid white' : '2px solid transparent',
                background: '#ca2b7f',
                color: 'white',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              MLOps
            </button>
            <button
              onClick={() => setActiveBrand('techtickets')}
              style={{
                padding: '8px 16px',
                borderRadius: '6px',
                border: activeBrand === 'techtickets' ? '2px solid white' : '2px solid transparent',
                background: '#ee4443',
                color: 'white',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              TechTickets
            </button>
          </div>
        </div>

        <p style={{ fontSize: '11px', color: '#888', marginTop: '16px', marginBottom: 0, lineHeight: 1.4 }}>
          Move your cursor to see the material deform with realistic PBR lighting (Cook-Torrance BRDF).
        </p>
      </div>

      {/* Sample content */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
          color: 'white',
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        <h1 style={{ fontSize: '48px', fontWeight: 700, margin: 0, textShadow: '0 2px 20px rgba(0,0,0,0.5)' }}>
          Fluid Material
        </h1>
        <p style={{ fontSize: '20px', opacity: 0.9, textShadow: '0 2px 10px rgba(0,0,0,0.5)' }}>
          Interactive WebGL with PBR lighting
        </p>
      </div>
    </div>
  )
}
