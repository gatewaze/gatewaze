// Dev placeholder. Silences the /runtime-config.js 404 in `vite dev`.
//
// In production this file is overwritten at container startup by
// docker/admin/entrypoint.sh, which generates a `window.__GATEWAZE_CONFIG__`
// object populated from the pod's VITE_* env vars. See vite.config.ts and
// index.html for the full mechanism.
//
// The inline bootstrap in index.html already sets `window.__GATEWAZE_CONFIG__`
// to `{}` before this file loads, so an empty file here is equivalent to no
// file — just without the 404.
