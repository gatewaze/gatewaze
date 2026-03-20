/**
 * Application configuration for Gatewaze Admin
 * Single-brand configuration — all features enabled by default
 */

export interface BrandFeatures {
  competitions: boolean;
  discounts: boolean;
  scrapers: boolean;
  blog: boolean;
  offers: boolean;
  members: boolean;
  events: boolean;
  jobs: boolean;
  cohorts: boolean;
  stripe: boolean;
  emails: boolean;
  compliance: boolean;
  newsletters: boolean;
  slack: boolean;
}

export interface BrandConfig {
  id: string;
  name: string;
  title: string;
  appName: string;
  features: BrandFeatures;
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey?: string;
  };
  api: {
    baseUrl: string;
    scraperApiUrl?: string;
  };
  customerio?: {
    siteId: string;
    apiKey: string;
    appApiKey?: string;
  };
  auth: {
    storageKey: string;
  };
  domains: {
    shortLink: string; // Short.io domain for link shortening
    portal: string; // Portal domain for public-facing URLs
    surveyBase: string; // Base URL for surveys
  };
  newsletter: {
    fromEmail: string;
    fromName: string;
    partnersEmail: string;
  };
  ui: {
    primaryColor?: string;
    secondaryColor?: string;
    logoPath?: string;
    faviconPath?: string;
  };
  stripe?: {
    publishableKey: string;
  };
}

/**
 * Get the application configuration from environment variables.
 * All features are enabled — configure external services via env vars.
 */
export function getBrandConfig(): BrandConfig {
  return {
    id: 'gatewaze',
    name: import.meta.env.VITE_APP_NAME || 'Gatewaze',
    title: import.meta.env.VITE_APP_NAME ? `${import.meta.env.VITE_APP_NAME} Admin` : 'Gatewaze Admin',
    appName: import.meta.env.VITE_APP_NAME ? `${import.meta.env.VITE_APP_NAME} Dashboard` : 'Gatewaze Dashboard',

    features: {
      competitions: true,
      discounts: true,
      scrapers: true,
      blog: true,
      offers: true,
      members: true,
      events: true,
      jobs: true,
      cohorts: true,
      stripe: true,
      emails: true,
      compliance: true,
      newsletters: true,
      slack: true,
    },

    supabase: {
      url: import.meta.env.VITE_SUPABASE_URL || '',
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || '',
      serviceRoleKey: import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
    },

    api: {
      baseUrl: import.meta.env.VITE_API_BASE_URL || '/api',
      scraperApiUrl: import.meta.env.VITE_SCRAPER_API_URL || '',
    },

    customerio: {
      siteId: import.meta.env.VITE_CUSTOMERIO_SITE_ID || '',
      apiKey: import.meta.env.VITE_CUSTOMERIO_API_KEY || '',
      appApiKey: import.meta.env.CUSTOMERIO_APP_API_KEY,
    },

    auth: {
      storageKey: 'gatewaze-admin-auth-token',
    },

    domains: {
      shortLink: import.meta.env.VITE_SHORT_LINK_DOMAIN || '',
      portal: import.meta.env.VITE_PORTAL_DOMAIN || '',
      surveyBase: import.meta.env.VITE_SURVEY_BASE_URL || '',
    },

    newsletter: {
      fromEmail: import.meta.env.VITE_NEWSLETTER_FROM_EMAIL || '',
      fromName: import.meta.env.VITE_NEWSLETTER_FROM_NAME || import.meta.env.VITE_APP_NAME || 'Gatewaze',
      partnersEmail: import.meta.env.VITE_PARTNERS_EMAIL || '',
    },

    ui: {
      primaryColor: import.meta.env.VITE_PRIMARY_COLOR || '#20dd20',
      secondaryColor: import.meta.env.VITE_SECONDARY_COLOR || '#0a0a0a',
    },

    stripe: {
      publishableKey: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '',
    },
  };
}

/** All features are always enabled in single-brand mode */
export function isFeatureEnabled(_feature: keyof BrandFeatures): boolean {
  return true;
}

export function getSupabaseConfig() {
  const config = getBrandConfig();
  return config.supabase;
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey);
}

export function getApiConfig() {
  const config = getBrandConfig();
  return config.api;
}

export function getApiBaseUrl(): string {
  return getBrandConfig().api.baseUrl;
}

export function getAuthConfig() {
  return getBrandConfig().auth;
}

export function getEnabledFeatures(): (keyof BrandFeatures)[] {
  return Object.keys(getBrandConfig().features) as (keyof BrandFeatures)[];
}

export function getBrandId(): string {
  return 'gatewaze';
}

export function getStripeConfig() {
  return getBrandConfig().stripe;
}

export function isStripeConfigured(): boolean {
  const stripeConfig = getStripeConfig();
  return Boolean(stripeConfig?.publishableKey);
}

export function getShortLinkDomain(): string {
  return getBrandConfig().domains.shortLink;
}

export function getPortalDomain(): string {
  return getBrandConfig().domains.portal;
}

export function getNewsletterConfig() {
  return getBrandConfig().newsletter;
}

export function getSurveyBaseUrl(): string {
  return getBrandConfig().domains.surveyBase;
}

export type { BrandConfig, BrandFeatures };
