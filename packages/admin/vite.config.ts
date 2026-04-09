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
    // Ensure deps from external module sources are resolved from admin's node_modules
    include: ["date-fns", "jszip", "qr-code-styling", "pdf-lib", "@pdf-lib/fontkit"],
  },
  build: {
    rollupOptions: {
      // Externalize Node built-ins that get pulled in via shared module system barrel exports
      external: ['fs', 'path', 'crypto', 'child_process', 'os', 'http', 'https', 'zlib', 'stream', 'util', 'net', 'tls', 'events', 'url', 'querystring', 'buffer'],
      onwarn(warning, warn) {
        // Suppress unresolved import warnings for module deps that may not be installed
        if (warning.code === 'UNRESOLVED_IMPORT') return;
        warn(warning);
      },
    },
  },
});
