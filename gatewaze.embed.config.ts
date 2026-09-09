import type { GatewazeConfig } from './packages/shared/src/types/modules';
import baseConfig from './gatewaze.config';

// Module allow-list for the @gatewaze/admin-embed library build (the
// embeddable admin library for host applications). This build compiles in
// only the newsletters pilot module and its declared dependencies — NOT
// the full module set the main admin app ships. Runtime enablement is
// still gated per-request by GwHostContext.enabled.moduleIds/features
// (see src/embed.tsx), so this list only bounds what's compiled at all.
//
// Selected via GATEWAZE_CONFIG_FILE=gatewaze.embed.config.ts, read by
// vite-plugin-gatewaze-modules.ts. The main app build/dev server is
// unaffected — it keeps reading gatewaze.config.ts.
const config: GatewazeConfig = {
  ...baseConfig,
  modules: [
    'newsletters',
    'content-platform',
    'host-media',
    'templates',
    'editor-ai-copilot',
  ],
};

export default config;
