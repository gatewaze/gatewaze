import DOMPurify from 'isomorphic-dompurify'

/**
 * Server-and-client safe HTML sanitization for admin-supplied content
 * rendered through `dangerouslySetInnerHTML`. Closes spec PR-H-2:
 * stored XSS via unsanitized custom HTML on the public portal's legal
 * pages.
 *
 * Per-context allowlists keep each page's content surface minimal:
 *
 *  - 'marketing-page' is the default for legal/marketing pages (privacy,
 *    terms, do-not-sell, cookie-policy). Allows headings, paragraphs,
 *    emphasis, lists, links, basic styling. **No `<script>`, `<style>`,
 *    or event handlers.**
 *
 *  - 'inline-style' is for the rare CSS-only block a page renders to
 *    apply admin-set theming. Allows ONLY a `<style>` element's text
 *    content; everything else is stripped.
 *
 * Tracking scripts in the brand layout (trackingHead / trackingBody)
 * are NOT sanitized here — they're an explicit admin-controlled JS
 * injection feature. Phase-4 work restricts those write paths to
 * `super_admin` and audits each change.
 */

export type SanitizeContext = 'marketing-page' | 'inline-style'

const MARKETING_PAGE_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'strong', 'em', 'b', 'i', 'u', 's',
    'a', 'span', 'div',
    'ul', 'ol', 'li',
    'blockquote',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'code', 'pre',
    'hr',
    'table', 'thead', 'tbody', 'tr', 'td', 'th',
    'img',
  ],
  ALLOWED_ATTR: [
    'href', 'target', 'rel',
    'src', 'alt', 'width', 'height',
    'class', 'id',
  ],
  // Drop entire blocks of dangerous content.
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button'],
  FORBID_ATTR: ['style', 'onload', 'onerror', 'onclick', 'onmouseover', 'onfocus', 'onblur'],
}

const INLINE_STYLE_CONFIG = {
  ALLOWED_TAGS: ['style'],
  ALLOWED_ATTR: [],
  // ADD_TAGS forces DOMPurify to permit <style> which it strips by
  // default (even when listed in ALLOWED_TAGS); FORCE_BODY keeps the
  // node even though it would normally be moved to <head>.
  ADD_TAGS: ['style'],
  FORCE_BODY: true,
  FORBID_TAGS: ['script', 'iframe', 'object', 'embed'],
  FORBID_ATTR: ['onload', 'onerror', 'onclick', 'href', 'src'],
}

export function sanitizeHtml(input: string | null | undefined, context: SanitizeContext = 'marketing-page'): string {
  if (!input) return ''
  const config = context === 'inline-style' ? INLINE_STYLE_CONFIG : MARKETING_PAGE_CONFIG
  return DOMPurify.sanitize(input, config)
}
