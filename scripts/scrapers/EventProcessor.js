import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Comprehensive event processing service that handles:
 * - Country name to country code mapping
 * - Region detection from country codes
 * - Event title cleaning
 * - URL sanitization
 * - Date validation
 */
export class EventProcessor {
  constructor(configPath) {
    this.countryCodesMap = this.loadCountryCodesMap(configPath);
    this.regionCodesMap = this.loadRegionCodesMap(configPath);
    this.europeCountries = [
      'at', 'be', 'bg', 'hr', 'cy', 'cz', 'dk', 'ee', 'fi', 'fr',
      'de', 'gr', 'hu', 'ie', 'it', 'lv', 'lt', 'lu', 'mt', 'nl',
      'pl', 'pt', 'ro', 'sk', 'si', 'es', 'se', 'gb', 'uk', 'ch',
      'no', 'ua', 'rs', 'ba', 'me', 'mk', 'al', 'gg', 'je', 'im',
      'is', 'by', 'md', 'ru', 'tr'
    ];
    this.naCountries = [
      'us', 'ca', 'mx', 'ag', 'bs', 'bb', 'bz', 'cr', 'cu', 'dm',
      'do', 'sv', 'gd', 'gt', 'ht', 'hn', 'jm', 'ni', 'pa', 'kn',
      'lc', 'vc', 'tt'
    ];
    this.apCountries = [
      'au', 'nz', 'jp', 'kr', 'cn', 'hk', 'tw', 'sg', 'my', 'th',
      'id', 'ph', 'vn', 'in', 'pk', 'bd', 'np', 'lk', 'mm', 'kh',
      'fj', 'la', 'mo', 'mv', 'mn', 'pg', 'ws', 'tl'
    ];
    this.latamCountries = [
      'ar', 'bo', 'br', 'cl', 'co', 'ec', 'gy', 'py', 'pe',
      'sr', 'uy', 've'
    ];
    this.meaCountries = [
      'za', 'eg', 'ma', 'ae', 'sa', 'qa', 'bh', 'om', 'kw', 'jo',
      'lb', 'il', 'iq', 'ir', 'ng', 'ke', 'gh', 'et', 'tz', 'ug',
      'rw', 'sn', 'ci', 'cm'
    ];
  }

  /**
   * Load country codes mapping from tech-events repo format
   */
  loadCountryCodesMap(configPath) {
    try {
      // Try local files first, then fallback paths
      const possiblePaths = [
        path.resolve(configPath, 'scrapers/country-codes.json'),
        path.resolve(configPath, 'country-codes.json'),
        path.resolve(__dirname, 'country-codes.json')
      ];

      for (const countryCodesPath of possiblePaths) {
        if (fs.existsSync(countryCodesPath)) {
          const countryCodes = JSON.parse(fs.readFileSync(countryCodesPath, 'utf8'));
          console.log(`🌍 Loaded ${Object.keys(countryCodes).length} country codes from ${path.basename(countryCodesPath)}`);
          return countryCodes;
        }
      }

      // Fallback to default mapping if file doesn't exist
      console.log('🌍 Using built-in country codes mapping');
      return this.getDefaultCountryCodesMap();
    } catch (error) {
      console.error(`❌ Error loading country codes: ${error.message}`);
      return this.getDefaultCountryCodesMap();
    }
  }

  /**
   * Load region codes mapping
   */
  loadRegionCodesMap(configPath) {
    try {
      // Try local files first, then fallback paths
      const possiblePaths = [
        path.resolve(configPath, 'scrapers/region-codes.json'),
        path.resolve(configPath, 'region-codes.json'),
        path.resolve(__dirname, 'region-codes.json')
      ];

      for (const regionCodesPath of possiblePaths) {
        if (fs.existsSync(regionCodesPath)) {
          const regionCodes = JSON.parse(fs.readFileSync(regionCodesPath, 'utf8'));
          console.log(`🗺️ Loaded ${Object.keys(regionCodes).length} region codes from ${path.basename(regionCodesPath)}`);
          return regionCodes;
        }
      }

      // Fallback to default mapping
      console.log('🗺️ Using built-in region codes mapping');
      return this.getDefaultRegionCodesMap();
    } catch (error) {
      console.error(`❌ Error loading region codes: ${error.message}`);
      return this.getDefaultRegionCodesMap();
    }
  }

