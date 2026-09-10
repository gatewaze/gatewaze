/**
 * Where the app's floating chrome is, so nothing has to guess.
 *
 * The header and the composer both float over the content area rather than
 * sitting in flex flow, which is what lets the thread scroll underneath and
 * dissolve at both ends. The cost is that a surface filling that area has no
 * way of knowing which parts of it are covered, and anything drawn in those
 * bands is invisible.
 *
 * Before this existed each surface carried its own guess at the numbers, and
 * they were wrong the moment the chrome changed: a module reserved a fixed
 * 150pt for a composer that is not a fixed height, and reserved nothing at
 * all for the header. The core measures its own chrome and publishes it
 * here, and every surface reads the same values.
 *
 * Two ways to use it:
 *
 * - Content that must stay visible (controls, result lists, buttons) applies
 *   the insets as PADDING ON THE CONTAINER, so it is laid out inside the
 *   clear band. `ModeSurface` does this for you.
 * - Content on a timeline that should pass behind the chrome (the coach
 *   thread) applies them as PADDING ON THE SCROLL CONTENT instead. It then
 *   scrolls under the header and composer but comes to rest clear of both.
 */

import React, { createContext, useContext, useMemo } from 'react';

export interface ChromeInsets {
  /** Height of the floating header, measured from the top of the surface. */
  top: number;
  /** Height of the floating composer, measured from the bottom. */
  bottom: number;
}

const ChromeInsetsContext = createContext<ChromeInsets>({ top: 0, bottom: 0 });

export function ChromeInsetsProvider({
  top,
  bottom,
  children,
}: ChromeInsets & { children: React.ReactNode }) {
  const value = useMemo(() => ({ top, bottom }), [top, bottom]);
  return (
    <ChromeInsetsContext.Provider value={value}>{children}</ChromeInsetsContext.Provider>
  );
}

/**
 * The clear band of the content area: everything between the bottom of the
 * header and the top of the composer.
 *
 * A surface rendered where there is no chrome (a pushed screen with a native
 * header, for instance) reads zeroes, so the same code is correct in both
 * places without branching on which one it is in.
 */
export function useChromeInsets(): ChromeInsets {
  return useContext(ChromeInsetsContext);
}
