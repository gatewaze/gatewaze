// Detects the "stale chunk after deploy" failure.
// ----------------------------------------------------------------------
// The admin is a Vite SPA with hash-named code-split chunks (e.g.
// `list-BhP8X2X6.js`). Every deploy changes those hashes and nginx drops
// the previous files, so a tab that was loaded BEFORE the deploy still
// holds the old route table. The next lazy `import()` then requests a
// chunk name that 404s, and the browser throws one of the messages below
// (wording differs per engine). We treat any of them as "the app has been
// updated, this tab is stale" — recoverable with a reload, not a crash.

export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === "string"
        ? error
        : (error as any)?.message || "";

  return (
    // Chromium / Edge
    /Failed to fetch dynamically imported module/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    // Firefox
    /error loading dynamically imported module/i.test(message) ||
    // Safari / WebKit
    /Importing a module script failed/i.test(message) ||
    /Unable to preload CSS/i.test(message) ||
    // Generic chunk-load naming used by some bundlers
    /ChunkLoadError/i.test(message)
  );
}
