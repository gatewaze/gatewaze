import { describe, it, expect } from 'vitest';
import {
  maxBytesFor,
  requiredRole,
  roleSatisfies,
  safeFileName,
  safeObjectPath,
  serverChosenPath,
  MAX_BYTES_OTHER,
  MAX_BYTES_VIDEO,
} from '../storage-rules.js';

describe('safeObjectPath', () => {
  it.each(['a.png', 'profiles/u1/a.png', 'speaker-submissions/x y.png'])('accepts %s', (p) => {
    expect(safeObjectPath(p)).toBe(p);
  });

  it.each([
    '',
    '/abs.png',
    'a/../b.png',
    '..',
    'a/./b',
    'a//b',
    'dir/',
    'a\\b',
    'a?x=1',
    'a#frag',
    'a\u0000b',
    'a\nb',
    'x'.repeat(1025),
    42,
    null,
    ['a'],
  ])('rejects %j', (p) => {
    expect(safeObjectPath(p)).toBeNull();
  });
});

describe('requiredRole', () => {
  it('media profiles/: authenticated inserts, admin overwrites and deletes', () => {
    expect(requiredRole('media', 'profiles/a.png', 'insert')).toBe('authenticated');
    expect(requiredRole('media', 'profiles/a.png', 'overwrite')).toBe('admin');
    expect(requiredRole('media', 'profiles/a.png', 'delete')).toBe('admin');
  });

  it.each(['speaker-submissions/a.png', 'talks/deck.pdf'])('media %s: anyone inserts, admin overwrites', (p) => {
    expect(requiredRole('media', p, 'insert')).toBe('anon');
    expect(requiredRole('media', p, 'overwrite')).toBe('admin');
    expect(requiredRole('media', p, 'delete')).toBe('admin');
  });

  it('media winner-images/: authenticated for everything', () => {
    for (const op of ['insert', 'overwrite', 'delete'] as const) {
      expect(requiredRole('media', 'winner-images/a.png', op)).toBe('authenticated');
    }
  });

  it('media anything else: admin', () => {
    expect(requiredRole('media', 'branding/logo.png', 'insert')).toBe('admin');
    expect(requiredRole('media', 'people/1.png', 'delete')).toBe('admin');
    // A prefix that only looks like a public one.
    expect(requiredRole('media', 'talksx/a.png', 'insert')).toBe('admin');
  });

  it('invite-templates: authenticated', () => {
    expect(requiredRole('invite-templates', 'a/b.png', 'insert')).toBe('authenticated');
    expect(requiredRole('invite-templates', 'a/b.png', 'delete')).toBe('authenticated');
  });

  it.each(['event-images', 'winner-images', 'downloads', 'speaker-logos'])('%s: admin', (b) => {
    expect(requiredRole(b, 'a.png', 'insert')).toBe('admin');
    expect(requiredRole(b, 'a.png', 'delete')).toBe('admin');
  });

  it.each(['video-masters', 'fetch-screenshots', 'fetch-artifacts'])('private bucket %s: never', (b) => {
    expect(requiredRole(b, 'a.png', 'insert')).toBe('never');
    expect(requiredRole(b, 'a.png', 'delete')).toBe('never');
  });

  it('a media path that names a private bucket is that bucket: never', () => {
    expect(requiredRole('media', 'video-masters/m.mp4', 'insert')).toBe('never');
    expect(requiredRole('media', 'video-masters/x.jpg', 'delete')).toBe('never');
  });
});

describe('roleSatisfies', () => {
  it('ranks anon < authenticated < admin', () => {
    expect(roleSatisfies('anon', 'anon')).toBe(true);
    expect(roleSatisfies('anon', 'authenticated')).toBe(false);
    expect(roleSatisfies('authenticated', 'admin')).toBe(false);
    expect(roleSatisfies('admin', 'authenticated')).toBe(true);
  });
});

describe('maxBytesFor', () => {
  it('caps images and pdf at 50 MB and video at 500 MB', () => {
    expect(maxBytesFor('image/png', 'anon')).toBe(MAX_BYTES_OTHER);
    expect(maxBytesFor('application/pdf', 'anon')).toBe(MAX_BYTES_OTHER);
    expect(maxBytesFor('font/woff2', 'authenticated')).toBe(MAX_BYTES_OTHER);
    expect(maxBytesFor('video/mp4', 'admin')).toBe(MAX_BYTES_VIDEO);
  });

  it('allows SVG only for admins', () => {
    expect(maxBytesFor('image/svg+xml', 'authenticated')).toBeNull();
    expect(maxBytesFor('image/svg+xml', 'admin')).toBe(MAX_BYTES_OTHER);
  });

  it('allows slide decks for anyone (speakers upload them to talks/)', () => {
    expect(maxBytesFor('application/vnd.openxmlformats-officedocument.presentationml.presentation', 'anon')).toBe(MAX_BYTES_OTHER);
    expect(maxBytesFor('application/vnd.ms-powerpoint', 'anon')).toBe(MAX_BYTES_OTHER);
  });

  it('lets only admins upload video', () => {
    expect(maxBytesFor('video/mp4', 'anon')).toBeNull();
    expect(maxBytesFor('video/mp4', 'authenticated')).toBeNull();
  });

  it('allows office documents only for admins', () => {
    expect(maxBytesFor('application/zip', 'authenticated')).toBeNull();
    expect(maxBytesFor('application/zip', 'admin')).toBe(MAX_BYTES_OTHER);
  });

  it.each(['text/html', 'application/javascript', 'image/png; charset=x', 'image', 'IMAGE/PNG/x', ''])('rejects %j', (t) => {
    expect(maxBytesFor(t, 'admin')).toBeNull();
  });
});

describe('server-chosen keys', () => {
  it('reduces a filename to safe characters', () => {
    expect(safeFileName('My Photo (1).PNG')).toBe('my-photo-1-.png');
    expect(safeFileName('../../etc/passwd')).toBe('passwd');
    expect(safeFileName('...')).toBe('file');
    expect(safeFileName('a'.repeat(300) + '.jpeg')).toHaveLength(100);
    expect(safeFileName('a'.repeat(300) + '.jpeg').endsWith('.jpeg')).toBe(true);
  });

  it('puts a uuid in front of the name under the prefix', () => {
    const p = serverChosenPath('speaker-submissions/', 'speaker-submissions/nested/Me.jpg');
    expect(p).toMatch(/^speaker-submissions\/[0-9a-f-]{36}-me\.jpg$/);
    expect(safeObjectPath(p)).toBe(p);
  });
});
