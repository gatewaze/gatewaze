import { useState, useEffect, useMemo } from 'react';
import { Page } from "@/components/shared/Page";
import { Card } from '@/components/ui';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import {
  CalendarIcon,
  TrophyIcon,
  UserGroupIcon,
  ChartBarIcon,
} from '@heroicons/react/24/outline';
import { EventService, Event } from '@/utils/eventService';
import { WinnerService } from '@/utils/winnerService';
import { PeopleService } from '@/utils/peopleService';
import { getBrandConfig } from '@/config/brands';
import { useModulesContext } from '@/app/contexts/modules/context';

export default function Home() {
  const brandConfig = getBrandConfig();
  const { isFeatureEnabled } = useModulesContext();
  const showEvents = isFeatureEnabled('events');
  const showCompetitions = isFeatureEnabled('competitions');

  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [winnerCounts, setWinnerCounts] = useState<Map<string, number>>(new Map());
  const [isLoadingWinners, setIsLoadingWinners] = useState(false);
  const [entriesCounts, setEntriesCounts] = useState<Map<string, number>>(new Map());
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);

  // Filter competitions only
  const competitions = useMemo(() => {
    return events.filter(event => event.offerSlug);
  }, [events]);

  // Separate current and past competitions
  const { currentCompetitions, pastCompetitions } = useMemo(() => {
    const now = new Date();

    const current = competitions.filter(comp => {
      if (!comp.offerCloseDate) return false;
      const closeDate = new Date(comp.offerCloseDate);
      return closeDate > now;
    });

    const past = competitions.filter(comp => {
      if (!comp.offerCloseDate) return false;
      const closeDate = new Date(comp.offerCloseDate);
      return closeDate <= now;
    });

    return { currentCompetitions: current, pastCompetitions: past };
  }, [competitions]);

  // Calculate total entries
  const totalEntries = useMemo(() => {
    return Array.from(entriesCounts.values())
      .reduce((sum, count) => sum + count, 0);
  }, [entriesCounts]);

  // Calculate total winners
  const totalWinners = useMemo(() => {
    return Array.from(winnerCounts.values())
      .reduce((sum, count) => sum + count, 0);
  }, [winnerCounts]);

  useEffect(() => {
    if (showEvents || showCompetitions) {
      loadEvents();
    } else {
      setLoading(false);
    }
  }, []);

  // Load winner counts and entries counts when competitions change
  useEffect(() => {
    if (showCompetitions && competitions.length > 0) {
      loadWinnerCounts();
      loadEntriesCounts();
    }
  }, [competitions, showCompetitions]);

  const loadEvents = async () => {
    if (!showEvents && !showCompetitions) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const result = await EventService.getAllEvents();
      if (result.success && result.data) {
        setEvents(result.data);
      }
    } catch (error) {
      console.error('Failed to load events:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadWinnerCounts = async () => {
    setIsLoadingWinners(true);
    try {
      const eventIds = competitions.map(comp => comp.eventId);
      const counts = await WinnerService.getWinnerCountsForEvents(eventIds);
      setWinnerCounts(counts);
    } catch (error) {
      console.error('Error loading winner counts:', error);
    } finally {
      setIsLoadingWinners(false);
    }
  };

  const loadEntriesCounts = async () => {
    setIsLoadingEntries(true);
    try {
      const counts = new Map<string, number>();

      // Get entries count for all competition offer slugs from competition_interactions table
      await Promise.all(
        competitions.map(async (comp) => {
          if (comp.offerSlug) {
            try {
              const count = await PeopleService.getCompetitionEntriesCount(comp.offerSlug);
              counts.set(comp.offerSlug, count);
            } catch (error) {
              console.error(`Error loading entries count for ${comp.offerSlug}:`, error);
              counts.set(comp.offerSlug, 0);
            }
          }
        })
      );

      setEntriesCounts(counts);
    } catch (error) {
      console.error('Error loading entries counts:', error);
    } finally {
      setIsLoadingEntries(false);
    }
  };

  if (loading) {
    return (
      <Page title="Dashboard">
        <div className="p-6 flex items-center justify-center h-64">
          <LoadingSpinner size="medium" />
        </div>
      </Page>
    );
  }

  return (
    <Page title="Dashboard">
      <div className="p-6">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
            Dashboard
          </h1>
          <p className="text-[var(--gray-11)] mt-1">
            High-level performance metrics for {brandConfig.name}
          </p>
        </div>

        <div className="space-y-6">

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Total Events */}
          {showEvents && (
            <Card variant="surface" className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-neutral-500">Total Events</div>
                  <div className="text-3xl font-bold mt-2">{events.length}</div>
                </div>
                <div className="p-3 bg-blue-100 dark:bg-blue-900/20 rounded-lg">
                  <CalendarIcon className="size-8 text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </Card>
          )}

          {/* Current Competitions */}
          {showCompetitions && (
            <Card variant="surface" className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-neutral-500">Current Competitions</div>
                  <div className="text-3xl font-bold mt-2">{currentCompetitions.length}</div>
                </div>
                <div className="p-3 bg-green-100 dark:bg-green-900/20 rounded-lg">
                  <TrophyIcon className="size-8 text-green-600 dark:text-green-400" />
                </div>
              </div>
            </Card>
          )}

          {/* Past Competitions */}
          {showCompetitions && (
            <Card variant="surface" className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-neutral-500">Past Competitions</div>
                  <div className="text-3xl font-bold mt-2">{pastCompetitions.length}</div>
                </div>
                <div className="p-3 bg-gray-100 dark:bg-gray-900/20 rounded-lg">
                  <TrophyIcon className="size-8 text-gray-600 dark:text-gray-400" />
                </div>
              </div>
            </Card>
          )}

          {/* Total Competition Entries */}
          {showCompetitions && (
            <Card variant="surface" className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-neutral-500">Total Competition Entries</div>
                  <div className="text-3xl font-bold mt-2">
                    {isLoadingEntries ? '...' : totalEntries.toLocaleString()}
                  </div>
                </div>
                <div className="p-3 bg-purple-100 dark:bg-purple-900/20 rounded-lg">
                  <UserGroupIcon className="size-8 text-purple-600 dark:text-purple-400" />
                </div>
              </div>
            </Card>
          )}

          {/* Total Competition Winners */}
          {showCompetitions && (
            <Card variant="surface" className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-neutral-500">Total Competition Winners</div>
                  <div className="text-3xl font-bold mt-2">
                    {isLoadingWinners ? '...' : totalWinners}
                  </div>
                </div>
                <div className="p-3 bg-yellow-100 dark:bg-yellow-900/20 rounded-lg">
                  <TrophyIcon className="size-8 text-yellow-600 dark:text-yellow-400" />
                </div>
              </div>
            </Card>
          )}

          {/* All Competitions */}
          {showCompetitions && (
            <Card variant="surface" className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-neutral-500">All Competitions</div>
                  <div className="text-3xl font-bold mt-2">{competitions.length}</div>
                </div>
                <div className="p-3 bg-indigo-100 dark:bg-indigo-900/20 rounded-lg">
                  <ChartBarIcon className="size-8 text-indigo-600 dark:text-indigo-400" />
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Quick Stats Summary */}
        {(showEvents || showCompetitions) && (
          <Card variant="surface" className="p-6">
            <h2 className="text-lg font-semibold mb-4">Quick Summary</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {showCompetitions && showEvents && (
                <div className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-neutral-600">Events/Competitions Ratio:</span>
                  <span className="font-semibold">
                    {competitions.length > 0
                      ? `${((competitions.length / events.length) * 100).toFixed(1)}%`
                      : '0%'}
                  </span>
                </div>
              )}
              {showCompetitions && (
                <div className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                  <span className="text-neutral-600">Avg Entries per Competition:</span>
                  <span className="font-semibold">
                    {competitions.length > 0 && !isLoadingEntries
                      ? Math.round(totalEntries / competitions.length).toLocaleString()
                      : '...'}
                  </span>
                </div>
              )}
            </div>
          </Card>
        )}

        </div>
      </div>
    </Page>
  );
}
