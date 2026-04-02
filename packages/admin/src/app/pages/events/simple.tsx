import { useState, useEffect } from 'react';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui';
import { EventService, Event } from '@/utils/eventService';

export default function SimpleEventsPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadEvents();
  }, []);

  const loadEvents = async () => {
    setLoading(true);
    setError(null);
    try {
      console.log('Loading events...');
      const result = await EventService.getAllEvents();

      if (result.success && result.data) {
        console.log('Events loaded:', result.data.length);
        setEvents(result.data);
      } else {
        console.error('Failed to load events:', result.error);
        setError(result.error || 'Failed to load events');
      }
    } catch (error) {
      console.error('Error loading events:', error);
      setError('Unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading events...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        <h1 className="text-2xl font-semibold text-[var(--gray-12)] mb-6">
          Events Management
        </h1>

        <div className="bg-white dark:bg-gray-800 shadow-sm rounded-lg p-6">
          <div className="mb-4">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-200">
              Events ({events.length})
            </h2>
          </div>

          {events.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 dark:text-gray-400">
                No events found. The database might be empty.
              </p>
              <p className="text-sm text-gray-400 dark:text-gray-500 mt-2">
                Try running <code>runFullImport()</code> in the browser console to import events.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <THead>
                  <Tr>
                    <Th>Event</Th>
                    <Th>Location</Th>
                    <Th>Date</Th>
                    <Th>Type</Th>
                  </Tr>
                </THead>
                <TBody>
                  {events.slice(0, 10).map((event) => (
                    <Tr key={event.id}>
                      <Td>
                        <div className="text-sm font-medium">
                          {event.eventTitle}
                        </div>
                        <div className="text-sm text-[var(--gray-a11)]">
                          ID: {event.eventId}
                        </div>
                      </Td>
                      <Td>
                        {event.eventCity}
                        {event.eventCountryCode && `, ${event.eventCountryCode}`}
                      </Td>
                      <Td>
                        {event.eventStart || 'TBD'}
                      </Td>
                      <Td>
                        <span className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                          {event.eventType || 'N/A'}
                        </span>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>

              {events.length > 10 && (
                <div className="mt-4 text-center text-sm text-gray-500 dark:text-gray-400">
                  Showing 10 of {events.length} events
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
          <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-2">
            Debug Information
          </h3>
          <div className="text-xs text-blue-700 dark:text-blue-300 space-y-1">
            <div>Total events loaded: {events.length}</div>
            <div>Loading state: {loading ? 'Loading' : 'Complete'}</div>
            <div>Error state: {error || 'None'}</div>
            <div>First event ID: {events[0]?.eventId || 'N/A'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}