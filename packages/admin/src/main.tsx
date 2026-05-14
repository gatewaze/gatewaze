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
// `process.env.X` directly without a `typeof` guard.
//
// `process.env` is wrapped in a Proxy that returns '' (empty
// string) for any missing key. The previous attempt (1.2.19) used a
// plain object with only NODE_ENV set; libs that did
// `process.env.SOMETHING.split('/')` then threw `Cannot read
// properties of undefined (reading 'split')`. Empty string supports
// every string method (`.split`, `.length`, `.indexOf`, etc.) and is
// the closest semantically to "env var not set" — which is what
// these libs are typically branching on anyway.
if (typeof (globalThis as { process?: unknown }).process === 'undefined') {
   
  const envBase: Record<string, string> = { NODE_ENV: 'production' };
  const envProxy = new Proxy(envBase, {
    get(target, key) {
      if (typeof key !== 'string') return undefined;
      return key in target ? target[key] : '';
    },
  });
   
  (globalThis as any).process = {
    env: envProxy,
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
