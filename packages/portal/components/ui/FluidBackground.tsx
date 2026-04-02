'use client'

import { Component, useRef, useMemo, useEffect, useState } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// Error boundary to catch WebGL context creation failures
class WebGLErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { hasError: boolean }> {
  constructor(props: { fallback: ReactNode; children: ReactNode }) {
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
    if (this.state.hasError) return this.props.fallback
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

// Vertex shader for mesh deformation with proper normals for lighting
const vertexShader = `
  uniform vec2 uMouse;
  uniform float uTime;
  uniform float uStrength;
  uniform float uRadius;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vWorldPosition;
  varying float vElevation;

  void main() {
    vUv = uv;

    vec3 pos = position;

    // Calculate distance from mouse position (in UV space, mouse is -1 to 1)
    vec2 mouseUV = (uMouse + 1.0) * 0.5;
    float dist = distance(uv, mouseUV);

    // Create smooth falloff for the deformation - more like pressing into fabric
    float influence = 1.0 - smoothstep(0.0, uRadius, dist);
    influence = pow(influence, 1.5); // Softer falloff for fabric feel

    // Main mouse-driven displacement - push INTO the surface
    float displacement = influence * uStrength;

    // Add subtle ambient waves like fabric settling
    float wave1 = sin(uv.x * 4.0 + uTime * 0.3) * cos(uv.y * 3.0 + uTime * 0.2) * 0.008;
    float wave2 = sin(uv.x * 6.0 - uTime * 0.25) * sin(uv.y * 5.0 + uTime * 0.35) * 0.006;
    float wave3 = cos(uv.x * 2.0 + uv.y * 2.0 + uTime * 0.15) * 0.01;

    pos.z += displacement + wave1 + wave2 + wave3;
    vElevation = displacement;

    // Calculate deformed normal for lighting using finite differences
    float eps = 0.01;

    // Sample neighboring points
    float dist_px = distance(uv + vec2(eps, 0.0), mouseUV);
    float dist_nx = distance(uv - vec2(eps, 0.0), mouseUV);
    float dist_py = distance(uv + vec2(0.0, eps), mouseUV);
    float dist_ny = distance(uv - vec2(0.0, eps), mouseUV);

    float inf_px = pow(1.0 - smoothstep(0.0, uRadius, dist_px), 1.5);
    float inf_nx = pow(1.0 - smoothstep(0.0, uRadius, dist_nx), 1.5);
    float inf_py = pow(1.0 - smoothstep(0.0, uRadius, dist_py), 1.5);
    float inf_ny = pow(1.0 - smoothstep(0.0, uRadius, dist_ny), 1.5);

    float z_px = inf_px * uStrength;
    float z_nx = inf_nx * uStrength;
    float z_py = inf_py * uStrength;
    float z_ny = inf_ny * uStrength;

    // Central differences for more accurate normals
    float dzdx = (z_px - z_nx) / (2.0 * eps);
    float dzdy = (z_py - z_ny) / (2.0 * eps);

    vNormal = normalize(vec3(-dzdx, -dzdy, 1.0));
    vPosition = pos;
    vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`

// Fragment shader with realistic fabric/material lighting
const fragmentShader = `
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec2 uMouse;
  uniform float uTime;
  uniform float uRoughness;
  uniform float uMetalness;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vPosition;
  varying vec3 vWorldPosition;
  varying float vElevation;

  // Schlick fresnel approximation
  vec3 fresnelSchlick(float cosTheta, vec3 F0) {
    return F0 + (1.0 - F0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
  }

  // GGX/Trowbridge-Reitz normal distribution
  float distributionGGX(vec3 N, vec3 H, float roughness) {
    float a = roughness * roughness;
    float a2 = a * a;
    float NdotH = max(dot(N, H), 0.0);
    float NdotH2 = NdotH * NdotH;
    float nom = a2;
    float denom = (NdotH2 * (a2 - 1.0) + 1.0);
    denom = 3.14159265 * denom * denom;
    return nom / denom;
  }

  // Geometry function for Smith's method
  float geometrySchlickGGX(float NdotV, float roughness) {
    float r = (roughness + 1.0);
    float k = (r * r) / 8.0;
    float nom = NdotV;
    float denom = NdotV * (1.0 - k) + k;
    return nom / denom;
  }

  float geometrySmith(vec3 N, vec3 V, vec3 L, float roughness) {
    float NdotV = max(dot(N, V), 0.0);
    float NdotL = max(dot(N, L), 0.0);
    float ggx2 = geometrySchlickGGX(NdotV, roughness);
    float ggx1 = geometrySchlickGGX(NdotL, roughness);
    return ggx1 * ggx2;
  }

  void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(vec3(0.0, 0.0, 3.0) - vPosition);

    // Create flowing gradient based on position
    vec2 mouseUV = (uMouse + 1.0) * 0.5;
    float mouseDist = distance(vUv, mouseUV);

    // Base color - smooth gradient between colors
    float gradientAngle = vUv.x * 0.6 + vUv.y * 0.4;
    float timeShift = sin(uTime * 0.1) * 0.05;

    vec3 baseColor = mix(uColor2, uColor1, gradientAngle + timeShift);
    baseColor = mix(baseColor, uColor3, pow(1.0 - vUv.y, 1.5) * 0.5);

    // Subtle color pooling where surface is pressed
    float mouseInfluence = 1.0 - smoothstep(0.0, 0.4, mouseDist);
    baseColor = mix(baseColor, uColor1 * 1.1, mouseInfluence * 0.25);

    // Material properties - slightly glossy fabric/latex feel
    float roughness = uRoughness;
    float metalness = uMetalness;

    // Dielectric F0 with slight tint
    vec3 F0 = mix(vec3(0.04), baseColor, metalness);

    // Multiple light setup for rich material appearance
    vec3 lightPositions[3];
    vec3 lightColors[3];
    float lightIntensities[3];

    // Key light - warm, from upper right
    lightPositions[0] = vec3(3.0, 2.0, 4.0);
    lightColors[0] = vec3(1.0, 0.95, 0.9);
    lightIntensities[0] = 1.2;

    // Fill light - cool, from upper left
    lightPositions[1] = vec3(-2.5, 1.5, 3.0);
    lightColors[1] = vec3(0.9, 0.95, 1.0);
    lightIntensities[1] = 0.6;

    // Rim/back light - for edge definition
    lightPositions[2] = vec3(0.0, -2.0, 2.0);
    lightColors[2] = vec3(1.0, 1.0, 1.0);
    lightIntensities[2] = 0.4;

    // Ambient
    vec3 ambient = baseColor * 0.15;

    // Accumulate lighting
    vec3 Lo = vec3(0.0);

    for (int i = 0; i < 3; i++) {
      vec3 L = normalize(lightPositions[i] - vPosition);
      vec3 H = normalize(V + L);
      float distance = length(lightPositions[i] - vPosition);
      float attenuation = 1.0 / (1.0 + 0.05 * distance * distance);
      vec3 radiance = lightColors[i] * lightIntensities[i] * attenuation;

      // Cook-Torrance BRDF
      float NDF = distributionGGX(N, H, roughness);
      float G = geometrySmith(N, V, L, roughness);
      vec3 F = fresnelSchlick(max(dot(H, V), 0.0), F0);

      vec3 numerator = NDF * G * F;
      float denominator = 4.0 * max(dot(N, V), 0.0) * max(dot(N, L), 0.0) + 0.0001;
      vec3 specular = numerator / denominator;

      vec3 kS = F;
      vec3 kD = vec3(1.0) - kS;
      kD *= 1.0 - metalness;

      float NdotL = max(dot(N, L), 0.0);
      Lo += (kD * baseColor / 3.14159265 + specular) * radiance * NdotL;
    }

    // Fresnel rim effect - gives that silky material edge glow
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0);
    vec3 rimColor = mix(uColor1, uColor2, 0.5);
    vec3 rim = rimColor * fresnel * 0.2;

    // Subsurface scattering approximation - light bleeding through material
    float sss = pow(max(dot(-V, N), 0.0), 2.0) * 0.1;
    vec3 subsurface = baseColor * sss;

    // Elevation-based highlight - pressed areas catch light differently
    float elevationHighlight = vElevation * 1.5;
    vec3 pressHighlight = vec3(1.0) * elevationHighlight * 0.5;

    vec3 finalColor = ambient + Lo + rim + subsurface + pressHighlight;

    // Subtle vignette
    float vignette = 1.0 - pow(length(vUv - 0.5) * 1.2, 2.0) * 0.15;
    finalColor *= vignette;

    // Tone mapping (simple Reinhard)
    finalColor = finalColor / (finalColor + vec3(1.0));

    // Slight saturation boost
    float gray = dot(finalColor, vec3(0.299, 0.587, 0.114));
    finalColor = mix(vec3(gray), finalColor, 1.1);

    gl_FragColor = vec4(finalColor, 1.0);
  }
`

interface FluidMeshProps {
  color1: string
  color2: string
  color3: string
  strength: number
  radius: number
  roughness: number
  metalness: number
}

function FluidMesh({ color1, color2, color3, strength, radius, roughness, metalness }: FluidMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const { viewport, size } = useThree()

  // Smooth mouse position with lerping
  const mouseTarget = useRef({ x: 0, y: 0 })
  const mouseCurrent = useRef({ x: 0, y: 0 })

  const uniforms = useMemo(() => ({
    uMouse: { value: new THREE.Vector2(0, 0) },
    uTime: { value: 0 },
    uStrength: { value: strength },
    uRadius: { value: radius },
    uRoughness: { value: roughness },
    uMetalness: { value: metalness },
    uColor1: { value: new THREE.Color(color1) },
    uColor2: { value: new THREE.Color(color2) },
    uColor3: { value: new THREE.Color(color3) },
  }), [])

  // Update uniforms when props change
  useEffect(() => {
    uniforms.uColor1.value.set(color1)
    uniforms.uColor2.value.set(color2)
    uniforms.uColor3.value.set(color3)
    uniforms.uStrength.value = strength
    uniforms.uRadius.value = radius
    uniforms.uRoughness.value = roughness
    uniforms.uMetalness.value = metalness
  }, [color1, color2, color3, strength, radius, roughness, metalness, uniforms])

  // Mouse/touch event handling
  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      // Convert to normalized device coordinates (-1 to 1)
      const x = (clientX / size.width) * 2 - 1
      const y = -(clientY / size.height) * 2 + 1
      mouseTarget.current = { x, y }
    }

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY)
    }

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY)
      }
    }

    const handleMouseLeave = () => {
      // Slowly return to center when mouse leaves
      mouseTarget.current = { x: 0, y: 0 }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('mouseleave', handleMouseLeave)

    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [size])

  useFrame((state) => {
    if (!meshRef.current) return

    const material = meshRef.current.material as THREE.ShaderMaterial

    // Smooth lerp for mouse position (creates the fluid follow effect)
    const lerpFactor = 0.06
    mouseCurrent.current.x += (mouseTarget.current.x - mouseCurrent.current.x) * lerpFactor
    mouseCurrent.current.y += (mouseTarget.current.y - mouseCurrent.current.y) * lerpFactor

    material.uniforms.uMouse.value.set(mouseCurrent.current.x, mouseCurrent.current.y)
    material.uniforms.uTime.value = state.clock.elapsedTime
  })

  // Create a subdivided plane for smooth deformation
  const geometry = useMemo(() => {
    return new THREE.PlaneGeometry(viewport.width * 1.2, viewport.height * 1.2, 80, 80)
  }, [viewport.width, viewport.height])

  return (
    <mesh ref={meshRef} geometry={geometry}>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={uniforms}
      />
    </mesh>
  )
}

