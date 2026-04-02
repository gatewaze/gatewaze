import { describe, it, expect } from 'vitest';
import { formatDate, formatDateTime, slugify, truncate, generateId } from '../index.js';

describe('formatDate', () => {
  it('formats a date string with default options', () => {
    const result = formatDate('2024-03-15T10:00:00Z');
    expect(result).toContain('2024');
    expect(result).toContain('Mar');
    expect(result).toContain('15');
  });

  it('formats a Date object', () => {
    const result = formatDate(new Date('2024-01-01T00:00:00Z'));
    expect(result).toContain('2024');
    expect(result).toContain('Jan');
  });

  it('accepts custom format options', () => {
    const result = formatDate('2024-06-15', { year: 'numeric', month: 'long' });
    expect(result).toContain('June');
    expect(result).toContain('2024');
  });
});

describe('formatDateTime', () => {
  it('includes date and time components', () => {
    const result = formatDateTime('2024-03-15T14:30:00Z');
    expect(result).toContain('2024');
    expect(result).toContain('Mar');
    expect(result).toContain('15');
    // Should include time
    expect(result).toMatch(/\d+:\d+/);
  });

  it('formats a Date object', () => {
    const result = formatDateTime(new Date('2024-12-25T08:00:00Z'));
    expect(result).toContain('Dec');
    expect(result).toContain('25');
  });
});

describe('slugify', () => {
  it('converts text to lowercase kebab-case', () => {
    expect(slugify('Hello World')).toBe('hello-world');
  });

  it('removes special characters', () => {
    expect(slugify('Hello! @World#')).toBe('hello-world');
  });

  it('replaces underscores with hyphens', () => {
    expect(slugify('hello_world')).toBe('hello-world');
  });

  it('trims leading and trailing hyphens', () => {
    expect(slugify('--hello--')).toBe('hello');
  });

  it('handles multiple spaces', () => {
    expect(slugify('hello   world')).toBe('hello-world');
  });

  it('handles empty string', () => {
    expect(slugify('')).toBe('');
  });
});

describe('truncate', () => {
  it('returns text unchanged if within limit', () => {
    expect(truncate('hello', 10)).toBe('hello');
  });

  it('truncates and adds ellipsis when exceeding limit', () => {
    expect(truncate('hello world', 8)).toBe('hello...');
  });

  it('returns text unchanged if exactly at limit', () => {
    expect(truncate('hello', 5)).toBe('hello');
  });

  it('handles maxLength of 3 (edge case)', () => {
    expect(truncate('hello', 3)).toBe('...');
  });
});

describe('generateId', () => {
  it('generates a string without prefix', () => {
    const id = generateId();
    expect(id).toMatch(/^[a-z0-9]+$/);
    expect(id.length).toBe(7);
  });

  it('generates a string with prefix', () => {
    const id = generateId('evt');
    expect(id).toMatch(/^evt-[a-z0-9]+$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});
