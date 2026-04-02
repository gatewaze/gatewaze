import eventsData from '../../events-source.json';

interface DataValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  statistics: Record<string, any>;
}

export function validateEventsData(): DataValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const statistics: Record<string, any> = {};

  console.log('🔍 Validating events data...');

  // Check field lengths
  const fieldLengths = {
    eventId: { max: 0, values: new Set() },
    eventTitle: { max: 0, values: new Set() },
    eventCountryCode: { max: 0, values: new Set() },
    eventRegion: { max: 0, values: new Set() },
    eventType: { max: 0, values: new Set() },
    offerValue: { max: 0, values: new Set() },
    offerCloseDisplay: { max: 0, values: new Set() },
    eventLocation: { max: 0, values: new Set() },
    offerSlug: { max: 0, values: new Set() },
  };

  const problematicEvents: any[] = [];

  eventsData.forEach((event: any, index) => {
    // Check required fields
    if (!event.eventId) {
      errors.push(`Event at index ${index} missing eventId`);
    }
    if (!event.eventTitle) {
      errors.push(`Event at index ${index} missing eventTitle`);
    }

    // Check field lengths and collect statistics
    Object.keys(fieldLengths).forEach(field => {
      const value = event[field];
      if (value) {
        const length = String(value).length;
        fieldLengths[field as keyof typeof fieldLengths].max = Math.max(
          fieldLengths[field as keyof typeof fieldLengths].max,
          length
        );
        fieldLengths[field as keyof typeof fieldLengths].values.add(value);

        // Check for specific problems
        if (field === 'eventCountryCode' && length > 5) {
          problematicEvents.push({
            index,
            eventId: event.eventId,
            eventTitle: event.eventTitle,
            issue: `Country code too long: "${value}" (${length} chars)`,
            field,
            value
          });
        }
      }
    });

    // Check date formats
    if (event.eventStart && !isValidDate(event.eventStart)) {
      warnings.push(`Event ${event.eventId} has invalid start date: ${event.eventStart}`);
    }
    if (event.eventEnd && !isValidDate(event.eventEnd)) {
      warnings.push(`Event ${event.eventId} has invalid end date: ${event.eventEnd}`);
    }

    // Check URL formats
    if (event.eventLink && !isValidUrl(event.eventLink)) {
      warnings.push(`Event ${event.eventId} has invalid URL: ${event.eventLink}`);
    }
  });

  // Generate statistics
  statistics.totalEvents = eventsData.length;
  statistics.fieldLengths = Object.fromEntries(
    Object.entries(fieldLengths).map(([field, data]) => [
      field,
      {
        maxLength: data.max,
        uniqueValues: data.values.size,
        samples: Array.from(data.values).slice(0, 5)
      }
    ])
  );
  statistics.problematicEvents = problematicEvents;

  // Print results
  console.log('\n📊 Validation Results:');
  console.log(`Total events: ${statistics.totalEvents}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Warnings: ${warnings.length}`);

  if (problematicEvents.length > 0) {
    console.log('\n⚠️  Problematic Events:');
    problematicEvents.forEach(event => {
      console.log(`  - ${event.eventTitle} (${event.eventId}): ${event.issue}`);
    });
  }

  console.log('\n📏 Field Length Analysis:');
  Object.entries(statistics.fieldLengths).forEach(([field, data]: [string, any]) => {
    if (data.maxLength > 0) {
      console.log(`  ${field}: max ${data.maxLength} chars, ${data.uniqueValues} unique values`);
      if (data.maxLength > getRecommendedLength(field)) {
        console.warn(`    ⚠️  Exceeds recommended length for ${field}`);
      }
    }
  });

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    statistics
  };
}

function isValidDate(dateStr: string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

function isValidUrl(urlStr: string): boolean {
  try {
    new URL(urlStr);
    return true;
  } catch {
    return false;
  }
}

function getRecommendedLength(field: string): number {
  const recommendations: Record<string, number> = {
    eventId: 10,
    eventTitle: 255,
    eventCountryCode: 5,
    eventRegion: 10,
    eventType: 50,
    offerValue: 100,
    offerCloseDisplay: 100,
    eventLocation: 100,
    offerSlug: 255,
  };
  return recommendations[field] || 255;
}

// Function to clean data before import
export function cleanEventData(event: any): any {
  const cleaned = { ...event };

  // Truncate long country codes
  if (cleaned.eventCountryCode && cleaned.eventCountryCode.length > 5) {
    console.warn(`Truncating country code for ${cleaned.eventId}: ${cleaned.eventCountryCode} -> ${cleaned.eventCountryCode.substring(0, 5)}`);
    cleaned.eventCountryCode = cleaned.eventCountryCode.substring(0, 5);
  }

  // Clean up empty strings
  Object.keys(cleaned).forEach(key => {
    if (cleaned[key] === '') {
      cleaned[key] = null;
    }
  });

  return cleaned;
}

// Function to get summary of unique values
export function getFieldSummary(fieldName: string): void {
  const values = new Set();
  const samples: any[] = [];

  eventsData.forEach((event: any) => {
    const value = event[fieldName];
    if (value) {
      values.add(value);
      if (samples.length < 10) {
        samples.push({
          eventId: event.eventId,
          eventTitle: event.eventTitle,
          value: value,
          length: String(value).length
        });
      }
    }
  });

  console.log(`\n📋 ${fieldName} Summary:`);
  console.log(`Unique values: ${values.size}`);
  console.log(`Sample values:`);
  samples.forEach(sample => {
    console.log(`  ${sample.eventId}: "${sample.value}" (${sample.length} chars)`);
  });

  if (fieldName === 'eventCountryCode') {
    console.log('\nAll unique country codes:');
    console.log(Array.from(values).sort());
  }
}

// Make functions available in browser console
if (typeof window !== 'undefined') {
  (window as any).validateEventsData = validateEventsData;
  (window as any).getFieldSummary = getFieldSummary;
  (window as any).cleanEventData = cleanEventData;

  console.log('🔧 Data validation utilities loaded!');
  console.log('💡 Available commands:');
  console.log('   validateEventsData() - Check data for issues');
  console.log('   getFieldSummary("fieldName") - Analyze specific field');
  console.log('   cleanEventData(event) - Clean individual event data');
}