import { describe, it, expect } from 'vitest';
import { stripEmojis } from '../text';

describe('stripEmojis', () => {
  it('removes emoji characters', () => {
    expect(stripEmojis('Hello 🌍 World 🎉')).toBe('Hello World');
  });

  it('returns plain text unchanged', () => {
    expect(stripEmojis('Hello World')).toBe('Hello World');
  });

  it('collapses multiple spaces after removal', () => {
    expect(stripEmojis('A 🎯 B 🎯 C')).toBe('A B C');
  });

  it('handles empty string', () => {
    expect(stripEmojis('')).toBe('');
  });

  it('handles string of only emojis', () => {
    expect(stripEmojis('🎉🎊🎈')).toBe('');
  });
});
