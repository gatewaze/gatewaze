/**
 * Configuration shape and default for the GradientWaveEditor.
 *
 * Lives here (rather than inside GradientWaveEditor.tsx) so that the
 * editor file only exports React components — required for
 * react-refresh fast refresh.
 */

export interface GradientWaveConfig {
  type: "plane" | "sphere" | "waterPlane";
  uStrength: number;
  uDensity: number;
  uAmplitude: number;
  uFrequency: number;
  pixelDensity: number;
  grain: "on" | "off";
  lightType: "3d" | "env";
  envPreset: "city" | "dawn" | "lobby";
  brightness: number;
  reflection: number;
  animate: "on" | "off";
  uSpeed: number;
  uTime: number;
  cameraZoom: number;
  cAzimuthAngle: number;
  cPolarAngle: number;
  cDistance: number;
  fov: number;
  positionX: number;
  positionY: number;
  positionZ: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  fallbackColor: string;
  // Glass panel styling
  glassOpacity: number;
  glassBlur: number;
  glassBorderOpacity: number;
  // UI effects
  glowEffects: boolean;
}

export const DEFAULT_GRADIENT_WAVE_CONFIG: GradientWaveConfig = {
  type: "plane",
  uStrength: 1.5,
  uDensity: 1.3,
  uAmplitude: 0.5,
  uFrequency: 4.5,
  pixelDensity: 1,
  grain: "off",
  lightType: "3d",
  envPreset: "city",
  brightness: 1.2,
  reflection: 0.1,
  animate: "on",
  uSpeed: 0.2,
  uTime: 0,
  cameraZoom: 1,
  cAzimuthAngle: 180,
  cPolarAngle: 90,
  cDistance: 3.6,
  fov: 45,
  positionX: -1.4,
  positionY: 0,
  positionZ: 0,
  rotationX: 0,
  rotationY: 10,
  rotationZ: 50,
  fallbackColor: "#0a0a0a",
  glassOpacity: 0.05,
  glassBlur: 4,
  glassBorderOpacity: 0.1,
  glowEffects: true,
};
