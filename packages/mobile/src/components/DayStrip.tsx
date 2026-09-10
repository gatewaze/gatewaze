/**
 * Horizontal day selector (the S M T W T F S strip from the reference
 * designs). Generic: callers provide the days and any per-day accent.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius } from '../theme/tokens';

export interface DayStripDay {
  /** Stable key, e.g. '2026-09-09'. */
  key: string;
  /** Single-letter or short weekday label. */
  label: string;
  /** Optional number shown in the circle (e.g. day of month). */
  value?: string;
  /** Filled check instead of the value. */
  checked?: boolean;
}

export function DayStrip({
  days,
  selectedKey,
  onSelect,
}: {
  days: DayStripDay[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
}) {
  return (
    <View style={styles.row}>
      {days.map((d) => {
        const selected = d.key === selectedKey;
        return (
          <Pressable key={d.key} style={styles.day} onPress={onSelect ? () => onSelect(d.key) : undefined}>
            <Text style={styles.label}>{d.label}</Text>
            <View
              style={[
                styles.circle,
                selected && { backgroundColor: colors.accent },
                !selected && d.checked && { backgroundColor: colors.text },
              ]}
            >
              {d.checked && !selected ? (
                <MaterialCommunityIcons name="check" size={14} color="#fff" />
              ) : (
                <Text style={[styles.value, (selected || d.checked) && { color: '#fff' }]}>
                  {d.value ?? ''}
                </Text>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between' },
  day: { alignItems: 'center', gap: 6, flex: 1 },
  label: { fontSize: 12, color: colors.textSecondary },
  circle: {
    width: 32,
    height: 32,
    borderRadius: radius.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  value: { fontSize: 13, fontWeight: '600', color: colors.text },
});
