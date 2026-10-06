import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import svgr from "vite-plugin-svgr";
import path from "path";
import fs from "fs";
import { createRequire } from "module";
import tailwindcss from "@tailwindcss/vite";
import { gatewazeModulesPlugin } from "./vite-plugin-gatewaze-modules";
import {
  SHARED_DEDUPE,
  SHARED_OPTIMIZE_DEPS_INCLUDE,
  buildRuntimeConfigDefine,
  buildSharedAlias,
} from "./vite-shared-config";

import { EMBED_CONTRACT } from "./src/embed/contract";

// Which modules the embed compiles in is the deployment's decision, not the
// repo's: ADMIN_EMBED_MODULES is a comma-separated allow-list (a module and
// every module it depends on — the plugin does not resolve dependencies).
// Runtime enablement is still narrowed per mount by GwHostContext.enabled.
// Handed to vite-plugin-gatewaze-modules.ts as GATEWAZE_MODULES; must be set
// before the plugin resolves its config.
const embedModules = (process.env.ADMIN_EMBED_MODULES || "")
  .split(",")
  .map((id) => id.trim())
  .filter(Boolean);
if (embedModules.length === 0) {
  throw new Error(
    "[vite-embed-config] ADMIN_EMBED_MODULES is not set — list the module ids to compile into the embed, e.g. ADMIN_EMBED_MODULES=newsletters,templates",
  );
}
process.env.GATEWAZE_MODULES = embedModules.join(",");

// Version stamped into the manifest. The image build passes the release tag;
// a local build falls back to "dev".
const embedVersion = process.env.ADMIN_EMBED_VERSION || "dev";

/**
 * Writes dist-embed/manifest.json after the bundle is on disk: the loader
 * fetches it to find the current content-hashed entry and stylesheet, and to
 * check the host contract before importing anything. Keep it small and
 * stable — a host reads it on every mount. Runs in closeBundle rather than
 * generateBundle because the lib build emits its stylesheet after plugins'
 * generateBundle hooks have run.
 */
function embedManifestPlugin(): Plugin {
  let outDir = "dist-embed";
  return {
    name: "gatewaze-embed-manifest",
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = fs.readdirSync(outDir);
      const entry = files.find((f) => /^admin-embed-[\w-]+\.js$/.test(f));
      const stylesheet = files.find((f) => /^admin-embed-[\w-]+\.css$/.test(f));
      if (!entry) throw new Error("[vite-embed-config] no entry chunk in the embed bundle");
      if (!stylesheet) throw new Error("[vite-embed-config] no stylesheet in the embed bundle");
      const manifest = {
        contract: EMBED_CONTRACT,
        version: embedVersion,
        entry,
        stylesheet,
        modules: embedModules,
        builtAt: new Date().toISOString(),
      };
      fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
      console.log(`[vite-embed-config] manifest: ${entry} + ${stylesheet} (contract ${EMBED_CONTRACT}, version ${embedVersion})`);
    },
  };
}

// sonner's package.json "exports" map has no catch-all, so the bridge below cannot import
// `sonner/dist/index.mjs` the way radixThemesPortal.tsx imports Radix's entry by path. Resolve the
// real entry here and expose it under a private specifier the bridge can import instead.
// Seeded from __dirname rather than import.meta.url: this config is loaded as CJS (it uses
// __dirname throughout), where import.meta is not available.
const sonnerEntry = createRequire(path.join(__dirname, "vite.embed.config.ts")).resolve("sonner");

// Library build of the embeddable admin, served by the admin image under
// /embed/ and loaded at runtime by @gatewaze/admin-embed (the loader).
// Reuses the same plugin pipeline, aliasing, and dedupe list as the main
// app build (vite-shared-config.ts) so external module-repo sources resolve
// identically in both builds — the one thing this build does differently
// is the entry point, the module allow-list (ADMIN_EMBED_MODULES above),
// and the output shape (an importable ES module plus a manifest instead of
// an HTML-driven SPA).
//
// react/react-dom are bundled in, not externalized: the host (an
// Angular app) has no React runtime of its own for this chunk to share.
export default defineConfig({
  // Runtime-config define always applies here (there is no "embed dev
  // server" mode) — the host's mount() call populates
  // globalThis.__GATEWAZE_CONFIG__ at runtime, same mechanism as the
  // prebuilt-image-shared-across-brands case the main app build handles.
  define: buildRuntimeConfigDefine(__dirname, "vite-embed-config"),
  plugins: [react(), svgr(), tailwindcss(), gatewazeModulesPlugin(), embedManifestPlugin()],
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
  // The app's public/ tree (flags, logos, illustrations — ~26MB) is for the
  // standalone SPA; nothing in the library bundle references it, and a host
  // page could not fetch it from here anyway.
  publicDir: false,
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: path.resolve(__dirname, "src/embed.tsx"),
      formats: ["es"],
      // Content-hashed names for everything (overridden below): the files are
      // served with a long immutable cache, and the manifest is the only
      // thing a host reads by a fixed name. A fixed entry name would let a
      // cached entry import chunks that no longer exist.
      fileName: () => "admin-embed.js",
      cssFileName: "admin-embed",
    },
    rollupOptions: {
      output: {
        entryFileNames: "admin-embed-[hash].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "[name]-[hash][extname]",
      },
    },
  },
});
