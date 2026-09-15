/**
 * Progress ring (the calorie-donut style stat from the reference designs).
 * Optionally segmented into colored series arcs.
 */

import React from 'react';
import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme/tokens';

export interface RingSegment {
  /** 0..1 fraction of the full circle. */
  fraction: number;
  color: string;
}

export function Ring({
  size = 96,
  strokeWidth = 8,
  segments,
  trackColor = colors.border,
  children,
}: {
  size?: number;
  strokeWidth?: number;
  segments: RingSegment[];
  trackColor?: string;
  children?: React.ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        {segments.map((seg, i) => {
          const dash = Math.max(0, Math.min(1, seg.fraction)) * c;
          const el = (
            <Circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              fill="none"
              strokeDasharray={`${dash} ${c - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return el;
        })}
      </Svg>
      {children}
    </View>
  );
}
