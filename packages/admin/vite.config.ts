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
  },
  server: {
    port: 5274,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://localhost:3002',
        changeOrigin: true,
        secure: false,
      },
    },
  },
});
