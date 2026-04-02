import { describe, it, expect } from 'vitest';
import { slugify, generateEventSlug, extractEventIdFromSlug } from '../slugify';

describe('slugify', () => {
  it('converts text to lowercase kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('Hello! @World# $2024')).toBe('hello-world-2024');
  });

  it('collapses multiple spaces and hyphens', () => {
    expect(slugify('hello   world---test')).toBe('hello-world-test');
  });

  it('trims whitespace', () => {
    expect(slugify('  hello world  ')).toBe('hello-world');
  });

  it('removes leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });
});

describe('generateEventSlug', () => {
  it('combines slugified title with event ID', () => {
    expect(generateEventSlug('AI Conference 2024', 'b68wjx')).toBe(
      'ai-conference-2024-b68wjx'
    );
  });

  it('returns just event ID when title produces empty slug', () => {
    expect(generateEventSlug('!!!', 'abc123')).toBe('abc123');
  });

  it('handles complex titles', () => {
    expect(
      generateEventSlug('Coding Agents: AI-Driven Dev Conference', 'xyz789')
    ).toBe('coding-agents-ai-driven-dev-conference-xyz789');
  });
});

describe('extractEventIdFromSlug', () => {
  it('extracts the last segment as event ID', () => {
    expect(
      extractEventIdFromSlug('coding-agents-ai-driven-dev-conference-b68wjx')
    ).toBe('b68wjx');
  });

  it('works with a single-segment slug', () => {
    expect(extractEventIdFromSlug('abc123')).toBe('abc123');
  });

  it('works with just two segments', () => {
    expect(extractEventIdFromSlug('event-xyz789')).toBe('xyz789');
  });
});
