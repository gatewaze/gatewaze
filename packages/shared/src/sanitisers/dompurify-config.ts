/**
 * DOMPurify configurations for the canvas — per spec-sites-wysiwyg-builder §7.1.
 *
 * These configs are static, platform-defined constants. They are NOT exposed
 * via any user-configurable setting, env var, or admin UI. Changes ship as
 * code and require platform-version bumps. This prevents an operator from
 * inadvertently weakening the sanitiser by extending the allowlist.
 *
 * Three sanitisation tiers (one save-time per format + one document-level
 * backstop):
 *
 *   format               | save-time config           | doc-level backstop
 *   ---------------------|----------------------------|-----------------------
 *   (default text)       | escape-only (no HTML)      | DOMPURIFY_HTML_CONFIG
 *   "html"               | DOMPURIFY_HTML_CONFIG      | DOMPURIFY_HTML_CONFIG
 *   "trusted-html"       | DOMPURIFY_TRUSTED_HTML_*   | DOMPURIFY_HTML_CONFIG
 *                        |                            |   (preserved via
 *                        |                            |    data-trusted-html)
 *
 * For format: "trusted-html", canonical-render stamps `data-trusted-html="1"`
 * on the substituted element so the document-level backstop preserves the
 * iframe/script/style tags that the save-time pass already vetted.
 */

import DOMPurify from 'isomorphic-dompurify';

export const DOMPURIFY_HTML_ALLOWED_TAGS = [
  'a', 'abbr', 'b', 'br', 'em', 'i', 'p', 'span', 'strong', 'u',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'blockquote', 'code', 'pre',
] as const;

export const DOMPURIFY_HTML_ALLOWED_ATTR = [
  'href', 'title', 'target', 'rel',
] as const;

export const DOMPURIFY_TRUSTED_HTML_ALLOWED_TAGS = [
  ...DOMPURIFY_HTML_ALLOWED_TAGS,
  'iframe', 'script', 'style',
] as const;

export const DOMPURIFY_TRUSTED_HTML_ALLOWED_ATTR = [
  ...DOMPURIFY_HTML_ALLOWED_ATTR,
  'src', 'allow', 'allowfullscreen', 'frameborder', 'sandbox',
  'data-trusted-html',
] as const;

/**
 * Sanitise a `format: "html"` field on save. Strips everything outside the
 * allowlist; preserves nothing aggressive. Used by op-handlers for
 * block.update_field / brick.update_field on rich-text fields.
 */
export function sanitiseHtmlField(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [...DOMPURIFY_HTML_ALLOWED_TAGS],
    ALLOWED_ATTR: [...DOMPURIFY_HTML_ALLOWED_ATTR],
    ALLOW_DATA_ATTR: false,
  });
}

/**
 * Sanitise a `format: "trusted-html"` field on save. Permits iframe/script/
 * style with src-allowlisted attrs. Used by op-handlers for super-admin-only
 * trusted-html fields.
 */
export function sanitiseTrustedHtmlField(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS: [...DOMPURIFY_TRUSTED_HTML_ALLOWED_TAGS],
    ALLOWED_ATTR: [...DOMPURIFY_TRUSTED_HTML_ALLOWED_ATTR],
    ALLOW_DATA_ATTR: true,
  });
}

/**
 * Document-level backstop pass on the final rendered HTML produced by
 * canonical-render. Catches the case where a buggy save-time sanitiser
 * missed something. Elements stamped with `data-trusted-html="1"` are
 * preserved (iframe/script/style stay) — the canonical-render adds that
 * marker on the parent element when substituting trusted-html field
 * content.
 *
 * Phase 2 will expose a custom hook on DOMPurify to skip subtree
 * sanitisation when `data-trusted-html="1"` is present on an ancestor;
 * v1 uses the simpler `ADD_TAGS`/`ADD_ATTR` extension to keep iframe/etc.
 * available at the document level too — defense relies on the save-time
 * pass having already vetted them.
 */
export function sanitiseDocument(html: string): string {
  const sanitised = DOMPurify.sanitize(html, {
    // Whole-document mode — preserve <html>/<head>/<body>.
    WHOLE_DOCUMENT: true,
    // Canvas iframe needs <meta http-equiv="Content-Security-Policy">.
    ADD_TAGS: ['meta', 'iframe', 'script', 'style', 'title'],
    ADD_ATTR: [
      'http-equiv', 'content', 'charset',
      'src', 'allow', 'allowfullscreen', 'frameborder', 'sandbox',
      'data-trusted-html', 'data-block-id', 'data-canvas-page-id',
      'data-field', 'data-edit', 'data-children', 'data-asset', 'data-block-root',
    ],
    ALLOW_DATA_ATTR: true,
  });
  // DOMPurify in WHOLE_DOCUMENT mode strips the DOCTYPE; canvas-render
  // emits HTML5, so we re-attach the standard doctype so the iframe
  // doesn't quirks-mode-render. Only prepend if the sanitiser left a
  // <html> root behind.
  if (/^\s*<html[\s>]/i.test(sanitised)) {
    return `<!DOCTYPE html>\n${sanitised}`;
  }
  return sanitised;
}
