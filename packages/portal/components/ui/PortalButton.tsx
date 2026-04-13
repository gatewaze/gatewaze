'use client'

import { ReactNode } from 'react'
import Link from 'next/link'
import { isLightColor } from '@/config/brand'

interface Props {
  children: ReactNode
  /** Button variant - primary uses solid color, secondary is transparent with border */
  variant: 'primary' | 'secondary'
  /** Primary color for the primary variant button */
  primaryColor?: string
  /** Button size */
  size?: 'small' | 'large'
  /** URL for link buttons */
  href?: string
  /** Click handler */
  onClick?: () => void
  /** Button type for form buttons */
  type?: 'button' | 'submit'
  /** Disabled state */
  disabled?: boolean
  /** Loading state - shows spinner */
  isLoading?: boolean
  /** Enable spinning glow border effect (primary variant only) */
  glow?: boolean
  /** Link target (e.g., "_blank" for new tab) */
  target?: string
  /** Link rel attribute (e.g., "noopener noreferrer" for external links) */
  rel?: string
  /** Additional class names */
  className?: string
}

/**
 * Portal button component with primary and secondary variants.
 *
 * Primary: Solid color background with white text (uses primaryColor)
 * Secondary: Transparent with white border and white text
 *
 * Can render as a button or Link based on href prop.
 */
export function PortalButton({
  children,
  variant,
  primaryColor = '#6366f1',
  size = 'large',
  href,
  onClick,
  type = 'button',
  disabled = false,
  isLoading = false,
  glow = false,
  target,
  rel,
  className = '',
}: Props) {
  const isDisabled = disabled || isLoading

  // Size classes
  const sizeClasses = size === 'small'
    ? 'px-3 py-1.5 text-sm'
    : 'px-6 py-3'

  // Base classes shared by both variants
  const baseClasses = `
    inline-flex items-center justify-center gap-2
    font-semibold
    cursor-pointer
    transition-all duration-200
    disabled:opacity-50 disabled:cursor-not-allowed
    ${sizeClasses}
    ${className}
  `.trim().replace(/\s+/g, ' ')

  // Determine text color for primary buttons based on primary color lightness
  const primaryTextColor = isLightColor(primaryColor) ? '#000000' : '#ffffff'

  // Variant-specific styles — all buttons get backdrop-blur for glass effect
  const baseStyle: React.CSSProperties = {
    borderRadius: 'var(--radius-control)',
    backdropFilter: 'blur(var(--glass-blur, 4px))',
    WebkitBackdropFilter: 'blur(var(--glass-blur, 4px))',
  }
  const variantStyles: React.CSSProperties = variant === 'primary'
    ? {
        ...baseStyle,
        backgroundColor: primaryColor,
        borderColor: primaryColor,
        borderWidth: '3px',
        borderStyle: 'solid' as const,
        color: primaryTextColor,
        boxShadow: isLightColor(primaryColor)
          ? `inset 0 0 0 1px rgba(0, 0, 0, 0.1), 0 4px 6px -1px rgba(0, 0, 0, 0.1)`
          : `inset 0 0 0 1px rgba(255, 255, 255, 0.5), 0 4px 6px -1px rgba(0, 0, 0, 0.1)`,
        '--button-bg': primaryColor,
      } as React.CSSProperties
    : baseStyle

  const variantClasses = variant === 'primary'
    ? 'shadow-md hover:shadow-xl hover:brightness-110'
    : 'text-white/80 border border-white/30 hover:bg-white/10 hover:text-white'

  // Add portal-primary-button class for consistent styling, glow-button for animation
  const portalPrimaryClass = variant === 'primary' ? 'portal-primary-button' : ''
  const glowClass = glow && variant === 'primary' ? 'glow-button' : ''

  const combinedClasses = `${baseClasses} ${variantClasses} ${portalPrimaryClass} ${glowClass}`

  // Loading spinner
  const loadingSpinner = (
    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
    </svg>
  )

  const innerContent = isLoading ? (
    <>
      {loadingSpinner}
      {children}
    </>
  ) : children

  // Wrap content in span for primary buttons (needed for z-index stacking with pseudo-elements)
  const content = variant === 'primary' ? (
    <span className="relative z-10 flex items-center gap-2">{innerContent}</span>
  ) : innerContent

  // Render as Link if href is provided and not disabled
  if (href && !isDisabled) {
    // Use anchor tag for external links or when target is specified
    const isExternal = href.startsWith('http://') || href.startsWith('https://')
    if (isExternal || target) {
      return (
        <a
          href={href}
          className={combinedClasses}
          style={variantStyles}
          target={target}
          rel={rel || (target === '_blank' ? 'noopener noreferrer' : undefined)}
        >
          {content}
        </a>
      )
    }
    return (
      <Link
        href={href}
        className={combinedClasses}
        style={variantStyles}
      >
        {content}
      </Link>
    )
  }

  // Render as button
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      className={combinedClasses}
      style={variantStyles}
    >
      {content}
    </button>
  )
}
