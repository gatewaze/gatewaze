import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from '../sanitize-html'

describe('sanitizeHtml — marketing-page context', () => {
  it('strips <script> tags', () => {
    const out = sanitizeHtml('<p>safe</p><script>alert(1)</script>')
    expect(out).toContain('<p>safe</p>')
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('alert(1)')
  })

  it('strips event handler attributes', () => {
    const out = sanitizeHtml('<a href="x" onclick="alert(1)">link</a>')
    expect(out).toContain('href="x"')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('alert(1)')
  })

  it('strips iframes', () => {
    const out = sanitizeHtml('<iframe src="evil.com"></iframe>')
    expect(out).not.toContain('iframe')
    expect(out).not.toContain('evil.com')
  })

  it('preserves safe markup', () => {
    const out = sanitizeHtml('<h2>Title</h2><p>Body <strong>bold</strong> <em>italic</em></p><ul><li>x</li></ul>')
    expect(out).toContain('<h2>Title</h2>')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<li>x</li>')
  })

  it('allows links with target/rel', () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank" rel="noopener">x</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noopener"')
  })

  it('returns empty string for null/undefined', () => {
    expect(sanitizeHtml(null)).toBe('')
    expect(sanitizeHtml(undefined)).toBe('')
    expect(sanitizeHtml('')).toBe('')
  })
})

describe('sanitizeHtml — inline-style context', () => {
  it('keeps the <style> element', () => {
    const out = sanitizeHtml('<style>.foo { color: red; }</style>', 'inline-style')
    expect(out).toContain('color: red')
  })

  it('still strips scripts', () => {
    const out = sanitizeHtml('<style>.x{}</style><script>alert(1)</script>', 'inline-style')
    expect(out).not.toContain('<script>')
    expect(out).not.toContain('alert(1)')
  })
})
