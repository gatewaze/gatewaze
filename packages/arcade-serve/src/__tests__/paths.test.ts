import { describe, expect, it } from 'vitest';
import { matchRoute, normaliseAssetPath, normaliseManifestPath } from '../paths.js';

const NUL = String.fromCharCode(0);
const BACKSLASH = String.fromCharCode(92);

describe('normaliseAssetPath — accepts ordinary relative paths', () => {
  it.each([
    ['index.html', 'index.html'],
    ['questions.js', 'questions.js'],
    ['img/logo.png', 'img/logo.png'],
    ['assets/audio/theme.mp3', 'assets/audio/theme.mp3'],
    ['my%20file.png', 'my file.png'],
    ['a-b_c.1.js', 'a-b_c.1.js'],
  ])('%s', (input, expected) => {
    expect(normaliseAssetPath(input)).toBe(expected);
  });
});

describe('normaliseAssetPath — rejects every traversal variant', () => {
  const rejected: Array<[string, string]> = [
    ['raw dot-dot', '../etc/passwd'],
    ['raw dot-dot mid-path', 'img/../../etc/passwd'],
    ['bare dot-dot', '..'],
    ['single dot segment', './index.html'],
    ['encoded dot-dot', '%2e%2e/etc/passwd'],
    ['encoded dot-dot uppercase', '%2E%2E/passwd'],
    ['encoded slash', 'img%2f..%2fsecret.js'],
    ['double-encoded dot-dot', '%252e%252e/etc/passwd'],
    ['double-encoded slash', 'img%252fsecret.js'],
    ['double-encoded backslash', 'img%255c..%255csecret.js'],
    ['encoded backslash', 'img%5c..%5csecret.js'],
    ['raw backslash', 'img' + BACKSLASH + '..' + BACKSLASH + 'secret.js'],
    ['leading backslash', BACKSLASH + 'etc' + BACKSLASH + 'passwd'],
    ['absolute path', '/etc/passwd'],
    ['absolute storage key', '/games/other/index.html'],
    ['raw null byte', 'index.html' + NUL + '.png'],
    ['encoded null byte', 'index.html%00.png'],
    ['windows drive', 'c:/windows/system32/config'],
    ['empty segment', 'img//logo.png'],
    ['trailing separator', 'img/'],
    ['malformed escape', 'img/%zz.png'],
    ['empty path', ''],
    ['control char', 'img/' + String.fromCharCode(10) + 'logo.png'],
  ];

  it.each(rejected)('rejects %s', (_label, input) => {
    expect(normaliseAssetPath(input)).toBeNull();
  });

  it('rejects an over-long path', () => {
    expect(normaliseAssetPath('a'.repeat(1100))).toBeNull();
  });
});

describe('normaliseManifestPath', () => {
  it('strips a leading ./', () => {
    expect(normaliseManifestPath('./questions.js')).toBe('questions.js');
  });

  it.each([
    ['/abs.js'],
    ['../up.js'],
    ['a/../b.js'],
    ['bad' + BACKSLASH + 'sep.js'],
    ['nul' + NUL + '.js'],
    [''],
  ])('rejects %s', (input) => {
    expect(normaliseManifestPath(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(normaliseManifestPath(null)).toBeNull();
    expect(normaliseManifestPath(42)).toBeNull();
  });
});

describe('matchRoute', () => {
  const versionId = '11111111-2222-4333-8444-555555555555';

  it('maps the operational endpoints', () => {
    expect(matchRoute('/healthz')).toEqual({ kind: 'health' });
    expect(matchRoute('/readyz')).toEqual({ kind: 'ready' });
    expect(matchRoute('/metrics')).toEqual({ kind: 'metrics' });
    expect(matchRoute('/sdk/gatewaze-arcade-1.js')).toEqual({ kind: 'sdk' });
  });

  it('maps the live route', () => {
    expect(matchRoute('/g/mcp-quest/')).toEqual({ kind: 'live', slug: 'mcp-quest' });
  });

  it('canonicalises the missing trailing slash', () => {
    expect(matchRoute('/g/mcp-quest')).toEqual({ kind: 'redirect-slash', to: '/g/mcp-quest/' });
    expect(matchRoute(`/g/mcp-quest/v/${versionId}`)).toEqual({
      kind: 'redirect-slash',
      to: `/g/mcp-quest/v/${versionId}/`,
    });
  });

  it('maps versioned index and assets', () => {
    expect(matchRoute(`/g/mcp-quest/v/${versionId}/`)).toEqual({
      kind: 'version',
      slug: 'mcp-quest',
      versionId,
      assetPath: '',
    });
    expect(matchRoute(`/g/mcp-quest/v/${versionId}/img/logo.png`)).toEqual({
      kind: 'version',
      slug: 'mcp-quest',
      versionId,
      assetPath: 'img/logo.png',
    });
  });

  it('refuses anything else on this origin', () => {
    expect(matchRoute('/').kind).toBe('none');
    expect(matchRoute('/api/modules/arcade/state').kind).toBe('none');
    expect(matchRoute('/sdk/other.js').kind).toBe('none');
    expect(matchRoute('/g/Bad_Slug/').kind).toBe('none');
    expect(matchRoute('/g/mcp-quest/x/abc/').kind).toBe('none');
    expect(matchRoute('/g/mcp-quest/v/not-a-uuid/').kind).toBe('none');
  });
});
