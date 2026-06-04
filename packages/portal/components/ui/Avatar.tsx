/**
 * Avatar — initials circle with optional image, used in the rail (sign-out/avatar), bylines,
 * rosters, etc. Colors come from the brand UI-mode tokens so it inverts per theme.
 */
import Image from 'next/image'
import type { CSSProperties } from 'react'

export interface AvatarProps {
  /** Image URL; falls back to initials when absent or on load error (handled by next/image). */
  src?: string | null
  /** Full name used to derive initials and the alt text. */
  name?: string | null
  size?: number
  className?: string
  style?: CSSProperties
}

function initialsOf(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export function Avatar({ src, name, size = 28, className, style }: AvatarProps) {
  const dimension = { width: size, height: size }
  if (src) {
    return (
      <span
        className={`gw-avatar ${className ?? ''}`}
        style={{ ...dimension, ...style }}
      >
        <Image src={src} alt={name ?? 'avatar'} width={size} height={size} className="gw-avatar-img" />
      </span>
    )
  }
  return (
    <span
      className={`gw-avatar gw-avatar-initials ${className ?? ''}`}
      style={{ ...dimension, fontSize: Math.max(10, Math.round(size * 0.4)), ...style }}
      aria-label={name ?? undefined}
    >
      {initialsOf(name)}
    </span>
  )
}

export default Avatar
