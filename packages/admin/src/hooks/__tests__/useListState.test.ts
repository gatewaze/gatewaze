import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useListState } from '../useListState';

describe('useListState', () => {
  it('initializes with the given array', () => {
    const { result } = renderHook(() => useListState([1, 2, 3]));
    expect(result.current[0]).toEqual([1, 2, 3]);
  });

  it('defaults to empty array', () => {
    const { result } = renderHook(() => useListState());
    expect(result.current[0]).toEqual([]);
  });

  describe('append', () => {
    it('appends items to the end', () => {
      const { result } = renderHook(() => useListState([1]));
      act(() => result.current[1].append(2, 3));
      expect(result.current[0]).toEqual([1, 2, 3]);
    });
  });

  describe('prepend', () => {
    it('prepends items to the beginning', () => {
      const { result } = renderHook(() => useListState([3]));
      act(() => result.current[1].prepend(1, 2));
      expect(result.current[0]).toEqual([1, 2, 3]);
    });
  });

  describe('insert', () => {
    it('inserts items at a given index', () => {
      const { result } = renderHook(() => useListState(['a', 'c']));
      act(() => result.current[1].insert(1, 'b'));
      expect(result.current[0]).toEqual(['a', 'b', 'c']);
    });
  });

  describe('remove', () => {
    it('removes items at given indices', () => {
      const { result } = renderHook(() => useListState(['a', 'b', 'c', 'd']));
      act(() => result.current[1].remove(1, 3));
      expect(result.current[0]).toEqual(['a', 'c']);
    });
  });

  describe('pop', () => {
    it('removes the last item', () => {
      const { result } = renderHook(() => useListState([1, 2, 3]));
      act(() => result.current[1].pop());
      expect(result.current[0]).toEqual([1, 2]);
    });
  });

  describe('shift', () => {
    it('removes the first item', () => {
      const { result } = renderHook(() => useListState([1, 2, 3]));
      act(() => result.current[1].shift());
      expect(result.current[0]).toEqual([2, 3]);
    });
  });

  describe('reorder', () => {
    it('moves an item from one index to another', () => {
      const { result } = renderHook(() => useListState(['a', 'b', 'c']));
      act(() => result.current[1].reorder({ from: 2, to: 0 }));
      expect(result.current[0]).toEqual(['c', 'a', 'b']);
    });
  });

  describe('swap', () => {
    it('swaps two items', () => {
      const { result } = renderHook(() => useListState(['a', 'b', 'c']));
      act(() => result.current[1].swap({ from: 0, to: 2 }));
      expect(result.current[0]).toEqual(['c', 'b', 'a']);
    });
  });

  describe('apply', () => {
    it('maps all items', () => {
      const { result } = renderHook(() => useListState([1, 2, 3]));
      act(() => result.current[1].apply((x) => x * 2));
      expect(result.current[0]).toEqual([2, 4, 6]);
    });
  });

  describe('applyWhere', () => {
    it('maps items matching a condition', () => {
      const { result } = renderHook(() => useListState([1, 2, 3, 4]));
      act(() =>
        result.current[1].applyWhere(
          (x) => x % 2 === 0,
          (x) => x * 10
        )
      );
      expect(result.current[0]).toEqual([1, 20, 3, 40]);
    });
  });

  describe('setItem', () => {
    it('replaces an item at a given index', () => {
      const { result } = renderHook(() => useListState(['a', 'b', 'c']));
      act(() => result.current[1].setItem(1, 'z'));
      expect(result.current[0]).toEqual(['a', 'z', 'c']);
    });
  });

  describe('setItemProp', () => {
    it('updates a property of an object at a given index', () => {
      const { result } = renderHook(() =>
        useListState([
          { name: 'Alice', age: 30 },
          { name: 'Bob', age: 25 },
        ])
      );
      act(() => result.current[1].setItemProp(1, 'age', 26));
      expect(result.current[0][1].age).toBe(26);
      expect(result.current[0][1].name).toBe('Bob');
    });
  });

  describe('filter', () => {
    it('filters items matching a condition', () => {
      const { result } = renderHook(() => useListState([1, 2, 3, 4, 5]));
      act(() => result.current[1].filter((x) => x > 3));
      expect(result.current[0]).toEqual([4, 5]);
    });
  });
});
