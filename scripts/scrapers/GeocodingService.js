import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Service for geocoding locations and mapping regions
 */
export class GeocodingService {
  constructor(config) {
    this.config = config || {};
    this.cache = new Map();
    this.cachePath = path.resolve(__dirname, this.config.cachePath || '../geocoding-cache.json');
    this.regionMapping = this.loadRegionMapping();

    this.loadCache();

    // Rate limiting
    this.lastRequest = 0;
    this.requestDelay = 1000; // 1 second between requests
  }

  /**
   * Load region mapping from existing files
   */
  loadRegionMapping() {
    try {
      const regionCodesPath = path.resolve(__dirname, 'region-codes.json');
      const countryCodesPath = path.resolve(__dirname, 'simplified_countries.json');

      let regionCodes = {};
      let countryCodes = [];

      if (fs.existsSync(regionCodesPath)) {
        regionCodes = JSON.parse(fs.readFileSync(regionCodesPath, 'utf8'));
      }

      if (fs.existsSync(countryCodesPath)) {
        countryCodes = JSON.parse(fs.readFileSync(countryCodesPath, 'utf8'));
      }

      console.log('🗺️ Region mapping loaded');
      return { regionCodes, countryCodes };
    } catch (error) {
      console.warn(`⚠️ Warning: Could not load region mapping: ${error.message}`);
      return { regionCodes: {}, countryCodes: [] };
    }
  }

  /**
   * Load geocoding cache
   */
  loadCache() {
    if (!this.config.cacheEnabled) return;

    try {
      if (fs.existsSync(this.cachePath)) {
        const cacheData = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
        Object.entries(cacheData).forEach(([key, value]) => {
          this.cache.set(key, value);
        });
        console.log(`🗃️ Loaded ${this.cache.size} cached geocoding entries`);
      }
    } catch (error) {
      console.warn(`⚠️ Warning: Could not load geocoding cache: ${error.message}`);
    }
  }

  /**
   * Save geocoding cache
   */
  saveCache() {
    if (!this.config.cacheEnabled) return;

    try {
      const cacheData = {};
      this.cache.forEach((value, key) => {
        cacheData[key] = value;
      });

      fs.writeFileSync(this.cachePath, JSON.stringify(cacheData, null, 2), 'utf8');
    } catch (error) {
      console.warn(`⚠️ Warning: Could not save geocoding cache: ${error.message}`);
    }
  }

