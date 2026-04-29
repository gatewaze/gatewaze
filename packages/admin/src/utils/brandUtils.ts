/**
 * Brand utility functions for the Gatewaze Admin application
 */

import { getBrandConfig, getBrandId, isFeatureEnabled, getEnabledFeatures } from '@/config/brands';
import type { BrandConfig, BrandFeatures } from '@/config/brands';

/**
 * Get a user-friendly display name for the current brand
 * @returns The brand's display name
 */
export function getBrandDisplayName(): string {
  const config = getBrandConfig();
  return config.title || config.name || 'Gatewaze Admin';
}

/**
 * Get the primary color for the current brand
 * @returns The brand's primary color or default
 */
export function getBrandPrimaryColor(): string {
  const config = getBrandConfig();
  return config.ui?.primaryColor || '#3B82F6';
}

/**
 * Get the logo path for the current brand
 * @returns The brand's logo path or default
 */
export function getBrandLogoPath(): string {
  const config = getBrandConfig();
  return config.ui?.logoPath || '/logo/default.svg';
}

/**
 * Get the favicon path for the current brand
 * @returns The brand's favicon path or default
 */
export function getBrandFaviconPath(): string {
  const config = getBrandConfig();
  return config.ui?.faviconPath || '/favicon/';
}

/**
 * Check if the current brand has any of the specified features enabled
 * @param features Array of features to check
 * @returns True if any of the features are enabled
 */
export function hasAnyFeature(features: (keyof BrandFeatures)[]): boolean {
  return features.some(feature => isFeatureEnabled(feature));
}

/**
 * Check if the current brand has all of the specified features enabled
 * @param features Array of features to check
 * @returns True if all features are enabled
 */
export function hasAllFeatures(features: (keyof BrandFeatures)[]): boolean {
  return features.every(feature => isFeatureEnabled(feature));
}

/**
 * Get a feature-aware route path
 * If the feature is disabled, returns a fallback route
 * @param feature The feature required for this route
 * @param path The desired path
 * @param fallback The fallback path if feature is disabled
 * @returns The appropriate route path
 */
export function getFeatureRoute(
  feature: keyof BrandFeatures,
  path: string,
  fallback: string = '/inbox'
): string {
  return isFeatureEnabled(feature) ? path : fallback;
}

/**
 * Get the default dashboard route based on enabled features
 * @returns The default dashboard route
 */
export function getDefaultDashboardRoute(): string {
  // Always prefer home if available
  return '/inbox';
}

/**
 * Get the brand-specific API base URL
 * @returns The API base URL for the current brand
 */
export function getBrandApiUrl(): string {
  const config = getBrandConfig();
  return config.api.baseUrl;
}

/**
 * Get the brand-specific scraper API URL
 * @returns The scraper API URL or null if scrapers are not enabled
 */
export function getBrandScraperApiUrl(): string | null {
  if (!isFeatureEnabled('scrapers')) {
    return null;
  }
  const config = getBrandConfig();
  return config.api.scraperApiUrl || `${config.api.baseUrl}/scrapers`;
}

/**
 * Check if Customer.io is configured for the current brand
 * @returns True if Customer.io credentials are configured
 */
export function isCustomerIOConfigured(): boolean {
  const config = getBrandConfig();
  return Boolean(
    config.customerio?.siteId &&
    config.customerio?.apiKey &&
    config.customerio.siteId !== '' &&
    config.customerio.apiKey !== ''
  );
}

/**
 * Get a list of disabled features for the current brand
 * @returns Array of disabled feature names
 */
export function getDisabledFeatures(): (keyof BrandFeatures)[] {
  const config = getBrandConfig();
  return (Object.keys(config.features) as (keyof BrandFeatures)[])
    .filter(feature => !config.features[feature]);
}

/**
 * Format brand name for display in titles
 * @param pageName Optional page name to include
 * @returns Formatted title string
 */
export function formatBrandTitle(pageName?: string): string {
  const brandName = getBrandDisplayName();
  return pageName ? `${pageName} | ${brandName}` : brandName;
}

/**
 * Get brand-specific metadata for SEO/meta tags
 * @returns Object with meta tag properties
 */
export function getBrandMetadata() {
  const config = getBrandConfig();
  return {
    title: config.title,
    applicationName: config.appName,
    themeColor: config.ui?.primaryColor || '#3B82F6',
    brandId: config.id,
  };
}

/**
 * Check if we're in development mode for a specific brand
 * @param brandId Optional brand ID to check (defaults to current)
 * @returns True if in development mode for the brand
 */
export function isBrandDevelopment(brandId?: string): boolean {
  const currentBrandId = brandId || getBrandId();
  return process.env.NODE_ENV === 'development' && getBrandId() === currentBrandId;
}

/**
 * Get environment-specific config value
 * @param key The config key to retrieve
 * @param defaultValue Default value if not found
 * @returns The config value or default
 */
export function getBrandEnvConfig(key: string, defaultValue: unknown = null): unknown {
  const brandId = getBrandId();
  const envKey = `VITE_${brandId.toUpperCase()}_${key.toUpperCase()}`;
  return import.meta.env[envKey] || import.meta.env[`VITE_${key.toUpperCase()}`] || defaultValue;
}

// Re-export commonly used functions from brands config for convenience
export {
  getBrandConfig,
  getBrandId,
  isFeatureEnabled,
  getEnabledFeatures,
  getApiBaseUrl,
  type BrandConfig,
  type BrandFeatures,
} from '@/config/brands';