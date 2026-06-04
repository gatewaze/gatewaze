'use client'

/**
 * SegmentedControl — a pill/tab group with a sliding white indicator that animates under the active
 * option. Mirrors the prototype's `.gw-seg` enhancer: a single layout-effect measures the active
 * button and drives CSS custom props (`--seg-x` / `--seg-w`) on the track; the indicator transitions
 * via transform/width. Respects `prefers-reduced-motion` (handled in shell.css).
 */
import { useLayoutEffect, useRef, useState } from 'react'

export interface SegmentedOption<T extends string = string> {
  value: T
  label: string
  count?: number | string
}

export interface SegmentedControlProps<T extends string = string> {
  options: SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  className?: string
  'aria-label'?: string
}

export function SegmentedControl<T extends string = string>({
  options,
  value,
  onChange,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [indicator, setIndicator] = useState<{ x: number; w: number }>({ x: 0, w: 0 })

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const active = track.querySelector<HTMLButtonElement>('.gw-seg-btn[data-active="true"]')
    if (active) setIndicator({ x: active.offsetLeft, w: active.offsetWidth })
  }, [value, options])

  return (
    <div
      ref={trackRef}
      className={`gw-seg ${className ?? ''}`}
      role="tablist"
      aria-label={rest['aria-label']}
      style={{ ['--seg-x' as string]: `${indicator.x}px`, ['--seg-w' as string]: `${indicator.w}px` }}
    >
      <span className="gw-seg-ind" aria-hidden />
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            data-active={active}
            className="gw-seg-btn"
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
            {opt.count != null && <span className="gw-seg-count">{opt.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

export default SegmentedControl
