import { describe, expect, it } from 'vitest';

import { buildEmbedManifest, staticImportGraph } from '../manifest';

describe('buildEmbedManifest (what vite.embed.config.ts writes to manifest.json)', () => {
  const manifest = buildEmbedManifest({
    entry: 'admin-embed-abc.js',
    stylesheet: 'admin-embed-def.css',
    modules: ['newsletters'],
    version: '1.2.3',
    builtAt: '2026-01-01T00:00:00.000Z',
  });

  it('stays on host contract 1, which installed loaders require exactly', () => {
    expect(manifest.contract).toBe(1);
  });

  it('advertises host-session, first-paint and host-loading-indicator', () => {
    expect(manifest.capabilities).toEqual(['host-session', 'first-paint', 'host-loading-indicator']);
  });

  it('leaves preload out when there is nothing to preload', () => {
    expect(manifest).not.toHaveProperty('preload');
    expect(buildEmbedManifest({ entry: 'e.js', stylesheet: 's.css', modules: [], version: 'v', builtAt: 't', preload: [] })).not.toHaveProperty('preload');
  });

  it('carries the preload list when there is one', () => {
    const m = buildEmbedManifest({ entry: 'e.js', stylesheet: 's.css', modules: [], version: 'v', builtAt: 't', preload: ['chunks/a.js'] });
    expect(m.preload).toEqual(['chunks/a.js']);
  });

  it('carries the build inputs through', () => {
    expect(manifest).toMatchObject({
      entry: 'admin-embed-abc.js',
      stylesheet: 'admin-embed-def.css',
      modules: ['newsletters'],
      version: '1.2.3',
      builtAt: '2026-01-01T00:00:00.000Z',
    });
  });
});

describe('staticImportGraph (the manifest preload list)', () => {
  const chunk = (fileName: string, imports: string[] = [], isEntry = false) => ({ type: 'chunk' as const, fileName, imports, isEntry });
  const bundle = {
    'entry.js': chunk('entry.js', ['chunks/react.js', 'chunks/ui.js'], true),
    'chunks/react.js': chunk('chunks/react.js', ['chunks/jsx.js']),
    'chunks/ui.js': chunk('chunks/ui.js', ['chunks/react.js', 'entry.js']),
    'chunks/jsx.js': chunk('chunks/jsx.js'),
    // Only reachable through a dynamic import (a lazy route): must not be preloaded.
    'chunks/lazy-page.js': chunk('chunks/lazy-page.js', ['chunks/react.js']),
    'admin-embed.css': { type: 'asset' as const, fileName: 'admin-embed.css' },
  };

  it('walks static imports breadth first, once each, without the entry or lazy chunks', () => {
    expect(staticImportGraph(bundle, 'entry.js')).toEqual(['chunks/react.js', 'chunks/ui.js', 'chunks/jsx.js']);
  });

  it('skips imports that are not chunks in the bundle', () => {
    expect(staticImportGraph({ 'entry.js': chunk('entry.js', ['admin-embed.css', 'missing.js'], true), 'admin-embed.css': bundle['admin-embed.css'] }, 'entry.js')).toEqual([]);
  });

  it('returns nothing for an unknown entry', () => {
    expect(staticImportGraph(bundle, 'nope.js')).toEqual([]);
  });
});
