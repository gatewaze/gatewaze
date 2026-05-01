/**
 * RFC 5545 helpers for emitting calendar (.ics) feeds.
 *
 * Extracted into a sibling module so the route handler stays small and
 * the security-sensitive escaping logic is unit-testable.
 */

/**
 * Escape a value per RFC 5545 §3.3.11 (TEXT property values: SUMMARY,
 * DESCRIPTION, LOCATION, …). Newlines become `\n`, commas/semicolons are
 * backslash-escaped, raw CR is stripped (would break folding), and
 * existing backslashes are doubled first so user-supplied `\n` literals
 * don't smuggle through.
 */
export function escapeICSText(input: string | null | undefined): string {
  if (!input) return ''
  return input
    .replace(/\\/g, '\\\\')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;')
}

/**
 * Sanitise a value for use in non-text ICS properties (URI, UID, etc.) per
 * RFC 5545 §3.3.13. The text-escape helper is wrong here because it
 * backslash-escapes commas/semicolons (legal characters in URIs); but raw
 * CR/LF in a DB-controlled URL or UID would let an attacker inject a new
 * ICS property line ("\r\nURL:evil" or "\r\nBEGIN:VEVENT"). Strip CR/LF
 * and other ASCII control characters defensively.
 */
export function sanitizeICSLineValue(input: string | null | undefined): string {
  if (!input) return ''
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\r\n\u0000-\u001f\u007f]/g, '')
}

/**
 * Fold a content line per RFC 5545 §3.1: lines longer than 75 octets
 * must be split, with each continuation prefixed by a single space.
 */
export function foldLine(line: string): string {
  if (line.length <= 75) return line
  // First chunk: 75 octets, no prefix.
  // Continuation chunks: 74 content octets + leading space = 75 octets each.
  // The previous version used stride 73 which silently duplicated 2 octets
  // between chunks (bug surfaced by the round-trip unit test).
  const parts: string[] = [line.slice(0, 75)]
  for (let i = 75; i < line.length; i += 74) {
    parts.push(' ' + line.slice(i, i + 74))
  }
  return parts.join('\r\n')
}

function pad(n: number): string { return n < 10 ? `0${n}` : `${n}` }

/** Emit an ISO timestamp as ICS DATE-TIME (YYYYMMDDTHHMMSSZ, UTC). */
export function formatICSDate(iso: string): string {
  const d = new Date(iso)
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  )
}
