import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import tailwindcss from "@tailwindcss/vite";
import { gatewazeModulesPlugin } from "./vite-plugin-gatewaze-modules";
import {
  SHARED_DEDUPE,
  SHARED_OPTIMIZE_DEPS_INCLUDE,
  buildRuntimeConfigDefine,
  buildSharedAlias,
} from "./vite-shared-config";

export default defineConfig(({ command }) => ({
  // Only swap to the runtime-config global on `vite build`. `vite dev`
  // and vitest keep Vite's default .env resolution so local development
  // is unaffected. See vite-shared-config.ts's buildRuntimeConfigDefine
  // for the full rationale (one prebuilt image shared across brands).
  define: command === "build" ? buildRuntimeConfigDefine(__dirname, "vite-config") : {},
  plugins: [react(), svgr(), tailwindcss(), gatewazeModulesPlugin()],
  resolve: {
    // See vite-shared-config.ts for the rationale behind each alias/dedupe
    // entry — shared verbatim with vite.embed.config.ts so both builds
    // resolve external module-repo sources identically.
    alias: buildSharedAlias(__dirname),
    dedupe: SHARED_DEDUPE,
  },
  server: {
    port: 5274,
    allowedHosts: true,
    fs: {
      allow: [
        // Allow serving files from module sibling repos
        path.resolve(__dirname, "../../../gatewaze-modules"),
        path.resolve(__dirname, "../../../gatewaze-modules"),
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
      // In the macOS Docker dev container, bind-mount fsevents don't reach
      // chokidar, so host edits to /gatewaze-modules never trigger HMR.
      // VITE_USE_POLLING (set on the admin service in docker-compose.dev.yml)
      // switches to polling there. Native dev leaves it unset → fast fsevents.
      ...(process.env.VITE_USE_POLLING === "true"
        ? { usePolling: true, interval: 300 }
        : {}),
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
    // See vite-shared-config.ts for the rationale behind each entry.
    include: SHARED_OPTIMIZE_DEPS_INCLUDE,
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
}));
