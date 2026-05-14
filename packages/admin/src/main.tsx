import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// SharedArrayBuffer is now available via cross-origin isolation
// (COOP: same-origin + COEP: credentialless are emitted by nginx —
// see docker/admin/nginx.conf). The previous attempts at JS-side
// polyfilling (1.2.17 aliased to ArrayBuffer, then 1.2.18 set
// undefined explicitly) both produced downstream crashes because
// the threaded paths in @pdf-lib/fontkit's brotli decoder expect
// real shared-memory semantics. Solving it at the HTTP layer is the
// correct fix.

// `process` polyfill — some libraries bundled into admin (event
// invites WASM/PDF stack, isomorphic dompurify, etc.) reference
// `process.env.NODE_ENV` or `process.platform` at module evaluation
// time without a `typeof` guard. Vite's `define` config rewrites
// most of these at build time but transitive deps with direct
// `process.env.X` references against keys we don't define still
// throw `ReferenceError: process is not defined` in the browser.
// Stub a minimal Node-shaped object so the lookup resolves; libs
// reading `process.env.NODE_ENV` get 'production' (matches the build
// mode), everything else gets undefined (the standard fallback path).
if (typeof (globalThis as { process?: unknown }).process === 'undefined') {
   
  (globalThis as any).process = {
    env: { NODE_ENV: 'production' },
    platform: 'browser',
    version: '',
    versions: {},
    browser: true,
    nextTick: (cb: () => void) => setTimeout(cb, 0),
  };
}

// Initialise Sentry as early as possible so component tree errors are
// captured. No-op when VITE_SENTRY_DSN is unset.
import { initSentry } from './lib/sentry'
initSentry()

import "./i18n/config";
import "./utils/pdfjsSetup";
import { setupFavicon } from './utils/favicon';

import "simplebar-react/dist/simplebar.min.css";
// Loaded once globally so any module using react-leaflet (e.g. the scrapers
// module's host map) gets working marker styles without needing leaflet as
// its own npm dependency.
import "leaflet/dist/leaflet.css";

import "./styles/index.css";

// Setup brand-specific favicon and title
setupFavicon();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
