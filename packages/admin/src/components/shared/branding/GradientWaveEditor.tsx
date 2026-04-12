import { useState, useEffect, lazy, Suspense } from "react";
import { createPortal } from "react-dom";
import { Text, Switch, Tabs, Theme } from "@radix-ui/themes";
import { ArrowPathIcon, XMarkIcon, SwatchIcon, Cog6ToothIcon } from "@heroicons/react/24/outline";
import { SliderInput } from "./SliderInput";

// Lazy-load ShaderGradient to avoid pulling Three.js into the main bundle
const ShaderGradientCanvas = lazy(() =>
  import("@shadergradient/react").then((m) => ({ default: m.ShaderGradientCanvas }))
);
const ShaderGradient = lazy(() =>
  import("@shadergradient/react").then((m) => ({ default: m.ShaderGradient }))
);

// ── Types ──────────────────────────────────────────────────────────

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

// ── Presets ────────────────────────────────────────────────────────

interface GradientPreset {
  name: string;
  colors: { start: string; middle: string; end: string };
  config: GradientWaveConfig;
}

const GRADIENT_PRESETS: GradientPreset[] = [
  {
    name: "Default",
    colors: { start: "#00a2c7", middle: "#0e7490", end: "#0a0a0a" },
    config: { ...DEFAULT_GRADIENT_WAVE_CONFIG },
  },
  {
    name: "Sunset Sphere",
    colors: { start: "#73bfc4", middle: "#ff810a", end: "#8da0ce" },
    config: {
      ...DEFAULT_GRADIENT_WAVE_CONFIG,
      type: "sphere", uStrength: 0, uDensity: 0.8, uAmplitude: 2, uFrequency: 5.5,
      uSpeed: 0.3, brightness: 0.8, grain: "on", lightType: "env", reflection: 0.4,
      cAzimuthAngle: 270, cPolarAngle: 180, cDistance: 0.5, cameraZoom: 14.84,
      positionX: -0.1, rotationY: 130, rotationZ: 70, pixelDensity: 1.6,
      fallbackColor: "#2a3040",
    },
  },
  {
    name: "Ocean Wave",
    colors: { start: "#0066cc", middle: "#00b4d8", end: "#023047" },
    config: {
      ...DEFAULT_GRADIENT_WAVE_CONFIG,
      type: "waterPlane", uStrength: 2, uDensity: 1.5, uAmplitude: 1, uFrequency: 3,
      uSpeed: 0.15, brightness: 1, reflection: 0.3, cPolarAngle: 70, cDistance: 4,
      fallbackColor: "#023047",
    },
  },
  {
    name: "Aurora",
    colors: { start: "#00ff87", middle: "#7b2ff7", end: "#0a0a0a" },
    config: {
      ...DEFAULT_GRADIENT_WAVE_CONFIG,
      uStrength: 3, uDensity: 0.8, uAmplitude: 1.5, uFrequency: 5, uSpeed: 0.1,
      brightness: 1.4, lightType: "env", envPreset: "dawn", reflection: 0.2, rotationZ: 30,
    },
  },
  {
    name: "Minimal",
    colors: { start: "#333333", middle: "#555555", end: "#111111" },
    config: {
      ...DEFAULT_GRADIENT_WAVE_CONFIG,
      uStrength: 0.5, uDensity: 1, uAmplitude: 0.3, uFrequency: 3, uSpeed: 0.1,
      brightness: 0.8, reflection: 0.05,
      fallbackColor: "#111111",
    },
  },
  {
    name: "Lava",
    colors: { start: "#ff4500", middle: "#ff8c00", end: "#1a0000" },
    config: {
      ...DEFAULT_GRADIENT_WAVE_CONFIG,
      type: "sphere", uStrength: 4, uDensity: 2, uAmplitude: 3, uFrequency: 4,
      fallbackColor: "#1a0000",
      uSpeed: 0.15, brightness: 1.3, grain: "on", reflection: 0.3,
      cameraZoom: 3, cDistance: 2.5, rotationZ: 90,
    },
  },
];

// ── Helpers ────────────────────────────────────────────────────────

