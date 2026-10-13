import { describe, expect, it } from 'vitest';

import { buildEmbedManifest } from '../manifest';

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

  it('advertises host-session, so a host-session loader will mount it', () => {
    expect(manifest.capabilities).toEqual(['host-session']);
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
