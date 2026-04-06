import type { GatewazeConfig } from './packages/shared/src/types/modules';

const config: GatewazeConfig = {
  name: process.env.INSTANCE_NAME || 'Gatewaze',
  platformVersion: '1.0.0',

  auth: {
    provider: (process.env.AUTH_PROVIDER as 'supabase' | 'oidc') || 'supabase',
    oidc: {
      issuerUrl: process.env.OIDC_ISSUER_URL,
      clientId: process.env.OIDC_CLIENT_ID,
      clientSecret: process.env.OIDC_CLIENT_SECRET,
    },
  },

  email: {
    provider: (process.env.EMAIL_PROVIDER as 'sendgrid' | 'smtp') || 'sendgrid',
  },

  // Module sources — directories containing module packages.
  // Can be local paths (relative to project root) or git repo URLs.
  // Examples:
  //   '../gatewaze-modules/modules'              — local sibling folder (default)
  //   './custom-modules'                          — local folder in project
  //   'https://github.com/org/modules.git'        — git repo (cloned at build time)
  //   { url: 'https://github.com/gatewaze/gatewaze-modules.git', path: 'modules', branch: 'main' }
  moduleSources: [
    // Additional sources from EXTRA_MODULE_SOURCES env var (comma-separated paths)
    // Used to add private/brand-specific module repos without hardcoding in this file.
    // Set EXTRA_MODULE_SOURCES in your environment file (e.g., aaif.local.env).
    ...(process.env.EXTRA_MODULE_SOURCES?.split(',').map(s => s.trim()).filter(Boolean) || []),
  ],

  // All modules found in moduleSources are included automatically.
  // To limit to a subset, add a "modules" array with specific package names.
  // Enable/disable per-instance is controlled via the Modules admin page.
};

export default config;
