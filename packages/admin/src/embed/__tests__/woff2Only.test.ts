import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

import { assertNoInlinedWoff, dropWoffFallbacks, isFontsourceCss } from '../woff2Only';

const FACE = `/* inter-latin-400-normal */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-display: swap;
  font-weight: 400;
  src: url(./files/inter-latin-400-normal.woff2) format('woff2'), url(./files/inter-latin-400-normal.woff) format('woff');
  unicode-range: U+0000-00FF;
}`;

describe('dropWoffFallbacks', () => {
  it('keeps the WOFF2 source and everything else in the face', () => {
    expect(dropWoffFallbacks(FACE)).toBe(FACE.replace(", url(./files/inter-latin-400-normal.woff) format('woff')", ''));
  });

  it('handles quoted URLs and double-quoted formats', () => {
    const css = `@font-face{src:url("a.woff2") format("woff2"),url("a.woff") format("woff")}`;
    expect(dropWoffFallbacks(css)).toBe(`@font-face{src:url("a.woff2") format("woff2")}`);
  });

  it.each([
    [`@font-face{src:url(a.woff2?v=1) format('woff2'),url(a.woff?v=1) format('woff')}`, `@font-face{src:url(a.woff2?v=1) format('woff2')}`],
    [`@font-face{src:url(a.woff2) format('woff2'),url(a.woff#x) format('woff')}`, `@font-face{src:url(a.woff2) format('woff2')}`],
  ])('handles a query string or fragment on the URLs (%s)', (input, expected) => {
    expect(dropWoffFallbacks(input)).toBe(expected);
  });

  it('leaves a face without WOFF alone', () => {
    const css = `@font-face{font-family:X;src:local('X')}`;
    expect(dropWoffFallbacks(css)).toBe(css);
  });

  it('refuses a face that has WOFF but no WOFF2, instead of dropping the font', () => {
    expect(() => dropWoffFallbacks(`@font-face{src:url(a.woff) format('woff')}`)).toThrow(/without WOFF2/);
  });

  it('leaves rules outside @font-face alone', () => {
    const css = `.x{background:url(a.woff) format('woff')}`;
    expect(dropWoffFallbacks(css)).toBe(css);
  });

  it.each(['400', '500', '600', '700'])('turns the installed @fontsource/inter/%s.css into WOFF2-only faces', (weight) => {
    const file = createRequire(import.meta.url).resolve(`@fontsource/inter/${weight}.css`);
    const before = readFileSync(file, 'utf8');
    const after = dropWoffFallbacks(before);
    const faces = (s: string) => s.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces(after)).toHaveLength(faces(before).length);
    for (const face of faces(after)) {
      expect(face).toMatch(/\.woff2\) format\('woff2'\)/);
      expect(face).not.toMatch(/\.woff\)/);
    }
    // Only the src lists changed.
    expect(after.replace(/src:[^;]*;/g, '')).toBe(before.replace(/src:[^;]*;/g, ''));
  });
});

describe('isFontsourceCss', () => {
  it.each([
    ['/app/node_modules/@fontsource/inter/400.css', true],
    ['/r/node_modules/.pnpm/@fontsource+inter@5.2.8/node_modules/@fontsource/inter/700.css', true],
    ['/r/node_modules/@fontsource/inter/400.css?inline', true],
    ['/r/src/styles/index.css', false],
    ['/r/node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2', false],
  ])('%s -> %s', (id, expected) => {
    expect(isFontsourceCss(id)).toBe(expected);
  });
});

describe('assertNoInlinedWoff (the build-output check)', () => {
  it('passes a stylesheet with only WOFF2 inlined', () => {
    expect(() => assertNoInlinedWoff('@font-face{src:url(data:font/woff2;base64,AAAA) format("woff2")}')).not.toThrow();
  });

  it('throws when a WOFF font is still inlined', () => {
    expect(() => assertNoInlinedWoff('@font-face{src:url(data:font/woff2;base64,AA) format("woff2"),url(data:font/woff;base64,BB) format("woff")}')).toThrow(/still inlines WOFF/);
  });
});
