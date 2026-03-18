// @ts-nocheck
/**
 * Multi-brand configuration for Gatewaze Admin
 * This file defines all brand-specific settings and feature flags
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
  warehouse: boolean; // BigQuery data warehouse integration
  newsletters: boolean;
  slack: boolean; // Slack workspace invitation management
}

export interface BrandConfig {
  // Brand identification
  id: string;
  name: string;
  title: string;
  appName: string;

  // Feature flags
  features: BrandFeatures;

  // Supabase configuration
  supabase: {
    url: string;
    anonKey: string;
    serviceRoleKey?: string; // Only set in server/build environment
  };

  // API configuration
  api: {
    baseUrl: string;
    scraperApiUrl?: string; // Only for brands with scraper feature
  };

  // Customer.io configuration
  customerio: {
    siteId: string;
    apiKey: string;
    appApiKey?: string; // Bearer token for app API (server-side)
  };

  // Auth configuration
  auth: {
    storageKey: string; // LocalStorage key for auth token
  };

  // UI configuration
  ui: {
    primaryColor?: string;
    secondaryColor?: string;
    logoPath?: string;
    faviconPath?: string;
  };

  // Stripe configuration
  stripe?: {
    publishableKey: string;
    // Note: Secret keys and webhook secrets should be in environment variables only
    // and accessed server-side (Edge Functions) via STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET
  };
}

// Brand configurations
export const brands: Record<string, BrandConfig> = {
  techtickets: {
    id: 'techtickets',
    name: 'TechTickets',
    title: 'TechTickets Admin',
    appName: 'TechTickets Admin Dashboard',

    features: {
      competitions: true,
      discounts: true,
      scrapers: true,
      blog: true,
      offers: true,
      members: true,
      events: true,
      jobs: false,
      cohorts: false,
      stripe: true,
      emails: true,
      compliance: true,
      warehouse: true,
      newsletters: true,
      slack: false, // TechTickets doesn't need Slack integration
    },

    supabase: {
      url: import.meta.env.VITE_SUPABASE_URL || 'https://data.tech.tickets',
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0',
      serviceRoleKey: import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
    },

    api: {
      baseUrl: import.meta.env.VITE_API_BASE_URL
        || (import.meta.env.DEV ? 'http://api-techtickets.localhost' : 'https://api.tech.tickets'),
      scraperApiUrl: import.meta.env.VITE_SCRAPER_API_URL
        || (import.meta.env.DEV ? 'http://api-techtickets.localhost/api/scrapers' : 'https://api.tech.tickets/api/scrapers'),
    },

    customerio: {
      siteId: import.meta.env.VITE_CUSTOMERIO_SITE_ID || '',
      apiKey: import.meta.env.VITE_CUSTOMERIO_API_KEY || '',
      appApiKey: import.meta.env.CUSTOMERIO_APP_API_KEY,
    },

    auth: {
      storageKey: 'gatewaze-admin-auth-token',
    },

    ui: {
      primaryColor: '#ee4443',  // Red - Tech Tickets brand color
      secondaryColor: '#1e2837',  // Dark blue-grey - Tech Tickets secondary color
      logoPath: '/theme/techtickets/logo.svg',
      faviconPath: '/theme/techtickets/',
    },

    stripe: {
      publishableKey: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '',
    },
  },

  mlops: {
    id: 'mlops',
    name: 'MLOps Community',
    title: 'MLOps Community Admin',
    appName: 'MLOps Community Dashboard',

    features: {
      competitions: false, // MLOps doesn't need competitions
      discounts: false,    // MLOps doesn't need discounts
      scrapers: true,     // Scrapers disabled until backend is configured
      blog: true,         // MLOps doesn't need blog
      offers: true,
      members: true,       // MLOps has members
      events: true,        // Events feature enabled for MLOps
      jobs: true,          // MLOps-specific feature
      cohorts: true,       // MLOps-specific feature
      stripe: true,        // Stripe payments enabled for MLOps
      emails: true,        // Email management enabled
      compliance: true,    // Privacy compliance management
      warehouse: true,     // BigQuery data warehouse integration
      newsletters: true,   // Newsletter content management
      slack: true,         // Slack workspace invitation management
    },

    supabase: {
      url: import.meta.env.VITE_SUPABASE_URL || 'https://mlopssupabase.supabase.co', // Placeholder - needs real URL
      anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY || 'mlops-anon-key-placeholder', // Placeholder - needs real key
      serviceRoleKey: import.meta.env.SUPABASE_SERVICE_ROLE_KEY,
    },

    api: {
      baseUrl: import.meta.env.VITE_API_BASE_URL
        || (import.meta.env.DEV ? 'http://api-mlops.localhost' : 'https://api.mlops.community'),
      scraperApiUrl: import.meta.env.VITE_SCRAPER_API_URL
        || (import.meta.env.DEV ? 'http://api-mlops.localhost/api/scrapers' : 'https://api.mlops.community/api/scrapers'),
    },

    customerio: {
      siteId: import.meta.env.VITE_CUSTOMERIO_SITE_ID || 'mlops-site-id',
      apiKey: import.meta.env.VITE_CUSTOMERIO_API_KEY || 'mlops-api-key',
      appApiKey: import.meta.env.CUSTOMERIO_APP_API_KEY,
    },

    auth: {
      storageKey: 'mlops-admin-auth-token',
    },

    ui: {
      primaryColor: '#ca2b7f',  // Pink/Magenta - ML Ops brand color
      secondaryColor: '#4086c6',  // Blue - ML Ops secondary color
      logoPath: '/theme/mlops/logo_white.png',  // Default to white logo
      faviconPath: '/theme/mlops/',
    },

    stripe: {
      publishableKey: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '',
    },
  },
};

/**
 * Get the current brand configuration based on environment variable
 * @returns The brand configuration for the current brand
 */
