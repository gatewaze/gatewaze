import { getApiBaseUrl } from '@/config/brands';

export class EventExportService {
  /**
   * Export all events to public/events.json
   * This triggers the API server to run the export script
   * The JSON file is used by the front-end website at build time
   */
  static async exportAllEventsToJson(): Promise<{ success: boolean; error?: string }> {
    try {
      console.log('📤 Triggering export of all events to public/events.json...');

      // Call the API endpoint to trigger the export script
      const apiBaseUrl = getApiBaseUrl();
      const response = await fetch(`${apiBaseUrl}/events/export`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('❌ Error calling export API:', errorData);

        // Don't fail the event update if export fails
        console.warn('⚠️  Export failed but event update succeeded. You can manually run: npm run export-events');
        return { success: false, error: errorData.error || 'Failed to export events' };
      }

      const result = await response.json();
      console.log(`✅ Successfully triggered events export to public/events.json`);

      return { success: true };
    } catch (error) {
      // Log the error but don't fail the event update
      console.error('❌ Error triggering event export:', error);
      console.warn('⚠️  Export failed but event update succeeded. You can manually run: npm run export-events');

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to trigger export'
      };
    }
  }
}