  /**
   * Default country codes mapping (subset of most common countries)
   */
  getDefaultCountryCodesMap() {
    return {
      "United States": "US",
      "Canada": "CA",
      "United Kingdom": "GB",
      "Germany": "DE",
      "France": "FR",
      "Netherlands": "NL",
      "Australia": "AU",
      "Japan": "JP",
      "Singapore": "SG",
      "India": "IN",
      "Brazil": "BR",
      "Spain": "ES",
      "Italy": "IT",
      "Sweden": "SE",
      "Norway": "NO",
      "Denmark": "DK",
      "Switzerland": "CH",
      "Austria": "AT",
      "Belgium": "BE",
      "Poland": "PL"
    };
  }

  /**
   * Default region codes mapping
   */
  getDefaultRegionCodesMap() {
    return {
      "Asia": "as",
      "Africa": "af",
      "Europe": "eu",
      "North America": "na",
      "South America": "sa",
      "Oceania": "oc",
      "Online": "on"
    };
  }

  /**
   * Process a single event with all enhancements
   */
  processEvent(event) {
    const processedEvent = { ...event };

    // 1. Clean event title
    processedEvent.eventTitle = this.cleanEventTitle(event.eventTitle);

    // 2. Validate and fix dates (but preserve if already set with time)
    this.validateAndFixDates(processedEvent);

    // 3. Combine date + time if available (e.g., from Luma scraper)
    // Format: "YYYY-MM-DD HH:MM:SS±TZ" (PostgreSQL timestamp with timezone format)
    if (event.startTime && event.eventStart) {
      const timeStr = this.convertToPostgresTimestamp(event.eventStart, event.startTime, event.timezone);
      if (timeStr) {
        processedEvent.eventStart = timeStr;
      }
    }
    if (event.endTime && event.eventEnd) {
      const timeStr = this.convertToPostgresTimestamp(event.eventEnd, event.endTime, event.timezone);
      if (timeStr) {
        processedEvent.eventEnd = timeStr;
      }
    }

    // 4. Sanitize URL
    processedEvent.event_link = this.sanitizeUrl(event.event_link);

    // 5. Parse venueAddress if present and country/city not already set
    if (event.venueAddress && !event.eventCountryCode) {
      const parsed = this.parseVenueAddress(event.venueAddress);
      if (parsed.city && !event.eventCity) {
        processedEvent.eventCity = parsed.city;
      }
      if (parsed.countryCode) {
        processedEvent.eventCountryCode = parsed.countryCode;
        processedEvent.eventCountry = parsed.country;
      }
    }

    // 6. Convert country name to country code (only if not already set)
    if (event.eventCountry && !event.eventCountryCode) {
      processedEvent.eventCountryCode = this.getCountryCode(event.eventCountry);
    }

    // 7. Determine region from country code (only if not already set)
    if (processedEvent.eventCountryCode && !event.eventRegion) {
      processedEvent.eventRegion = this.getRegionFromCountryCode(processedEvent.eventCountryCode);
    }

    // 8. Handle online events
    if (event.eventCity && event.eventCity.toLowerCase() === 'online') {
      processedEvent.eventRegion = 'on';
      processedEvent.eventCountryCode = '';
      processedEvent.eventCountry = 'Online';
    }

    return processedEvent;
  }