export function getBrandConfig(): BrandConfig {
  const brandId = import.meta.env.VITE_BRAND_ID || 'techtickets';
  const config = brands[brandId];

  if (!config) {
    console.warn(`Brand "${brandId}" not found, falling back to techtickets`);
    return brands.techtickets;
  }

  return config;
}

/**
 * Check if a specific feature is enabled for the current brand
 * @param feature The feature to check
 * @returns Whether the feature is enabled
 */
export function isFeatureEnabled(feature: keyof BrandFeatures): boolean {
  const config = getBrandConfig();
  return config.features[feature] || false;
}

/**
 * Get the Supabase configuration for the current brand
 * @returns Supabase URL and keys
 */
export function getSupabaseConfig() {
  const config = getBrandConfig();
  return config.supabase;
}

/**
 * Check if Supabase is configured for the current brand
 * @returns Whether Supabase is properly configured
 */
export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = getSupabaseConfig();
  return Boolean(url && anonKey && url !== '' && anonKey !== '');
}

/**
 * Get the Customer.io configuration for the current brand
 * @returns Customer.io credentials
 */
export function getCustomerIOConfig() {
  const config = getBrandConfig();
  return config.customerio;
}

/**
 * Get the API configuration for the current brand
 * @returns API URLs
 */
export function getApiConfig() {
  const config = getBrandConfig();
  return config.api;
}

/**
 * Get the base API URL with automatic localhost detection for development
 * @returns The appropriate API base URL based on environment
 */
export function getApiBaseUrl(): string {
  const config = getBrandConfig();
  // The config already has the correct URLs for each brand and environment
  return config.api.baseUrl;
}

/**
 * Get the auth configuration for the current brand
 * @returns Auth settings
 */
export function getAuthConfig() {
  const config = getBrandConfig();
  return config.auth;
}

/**
 * Get all enabled features for the current brand
 * @returns Array of enabled feature names
 */
export function getEnabledFeatures(): (keyof BrandFeatures)[] {
  const config = getBrandConfig();
  return (Object.keys(config.features) as (keyof BrandFeatures)[])
    .filter(feature => config.features[feature]);
}

/**
 * Get the brand ID from environment
 * @returns The current brand ID
 */
export function getBrandId(): string {
  return import.meta.env.VITE_BRAND_ID || 'techtickets';
}

/**
 * Get the Stripe configuration for the current brand
 * @returns Stripe configuration
 */
export function getStripeConfig() {
  const config = getBrandConfig();
  return config.stripe;
}

/**
 * Check if Stripe is configured for the current brand
 * @returns Whether Stripe is properly configured
 */
export function isStripeConfigured(): boolean {
  const stripeConfig = getStripeConfig();
  return Boolean(stripeConfig?.publishableKey && stripeConfig.publishableKey !== '');
}

// Export type for use in other files
export type { BrandConfig, BrandFeatures };