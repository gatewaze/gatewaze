import path from "path";
import { execSync } from "node:child_process";

/**
 * Resolve config shared between the main app build (vite.config.ts) and
 * the admin-embed library build (vite.embed.config.ts). Both builds
 * compile the same `src/` tree plus the same external module-repo
 * sources, so they need identical alias/dedupe behavior — a drift here
 * (e.g. embed resolving a second react-router copy) would reproduce the
 * exact "two React instances" crashes the dedupe list exists to prevent.
 * Extracted rather than duplicated so there is one list to update.
 */
export function buildSharedAlias(adminDir: string): Record<string, string> {
  return {
    "@": path.join(adminDir, "src"),
    "@gatewaze/shared": path.resolve(adminDir, "../shared/src"),
    "undici": path.resolve(adminDir, "src/stubs/undici-empty.ts"),
    "jsdom": path.resolve(adminDir, "src/stubs/jsdom-empty.ts"),
    "@react-email/render": path.resolve(
      adminDir,
      "node_modules/@react-email/render/dist/browser/index.mjs",
    ),
  };
}

export const SHARED_DEDUPE = [
  "jszip", "react", "react-dom", "react-router", "react-router-dom",
  "sonner", "@heroicons/react", "@headlessui/react", "@dnd-kit/core",
  "@dnd-kit/sortable", "@dnd-kit/utilities", "@supabase/supabase-js",
  "@tanstack/react-table", "react-hook-form", "@hookform/resolvers",
  "@radix-ui/themes", "yup", "apexcharts", "react-apexcharts",
  "pdfjs-dist",
  "@puckeditor/core", "isomorphic-dompurify",
  "@react-email/components", "@react-email/render",
  "@assistant-ui/react",
  "@tiptap/pm",
];

/**
 * Runtime-config substitution for VITE_* env vars — see vite.config.ts's
 * original comment (preserved there) for the full rationale: one prebuilt
 * image is shared across brands, so `import.meta.env.VITE_X` gets
 * rewritten at build time to read `globalThis.__GATEWAZE_CONFIG__.VITE_X`
 * instead, and a pod entrypoint (or, for the embed, the host's mount()
 * call) populates that global at runtime. Shared so the embed build
 * rewrites the exact same set of references the main build does — the
 * embed's `mount()` sets a subset of these keys directly (see
 * src/embed.tsx); an undiscovered reference would silently read
 * `undefined` instead of throwing, which is strictly worse for an
 * embedded surface than for the main app.
 */
export function discoverViteEnvNames(rootDir: string): string[] {
  const grepCmd = `grep -rhoE 'import\\.meta\\.env\\.VITE_[A-Z0-9_]+' ${rootDir}/src ${rootDir}/../shared/src ${rootDir}/.gatewaze-modules ${rootDir}/../../../gatewaze-modules ${rootDir}/../../../gatewaze-modules ${rootDir}/../../../lf-gatewaze-modules /tmp/module-repos 2>/dev/null | sort -u || true`;
  let out = "";
  try {
    out = execSync(grepCmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    /* grep with `|| true` shouldn't throw, but be defensive */
  }
  const names = new Set<string>();
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("import.meta.env.VITE_")) continue;
    const name = trimmed.replace(/^import\.meta\.env\./, "");
    if (/^VITE_[A-Z0-9_]+$/.test(name)) names.add(name);
  }
  return Array.from(names).sort();
}

export function buildRuntimeConfigDefine(rootDir: string, logLabel: string): Record<string, string> {
  const names = discoverViteEnvNames(rootDir);
  const defines: Record<string, string> = {};
  for (const n of names) {
    // esbuild's `define` accepts only JS literals or identifier paths
    // (foo.bar.baz) — see vite.config.ts's original comment for why a
    // ternary/optional-chain form doesn't work here.
    defines[`import.meta.env.${n}`] = `globalThis.__GATEWAZE_CONFIG__.${n}`;
  }
  console.log(`[${logLabel}] runtime-config define: rewrote ${names.length} VITE_* references`);
  return defines;
}

export const SHARED_OPTIMIZE_DEPS_INCLUDE = [
  "jszip", "qr-code-styling", "pdf-lib", "@pdf-lib/fontkit", "pdfjs-dist",
  "cookie", "set-cookie-parser", "turbo-stream", "leaflet", "react-leaflet",
  "@heroicons/react/24/outline", "@heroicons/react/24/solid", "@heroicons/react/20/solid",
  "react-router-dom", "react-router",
  "@puckeditor/core",
  "isomorphic-dompurify",
  "@react-email/components",
  "@react-email/render",
  "@assistant-ui/react",
];
