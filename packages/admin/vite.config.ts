import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { gatewazeModulesPlugin } from "./vite-plugin-gatewaze-modules";

export default defineConfig({
  plugins: [react(), svgr(), tailwindcss(), gatewazeModulesPlugin()],
  resolve: {
    alias: {
      "@": path.join(__dirname, "src"),
      "@gatewaze/shared": path.resolve(__dirname, "../shared/src"),
      // Stub undici — a Node-only HTTP client that a transitive dep
      // drags into the admin bundle (event-invites tab crash). Tried
      // polyfilling `process.versions.node` (worked) but then undici
      // calls `util.debuglog` and the polyfill chain keeps growing.
      // Easier to alias the package to an empty stub since the admin
      // never legitimately invokes undici at runtime (uses fetch()
      // directly). See src/stubs/undici-empty.ts.
      "undici": path.resolve(__dirname, "src/stubs/undici-empty.ts"),
      // Stub jsdom — Node-only DOM simulator pulled in via
      // isomorphic-dompurify's Node branch (and possibly other libs
      // doing SSR-on-server detection). Admin runs in a real browser
      // with a native DOM; jsdom is dead weight. Without this stub,
      // jsdom's VirtualConsole crashes at module init with
      // `Class extends value undefined` because Vite stubs node:events
      // and jsdom tries to `class VirtualConsole extends EventEmitter`.
      "jsdom": path.resolve(__dirname, "src/stubs/jsdom-empty.ts"),
    },
    // Ensure bare imports from external module sources (gatewaze-modules) resolve
    // from the admin app's node_modules, not from the module's filesystem location
    dedupe: [
      "jszip", "react", "react-dom", "react-router", "react-router-dom",
      "sonner", "@heroicons/react", "@headlessui/react", "@dnd-kit/core",
      "@dnd-kit/sortable", "@dnd-kit/utilities", "@supabase/supabase-js",
      "@tanstack/react-table", "react-hook-form", "@hookform/resolvers",
      "@radix-ui/themes", "yup", "apexcharts", "react-apexcharts",
      "pdfjs-dist",
      // Canvas / WYSIWYG editor deps imported from gatewaze-modules
      // module files. dedupe forces Vite to resolve from admin/node_modules
      // and routes through optimizeDeps so the pre-bundled (ESM) version
      // is served — not the raw CJS file (which would crash the browser
      // with `module is not defined`).
      "@puckeditor/core", "isomorphic-dompurify",
      // react-email used by the newsletter email-blocks registry —
      // same dedupe rationale as @puckeditor/core.
      "@react-email/components", "@react-email/render",
    ],
  },
  server: {
    port: 5274,
    allowedHosts: true,
    fs: {
      allow: [
        // Allow serving files from module sibling repos
        path.resolve(__dirname, "../../../gatewaze-modules"),
        path.resolve(__dirname, "../../../premium-gatewaze-modules"),
        path.resolve(__dirname, "../../../lf-gatewaze-modules"),
        // Default: project root and workspace
        path.resolve(__dirname, "../.."),
      ],
    },
    // Stop chokidar from waking on platform-internal sentinel files.
    // The API server writes these through symlinks into module source
    // directories on every enable / disable / apply-update; without this,
    // every module toggle propagates a watch event into the dev server
    // and Vite triggers a full page reload.
    watch: {
      ignored: [
        '**/.snapshot',
        '**/.snapshot.tmp',
        '**/.rebuild-requested',
        '**/.rebuild-status-*',
        '**/.gatewaze-modules/**',
      ],
    },
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
      },
    },
  },
  optimizeDeps: {
    // Ensure deps from external module sources are resolved from admin's node_modules.
    // `cookie` and `leaflet` are CJS modules that break Vite's automatic CJS→ESM
    // interop (named exports like `parse`, `DomUtil` come through as undefined).
    // Listing them here forces esbuild to pre-bundle with proper named-export
    // re-exports so consumer imports work in dev mode.
    include: [
      "jszip", "qr-code-styling", "pdf-lib", "@pdf-lib/fontkit", "pdfjs-dist",
      "cookie", "set-cookie-parser", "turbo-stream", "leaflet", "react-leaflet",
      "@heroicons/react/24/outline", "@heroicons/react/24/solid", "@heroicons/react/20/solid",
      // react-router-dom v7 imports `cookie`, `set-cookie-parser`, `turbo-stream`
      // with named-export syntax; without pre-bundling the importer chain,
      // module-file imports from outside the project root can land on the raw
      // CJS file and lose named exports.
      "react-router-dom", "react-router",
      // @puckeditor/core ships dual-format with `require → ./dist/index.js`
      // (CJS). Module files imported from /gatewaze-modules paths resolve
      // through Node's require chain and land on the CJS file, which then
      // crashes the browser with `module is not defined`. Pre-bundling
      // forces esbuild's CJS→ESM interop with proper named-export
      // re-exports for `Puck`, `Render`, `Frame`, etc.
      "@puckeditor/core",
      // isomorphic-dompurify is CJS-first; same fix applies for the Puck
      // RichText sanitiser when imported from module files.
      "isomorphic-dompurify",
      // @react-email/components and @react-email/render — same CJS-main
      // pattern. Newsletter email-blocks (gatewaze-modules/newsletters/
      // admin/components/puck/email-blocks/) import these from outside
      // the workspace root, so without explicit pre-bundling Vite serves
      // the raw .cjs file and import-analysis fails to resolve the
      // bare specifier. Per spec-builder-evaluation §3.6 (extended).
      "@react-email/components",
      "@react-email/render",
    ],
  },
  build: {
    rollupOptions: {
      // Multi-entry: admin SPA + standalone /docs/ app. The docs entry has its
      // own bundle (incl. Scalar's CSS) so its styles never leak into the admin.
      input: {
        main: path.resolve(__dirname, 'index.html'),
        docs: path.resolve(__dirname, 'docs.html'),
      },
      // NOTE: Do NOT externalize Node builtins here. `external` runs
      // before plugin resolveId, so listing 'path', 'fs', etc. as
      // external causes Rollup to emit raw `import "path"` in the
      // browser bundle — the runtime then crashes with "Failed to
      // resolve module specifier 'path'". The
      // vite-plugin-gatewaze-modules plugin uses module.isBuiltin()
      // to detect both `path` and `node:path` forms and stub them
      // (returning an empty module), which is what we actually want
      // for browser-bound chunks created from module api.ts files.
      //
      // UNRESOLVED_IMPORT was previously suppressed here; it masked a
      // real bug where module-file imports of admin-owned deps (e.g.
      // react-leaflet) shipped as raw bare specifiers and blew up in
      // the browser. The vite-plugin-gatewaze-modules plugin now stubs
      // truly unresolvable imports explicitly, so any remaining
      // UNRESOLVED_IMPORT is a real problem worth surfacing.
    },
  },
});
