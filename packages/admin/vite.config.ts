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
    },
    // Ensure bare imports from external module sources (gatewaze-modules) resolve
    // from the admin app's node_modules, not from the module's filesystem location
    dedupe: [
      "date-fns", "jszip", "react", "react-dom", "react-router", "react-router-dom",
      "sonner", "@heroicons/react", "@headlessui/react", "@dnd-kit/core",
      "@dnd-kit/sortable", "@dnd-kit/utilities", "@supabase/supabase-js",
      "@tanstack/react-table", "react-hook-form", "@hookform/resolvers",
      "@radix-ui/themes", "yup", "apexcharts", "react-apexcharts",
      "pdfjs-dist",
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
      "date-fns", "jszip", "qr-code-styling", "pdf-lib", "@pdf-lib/fontkit", "pdfjs-dist",
      "cookie", "set-cookie-parser", "turbo-stream", "leaflet", "react-leaflet",
      "@heroicons/react/24/outline", "@heroicons/react/24/solid", "@heroicons/react/20/solid",
      // react-router-dom v7 imports `cookie`, `set-cookie-parser`, `turbo-stream`
      // with named-export syntax; without pre-bundling the importer chain,
      // module-file imports from outside the project root can land on the raw
      // CJS file and lose named exports.
      "react-router-dom", "react-router",
    ],
  },
  build: {
    rollupOptions: {
      // Externalize Node built-ins that get pulled in via shared module system barrel exports
      external: ['fs', 'path', 'crypto', 'child_process', 'os', 'http', 'https', 'zlib', 'stream', 'util', 'net', 'tls', 'events', 'url', 'querystring', 'buffer'],
      // UNRESOLVED_IMPORT was previously suppressed here; it masked a
      // real bug where module-file imports of admin-owned deps (e.g.
      // react-leaflet) shipped as raw bare specifiers and blew up in
      // the browser. The vite-plugin-gatewaze-modules plugin now stubs
      // truly unresolvable imports explicitly, so any remaining
      // UNRESOLVED_IMPORT is a real problem worth surfacing.
    },
  },
});
