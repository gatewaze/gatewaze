import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

// Polyfill SharedArrayBuffer for browsers without cross-origin isolation
// (the admin is served from a plain origin without COOP/COEP headers).
// @pdf-lib/fontkit's brotli decoder references the global symbol at
// module evaluation time and throws `ReferenceError: SharedArrayBuffer
// is not defined` from inside a render path on the event-invites tab,
// even though the surrounding component is React.lazy'd. The stub never
// gets used for real shared-memory (we don't run threaded WASM in the
// admin), so an ArrayBuffer fallback is safe — the lib gets a regular
// buffer with no cross-thread visibility, which is exactly what
// single-threaded execution wants.
if (typeof globalThis.SharedArrayBuffer === 'undefined') {
   
  (globalThis as any).SharedArrayBuffer = ArrayBuffer;
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
