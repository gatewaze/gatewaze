import type { GatewazeConfig } from './packages/shared/src/types/modules';

const config: GatewazeConfig = {
  name: process.env.INSTANCE_NAME || 'Gatewaze',

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

  // Add paid modules here:
  // modules: ['@gatewaze-modules/stripe-payments'],
  modules: [],
};

export default config;