  /**
   * Convert date, time, and timezone to PostgreSQL timestamp format
   * Input: date="2025-10-15", time="16:30", timezone="GMT-4" or "EDT"
   * Output: "2025-10-15T16:30:00-04:00" (ISO 8601 with timezone offset)
   */
  convertToPostgresTimestamp(date, time, timezone) {
    try {
      if (!date || !time) return null;

      // Handle different time formats
      let hours, minutes;

      // Check if time is in 12-hour format (with AM/PM)
      const time12hMatch = time.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (time12hMatch) {
        hours = parseInt(time12hMatch[1]);
        minutes = parseInt(time12hMatch[2]);
        const period = time12hMatch[3].toUpperCase();

        // Convert to 24-hour format
        if (period === 'PM' && hours !== 12) {
          hours += 12;
        } else if (period === 'AM' && hours === 12) {
          hours = 0;
        }
      } else {
        // 24-hour format
        const time24hMatch = time.match(/(\d{1,2}):(\d{2})/);
        if (time24hMatch) {
          hours = parseInt(time24hMatch[1]);
          minutes = parseInt(time24hMatch[2]);
        } else {
          return null;
        }
      }

      // Pad with zeros
      const hoursStr = String(hours).padStart(2, '0');
      const minutesStr = String(minutes).padStart(2, '0');

      // Convert timezone to offset format
      let timezoneOffset = '+00:00';
      if (timezone) {
        // Handle GMT offsets (e.g., "GMT-4", "GMT+5:30")
        const gmtMatch = timezone.match(/GMT([+-]\d+(?::\d+)?)/i);
        if (gmtMatch) {
          const offset = gmtMatch[1];
          // Ensure format is ±HH:MM
          if (!offset.includes(':')) {
            timezoneOffset = offset.includes('-') ? `-${String(Math.abs(parseInt(offset))).padStart(2, '0')}:00`
                                                   : `+${String(parseInt(offset)).padStart(2, '0')}:00`;
          } else {
            timezoneOffset = offset;
          }
        } else {
          // Handle named timezones (EDT, EST, PST, etc.)
          const timezoneMap = {
            'EST': '-05:00', 'EDT': '-04:00',
            'CST': '-06:00', 'CDT': '-05:00',
            'MST': '-07:00', 'MDT': '-06:00',
            'PST': '-08:00', 'PDT': '-07:00',
            'UTC': '+00:00', 'GMT': '+00:00'
          };
          timezoneOffset = timezoneMap[timezone.toUpperCase()] || '+00:00';
        }
      }

      // Format as ISO 8601: "YYYY-MM-DDTHH:MM:SS±HH:MM"
      return `${date}T${hoursStr}:${minutesStr}:00${timezoneOffset}`;

    } catch (error) {
      console.warn(`⚠️ Failed to convert timestamp: ${error.message}`);
      return null;
    }
  }

  /**
   * Parse venue address to extract city and country
   * Format: "Street, City, State ZIP, Country"
   * Example: "9 W 8th St, New York, NY 10011, USA"
   */
  parseVenueAddress(address) {
    const result = { city: '', country: '', countryCode: '' };

    if (!address) return result;

    // Split by commas
    const parts = address.split(',').map(p => p.trim());

    if (parts.length >= 2) {
      // Last part is usually the country
      const lastPart = parts[parts.length - 1];
      result.country = lastPart;
      result.countryCode = this.getCountryCode(lastPart);

      // Second part is usually the city
      if (parts.length >= 2) {
        result.city = parts[parts.length - 3] || parts[parts.length - 2];
      }
    }

    return result;
  }

  /**
   * Clean event title by removing years, excessive whitespace, and normalizing format
   */
  cleanEventTitle(title) {
    if (!title) return '';

    let cleanTitle = title;

    // Remove year patterns (2023, 2024, 2025, etc.)
    cleanTitle = cleanTitle.replace(/\s+20\d{2}\b/g, '');
    cleanTitle = cleanTitle.replace(/20\d{2}$/g, '');

    // Remove parenthesized content (e.g., "(Online)", "(Virtual)", etc.)
    cleanTitle = cleanTitle.replace(/\([^)]*\)/g, '');

    // Remove hash symbols and normalize spaces
    cleanTitle = cleanTitle.replace(/#/g, '');
    cleanTitle = cleanTitle.replace(/\s+/g, ' ');

    return cleanTitle.trim();
  }

  /**
   * Validate and fix date formats
   */
  validateAndFixDates(event) {
    const currentYear = new Date().getFullYear();

    // Check if eventStart is already an ISO timestamp (from iCal scraper)
    const isoTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;

    // Validate eventStart format (YYYY-MM-DD or ISO timestamp)
    if (!event.eventStart || (!datePattern.test(event.eventStart) && !isoTimestampPattern.test(event.eventStart))) {
      console.warn(`Invalid eventStart format for "${event.eventTitle}": "${event.eventStart}". Using current year fallback.`);
      event.eventStart = `${currentYear}-01-01`;
    }

    // Validate eventEnd format (YYYY-MM-DD or ISO timestamp)
    if (!event.eventEnd || (!datePattern.test(event.eventEnd) && !isoTimestampPattern.test(event.eventEnd))) {
      console.warn(`Invalid eventEnd format for "${event.eventTitle}": "${event.eventEnd}". Using eventStart or current year fallback.`);
      // If eventStart is valid, use it as eventEnd too (same day event)
      if (event.eventStart && (datePattern.test(event.eventStart) || isoTimestampPattern.test(event.eventStart))) {
        event.eventEnd = event.eventStart;
      } else {
        event.eventEnd = `${currentYear}-12-31`;
      }
    }
  }

