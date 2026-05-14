// MUST be the very first import — polyfills.ts has no imports of its
// own, so importing it first guarantees it evaluates before any other
// module in the dependency graph. See polyfills.ts for the why; the
// short version is that ES module imports are hoisted and evaluated
// depth-first BEFORE the importer's body, so polyfill code in main.tsx's
// body runs AFTER vendor chunks have already cached `process.env.X` at
// their own module init. (Earlier 1.2.19/1.2.20 attempts hit exactly
// this — Proxy was in place by render time but the lib had already
// captured undefined at boot.)
import './polyfills'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

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
