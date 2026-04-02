import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToggle } from '../useToggle';

describe('useToggle', () => {
  it('defaults to false', () => {
    const { result } = renderHook(() => useToggle());
    expect(result.current[0]).toBe(false);
  });

  it('toggles between true and false', () => {
    const { result } = renderHook(() => useToggle());

    act(() => result.current[1]());
    expect(result.current[0]).toBe(true);

    act(() => result.current[1]());
    expect(result.current[0]).toBe(false);
  });

  it('sets a specific value', () => {
    const { result } = renderHook(() => useToggle());

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);

    act(() => result.current[1](true));
    expect(result.current[0]).toBe(true);
  });

  it('works with custom options', () => {
    const { result } = renderHook(() =>
      useToggle(['light', 'dark', 'system'] as const)
    );

    expect(result.current[0]).toBe('light');

    act(() => result.current[1]());
    expect(result.current[0]).toBe('dark');

    act(() => result.current[1]());
    expect(result.current[0]).toBe('system');

    act(() => result.current[1]());
    expect(result.current[0]).toBe('light');
  });

  it('can set a specific custom value', () => {
    const { result } = renderHook(() =>
      useToggle(['a', 'b', 'c'] as const)
    );

    act(() => result.current[1]('c'));
    expect(result.current[0]).toBe('c');
  });
});
