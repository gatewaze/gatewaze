// Quick setup utility for events
// This can be run in the browser console after logging in

import { EventService, Event } from './eventService';

// Sample events data for testing (subset of the full data)
const sampleEvents = [
  {
    "eventId": "test01",
    "eventTitle": "Sample Tech Conference",
    "listingIntro": "Win tickets to",
    "offerResult": "2 tickets",
    "offerCloseDisplay": "December 31",
    "eventTopics": ["JavaScript", "React", "TypeScript"],
    "offerTicketDetails": "2 day conference pass",
    "offerValue": "$299",
    "eventCity": "San Francisco",
    "eventCountryCode": "US",
    "eventLink": "https://example.com/conference",
    "eventLogo": "",
    "offerSlug": "sample-tech-conference",
    "offerCloseDate": "2025-12-31T23:59:59Z",
    "eventStart": "2026-01-15",
    "eventEnd": "2026-01-16",
    "eventRegion": "na",
    "eventLocation": "37.7749,-122.4194",
    "eventTopicsUpdatedAt": Date.now(),
    "eventType": "conference"
  }
];

// Function to test the events system
export async function testEventsSystem(): Promise<void> {
  console.log('🧪 Testing Events System...');

  try {
    // Test 1: Get all events
    console.log('📋 Fetching existing events...');
    const { success, data: events, error } = await EventService.getAllEvents();

    if (!success) {
      console.error('❌ Failed to fetch events:', error);
      return;
    }

    console.log(`✅ Found ${events?.length || 0} existing events`);

    // Test 2: Create a sample event
    console.log('➕ Creating sample event...');
    const createResult = await EventService.createEvent(sampleEvents[0]);

    if (createResult.success) {
      console.log('✅ Sample event created successfully');
    } else {
      console.log('ℹ️  Sample event might already exist or creation failed:', createResult.error);
    }

    // Test 3: Fetch events again to verify
    console.log('🔄 Verifying events...');
    const verifyResult = await EventService.getAllEvents();

    if (verifyResult.success) {
      console.log(`✅ Total events now: ${verifyResult.data?.length || 0}`);

      // Show some details
      verifyResult.data?.slice(0, 3).forEach((event, index) => {
        console.log(`  ${index + 1}. ${event.eventTitle} (${event.eventId}) - ${event.eventCity}`);
      });
    }

    console.log('🎉 Events system test completed!');
    console.log('💡 You can now visit /admin/events to manage events');

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Function to run the full import from events-source.json
export async function runFullImport(): Promise<void> {
  try {
    console.log('📦 Starting full events import...');
    console.log('⚠️  This will import all events from events-source.json file');

    // Import the validation functions
    const { cleanEventData } = await import('./validateEventsData');

    // Import the full events data
    const eventsModule = await import('../../events-source.json');
    const eventsData = eventsModule.default;

    console.log(`📊 Found ${eventsData.length} events to import`);

    let imported = 0;
    let failed = 0;
    let cleaned = 0;
    const batchSize = 5; // Smaller batches to be more careful

    // Process in batches
    for (let i = 0; i < eventsData.length; i += batchSize) {
      const batch = eventsData.slice(i, i + batchSize);
      console.log(`📦 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(eventsData.length / batchSize)}`);

      for (const rawEventData of batch) {
        try {
          // Clean the data first
          const cleanedData = cleanEventData(rawEventData);
          if (cleanedData !== rawEventData) {
            cleaned++;
          }

          const event: Omit<Event, 'id' | 'createdAt' | 'updatedAt'> = {
            eventId: cleanedData.eventId,
            eventTitle: cleanedData.eventTitle,
            listingIntro: cleanedData.listingIntro || undefined,
            offerResult: cleanedData.offerResult || undefined,
            offerCloseDisplay: cleanedData.offerCloseDisplay || undefined,
            eventTopics: cleanedData.eventTopics || [],
            offerTicketDetails: cleanedData.offerTicketDetails || undefined,
            offerValue: cleanedData.offerValue || undefined,
            eventCity: cleanedData.eventCity || undefined,
            eventCountryCode: cleanedData.eventCountryCode || undefined,
            eventLink: cleanedData.eventLink || undefined,
            eventLogo: cleanedData.eventLogo || undefined,
            offerSlug: cleanedData.offerSlug || undefined,
            offerCloseDate: cleanedData.offerCloseDate || undefined,
            eventStart: cleanedData.eventStart || undefined,
            eventEnd: cleanedData.eventEnd || undefined,
            eventRegion: cleanedData.eventRegion || undefined,
            eventLocation: cleanedData.eventLocation || undefined,
            eventTopicsUpdatedAt: cleanedData.eventTopicsUpdatedAt || undefined,
            eventType: cleanedData.eventType || undefined,
          };

          const result = await EventService.createEvent(event);

          if (result.success) {
            imported++;
            console.log(`✅ ${event.eventTitle} (${event.eventId})`);
          } else {
            failed++;
            if (!result.error?.includes('duplicate') && !result.error?.includes('already exists')) {
              console.warn(`⚠️  Failed to import ${event.eventTitle}:`, result.error);
            } else {
              console.log(`ℹ️  Skipped duplicate: ${event.eventTitle} (${event.eventId})`);
            }
          }
        } catch (error) {
          failed++;
          console.error(`❌ Error importing ${rawEventData.eventTitle}:`, error);
        }
      }

      // Small delay between batches
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    console.log(`\n📊 Import Summary:`);
    console.log(`✅ Successfully imported: ${imported}`);
    console.log(`❌ Failed to import: ${failed}`);
    console.log(`🧹 Data cleaned: ${cleaned}`);
    console.log(`📁 Total processed: ${eventsData.length}`);

  } catch (error) {
    console.error('❌ Full import failed:', error);
  }
}

// Make functions available in browser console
if (typeof window !== 'undefined') {
  (window as any).testEventsSystem = testEventsSystem;
  (window as any).runFullImport = runFullImport;

  console.log('🔧 Events setup utilities loaded!');
  console.log('💡 Available commands:');
  console.log('   testEventsSystem() - Test the events system with sample data');
  console.log('   runFullImport() - Import all events from events-source.json');
}