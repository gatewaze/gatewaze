import { describe, it, expect } from 'vitest'
import { decodeThemeHeader, encodeThemeHeader, parseCustomDomainTheme, themeCssVariables, themeFontsUrl } from '../custom-domain-theme'

describe('custom-domain theme', () => {
  it('keeps only the tokens it can vouch for', () => {
    const t = parseCustomDomainTheme({
      mode: 'light',
      colors: { background: '#FFFFFF', primary: '#ff5500', text: 'red', muted: '#12345', extra: '#000000' },
      fonts: { heading: ' Fraunces ', body: 'Inter; url(x)' },
      logoUrl: 'https://cdn.example/logo.svg',
      radius: 'round',
      css: 'body{display:none}',
    })
    expect(t).toEqual({
      mode: 'light',
      colors: { background: '#ffffff', primary: '#ff5500' },
      fonts: { heading: 'Fraunces' },
      logoUrl: 'https://cdn.example/logo.svg',
      radius: 'round',
    })
    expect(parseCustomDomainTheme({ logoUrl: 'javascript:alert(1)' })).toBeNull()
    expect(parseCustomDomainTheme({ logoUrl: 'http://plain.example/x.png' })).toBeNull()
    expect(parseCustomDomainTheme(null)).toBeNull()
    expect(parseCustomDomainTheme([])).toBeNull()
    expect(parseCustomDomainTheme({ mode: 'neon' })).toBeNull()
  })

  it('round-trips through the header and re-checks on the way back', () => {
    const t = parseCustomDomainTheme({ colors: { primary: '#123456' }, fonts: { body: 'Nunito Sans' } })!
    const h = encodeThemeHeader(t)
    expect(h).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decodeThemeHeader(h)).toEqual(t)
    expect(decodeThemeHeader('not base64!')).toBeNull()
    expect(decodeThemeHeader(encodeThemeHeader({ logoUrl: 'javascript:x' } as never))).toBeNull()
    expect(decodeThemeHeader(null)).toBeNull()
  })

  it('writes the page variables and the portal ones they shadow', () => {
    const vars = themeCssVariables({ colors: { background: '#000000', primary: '#ff5500', primaryText: '#000000' }, fonts: { heading: 'Fraunces', body: 'Inter' }, radius: 'soft', logoUrl: 'https://cdn.example/l.svg' })
    expect(vars['--cd-bg']).toBe('#000000')
    expect(vars['--primary-color']).toBe('#ff5500')
    expect(vars['--primary-text']).toBe('#000000')
    expect(vars['--font-display']).toMatch(/^"Fraunces",/)
    expect(vars['--font-sans']).toMatch(/^"Inter",/)
    // A quote in a font name or a backslash in a logo would end the CSS string early: both are refused.
    expect(parseCustomDomainTheme({ fonts: { body: "O'Neil" } })).toBeNull()
    expect(parseCustomDomainTheme({ logoUrl: 'https://cdn.example/l.svg?x=\\' })).toBeNull()
    expect(vars['--cd-radius']).toBe('10px')
    expect(vars['--cd-logo']).toBe('url("https://cdn.example/l.svg")')
    expect(themeFontsUrl({ fonts: { heading: 'Fraunces', body: 'Nunito Sans' } })).toBe('https://fonts.googleapis.com/css2?family=Fraunces:wght@400;500;600;700&family=Nunito+Sans:wght@400;500;600;700&display=swap')
    expect(themeFontsUrl({ colors: { primary: '#000000' } })).toBeNull()
  })
})
