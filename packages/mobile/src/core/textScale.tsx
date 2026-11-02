/**
 * The member's chosen text size, relative to the app's shipped default.
 *
 * A context provider rather than prop drilling, because the scale has to
 * reach every screen's typography, including module screens from the three
 * module repos that import from `@gatewaze/mobile` and have no path of their
 * own back to a root-level setting.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';
import { cacheGet, cacheSet } from './cache';

export const TEXT_SCALE_OPTIONS = [
  { id: 'small', label: 'Small', scale: 0.88 },
  { id: 'default', label: 'Default', scale: 1.0 },
  { id: 'large', label: 'Large', scale: 1.15 },
  { id: 'xlarge', label: 'Extra large', scale: 1.3 },
] as const;

export type TextScaleId = (typeof TEXT_SCALE_OPTIONS)[number]['id'];

const DEFAULT_SCALE_ID: TextScaleId = 'default';
const TEXT_SCALE_KEY = 'core:textScale';

function scaleFor(id: TextScaleId): number {
  return TEXT_SCALE_OPTIONS.find((o) => o.id === id)?.scale ?? 1;
}

interface TextScaleState {
  scaleId: TextScaleId;
  scale: number;
  setScaleId: (id: TextScaleId) => void;
}

const TextScaleContext = createContext<TextScaleState>({
  scaleId: DEFAULT_SCALE_ID,
  scale: 1,
  setScaleId: () => {},
});

export function TextScaleProvider({ children }: { children: React.ReactNode }) {
  const [scaleId, setScaleIdState] = useState<TextScaleId>(DEFAULT_SCALE_ID);

  // Loads after first paint, same pattern as app/settings/index.tsx's
  // `enabled` entitlement state: a brief default-size paint before the
  // persisted choice arrives, rather than blocking the first frame on a
  // sqlite read.
  useEffect(() => {
    let alive = true;
    void cacheGet(TEXT_SCALE_KEY).then((v) => {
      if (alive && typeof v === 'string' && TEXT_SCALE_OPTIONS.some((o) => o.id === v)) {
        setScaleIdState(v as TextScaleId);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  // Defined fresh each render, so it always closes over the current
  // `scaleId` — deliberately NOT memoised with useCallback. Slider fires
  // onValueChange on every PanResponder move event, not only when the
  // snapped value changes, so without this guard a single drag across the 4
  // steps would fire a sqlite write on every intermediate pixel instead of
  // up to 3 times (once per step boundary actually crossed).
  const setScaleId = (id: TextScaleId) => {
    if (id === scaleId) return;
    setScaleIdState(id);
    void cacheSet(TEXT_SCALE_KEY, id);
  };

  return (
    <TextScaleContext.Provider value={{ scaleId, scale: scaleFor(scaleId), setScaleId }}>
      {children}
    </TextScaleContext.Provider>
  );
}

export function useTextScale(): TextScaleState {
  return useContext(TextScaleContext);
}
