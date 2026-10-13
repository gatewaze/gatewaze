import { describe, it, expect } from 'vitest';
import { isSafeHubUrl, sanitizeNavLayout, NavLayoutValidationError } from '../nav-layout';

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

  it('keeps hub lists, flattened, under valid hub ids only', () => {
    const out = sanitizeNavLayout({
      version: 1,
      sidebar: [],
      settings: [],
      hidden: [],
      // JSON.parse so `__proto__` lands as an own key, as it would from a request body.
      hubs: JSON.parse(
        '{"marketing-os":[{"key":"a","label":"A","extra":"x","children":[{"key":"b"}]},{"nope":1}],' +
          '"__proto__":[{"key":"evil"}],"Bad Id":[{"key":"c"}]}',
      ),
    });
    expect(out.hubs).toEqual({ 'marketing-os': [{ key: 'a', label: 'A' }] });
  });

  it('omits hubs when none are valid, and ignores a non-object', () => {
    expect(sanitizeNavLayout({ sidebar: [], hubs: { 'Bad Id': [] } }).hubs).toBeUndefined();
    expect(sanitizeNavLayout({ sidebar: [], hubs: [[{ key: 'a' }]] }).hubs).toBeUndefined();
  });

  it('never lets a __proto__ key reach the hubs prototype', () => {
    const out = sanitizeNavLayout(JSON.parse('{"sidebar":[],"hubs":{"__proto__":[{"key":"evil"}],"ok":[]}}'));
    expect(Object.getPrototypeOf(out.hubs)).toBe(Object.prototype);
    expect(Object.hasOwn(out.hubs!, '__proto__')).toBe(false);
    expect(Object.keys(out.hubs!)).toEqual(['ok']);
  });

  it('caps the number of hubs', () => {
    const hubs = Object.fromEntries(Array.from({ length: 25 }, (_, i) => [`hub-${i}`, [{ key: 'k' }]]));
    const out = sanitizeNavLayout({ sidebar: [], hubs });
    expect(Object.keys(out.hubs!)).toHaveLength(20);
  });

  describe('hub cards', () => {
    const hub = (cards: unknown[]) => sanitizeNavLayout({ sidebar: [], hubs: { 'marketing-os': cards } }).hubs?.['marketing-os'];

    it('keeps card fields, bounded, and drops unknown ones', () => {
      const [card] = hub([
        {
          key: 'module.newsletters..newsletters',
          label: 'Newsletters',
          description: 'd'.repeat(500),
          eyebrow: 'Agent 1',
          tags: ['Email', 'Email', ' ', 'Copy', 'a', 'b', 'c', 'd'],
          accent: 'violet',
          comingSoon: true,
          url: 'https://example.org',
          newTab: true,
          onclick: 'alert(1)',
        },
      ])!;
      expect(card.description).toHaveLength(300);
      expect(card.eyebrow).toBe('Agent 1');
      expect(card.tags).toEqual(['Email', 'Copy', 'a', 'b', 'c']);
      expect(card.accent).toBe('violet');
      expect(card.comingSoon).toBe(true);
      // url and newTab belong to custom cards only.
      expect(card).not.toHaveProperty('url');
      expect(card).not.toHaveProperty('newTab');
      expect(card).not.toHaveProperty('onclick');
    });

    it('drops an unknown accent', () => {
      expect(hub([{ key: 'k', accent: 'chartreuse' }])![0]).not.toHaveProperty('accent');
      expect(hub([{ key: 'k', accent: 'constructor' }])![0]).not.toHaveProperty('accent');
    });

    it('keeps only true booleans, and caps the line above the title and each tag', () => {
      const [card] = hub([
        { key: 'link:x', label: 'X', url: '/x', comingSoon: 'yes', newTab: 1, eyebrow: 'e'.repeat(100), tags: ['t'.repeat(100)] },
      ])!;
      expect(card).not.toHaveProperty('comingSoon');
      expect(card).not.toHaveProperty('newTab');
      expect(card.eyebrow).toHaveLength(60);
      expect(card.tags![0]).toHaveLength(40);
    });

    it('keeps one card per key', () => {
      expect(hub([{ key: 'k', label: 'first' }, { key: 'k', label: 'second' }])).toEqual([{ key: 'k', label: 'first' }]);
    });

    it('keeps a custom link card with a safe URL', () => {
      expect(hub([{ key: 'link:events', label: 'Events', url: '/foundation/events?project=x', newTab: true }])).toEqual([
        { key: 'link:events', label: 'Events', url: '/foundation/events?project=x', newTab: true },
      ]);
    });

    it('drops a custom card with no title, a bad key, or nowhere to go', () => {
      expect(hub([{ key: 'link:events', url: '/events' }])).toEqual([]);
      expect(hub([{ key: 'link:Bad Key', label: 'x', url: '/events' }])).toEqual([]);
      expect(hub([{ key: 'link:events', label: 'Events' }])).toEqual([]);
      expect(hub([{ key: 'link:events', label: 'Events', url: 'javascript:alert(1)' }])).toEqual([]);
    });

    it('keeps a coming-soon custom card without a URL', () => {
      expect(hub([{ key: 'link:deck', label: 'Pitch deck', comingSoon: true, newTab: true }])).toEqual([
        { key: 'link:deck', label: 'Pitch deck', comingSoon: true },
      ]);
    });
  });

  describe('isSafeHubUrl', () => {
    it.each([
      'https://app.lfx.dev/foundation/events?project=x402-foundation',
      'http://localhost:4200/x',
      '/foundation/events',
      '/',
    ])('accepts %s', (url) => {
      expect(isSafeHubUrl(url)).toBe(true);
    });

    it.each([
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox',
      '//evil.example.org/x',
      '/\\evil.example.org',
      'https://user:pass@example.org',
      'https://user@example.org',
      'https://:pass@example.org',
      'https:evil.example.org',
      'http:/evil.example.org',
      'HTTPS:evil.example.org',
      'https://exa mple.org',
      '/path\nwith-newline',
      'mailto:a@b.c',
      'ftp://example.org',
      'relative/path',
      '',
      'https://example.org/' + 'a'.repeat(2000),
    ])('refuses %s', (url) => {
      expect(isSafeHubUrl(url)).toBe(false);
    });

    it('refuses non-strings', () => {
      expect(isSafeHubUrl(undefined)).toBe(false);
      expect(isSafeHubUrl(42)).toBe(false);
    });
  });
});

