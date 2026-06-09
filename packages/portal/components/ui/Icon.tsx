/**
 * Inline outline icon registry for the workspace shell.
 *
 * Heroicons-style: 24x24 viewBox, `stroke="currentColor"`, 1.5–2 stroke width, no fill. Icons
 * inherit color from the surrounding text (`currentColor`) so they re-theme with the brand UI mode.
 * Module nav `icon` strings (from `portalShell.rail.icon` / nav entries) resolve to these names.
 *
 * Adding a glyph: add an entry to PATHS keyed by its name. Unknown names render the `default` glyph.
 */
import type { CSSProperties } from 'react'

export type IconName =
  | 'home' | 'calendar' | 'file' | 'msg' | 'star' | 'users' | 'globe'
  | 'search' | 'bell' | 'plus' | 'check' | 'x' | 'more'
  | 'chevD' | 'chevL' | 'chevR' | 'chevU'
  | 'panelOpen' | 'panelClose' | 'menu'
  | 'layers' | 'shield' | 'signal' | 'trend' | 'badge' | 'sparkle' | 'route'
  | 'filter' | 'download' | 'mappin' | 'clock' | 'mic' | 'link' | 'signin'
  | 'newspaper' | 'pencil'
  | 'default'

/** Each value is the inner markup of a 24x24 stroke icon. */
const PATHS: Record<IconName, string> = {
  home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v3M16 3v3"/>',
  file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
  msg: '<path d="M4 5h16v11H8l-4 4z"/>',
  star: '<path d="M12 4l2.4 5 5.6.7-4 3.9 1 5.5L12 16.9 7 19l1-5.5-4-3.9 5.6-.7z"/>',
  users: '<path d="M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="9.5" cy="8" r="3"/><path d="M21 19v-1a4 4 0 0 0-3-3.8"/><path d="M16 5.2A3 3 0 0 1 16 11"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.5 2.5 15 0 18M12 3c-2.5 2.5-2.5 15 0 18"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  bell: '<path d="M18 16H6l1.5-2.5V10a4.5 4.5 0 0 1 9 0v3.5z"/><path d="M10 19a2 2 0 0 0 4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  chevU: '<path d="m6 15 6-6 6 6"/>',
  chevL: '<path d="m15 6-6 6 6 6"/>',
  chevR: '<path d="m9 6 6 6-6 6"/>',
  // panel-collapse chevrons (sidebar show/hide)
  panelClose: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/><path d="m6.5 9-1.5 3 1.5 3"/>',
  panelOpen: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="M9 4.5v15"/><path d="m5 9 1.5 3L5 15"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
  shield: '<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/>',
  signal: '<path d="M5 20v-5M10 20v-9M15 20v-13M20 20V5"/>',
  trend: '<path d="m3 16 5-5 4 4 7-8"/><path d="M16 7h5v5"/>',
  badge: '<circle cx="12" cy="9" r="5"/><path d="m8.5 13-1.5 7 5-3 5 3-1.5-7"/>',
  sparkle: '<path d="M12 3v6M12 15v6M3 12h6M15 12h6"/><path d="m6 6 3 3M15 15l3 3M18 6l-3 3M9 15l-3 3"/>',
  route: '<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h6a4 4 0 0 1 0 8H8a4 4 0 0 0 0 8"/>',
  filter: '<path d="M3 5h18l-7 8v5l-4 2v-7z"/>',
  download: '<path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 19h16"/>',
  mappin: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>',
  link: '<path d="M10 14a4 4 0 0 0 6 .5l3-3a4 4 0 0 0-5.5-5.5l-1.5 1.4"/><path d="M14 10a4 4 0 0 0-6-.5l-3 3A4 4 0 0 0 10.5 18l1.5-1.4"/>',
  signin: '<path d="M14 3h5v18h-5"/><path d="M10 12h9m0 0-4-4m4 4-4 4"/>',
  newspaper: '<path d="M4 5h13v14a1.5 1.5 0 0 0 1.5 1.5h0A1.5 1.5 0 0 0 20 19V8h-3"/><path d="M5.5 20.5h11A1.5 1.5 0 0 0 18 19V5H4v14a1.5 1.5 0 0 0 1.5 1.5z"/><path d="M7 8.5h7M7 12h7M7 15.5h4"/>',
  pencil: '<path d="M4 20h4l10-10a2 2 0 0 0-3-3L5 17z"/><path d="M14 6l3 3"/>',
  default: '<circle cx="12" cy="12" r="8"/>',
}

export interface IconProps {
  name: string
  size?: number
  className?: string
  strokeWidth?: number
  style?: CSSProperties
  'aria-hidden'?: boolean
}

export function Icon({ name, size = 20, className, strokeWidth = 1.75, style, ...rest }: IconProps) {
  const inner = PATHS[(name as IconName)] ?? PATHS.default
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden={rest['aria-hidden'] ?? true}
      dangerouslySetInnerHTML={{ __html: inner }}
    />
  )
}

export default Icon