  /**
   * Sanitize and fix common URL issues
   */
  sanitizeUrl(url) {
    if (!url) return '';

    let cleanUrl = url.trim();

    // Filter out entries with malformed URLs that start with https://dev.eventshttps://
    if (cleanUrl.startsWith('https://dev.eventshttps://')) {
      console.log(`Fixing malformed URL: ${cleanUrl}`);
      return '';
    }

    // Fix URLs with multiple "http://" or "https://" prefixes
    cleanUrl = cleanUrl.replace(/https?:\/\/(https?:\/\/)/g, '$1');

    // Ensure URL has a protocol
    if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
      cleanUrl = 'https://' + cleanUrl;
    }

    // Remove trailing slash to normalize URLs for deduplication
    // (e.g., "https://example.com/event/" and "https://example.com/event" should be treated as the same)
    cleanUrl = cleanUrl.replace(/\/+$/, '');

    return cleanUrl;
  }

  /**
   * Get country code for a given country name
   */
  getCountryCode(countryName) {
    if (!countryName) return '';

    const standardCountry = countryName.trim();
    return this.countryCodesMap[standardCountry] || '';
  }

  /**
   * Get region code from country code
   */
  getRegionFromCountryCode(countryCode) {
    if (!countryCode) return '';

    const lowercaseCountry = countryCode.toLowerCase();

    if (this.europeCountries.includes(lowercaseCountry)) {
      return 'eu';
    } else if (this.naCountries.includes(lowercaseCountry)) {
      return 'na';
    } else if (this.apCountries.includes(lowercaseCountry)) {
      return 'as';
    } else if (this.latamCountries.includes(lowercaseCountry)) {
      return 'sa';
    } else if (this.meaCountries.includes(lowercaseCountry)) {
      return 'af';
    } else {
      // Default fallback
      console.log(`Could not determine region for country "${countryCode}", defaulting to "as"`);
      return 'as';
    }
  }

  /**
   * Get region code from region name (if provided)
   */
  getRegionCode(regionName) {
    if (!regionName) return 'determine_from_country';

    const standardRegion = regionName.trim();
    return this.regionCodesMap[standardRegion] || 'determine_from_country';
  }

  /**
   * Filter out unwanted events
   */
  shouldFilterOut(event) {
    // Filter out "Best conference" entries
    if (event.eventTitle && event.eventTitle.includes('Best conference')) {
      return true;
    }

    // Filter out entries with malformed URLs
    if (event.event_link && event.event_link.startsWith('https://dev.eventshttps://')) {
      return true;
    }

    return false;
  }

  /**
   * Check if an event is a duplicate based on comprehensive matching logic
   * Priority: 1) luma_event_id (stable across URL changes), 2) source_event_id (for dev.events), 3) event_link, 4) title+date (for backfilling)
   */
  async isDuplicate(event, supabase) {
    const lumaEventId = event.lumaEventId || event.luma_event_id;
    const sourceEventId = event.sourceEventId || event.source_event_id;
    let eventLink = event.eventLink || event.event_link;
    const eventTitle = event.eventTitle || event.event_title;
    const eventStart = event.eventStart || event.event_start;

    try {
      // First, check by luma_event_id (most reliable for Luma events)
      // This handles URL changes - the luma_event_id stays constant
      if (lumaEventId) {
        const { data: lumaMatches } = await supabase
          .from('events')
          .select('id, event_link')
          .eq('luma_event_id', lumaEventId)
          .limit(1);

        if (lumaMatches && lumaMatches.length > 0) {
          // Log if URL has changed
          if (eventLink && lumaMatches[0].event_link !== eventLink) {
            console.log(`🔄 URL change detected for ${lumaEventId}: ${lumaMatches[0].event_link} → ${eventLink}`);
          }
          return lumaMatches[0].id; // Return UUID for updating
        }
      }

      // Second: check by source_event_id (for dev.events scrapers)
      // This handles URL changes for dev.events - the source_event_id stays constant
      if (sourceEventId) {
        const { data: sourceMatches } = await supabase
          .from('events')
          .select('id, event_link')
          .eq('source_event_id', sourceEventId)
          .limit(1);

        if (sourceMatches && sourceMatches.length > 0) {
          // Log if URL has changed
          if (eventLink && sourceMatches[0].event_link !== eventLink) {
            console.log(`🔄 URL change detected for source_event_id=${sourceEventId}: ${sourceMatches[0].event_link} → ${eventLink}`);
          }
          return sourceMatches[0].id; // Return UUID for updating
        }
      }

      // Third: check by event_link for non-Luma events or legacy data
      if (eventLink) {
        // Normalize URL by removing trailing slashes
        eventLink = eventLink.trim().replace(/\/+$/, '');

        // Check for event_link match (both with and without trailing slash)
        // This prevents duplicates when one URL has a trailing slash and another doesn't
        const { data: linkMatches } = await supabase
          .from('events')
          .select('id, luma_event_id, source_event_id')
          .or(`event_link.eq.${eventLink},event_link.eq.${eventLink}/`)
          .limit(1);

        if (linkMatches && linkMatches.length > 0) {
          // If we have a lumaEventId but the existing event doesn't, we'll backfill it on update
          if (lumaEventId && !linkMatches[0].luma_event_id) {
            console.log(`📝 Will backfill luma_event_id=${lumaEventId} for existing event`);
          }
          // If we have a sourceEventId but the existing event doesn't, we'll backfill it on update
          if (sourceEventId && !linkMatches[0].source_event_id) {
            console.log(`📝 Will backfill source_event_id=${sourceEventId} for existing event`);
          }
          return linkMatches[0].id; // Return UUID for updating
        }
      }

      // Fourth: For events with changed URLs, try matching by title + start date
      // This helps backfill event IDs for events where the URL changed before we tracked it
      if ((lumaEventId || sourceEventId) && eventTitle && eventStart) {
        // Extract just the date part for comparison (ignore time)
        const startDate = eventStart.split('T')[0];

        const { data: titleDateMatches } = await supabase
          .from('events')
          .select('id, event_link, luma_event_id, source_event_id')
          .eq('event_title', eventTitle)
          .gte('event_start', `${startDate}T00:00:00`)
          .lt('event_start', `${startDate}T23:59:59`)
          .is('luma_event_id', null)  // Only match events without luma_event_id
          .is('source_event_id', null)  // Only match events without source_event_id
          .limit(1);

        if (titleDateMatches && titleDateMatches.length > 0) {
          const idInfo = lumaEventId ? `luma_event_id=${lumaEventId}` : `source_event_id=${sourceEventId}`;
          console.log(`🔗 Matched by title+date, will update ${idInfo} and URL: ${titleDateMatches[0].event_link} → ${eventLink}`);
          return titleDateMatches[0].id; // Return UUID for updating
        }
      }

      return null;

    } catch (error) {
      console.error(`Error checking for duplicates: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if two event names are similar (from original tech-events logic)
   */
  areSimilarNames(name1, name2) {
    if (!name1 || !name2) return false;

    // Convert both names to lowercase for comparison
    const n1 = name1.toLowerCase();
    const n2 = name2.toLowerCase();

    // Check if one is a substring of the other
    if (n1.includes(n2) || n2.includes(n1)) {
      return true;
    }

    // Check for meaningful words that appear in both names
    const words1 = n1.split(/\s+/).filter(w => w.length > 2); // Ignore small words
    const words2 = n2.split(/\s+/).filter(w => w.length > 2);

    // If there are significant matching words (more than 50% match)
    const commonWords = words1.filter(w => words2.includes(w));
    if (commonWords.length > 0) {
      const matchRatio1 = commonWords.length / words1.length;
      const matchRatio2 = commonWords.length / words2.length;
      if (matchRatio1 > 0.5 || matchRatio2 > 0.5) {
        return true;
      }
    }

    return false;
  }

  /**
   * Add source tracking fields for manual event entry
   */
  addManualSourceTracking(event, userInfo = {}) {
    return {
      ...event,
      source_type: 'manual',
      source_details: {
        entry_method: 'admin_ui',
        user_id: userInfo.id || null,
        user_email: userInfo.email || null,
        added_timestamp: new Date().toISOString(),
        ip_address: userInfo.ipAddress || null
      }
    };
  }

  /**
   * Add source tracking fields for user-submitted events
   */
  addUserSubmissionTracking(event, submissionInfo = {}) {
    return {
      ...event,
      source_type: 'user_submission',
      source_details: {
        submission_method: 'website_form',
        submitter_email: submissionInfo.email || null,
        submitter_name: submissionInfo.name || null,
        submission_timestamp: new Date().toISOString(),
        ip_address: submissionInfo.ipAddress || null,
        user_agent: submissionInfo.userAgent || null,
        referrer: submissionInfo.referrer || null
      }
    };
  }

  /**
   * Get processing statistics
   */
  getStats() {
    return {
      countryCodesLoaded: Object.keys(this.countryCodesMap).length,
      regionCodesLoaded: Object.keys(this.regionCodesMap).length,
      regionsSupported: ['eu', 'na', 'as', 'sa', 'af', 'oc', 'on']
    };
  }
}