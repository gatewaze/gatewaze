'use client'

import { useState, useEffect, useRef, InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

interface GlowInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'ref'> {
  glowColor: string
  borderRadius?: string
  /** Show glow when the input has a value (not just on focus) */
  glowWhenFilled?: boolean
}

interface GlowTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'ref'> {
  glowColor: string
  borderRadius?: string
}

function usePulseAnimation(isFocused: boolean) {
  const [opacity, setOpacity] = useState(0.5)
  const animationRef = useRef<number | null>(null)
  const phaseRef = useRef(0)

  useEffect(() => {
    if (!isFocused) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
      return
    }

    let lastTime = performance.now()

    const animate = (currentTime: number) => {
      const deltaTime = (currentTime - lastTime) / 1000
      lastTime = currentTime

      // Smooth sine wave pulsing opacity between 0.4 and 1.0
      phaseRef.current = (phaseRef.current + deltaTime * 3) % (Math.PI * 2)
      const newOpacity = 0.7 + Math.sin(phaseRef.current) * 0.3
      setOpacity(newOpacity)

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
      }
    }
  }, [isFocused])

  return opacity
}

export function GlowInput({
  glowColor,
  borderRadius = 'var(--radius-control)',
  glowWhenFilled = false,
  className = '',
  onFocus,
  onBlur,
  ...props
}: GlowInputProps) {
  const [isFocused, setIsFocused] = useState(false)
  const hasValue = glowWhenFilled && typeof props.value === 'string' && props.value.length > 0
  const isGlowing = isFocused || hasValue
  const opacity = usePulseAnimation(isGlowing)

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(true)
    onFocus?.(e)
  }

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    setIsFocused(false)
    onBlur?.(e)
  }

  return (
    <div className="relative" style={{ borderRadius }}>
      {/* Glow layer behind input */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          borderRadius,
          boxShadow: `0 0 8px 1px ${glowColor}`,
          opacity: isGlowing ? opacity : 0,
          transition: isGlowing ? undefined : 'opacity 0.2s ease-out',
        }}
      />
      {/* Input */}
      <input
        {...props}
        className={className}
        style={{
          ...props.style,
          borderRadius,
          outline: 'none',
          borderColor: isGlowing ? glowColor : undefined,
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    </div>
  )
}

export function GlowTextarea({
  glowColor,
  borderRadius = 'var(--radius-control)',
  className = '',
  onFocus,
  onBlur,
  ...props
}: GlowTextareaProps) {
  const [isFocused, setIsFocused] = useState(false)
  const opacity = usePulseAnimation(isFocused)

  const handleFocus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    setIsFocused(true)
    onFocus?.(e)
  }

  const handleBlur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    setIsFocused(false)
    onBlur?.(e)
  }

  return (
    <div className="relative" style={{ borderRadius }}>
      {/* Glow layer behind textarea */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          borderRadius,
          boxShadow: `0 0 8px 1px ${glowColor}`,
          opacity: isFocused ? opacity : 0,
          transition: isFocused ? undefined : 'opacity 0.2s ease-out',
        }}
      />
      {/* Textarea */}
      <textarea
        {...props}
        className={className}
        style={{
          ...props.style,
          borderRadius,
          outline: 'none',
          borderColor: isFocused ? glowColor : undefined,
          display: 'block',
        }}
        onFocus={handleFocus}
        onBlur={handleBlur}
      />
    </div>
  )
}
