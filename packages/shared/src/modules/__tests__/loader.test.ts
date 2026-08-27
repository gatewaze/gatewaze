import { describe, it, expect } from 'vitest';
import { validateModule } from '../loader.js';

const base = { name: 'Example', description: 'An example module', version: '1.0.0', features: [] };

describe('validateModule — id charset', () => {
  it('accepts kebab-case ids', () => {
    for (const id of ['ai', 'conference-recap', 'bunny-cdn', 'newsletters-output-html', 'a1-b2']) {
      expect(() => validateModule({ ...base, id }, `@gatewaze-modules/${id}`)).not.toThrow();
    }
  });

  it('rejects ids that could compose a path or import specifier', () => {
    // The id feeds liveModuleDir()/resolve() and, on apply-update, a
    // cache-busted dynamic import — anything path- or URL-shaped must fail
    // at load time, before it reaches those call sites.
    for (const id of [
      '../escape',
      'a/b',
      'a\\b',
      'Upper-Case',
      'under_score',
      'dot.ted',
      'with space',
      'q?x=1',
      '-leading-hyphen',
      'a'.repeat(129),
    ]) {
      expect(() => validateModule({ ...base, id }, 'pkg')).toThrow(/invalid id/);
    }
  });

  it('still reports missing required fields first', () => {
    expect(() => validateModule({ ...base }, 'pkg')).toThrow(/missing required string field: id/);
  });
});