function SegmentPicker<T extends string>({
  label,
  description,
  options,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      <Text as="label" size="2" weight="medium">{label}</Text>
      {description && <Text as="p" size="1" color="gray">{description}</Text>}
      <div className="flex gap-1 pt-2">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              value === opt.value
                ? "bg-[var(--accent-9)] text-white"
                : "bg-[var(--gray-3)] text-[var(--gray-11)] hover:bg-[var(--gray-4)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string; description?: string; checked: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Text as="label" size="2" weight="medium">{label}</Text>
        {description && <Text as="p" size="1" color="gray">{description}</Text>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function XYZInputs({ label, x, y, z, onChange, min, max, step }: {
  label: string; x: number; y: number; z: number;
  onChange: (axis: "x" | "y" | "z", v: number) => void; min: number; max: number; step: number;
}) {
  return (
    <div>
      <Text as="label" size="2" weight="medium" className="pb-1">{label}</Text>
      <div className="grid grid-cols-3 gap-3 pt-1">
        {(["x", "y", "z"] as const).map((axis) => {
          const val = axis === "x" ? x : axis === "y" ? y : z;
          return (
            <div key={axis} className="space-y-1">
              <Text size="1" color="gray" className="uppercase">{axis}</Text>
              <input
                type="number" value={val}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v)) onChange(axis, parseFloat(Math.min(max, Math.max(min, v)).toFixed(2)));
                }}
                min={min} max={max} step={step}
                className="w-full rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-2 py-1.5 font-mono text-sm tabular-nums"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export function GradientWaveEditor({
  config,
  onChange,
  colors,
  onColorsChange,
  uiMode = "auto",
  onUiModeChange,
  accentColor,
  onAccentColorChange,
  cornerStyle,
  onCornerStyleChange,
}: {
  config: GradientWaveConfig;
  onChange: (config: GradientWaveConfig) => void;
  colors?: { start: string; middle: string; end: string };
  onColorsChange?: (colors: { start: string; middle: string; end: string }) => void;
  uiMode?: "auto" | "dark" | "light";
  onUiModeChange?: (mode: "auto" | "dark" | "light") => void;
  accentColor?: string;
  onAccentColorChange?: (color: string) => void;
  cornerStyle?: "square" | "rounded" | "pill";
  onCornerStyleChange?: (style: "square" | "rounded" | "pill") => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("portal");

  const update = <K extends keyof GradientWaveConfig>(key: K, value: GradientWaveConfig[K]) =>
    onChange({ ...config, [key]: value });

  const applyPreset = (preset: GradientPreset) => {
    onChange(preset.config);
    onColorsChange?.(preset.colors);
  };

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === "Escape") setIsOpen(false); };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen]);

  // Use current colors or fallback for preview
  const previewColors = colors ?? GRADIENT_PRESETS[0].colors;

  return (
    <>
      {/* Open button */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-4 rounded-xl border-2 border-[var(--accent-6)] bg-[var(--accent-2)] p-5 w-full text-left hover:border-[var(--accent-8)] hover:bg-[var(--accent-3)] transition-colors"
      >
        {/* Mini gradient preview */}
        <div
          className="w-14 h-14 rounded-lg flex-shrink-0 border border-black/10"
          style={{
            background: previewColors
              ? `linear-gradient(135deg, ${previewColors.start}, ${previewColors.middle}, ${previewColors.end})`
              : "linear-gradient(135deg, #00a2c7, #0e7490, #0a0a0a)",
          }}
        />
        <div className="flex-1">
          <div className="text-sm font-semibold">Open Portal Theme Editor</div>
          <div className="text-xs text-[var(--gray-9)] mt-0.5">
            Background, colors, accent, UI mode, corner style &mdash; fullscreen with live preview
          </div>
        </div>
        <Cog6ToothIcon className="size-5 text-[var(--accent-9)] flex-shrink-0" />
      </button>

      {/* Fullscreen overlay: portaled to document.body so it escapes all parent clipping/stacking */}
      {isOpen && createPortal(
        <Theme>
        <div style={{ position: "fixed", inset: 0, zIndex: 99999, backgroundColor: config.fallbackColor }}>
          {/* Live ShaderGradient background */}
          <Suspense fallback={null}>
            <ShaderGradientCanvas
              fov={config.fov}
              pixelDensity={config.pixelDensity}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
            >
              <ShaderGradient
                animate={config.animate}
                brightness={config.brightness}
                cAzimuthAngle={config.cAzimuthAngle}
                cDistance={config.cDistance}
                cPolarAngle={config.cPolarAngle}
                cameraZoom={config.cameraZoom}
                color1={previewColors.start}
                color2={previewColors.middle}
                color3={previewColors.end}
                envPreset={config.envPreset}
                grain={config.grain}
                lightType={config.lightType}
                positionX={config.positionX}
                positionY={config.positionY}
                positionZ={config.positionZ}
                reflection={config.reflection}
                rotationX={config.rotationX}
                rotationY={config.rotationY}
                rotationZ={config.rotationZ}
                type={config.type}
                uAmplitude={config.uAmplitude}
                uDensity={config.uDensity}
                uFrequency={config.uFrequency}
                uSpeed={config.uSpeed}
                uStrength={config.uStrength}
                uTime={config.uTime}
              />
            </ShaderGradientCanvas>
          </Suspense>

          {/* Sample UI components to preview light/dark readability */}
          {(() => {
            const isDark = uiMode === "dark" || (uiMode === "auto" && true);
            const textColor = isDark ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.9)";
            const mutedColor = isDark ? "rgba(255,255,255,0.5)" : "rgba(0,0,0,0.5)";
            const go = config.glassOpacity;
            const gb = config.glassBlur;
            const gbo = config.glassBorderOpacity;
            const cardBg = isDark ? `rgba(255,255,255,${go})` : `rgba(0,0,0,${go})`;
            const borderCol = isDark ? `rgba(255,255,255,${gbo})` : `rgba(0,0,0,${gbo})`;
            const blurVal = `blur(${gb}px)`;
            const btnRadius = cornerStyle === "pill" ? 9999 : cornerStyle === "rounded" ? 8 : 2;
            const pillRadius = cornerStyle === "pill" ? 9999 : cornerStyle === "rounded" ? 20 : 4;
            const cardRadius = cornerStyle === "pill" ? 16 : cornerStyle === "rounded" ? 12 : 4;
            const accent = accentColor || "#00a2c7";
            return (
              <div style={{ position: "fixed", top: 40, left: 40, maxWidth: 560, pointerEvents: "none" }}>
                <div style={{ color: textColor, fontFamily: "Inter, system-ui, sans-serif" }}>
                  <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8 }}>Upcoming Events</h1>
                  <p style={{ fontSize: 14, color: mutedColor, marginBottom: 24 }}>Browse our latest events and register to attend.</p>

                  {/* Filter pills */}
                  <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
                    {["All", "Conferences", "Workshops", "Meetups"].map((t, i) => (
                      <span key={t} style={{
                        padding: "6px 14px", borderRadius: pillRadius, fontSize: 13, fontWeight: 500,
                        background: i === 0 ? accent : cardBg,
                        backdropFilter: i === 0 ? undefined : blurVal,
                        color: i === 0 ? "#fff" : textColor,
                        border: `1px solid ${i === 0 ? "transparent" : borderCol}`,
                      }}>{t}</span>
                    ))}
                  </div>

                  {/* Event card */}
                  <div style={{
                    background: cardBg, backdropFilter: blurVal,
                    border: `1px solid ${borderCol}`, borderRadius: cardRadius, padding: 20,
                    marginBottom: 12,
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>AI Agents Summit</div>
                    <div style={{ fontSize: 13, color: mutedColor, marginBottom: 12 }}>April 14 &middot; Seattle, WA &middot; Conference</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ padding: "5px 12px", borderRadius: btnRadius, fontSize: 12, background: accent, color: "#fff", fontWeight: 500 }}>Register</span>
                      <span style={{ padding: "5px 12px", borderRadius: btnRadius, fontSize: 12, background: cardBg, backdropFilter: blurVal, color: textColor, border: `1px solid ${borderCol}`, fontWeight: 500 }}>Learn More</span>
                    </div>
                  </div>

                  {/* Second card for contrast */}
                  <div style={{
                    background: cardBg, backdropFilter: blurVal,
                    border: `1px solid ${borderCol}`, borderRadius: cardRadius, padding: 20,
                  }}>
                    <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>Context Engineering Workshop</div>
                    <div style={{ fontSize: 13, color: mutedColor, marginBottom: 12 }}>April 21 &middot; Amsterdam &middot; Workshop</div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <span style={{ padding: "5px 12px", borderRadius: btnRadius, fontSize: 12, background: accent, color: "#fff", fontWeight: 500 }}>Register</span>
                      <span style={{ padding: "5px 12px", borderRadius: btnRadius, fontSize: 12, background: cardBg, backdropFilter: blurVal, color: textColor, border: `1px solid ${borderCol}`, fontWeight: 500 }}>Learn More</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Editor panel — fixed bottom-right, never scrolls the page */}
          <div
            style={{
              position: "fixed",
              top: 16,
              right: 16,
              width: 460,
              maxHeight: "calc(100vh - 32px)",
              display: "flex",
              flexDirection: "column",
            }}
            className="rounded-xl bg-white/90 dark:bg-neutral-900/90 backdrop-blur-xl shadow-2xl border border-white/20 dark:border-neutral-700/50"
          >
            {/* Header — always visible */}
            <div className="flex-shrink-0 flex items-center justify-between px-4 py-3 border-b border-[var(--gray-5)]">
              <Text size="3" weight="bold">Gradient Editor</Text>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    onChange({ ...DEFAULT_GRADIENT_WAVE_CONFIG });
                    onColorsChange?.(GRADIENT_PRESETS[0].colors);
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-[var(--gray-11)] hover:bg-[var(--gray-3)] transition-colors"
                >
                  <ArrowPathIcon className="size-3" />
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="rounded-md p-1.5 text-[var(--gray-11)] hover:bg-[var(--gray-3)] transition-colors"
                >
                  <XMarkIcon className="size-5" />
                </button>
              </div>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Colors */}
              {onColorsChange && (
                <div className="grid grid-cols-3 gap-2">
                  {(["start", "middle", "end"] as const).map((key) => (
                    <div key={key} className="space-y-1">
                      <Text size="1" color="gray" className="capitalize">{key}</Text>
                      <div className="flex items-center gap-1">
                        <input
                          type="color"
                          value={previewColors[key]}
                          onChange={(e) => onColorsChange({ ...previewColors, [key]: e.target.value })}
                          className="h-8 w-10 cursor-pointer rounded border border-[var(--gray-6)] bg-transparent p-0.5"
                        />
                        <input
                          value={previewColors[key]}
                          onChange={(e) => onColorsChange({ ...previewColors, [key]: e.target.value })}
                          className="w-full rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-1.5 py-1 font-mono text-xs"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Presets */}
              <div>
                <Text as="label" size="1" weight="medium" className="flex items-center gap-1 pb-1.5 text-[var(--gray-11)]">
                  <SwatchIcon className="size-3.5" />
                  Presets
                </Text>
                <div className="flex gap-1.5 flex-wrap">
                  {GRADIENT_PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      type="button"
                      onClick={() => applyPreset(preset)}
                      className="rounded-md border border-[var(--gray-6)] px-2.5 py-1.5 text-xs font-medium text-[var(--gray-11)] hover:border-[var(--accent-7)] transition-colors"
                      style={{
                        background: `linear-gradient(135deg, ${preset.colors.start}30, ${preset.colors.middle}30, ${preset.colors.end}30)`,
                      }}
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* UI Mode */}
              {onUiModeChange && (
                <div>
                  <Text as="label" size="1" weight="medium" className="pb-1.5 text-[var(--gray-11)]">
                    UI Mode
                  </Text>
                  <div className="flex gap-1">
                    {(["auto", "dark", "light"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => onUiModeChange(m)}
                        className={`flex-1 rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors ${
                          uiMode === m
                            ? "bg-[var(--accent-9)] text-white"
                            : "bg-[var(--gray-3)] text-[var(--gray-11)] hover:bg-[var(--gray-4)]"
                        }`}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Tabs */}
              <Tabs.Root value={activeTab} onValueChange={setActiveTab}>
                <Tabs.List>
                  <Tabs.Trigger value="portal">Portal</Tabs.Trigger>
                  <Tabs.Trigger value="shape">Shape</Tabs.Trigger>
                  <Tabs.Trigger value="colors">Colors</Tabs.Trigger>
                  <Tabs.Trigger value="motion">Motion</Tabs.Trigger>
                  <Tabs.Trigger value="view">View</Tabs.Trigger>
                </Tabs.List>

                <div className="pt-3 space-y-3">
                  {activeTab === "portal" && (
                    <>
                      {/* Accent Color */}
                      {onAccentColorChange && accentColor !== undefined && (
                        <div>
                          <Text as="label" size="2" weight="medium">Accent Color</Text>
                          <Text as="p" size="1" color="gray">Buttons, links, and interactive elements on the portal.</Text>
                          <div className="flex items-center gap-2 pt-2">
                            <input type="color" value={accentColor} onChange={(e) => onAccentColorChange(e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-[var(--gray-6)] bg-transparent p-0.5" />
                            <input value={accentColor} onChange={(e) => onAccentColorChange(e.target.value)} className="w-full rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-1.5 py-1 font-mono text-xs" />
                          </div>
                        </div>
                      )}

                      {/* UI Mode */}
                      {onUiModeChange && (
                        <SegmentPicker
                          label="UI Mode"
                          description="Dark or light text and UI components on the portal."
                          options={[
                            { value: "auto" as const, label: "Auto" },
                            { value: "dark" as const, label: "Dark" },
                            { value: "light" as const, label: "Light" },
                          ]}
                          value={uiMode}
                          onChange={onUiModeChange}
                        />
                      )}

                      {/* Corner Style */}
                      {onCornerStyleChange && cornerStyle && (
                        <SegmentPicker
                          label="Corner Style"
                          description="Border radius for buttons, inputs, and interactive elements."
                          options={[
                            { value: "square" as const, label: "Square" },
                            { value: "rounded" as const, label: "Rounded" },
                            { value: "pill" as const, label: "Pill" },
                          ]}
                          value={cornerStyle}
                          onChange={onCornerStyleChange}
                        />
                      )}

                      {/* Glass Panel Styling */}
                      <div className="pt-2 border-t border-[var(--gray-5)]">
                        <Text as="label" size="2" weight="bold" className="pb-2 block">Glass Panels</Text>
                      </div>
                      <SliderInput label="Panel Opacity" description="Background opacity of glass panels and cards." value={config.glassOpacity} onChange={(v) => update("glassOpacity", v)} min={0} max={0.3} step={0.01} />
                      <SliderInput label="Blur Amount" description="Backdrop blur intensity on glass panels." value={config.glassBlur} onChange={(v) => update("glassBlur", v)} min={0} max={20} step={1} />
                      <SliderInput label="Border Opacity" description="Border opacity on glass panels and cards." value={config.glassBorderOpacity} onChange={(v) => update("glassBorderOpacity", v)} min={0} max={0.3} step={0.01} />
                      <ToggleRow label="Glow Effects" description="Border glow animations and mouse-tracking highlights on cards." checked={config.glowEffects} onChange={(v) => update("glowEffects", v)} />
                    </>
                  )}

                  {activeTab === "shape" && (
                    <>
                      <SegmentPicker label="Type" options={[{ value: "plane" as const, label: "Plane" }, { value: "sphere" as const, label: "Sphere" }, { value: "waterPlane" as const, label: "Water" }]} value={config.type} onChange={(v) => update("type", v)} />
                      <SliderInput label="Noise Strength" value={config.uStrength} onChange={(v) => update("uStrength", v)} min={0} max={10} step={0.1} />
                      <SliderInput label="Noise Density" value={config.uDensity} onChange={(v) => update("uDensity", v)} min={0} max={10} step={0.1} />
                      <SliderInput label="Spiral" value={config.uAmplitude} onChange={(v) => update("uAmplitude", v)} min={0} max={10} step={0.1} />
                      <SliderInput label="Noise Frequency" value={config.uFrequency} onChange={(v) => update("uFrequency", v)} min={0} max={10} step={0.1} />
                      <SliderInput label="Pixel Density" value={config.pixelDensity} onChange={(v) => update("pixelDensity", v)} min={0.5} max={3} step={0.1} />
                    </>
                  )}

                  {activeTab === "colors" && (
                    <>
                      <ToggleRow label="Grain" checked={config.grain === "on"} onChange={(v) => update("grain", v ? "on" : "off")} />
                      <SegmentPicker label="Light Type" options={[{ value: "3d" as const, label: "3D" }, { value: "env" as const, label: "Environment" }]} value={config.lightType} onChange={(v) => update("lightType", v)} />
                      <SegmentPicker label="Env Preset" options={[{ value: "city" as const, label: "City" }, { value: "dawn" as const, label: "Dawn" }, { value: "lobby" as const, label: "Lobby" }]} value={config.envPreset} onChange={(v) => update("envPreset", v)} />
                      <SliderInput label="Reflection" value={config.reflection} onChange={(v) => update("reflection", v)} min={0} max={1} step={0.05} />
                      <SliderInput label="Brightness" value={config.brightness} onChange={(v) => update("brightness", v)} min={0} max={3} step={0.1} />
                      <div>
                        <Text as="label" size="2" weight="medium">Fallback Color</Text>
                        <Text as="p" size="1" color="gray">Flat background shown while the gradient loads.</Text>
                        <div className="flex items-center gap-2 pt-2">
                          <input type="color" value={config.fallbackColor} onChange={(e) => update("fallbackColor", e.target.value)} className="h-8 w-10 cursor-pointer rounded border border-[var(--gray-6)] bg-transparent p-0.5" />
                          <input value={config.fallbackColor} onChange={(e) => update("fallbackColor", e.target.value)} className="w-full rounded border border-[var(--gray-6)] bg-[var(--color-surface)] px-1.5 py-1 font-mono text-xs" />
                        </div>
                      </div>
                    </>
                  )}

                  {activeTab === "motion" && (
                    <>
                      <ToggleRow label="Animate" checked={config.animate === "on"} onChange={(v) => update("animate", v ? "on" : "off")} />
                      <SliderInput label="Speed" value={config.uSpeed} onChange={(v) => update("uSpeed", v)} min={0} max={2} step={0.1} />
                    </>
                  )}

                  {activeTab === "view" && (
                    <>
                      <SliderInput label="Zoom" value={config.cameraZoom} onChange={(v) => update("cameraZoom", v)} min={0.1} max={20} step={0.1} />
                      <SliderInput label="Field of View" value={config.fov} onChange={(v) => update("fov", v)} min={10} max={120} step={1} />
                      <SliderInput label="Distance" value={config.cDistance} onChange={(v) => update("cDistance", v)} min={0} max={10} step={0.1} />
                      <div className="grid grid-cols-2 gap-3">
                        <SliderInput label="Azimuth" value={config.cAzimuthAngle} onChange={(v) => update("cAzimuthAngle", v)} min={0} max={360} step={1} />
                        <SliderInput label="Polar" value={config.cPolarAngle} onChange={(v) => update("cPolarAngle", v)} min={0} max={360} step={1} />
                      </div>
                      <XYZInputs label="Position" x={config.positionX} y={config.positionY} z={config.positionZ} onChange={(a, v) => update(a === "x" ? "positionX" : a === "y" ? "positionY" : "positionZ", v)} min={-5} max={5} step={0.1} />
                      <XYZInputs label="Rotation" x={config.rotationX} y={config.rotationY} z={config.rotationZ} onChange={(a, v) => update(a === "x" ? "rotationX" : a === "y" ? "rotationY" : "rotationZ", v)} min={0} max={360} step={1} />
                    </>
                  )}
                </div>
              </Tabs.Root>
            </div>
          </div>
        </div>
        </Theme>,
        document.body
      )}
    </>
  );
}
