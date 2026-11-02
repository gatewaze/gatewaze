import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../lib/supabase.js', () => ({
  getSupabase: () => ({}),
}));

const { shortUrlFor } = await import('../redirects.js');

describe('shortUrlFor', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('serves portal-host links under /go/', () => {
    vi.stubEnv('SHORT_LINK_HOSTS', '');
    expect(shortUrlFor('aaif.live', 'nl-abc-1')).toBe('https://aaif.live/go/nl-abc-1');
    expect(shortUrlFor('app.aaif.localhost', 'x')).toBe('http://app.aaif.localhost/go/x');
  });

  it('serves short-link-only hosts at the root', () => {
    vi.stubEnv('SHORT_LINK_HOSTS', 'go.mlops.community=https://mlops.community');
    expect(shortUrlFor('go.mlops.community', 'NL_Jobs_Board')).toBe('https://go.mlops.community/NL_Jobs_Board');
    expect(shortUrlFor('aaif.live', 'nl-abc-1')).toBe('https://aaif.live/go/nl-abc-1');
  });

  it('keeps & + ( ) readable and encodes [ ]', () => {
    vi.stubEnv('SHORT_LINK_HOSTS', 'go.mlops.community');
    expect(shortUrlFor('go.mlops.community', 'l&lsession25')).toBe('https://go.mlops.community/l&lsession25');
    expect(shortUrlFor('go.mlops.community', 'the_[ai]_office')).toBe('https://go.mlops.community/the_%5Bai%5D_office');
  });
});
