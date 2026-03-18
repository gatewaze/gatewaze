// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { customerIOService, SegmentMemberCount } from '@/utils/customerioService';

interface UseCustomerIOReturn {
  memberCounts: Map<string, SegmentMemberCount>;
  isLoading: boolean;
  lastUpdated: Date | null;
  error: string | null;
  refreshData: () => Promise<void>;
}

export const useCustomerIO = (offerSlugs: string[]): UseCustomerIOReturn => {
  const [memberCounts, setMemberCounts] = useState<Map<string, SegmentMemberCount>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (offerSlugs.length === 0) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch with update callback for dynamic updates
      const data = await customerIOService.fetchSegmentMemberCounts(
        offerSlugs,
        (updatedCounts) => {
          // This callback is called when fresh data arrives from Customer.io
          setMemberCounts(new Map(updatedCounts));
          setLastUpdated(customerIOService.getLastUpdated());
          console.log('UI updated with fresh Customer.io data');
        }
      );

      // Set initial data (cached from Supabase)
      setMemberCounts(data);
      setLastUpdated(customerIOService.getLastUpdated());
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch Customer.io data';
      setError(errorMessage);
      console.error('Error fetching Customer.io data:', err);

      // Use cached data if available
      const cachedData = customerIOService.getCachedData();
      if (cachedData.size > 0) {
        setMemberCounts(cachedData);
        setLastUpdated(customerIOService.getLastUpdated());
      }
    } finally {
      setIsLoading(false);
    }
  }, [offerSlugs]);

  const refreshData = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  // Initial fetch - only when offerSlugs change
  useEffect(() => {
    if (offerSlugs.length > 0) {
      fetchData();
    }
  }, [offerSlugs.join(',')]); // Only re-run if the actual slugs change

  // Set up 5-minute interval for automatic updates
  useEffect(() => {
    if (offerSlugs.length === 0) return;

    const interval = setInterval(() => {
      // Only fetch if data is stale
      if (customerIOService.isDataStale()) {
        console.log('Customer.io data is stale, refreshing...');
        fetchData();
      }
    }, 5 * 60 * 1000); // 5 minutes

    return () => clearInterval(interval);
  }, [offerSlugs.join(',')]); // Only re-run if the actual slugs change

  return {
    memberCounts,
    isLoading,
    lastUpdated,
    error,
    refreshData,
  };
};
