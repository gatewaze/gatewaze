import React from 'react'

/**
 * Renders admin-supplied tracking/analytics markup (Settings → System →
 * Tracking) into the document. The stored value already contains the full
 * tags the user pasted — `<script>…</script>`, `<noscript>…</noscript>`,
 * comments, pixel `<img>`s, etc. — so it must NOT be wrapped in another
 * `<script>`: doing so nests the tags and the browser terminates the outer
 * script at the snippet's own `</script>`, silently breaking GA/GTM/Segment.
 *
 * We instead parse out each `<script>` block and render it as a real React
 * script element (preserving src/async/defer/etc. so it executes), passing
 * any remaining markup through verbatim. Not sanitized by design: this is an
 * explicit, super_admin-only JS injection feature (see sanitize-html.ts).
 */

// HTML attribute name → React prop name for the handful that differ.
const ATTR_MAP: Record<string, string> = {
  class: 'className',
  crossorigin: 'crossOrigin',
  referrerpolicy: 'referrerPolicy',
  charset: 'charSet',
  nomodule: 'noModule',
}

const BOOLEAN_ATTRS = new Set(['async', 'defer', 'nomodule'])

function parseAttrs(raw: string): Record<string, unknown> {
  const attrs: Record<string, unknown> = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    const name = m[1].toLowerCase()
    const value = m[2] ?? m[3] ?? m[4]
    const key = ATTR_MAP[name] ?? name
    attrs[key] = value === undefined || BOOLEAN_ATTRS.has(name) ? true : value
  }
  return attrs
}

function pushRaw(nodes: React.ReactNode[], raw: string, key: number): void {
  const cleaned = raw.replace(/<!--[\s\S]*?-->/g, '')
  if (!cleaned.trim()) return
  nodes.push(
    <span
      key={`r${key}`}
      style={{ display: 'contents' }}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: cleaned }}
    />,
  )
}

export function TrackingMarkup({ html }: { html: string | null | undefined }) {
  if (!html || !html.trim()) return null

  const nodes: React.ReactNode[] = []
  const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let lastIndex = 0
  let key = 0
  let m: RegExpExecArray | null

  while ((m = scriptRe.exec(html))) {
    pushRaw(nodes, html.slice(lastIndex, m.index), key++)
    const attrs = parseAttrs(m[1])
    const inner = m[2]
    nodes.push(
      inner && inner.trim() ? (
        <script key={`s${key++}`} {...attrs} suppressHydrationWarning dangerouslySetInnerHTML={{ __html: inner }} />
      ) : (
        <script key={`s${key++}`} {...attrs} suppressHydrationWarning />
      ),
    )
    lastIndex = scriptRe.lastIndex
  }
  pushRaw(nodes, html.slice(lastIndex), key++)

  return <>{nodes}</>
}
