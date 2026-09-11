import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import { createRequire } from "module";
import tailwindcss from "@tailwindcss/vite";
import { gatewazeModulesPlugin } from "./vite-plugin-gatewaze-modules";
import {
  SHARED_DEDUPE,
  SHARED_OPTIMIZE_DEPS_INCLUDE,
  buildRuntimeConfigDefine,
  buildSharedAlias,
} from "./vite-shared-config";

// Scopes vite-plugin-gatewaze-modules.ts to the pilot module allow-list
// (gatewaze.embed.config.ts) instead of the main app's full module set.
// Must be set before the plugin resolves its config path.
process.env.GATEWAZE_CONFIG_FILE = "gatewaze.embed.config.ts";

// sonner's package.json "exports" map has no catch-all, so the bridge below cannot import
// `sonner/dist/index.mjs` the way radixThemesPortal.tsx imports Radix's entry by path. Resolve the
// real entry here and expose it under a private specifier the bridge can import instead.
// Seeded from __dirname rather than import.meta.url: this config is loaded as CJS (it uses
// __dirname throughout), where import.meta is not available.
const sonnerEntry = createRequire(path.join(__dirname, "vite.embed.config.ts")).resolve("sonner");

// Library build for @gatewaze/admin-embed, the embeddable admin library
// for host applications. Reuses the same plugin pipeline, aliasing, and
// dedupe list as the main app build (vite-shared-config.ts) so external
// module-repo sources resolve identically in both builds — the one
// thing this build does differently is the entry point, the module
// allow-list (via GATEWAZE_CONFIG_FILE above), and the output shape
// (a single importable ES module instead of an HTML-driven SPA).
//
// react/react-dom are bundled in, not externalized: the host (an
// Angular app) has no React runtime of its own for this chunk to share.
export default defineConfig({
  // Runtime-config define always applies here (there is no "embed dev
  // server" mode) — the host's mount() call populates
  // globalThis.__GATEWAZE_CONFIG__ at runtime, same mechanism as the
  // prebuilt-image-shared-across-brands case the main app build handles.
  define: buildRuntimeConfigDefine(__dirname, "vite-embed-config"),
  plugins: [react(), svgr(), tailwindcss(), gatewazeModulesPlugin()],
  resolve: {
    // Array form (not the shared object) so the first entry can match `@radix-ui/themes`
    // EXACTLY: it redirects the bare specifier to a shim that defaults every portalled
    // component's `container` to the host's portal element, while leaving deep specifiers
    // (`@radix-ui/themes/styles.css`, and the shim's own entry import) resolving to the real
    // package. Without it Radix overlays portal to the host's document.body, outside the scope
    // the embed stylesheet is contained to, and render unstyled. Embed build only — the
    // standalone app's config is untouched.
    alias: [
      {
        find: /^@radix-ui\/themes$/,
        replacement: path.resolve(__dirname, "src/embed/radixThemesPortal.tsx"),
      },
      // Same trick for `sonner`: routes toast() to the host's notification system when the host
      // supplies one, so embed toasts render as the host's own rather than as a second stack in a
      // different corner. The bridge reaches the real package through `gw-sonner-real` below.
      // Embed build only — core Gatewaze keeps its toaster untouched.
      {
        find: /^sonner$/,
        replacement: path.resolve(__dirname, "src/embed/sonnerHostBridge.tsx"),
      },
      { find: /^gw-sonner-real$/, replacement: sonnerEntry },
      // Rollup's matcher treats a string `find` as "equal, or followed by a slash", so these
      // keep the exact prefix semantics they had as an object.
      ...Object.entries(buildSharedAlias(__dirname)).map(([find, replacement]) => ({
        find,
        replacement,
      })),
    ],
    dedupe: SHARED_DEDUPE,
  },
  optimizeDeps: {
    include: SHARED_OPTIMIZE_DEPS_INCLUDE,
  },
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, "src/embed.tsx"),
      formats: ["es"],
      fileName: () => "admin-embed.js",
      // cssFileName isn't a Vite option pre-6; with cssCodeSplit:false the
      // single stylesheet lands at dist-embed/admin-embed.css by default —
      // the host must load it alongside the JS chunk.
    },
  },
});
