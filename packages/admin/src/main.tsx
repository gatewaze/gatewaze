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

// Self-hosted Inter. Required because the admin nginx sends
// Cross-Origin-Embedder-Policy: credentialless (intentional — unlocks
// SharedArrayBuffer for the PDF generator's brotli decoder), and under that
// policy the woff2 files served by fonts.gstatic.com don't always pass the
// cross-origin-isolation requirement, so the browser silently falls back to
// system fonts on production. Loading the same fonts from same-origin
// node_modules sidesteps COEP entirely and keeps prod + localhost identical.
//
// Single-family policy: the admin chrome uses Inter everywhere — body and
// headings — instead of the previous Inter/Poppins split. Poppins was only
// ever applied to a handful of Radix <Heading>-based pages (Settings), and
// the visible weight differences against the surrounding Inter UI weren't
// worth carrying a second font family for. The radixOverrides.css var
// declarations have been collapsed to match.
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";

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