interface FluidBackgroundProps {
  color1?: string
  color2?: string
  color3?: string
  strength?: number
  radius?: number
  roughness?: number
  metalness?: number
  className?: string
}

export function FluidBackground({
  color1 = '#ca2b7f',
  color2 = '#4086c6',
  color3 = '#1e2837',
  strength = 0.12,
  radius = 0.35,
  roughness = 0.4,
  metalness = 0.1,
  className = '',
}: FluidBackgroundProps) {
  const [mounted, setMounted] = useState(false)
  const [webglSupported, setWebglSupported] = useState(true)

  useEffect(() => {
    if (!hasWebGLSupport()) {
      setWebglSupported(false)
      return
    }
    // Small delay to ensure DOM is ready for WebGL context
    const timer = setTimeout(() => setMounted(true), 50)
    return () => clearTimeout(timer)
  }, [])

  const fallbackGradient = (
    <div
      className={className}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        background: `radial-gradient(ellipse 100% 100% at 100% 100%, ${color1} 0%, transparent 80%),
                     radial-gradient(ellipse 80% 80% at 0% 0%, ${color2} 0%, transparent 70%),
                     linear-gradient(135deg, ${color2} 0%, ${color1}60 100%),
                     ${color3}`,
        zIndex: 0,
      }}
    />
  )

  if (!webglSupported || !mounted) {
    return fallbackGradient
  }

  return (
    <WebGLErrorBoundary fallback={fallbackGradient}>
      <div
        className={className}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 0,
        }}
      >
        <Canvas
          camera={{ position: [0, 0, 1], fov: 75 }}
          style={{ width: '100%', height: '100%' }}
          dpr={[1, 2]}
          gl={{
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance',
          }}
        >
          <FluidMesh
            color1={color1}
            color2={color2}
            color3={color3}
            strength={strength}
            radius={radius}
            roughness={roughness}
            metalness={metalness}
          />
        </Canvas>
      </div>
    </WebGLErrorBoundary>
  )
}
