import { describe, it, expect } from 'vitest';
import { sanitizeNavLayout, NavLayoutValidationError } from '../nav-layout';

describe('sanitizeNavLayout', () => {
  it('passes a well-formed layout through, normalising version/defaults', () => {
    const out = sanitizeNavLayout({
      version: 1,
      sidebar: [{ id: 'content', title: 'Content', items: [{ key: 'inbox' }] }],
      settings: [{ key: 'admin.users' }],
      hidden: ['x'],
      defaultRoute: 'inbox',
    });
    expect(out.version).toBe(1);
    expect(out.sidebar[0].items[0].key).toBe('inbox');
    expect(out.settings[0].key).toBe('admin.users');
    expect(out.hidden).toEqual(['x']);
    expect(out.defaultRoute).toBe('inbox');
  });

  it('throws when the input is not an object', () => {
    expect(() => sanitizeNavLayout('nope')).toThrow(NavLayoutValidationError);
    expect(() => sanitizeNavLayout(null)).toThrow(NavLayoutValidationError);
  });

  it('throws when sidebar is not an array', () => {
    expect(() => sanitizeNavLayout({ version: 1, sidebar: 'x' })).toThrow(
      NavLayoutValidationError,
    );
  });

  it('drops unknown fields (mass-assignment defence)', () => {
    const out = sanitizeNavLayout({
      version: 99,
      sidebar: [],
      settings: [],
      hidden: [],
      isAdmin: true,
      __proto__hack: 1,
    } as unknown);
    expect(out).toEqual({ version: 1, sidebar: [], settings: [], hidden: [] });
    expect((out as unknown as Record<string, unknown>).isAdmin).toBeUndefined();
  });

  it('drops items without a key and coerces missing settings/hidden to []', () => {
    const out = sanitizeNavLayout({
      version: 1,
      sidebar: [{ id: 's', items: [{ key: 'ok' }, { icon: 'x' }, 'garbage'] }],
    });
    expect(out.sidebar[0].items.map((i) => i.key)).toEqual(['ok']);
    expect(out.settings).toEqual([]);
    expect(out.hidden).toEqual([]);
  });

  it('caps section, item, and string sizes', () => {
    const out = sanitizeNavLayout({
      version: 1,
      sidebar: Array.from({ length: 100 }, (_v, i) => ({ id: `s${i}`, items: [] })),
      settings: [],
      hidden: [],
    });
    expect(out.sidebar.length).toBeLessThanOrEqual(50);

    const longLabel = 'a'.repeat(5000);
    const out2 = sanitizeNavLayout({
      version: 1,
      sidebar: [{ id: 's', items: [{ key: 'k', label: longLabel }] }],
      settings: [],
      hidden: [],
    });
    expect(out2.sidebar[0].items[0].label!.length).toBeLessThanOrEqual(200);
  });

  it('synthesises a positional id for a section missing one', () => {
    const out = sanitizeNavLayout({
      version: 1,
      sidebar: [{ items: [{ key: 'k' }] }],
      settings: [],
      hidden: [],
    });
    expect(out.sidebar[0].id).toBe('section-0');
  });
});
