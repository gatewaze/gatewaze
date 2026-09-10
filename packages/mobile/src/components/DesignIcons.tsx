/**
 * Icons drawn from the design system's own SVG paths.
 *
 * Where the design specifies a particular mark — the asymmetric two-line
 * menu, the composer's mode glyphs — no SF Symbol or icon-font equivalent
 * matches it, so the paths are reproduced verbatim. Everything else falls
 * through to the platform icon set in Icon.tsx.
 *
 * All paths are authored on a 24x24 viewBox with round caps, matching the
 * design's `stroke-linecap:round` and stroke widths.
 */

import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export interface DesignIconProps {
  size?: number;
  color: string;
}

/** Names this module draws itself. Icon.tsx checks this before SF Symbols. */
export const DESIGN_ICON_NAMES = [
  'menu',
  'message-outline',
  'camera',
  'barcode',
  'magnify',
  'microphone',
  'plus',
  'arrow-up',
  'bug',
  'dumbbell',
  'silverware-fork-knife',
  'scale-bathroom',
  'cog-outline',
  'pencil',
] as const;

export type DesignIconName = (typeof DESIGN_ICON_NAMES)[number];

export function isDesignIcon(name: string): name is DesignIconName {
  return (DESIGN_ICON_NAMES as readonly string[]).includes(name);
}

export function DesignIcon({
  name,
  size = 15,
  color,
}: DesignIconProps & { name: DesignIconName }) {
  const common = {
    stroke: color,
    fill: 'none' as const,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {name === 'menu' ? (
        // The design's menu mark: one full rule and one short one.
        <Path d="M4 8h16M4 15h9" strokeWidth={2.4} {...common} />
      ) : null}

      {name === 'message-outline' ? (
        <Path
          d="M4 6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H9l-4 4v-4a3 3 0 0 1-1-2.2V6z"
          strokeWidth={2}
          {...common}
        />
      ) : null}

      {name === 'camera' ? (
        <>
          <Rect x={3} y={4} width={18} height={16} rx={3} strokeWidth={2} {...common} />
          <Circle cx={9} cy={10} r={2} strokeWidth={2} {...common} />
          <Path d="M21 16l-5-5-9 9" strokeWidth={2} {...common} />
        </>
      ) : null}

      {name === 'barcode' ? (
        <Path
          d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M7 12h.01M11 12h2M17 12h.01"
          strokeWidth={2}
          {...common}
        />
      ) : null}

      {name === 'magnify' ? (
        <>
          <Circle cx={11} cy={11} r={7} strokeWidth={2} {...common} />
          <Path d="M21 21l-4.3-4.3" strokeWidth={2} {...common} />
        </>
      ) : null}

      {name === 'microphone' ? (
        <>
          <Rect x={9} y={3} width={6} height={11} rx={3} strokeWidth={2} {...common} />
          <Path d="M6 11a6 6 0 0 0 12 0M12 17v4" strokeWidth={2} {...common} />
        </>
      ) : null}

      {name === 'plus' ? (
        <Path d="M12 5v14M5 12h14" strokeWidth={2.2} {...common} />
      ) : null}

      {name === 'arrow-up' ? (
        <Path d="M12 19V6M6 12l6-6 6 6" strokeWidth={2.4} {...common} />
      ) : null}

      {name === 'bug' ? (
        <>
          <Path
            d="M12 8a4 4 0 0 1 4 4v3a4 4 0 0 1-8 0v-3a4 4 0 0 1 4-4z"
            strokeWidth={2}
            {...common}
          />
          <Path
            d="M9 9 7 7M15 9l2-2M4 13h4M16 13h4M6 19l2.5-1.8M18 19l-2.5-1.8"
            strokeWidth={2}
            {...common}
          />
        </>
      ) : null}

      {/* Drawer destinations, drawn to the design's marks. */}
      {name === 'dumbbell' ? (
        <Path
          d="M2 12h3M19 12h3M7 8v8M17 8v8M7 12h10M5 9v6M19 9v6"
          strokeWidth={2}
          {...common}
        />
      ) : null}

      {name === 'silverware-fork-knife' ? (
        <Path
          d="M4 11h16M5 11a7 7 0 0 0 14 0M12 11V5M12 5c2 0 3-1 3-2"
          strokeWidth={2}
          {...common}
        />
      ) : null}

      {name === 'scale-bathroom' ? (
        <Path d="M4 19l5-6 4 3 7-9" strokeWidth={2} {...common} />
      ) : null}

      {name === 'cog-outline' ? (
        <Path
          d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"
          strokeWidth={2}
          {...common}
        />
      ) : null}

      {name === 'pencil' ? (
        <Path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" strokeWidth={2.4} {...common} />
      ) : null}
    </Svg>
  );
}
