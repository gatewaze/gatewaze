import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } }));

import { apiErrorMessage } from '../moduleService';

// The modules page renders these strings. An error object reaching React as a
// child crashed the page (minified React error #31) when an events update
// failed with { error: { code, message } }.
describe('apiErrorMessage', () => {
  it('passes a string error through', () => {
    expect(apiErrorMessage({ error: 'Source not found' }, 'fallback')).toBe('Source not found');
  });

  it('reads the message from an error object', () => {
    expect(
      apiErrorMessage({ error: { code: '42704', message: 'policy "x" does not exist' } }, 'fallback'),
    ).toBe('policy "x" does not exist');
  });

  it.each([
    ['an empty body', {}],
    ['a null body', null],
    ['an object without a message', { error: { code: 'X' } }],
    ['a non-string message', { error: { message: { nested: true } } }],
    ['an empty string', { error: '' }],
  ])('falls back for %s', (_label, body) => {
    expect(apiErrorMessage(body, 'Failed (500)')).toBe('Failed (500)');
  });
});
