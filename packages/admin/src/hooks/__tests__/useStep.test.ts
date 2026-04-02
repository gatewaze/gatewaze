import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useStep } from '../useStep';

describe('useStep', () => {
  it('starts at step 1', () => {
    const { result } = renderHook(() => useStep(5));
    expect(result.current[0]).toBe(1);
  });

  it('reports canGoToNextStep and canGoToPrevStep', () => {
    const { result } = renderHook(() => useStep(3));
    expect(result.current[1].canGoToNextStep).toBe(true);
    expect(result.current[1].canGoToPrevStep).toBe(false);
  });

  it('goes to next step', () => {
    const { result } = renderHook(() => useStep(3));

    act(() => result.current[1].goToNextStep());
    expect(result.current[0]).toBe(2);
    expect(result.current[1].canGoToPrevStep).toBe(true);
  });

  it('does not go beyond max step', () => {
    const { result } = renderHook(() => useStep(2));

    act(() => result.current[1].goToNextStep());
    expect(result.current[0]).toBe(2);
    expect(result.current[1].canGoToNextStep).toBe(false);

    act(() => result.current[1].goToNextStep());
    expect(result.current[0]).toBe(2);
  });

  it('goes to previous step', () => {
    const { result } = renderHook(() => useStep(3));

    act(() => result.current[1].goToNextStep());
    act(() => result.current[1].goToNextStep());
    expect(result.current[0]).toBe(3);

    act(() => result.current[1].goToPrevStep());
    expect(result.current[0]).toBe(2);
  });

  it('does not go below step 1', () => {
    const { result } = renderHook(() => useStep(3));

    act(() => result.current[1].goToPrevStep());
    expect(result.current[0]).toBe(1);
  });

  it('resets to step 1', () => {
    const { result } = renderHook(() => useStep(5));

    act(() => result.current[1].goToNextStep());
    act(() => result.current[1].goToNextStep());
    expect(result.current[0]).toBe(3);

    act(() => result.current[1].reset());
    expect(result.current[0]).toBe(1);
  });

  it('setStep sets a specific step', () => {
    const { result } = renderHook(() => useStep(5));

    act(() => result.current[1].setStep(4));
    expect(result.current[0]).toBe(4);
  });

  it('setStep throws for invalid steps', () => {
    const { result } = renderHook(() => useStep(3));

    expect(() => {
      act(() => result.current[1].setStep(0));
    }).toThrow('Step not valid');

    expect(() => {
      act(() => result.current[1].setStep(4));
    }).toThrow('Step not valid');
  });
});