  /**
   * Geocode a location (city, country) to coordinates
   */
  async geocode(city, countryCode) {
    if (!city || city.toLowerCase() === 'online') {
      return null;
    }

    // Create cache key
    const cacheKey = `${city.toLowerCase()}_${(countryCode || '').toLowerCase()}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    // Try built-in city coordinates first
    const builtInCoords = this.getBuiltInCoordinates(city, countryCode);
    if (builtInCoords) {
      this.cache.set(cacheKey, builtInCoords);
      this.saveCache();
      return builtInCoords;
    }

    // If API key is available, use geocoding service
    if (this.config.apiKey && this.config.enabled) {
      return await this.geocodeWithAPI(city, countryCode, cacheKey);
    }

    // Fallback to estimated coordinates
    const estimatedCoords = this.getEstimatedCoordinates(city, countryCode);
    if (estimatedCoords) {
      this.cache.set(cacheKey, estimatedCoords);
      this.saveCache();
    }

    return estimatedCoords;
  }

  /**
   * Get built-in coordinates for major cities
   */
  getBuiltInCoordinates(city, countryCode) {
    const cityLower = city.toLowerCase();
    const countryLower = (countryCode || '').toLowerCase();

    // Major world cities with coordinates
    const majorCities = {
      // North America
      'new york': { lat: 40.7128, lng: -74.0060, region: 'NA' },
      'los angeles': { lat: 34.0522, lng: -118.2437, region: 'NA' },
      'san francisco': { lat: 37.7749, lng: -122.4194, region: 'NA' },
      'chicago': { lat: 41.8781, lng: -87.6298, region: 'NA' },
      'toronto': { lat: 43.6532, lng: -79.3832, region: 'NA' },
      'vancouver': { lat: 49.2827, lng: -123.1207, region: 'NA' },

      // Europe
      'london': { lat: 51.5074, lng: -0.1278, region: 'EU' },
      'paris': { lat: 48.8566, lng: 2.3522, region: 'EU' },
      'berlin': { lat: 52.5200, lng: 13.4050, region: 'EU' },
      'amsterdam': { lat: 52.3676, lng: 4.9041, region: 'EU' },
      'madrid': { lat: 40.4168, lng: -3.7038, region: 'EU' },
      'rome': { lat: 41.9028, lng: 12.4964, region: 'EU' },
      'stockholm': { lat: 59.3293, lng: 18.0686, region: 'EU' },
      'copenhagen': { lat: 55.6761, lng: 12.5683, region: 'EU' },
      'vienna': { lat: 48.2082, lng: 16.3738, region: 'EU' },

      // Asia
      'tokyo': { lat: 35.6762, lng: 139.6503, region: 'AS' },
      'singapore': { lat: 1.3521, lng: 103.8198, region: 'AS' },
      'bangalore': { lat: 12.9716, lng: 77.5946, region: 'AS' },
      'mumbai': { lat: 19.0760, lng: 72.8777, region: 'AS' },
      'delhi': { lat: 28.7041, lng: 77.1025, region: 'AS' },
      'hong kong': { lat: 22.3193, lng: 114.1694, region: 'AS' },
      'seoul': { lat: 37.5665, lng: 126.9780, region: 'AS' },

      // Australia/Oceania
      'sydney': { lat: -33.8688, lng: 151.2093, region: 'OC' },
      'melbourne': { lat: -37.8136, lng: 144.9631, region: 'OC' },
      'brisbane': { lat: -27.4698, lng: 153.0251, region: 'OC' },
      'auckland': { lat: -36.8485, lng: 174.7633, region: 'OC' },

      // South America
      'são paulo': { lat: -23.5505, lng: -46.6333, region: 'SA' },
      'rio de janeiro': { lat: -22.9068, lng: -43.1729, region: 'SA' },
      'buenos aires': { lat: -34.6118, lng: -58.3960, region: 'SA' },

      // Africa
      'cape town': { lat: -33.9249, lng: 18.4241, region: 'AF' },
      'johannesburg': { lat: -26.2041, lng: 28.0473, region: 'AF' },
      'cairo': { lat: 30.0444, lng: 31.2357, region: 'AF' }
    };

    const coords = majorCities[cityLower];
    if (coords) {
      console.log(`📍 Built-in coordinates found for ${city}: ${coords.lat}, ${coords.lng}`);
      return coords;
    }

    return null;
  }

  /**
   * Geocode using external API (placeholder for future implementation)
   */
  async geocodeWithAPI(city, countryCode, cacheKey) {
    console.log(`🌐 Geocoding with API: ${city}, ${countryCode}`);

    // Rate limiting
    const now = Date.now();
    if (now - this.lastRequest < this.requestDelay) {
      await new Promise(resolve => setTimeout(resolve, this.requestDelay));
    }
    this.lastRequest = Date.now();

    try {
      // Placeholder for actual geocoding API call
      // This could be Google Maps, OpenStreetMap Nominatim, or other services

      // For now, return null to fall back to estimated coordinates
      console.log(`⚠️ API geocoding not implemented, falling back to estimation`);
      return null;

    } catch (error) {
      console.warn(`⚠️ API geocoding failed for ${city}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get estimated coordinates based on country/region
   */
  getEstimatedCoordinates(city, countryCode) {
    // Estimate coordinates based on country center points
    const countryEstimates = {
      'US': { lat: 39.8283, lng: -98.5795, region: 'NA' },
      'CA': { lat: 56.1304, lng: -106.3468, region: 'NA' },
      'GB': { lat: 55.3781, lng: -3.4360, region: 'EU' },
      'DE': { lat: 51.1657, lng: 10.4515, region: 'EU' },
      'FR': { lat: 46.2276, lng: 2.2137, region: 'EU' },
      'IT': { lat: 41.8719, lng: 12.5674, region: 'EU' },
      'ES': { lat: 40.4637, lng: -3.7492, region: 'EU' },
      'NL': { lat: 52.1326, lng: 5.2913, region: 'EU' },
      'SE': { lat: 60.1282, lng: 18.6435, region: 'EU' },
      'DK': { lat: 56.2639, lng: 9.5018, region: 'EU' },
      'AU': { lat: -25.2744, lng: 133.7751, region: 'OC' },
      'NZ': { lat: -40.9006, lng: 174.8860, region: 'OC' },
      'JP': { lat: 36.2048, lng: 138.2529, region: 'AS' },
      'SG': { lat: 1.3521, lng: 103.8198, region: 'AS' },
      'IN': { lat: 20.5937, lng: 78.9629, region: 'AS' },
      'BR': { lat: -14.2350, lng: -51.9253, region: 'SA' },
      'AR': { lat: -38.4161, lng: -63.6167, region: 'SA' },
      'ZA': { lat: -30.5595, lng: 22.9375, region: 'AF' }
    };

    const countryUpper = (countryCode || '').toUpperCase();
    const estimate = countryEstimates[countryUpper];

    if (estimate) {
      console.log(`📍 Estimated coordinates for ${city}, ${countryCode}: ${estimate.lat}, ${estimate.lng}`);
      return estimate;
    }

    console.log(`⚠️ No coordinates available for ${city}, ${countryCode}`);
    return null;
  }

  /**
   * Map city/country to region code
   */
  mapToRegion(city, countryCode) {
    if (!city) return null;

    // Handle online events
    if (city.toLowerCase() === 'online') {
      return 'ON';
    }

    // Try to determine region from country code
    const countryUpper = (countryCode || '').toUpperCase();

    const regionMapping = {
      // North America
      'US': 'NA', 'CA': 'NA', 'MX': 'NA',

      // Europe
      'GB': 'EU', 'DE': 'EU', 'FR': 'EU', 'IT': 'EU', 'ES': 'EU',
      'NL': 'EU', 'SE': 'EU', 'DK': 'EU', 'NO': 'EU', 'FI': 'EU',
      'CH': 'EU', 'AT': 'EU', 'BE': 'EU', 'PL': 'EU', 'CZ': 'EU',
      'HU': 'EU', 'PT': 'EU', 'GR': 'EU', 'IE': 'EU',

      // Asia
      'JP': 'AS', 'CN': 'AS', 'IN': 'AS', 'SG': 'AS', 'KR': 'AS',
      'TH': 'AS', 'VN': 'AS', 'PH': 'AS', 'MY': 'AS', 'ID': 'AS',
      'HK': 'AS', 'TW': 'AS',

      // Oceania
      'AU': 'OC', 'NZ': 'OC',

      // South America
      'BR': 'SA', 'AR': 'SA', 'CL': 'SA', 'CO': 'SA', 'PE': 'SA',
      'UY': 'SA', 'PY': 'SA', 'BO': 'SA', 'EC': 'SA', 'VE': 'SA',

      // Africa
      'ZA': 'AF', 'EG': 'AF', 'NG': 'AF', 'KE': 'AF', 'MA': 'AF',
      'GH': 'AF', 'TN': 'AF', 'ET': 'AF'
    };

    const region = regionMapping[countryUpper];
    if (region) {
      console.log(`🗺️ Mapped ${countryCode} to region: ${region}`);
      return region;
    }

    console.log(`⚠️ Could not map ${countryCode} to region`);
    return null;
  }

  /**
   * Batch geocode multiple locations
   */
  async geocodeBatch(locations) {
    const results = [];

    console.log(`🗺️ Batch geocoding ${locations.length} locations...`);

    for (const location of locations) {
      try {
        const coords = await this.geocode(location.city, location.countryCode);
        results.push({
          ...location,
          coordinates: coords
        });

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Geocoding failed for ${location.city}: ${error.message}`);
        results.push({
          ...location,
          coordinates: null,
          error: error.message
        });
      }
    }

    return results;
  }

  /**
   * Get geocoding statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      cacheEnabled: this.config.cacheEnabled,
      apiEnabled: this.config.enabled && !!this.config.apiKey
    };
  }

  /**
   * Reverse geocode coordinates to location details
   * Uses OpenStreetMap Nominatim API (free, no key required, server-side safe)
   */
  async reverseGeocode(lat, lng) {
    const cacheKey = `reverse_${lat}_${lng}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      // Rate limiting (Nominatim requires 1 second between requests)
      const now = Date.now();
      const timeSinceLastRequest = now - this.lastRequest;
      if (timeSinceLastRequest < this.requestDelay) {
        await new Promise(resolve => setTimeout(resolve, this.requestDelay - timeSinceLastRequest));
      }
      this.lastRequest = Date.now();

      // Use OpenStreetMap Nominatim reverse geocoding API (free, server-side safe)
      // User-Agent is required by Nominatim usage policy
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`;
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Gatewaze/1.0 (https://gatewaze.io)'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`⚠️ Reverse geocoding failed: ${response.status} - ${errorText}`);
        return null;
      }

      const data = await response.json();

      // Nominatim returns address components in the 'address' object
      const address = data.address || {};

      // Extract city name (try multiple fields in order of preference)
      let cityName = address.city ||
                     address.town ||
                     address.village ||
                     address.municipality ||
                     address.county ||
                     '';

      const result = {
        city: cityName,
        country: address.country || '',
        countryCode: (address.country_code || '').toUpperCase(),
        region: this.getRegionFromCountryCode((address.country_code || '').toUpperCase()) || ''
      };

      // Cache the result
      this.cache.set(cacheKey, result);
      this.saveCache();

      return result;
    } catch (error) {
      console.warn(`⚠️ Reverse geocoding error: ${error.message || 'Unknown error'}`);
      return null;
    }
  }

  /**
   * Get region code from country code (returns lowercase for database)
   */
  getRegionFromCountryCode(countryCode) {
    const regionMapping = {
      // North America
      'US': 'na', 'CA': 'na', 'MX': 'na',

      // Europe
      'GB': 'eu', 'DE': 'eu', 'FR': 'eu', 'IT': 'eu', 'ES': 'eu',
      'NL': 'eu', 'SE': 'eu', 'DK': 'eu', 'NO': 'eu', 'FI': 'eu',
      'CH': 'eu', 'AT': 'eu', 'BE': 'eu', 'PL': 'eu', 'CZ': 'eu',
      'HU': 'eu', 'PT': 'eu', 'GR': 'eu', 'IE': 'eu',

      // Asia
      'JP': 'as', 'CN': 'as', 'IN': 'as', 'SG': 'as', 'KR': 'as',
      'TH': 'as', 'VN': 'as', 'PH': 'as', 'MY': 'as', 'ID': 'as',
      'HK': 'as', 'TW': 'as',

      // Oceania
      'AU': 'oc', 'NZ': 'oc',

      // South America
      'BR': 'sa', 'AR': 'sa', 'CL': 'sa', 'CO': 'sa', 'PE': 'sa',
      'UY': 'sa', 'PY': 'sa', 'BO': 'sa', 'EC': 'sa', 'VE': 'sa',

      // Africa
      'ZA': 'af', 'EG': 'af', 'NG': 'af', 'KE': 'af', 'MA': 'af',
      'GH': 'af', 'TN': 'af', 'ET': 'af'
    };

    return regionMapping[countryCode] || null;
  }

  /**
   * Clear geocoding cache
   */
  clearCache() {
    this.cache.clear();
    if (fs.existsSync(this.cachePath)) {
      fs.unlinkSync(this.cachePath);
    }
    console.log('🗑️ Geocoding cache cleared');
  }
}