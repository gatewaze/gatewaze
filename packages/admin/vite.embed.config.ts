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

// Scopes vite-plugin-gatewaze-modules.ts to the pilot module allow-list
// (gatewaze.embed.config.ts) instead of the main app's full module set.
// Must be set before the plugin resolves its config path.
process.env.GATEWAZE_CONFIG_FILE = "gatewaze.embed.config.ts";

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
    alias: buildSharedAlias(__dirname),
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
