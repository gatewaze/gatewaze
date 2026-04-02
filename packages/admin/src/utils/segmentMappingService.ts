import { supabase } from '@/lib/supabase';

/**
 * Service to handle mapping between offer/discount/competition IDs and Customer.io segment IDs
 * Segments follow the naming pattern: "Offer // {offer-id} // Accepted"
 */
export class SegmentMappingService {
  private static segmentCache = new Map<string, number>();
  private static cacheTimestamp = 0;
  private static readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  /**
   * Get the Customer.io segment ID for an offer/discount/competition
   * @param offerId The offer ID (e.g., "win-kubecon-tickets", "discount-aws-reinvent")
   * @returns The Customer.io segment ID or null if not found
   */
  static async getSegmentIdForOffer(offerId: string): Promise<number | null> {
    // Check cache first
    const cacheKey = offerId;
    const now = Date.now();

    if (this.segmentCache.has(cacheKey) && (now - this.cacheTimestamp) < this.CACHE_DURATION) {
      const cachedId = this.segmentCache.get(cacheKey)!;
      console.log(`[SegmentMapping] Using cached segment ID ${cachedId} for offer: ${offerId}`);
      return cachedId;
    }

    try {
      // Look for segment with name pattern "Offer // {offerId} // Accepted"
      const segmentName = `Offer // ${offerId} // Accepted`;
      console.log(`[SegmentMapping] Looking for segment: "${segmentName}"`);

      const { data, error } = await supabase
        .from('segments')
        .select('cio_segment_id')
        .eq('name', segmentName)
        .single();

      if (error || !data) {
        console.warn(`[SegmentMapping] No segment found for offer: ${offerId} (looked for: "${segmentName}")`);
        return null;
      }

      console.log(`[SegmentMapping] Found segment ID ${data.cio_segment_id} for offer: ${offerId}`);

      // Cache the result
      this.segmentCache.set(cacheKey, data.cio_segment_id);
      this.cacheTimestamp = now;

      return data.cio_segment_id;
    } catch (error) {
      console.error('Error getting segment ID for offer:', error);
      return null;
    }
  }

  /**
   * Get segment IDs for multiple offers
   * @param offerIds Array of offer IDs
   * @returns Map of offer ID to segment ID
   */
  static async getSegmentIdsForOffers(offerIds: string[]): Promise<Map<string, number>> {
    const segmentMap = new Map<string, number>();

    if (offerIds.length === 0) {
      return segmentMap;
    }

    try {
      // Build segment names
      const segmentNames = offerIds.map(id => `Offer // ${id} // Accepted`);

      const { data, error } = await supabase
        .from('segments')
        .select('name, cio_segment_id')
        .in('name', segmentNames);

      if (error) {
        console.error('Error fetching segment IDs:', error);
        return segmentMap;
      }

      // Parse the segment names to extract offer IDs and map them
      data?.forEach(segment => {
        // Extract offer ID from segment name "Offer // {offerId} // Accepted"
        const match = segment.name.match(/^Offer \/\/ (.+) \/\/ Accepted$/);
        if (match) {
          const offerId = match[1];
          segmentMap.set(offerId, segment.cio_segment_id);

          // Update cache
          this.segmentCache.set(offerId, segment.cio_segment_id);
        }
      });

      this.cacheTimestamp = Date.now();

      return segmentMap;
    } catch (error) {
      console.error('Error getting segment IDs for offers:', error);
      return new Map<string, number>();
    }
  }

  /**
   * Get member count for a segment from our synced data
   * @param segmentId The Customer.io segment ID
   * @returns The number of members in the segment
   */
  static async getSegmentMemberCount(segmentId: number): Promise<number> {
    try {
      console.log(`[SegmentMapping] Getting member count for segment ID: ${segmentId}`);

      const { count, error } = await supabase
        .from('segments_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('segment_id', segmentId);

      if (error) {
        console.error('[SegmentMapping] Error getting segment member count:', error);
        return 0;
      }

      console.log(`[SegmentMapping] Segment ${segmentId} has ${count || 0} members`);
      return count || 0;
    } catch (error) {
      console.error('Error getting segment member count:', error);
      return 0;
    }
  }

  /**
   * Get member counts for multiple segments
   * @param segmentIds Array of Customer.io segment IDs
   * @returns Map of segment ID to member count
   */
  static async getSegmentMemberCounts(segmentIds: number[]): Promise<Map<number, number>> {
    const countMap = new Map<number, number>();

    if (segmentIds.length === 0) {
      return countMap;
    }

    try {
      // Initialize all counts to 0
      segmentIds.forEach(id => countMap.set(id, 0));

      // Query each segment individually to get accurate counts
      // This avoids the 1000 row limit issue and ensures we get the correct count
      const countPromises = segmentIds.map(async (segmentId) => {
        const { count, error } = await supabase
          .from('segments_memberships')
          .select('*', { count: 'exact', head: true })
          .eq('segment_id', segmentId);

        if (error) {
          console.error(`Error getting count for segment ${segmentId}:`, error);
          return { segmentId, count: 0 };
        }

        return { segmentId, count: count || 0 };
      });

      // Execute all count queries in parallel
      const results = await Promise.all(countPromises);

      // Update the count map with results
      results.forEach(({ segmentId, count }) => {
        countMap.set(segmentId, count);
      });

      return countMap;
    } catch (error) {
      console.error('Error getting segment member counts:', error);
      return new Map<number, number>();
    }
  }

  /**
   * Get members of a segment
   * @param segmentId The Customer.io segment ID
   * @returns Array of customer CIO IDs
   */
  static async getSegmentMembers(segmentId: number): Promise<string[]> {
    try {
      const { data, error } = await supabase
        .from('segments_memberships')
        .select('customer_cio_id')
        .eq('segment_id', segmentId);

      if (error) {
        console.error('Error getting segment members:', error);
        return [];
      }

      return data?.map(m => m.customer_cio_id) || [];
    } catch (error) {
      console.error('Error getting segment members:', error);
      return [];
    }
  }

  /**
   * Clear the segment cache (useful when segments are updated)
   */
  static clearCache(): void {
    this.segmentCache.clear();
    this.cacheTimestamp = 0;
  }

  /**
   * Get the best segment ID for an offer - prefers "Completed" over "Accepted" if available
   * This handles offers with a multi-step flow (e.g., ebook downloads where "Completed" = actually downloaded)
   * @param offerId The offer ID
   * @returns Object with segmentId, status ('completed' or 'accepted'), and the segment name
   */
  static async getBestSegmentForOffer(offerId: string): Promise<{
    segmentId: number | null;
    status: 'completed' | 'accepted';
    segmentName: string | null;
  }> {
    try {
      // First, check for a "Completed" segment (higher priority)
      const completedName = `Offer // ${offerId} // Completed`;
      const { data: completedData } = await supabase
        .from('segments')
        .select('cio_segment_id, name')
        .eq('name', completedName)
        .maybeSingle();

      if (completedData) {
        console.log(`[SegmentMapping] Found Completed segment for ${offerId}: ${completedData.cio_segment_id}`);
        return {
          segmentId: completedData.cio_segment_id,
          status: 'completed',
          segmentName: completedData.name
        };
      }

      // Fall back to "Accepted" segment
      const acceptedName = `Offer // ${offerId} // Accepted`;
      const { data: acceptedData } = await supabase
        .from('segments')
        .select('cio_segment_id, name')
        .eq('name', acceptedName)
        .maybeSingle();

      if (acceptedData) {
        console.log(`[SegmentMapping] Found Accepted segment for ${offerId}: ${acceptedData.cio_segment_id}`);
        return {
          segmentId: acceptedData.cio_segment_id,
          status: 'accepted',
          segmentName: acceptedData.name
        };
      }

      console.log(`[SegmentMapping] No segment found for ${offerId}`);
      return { segmentId: null, status: 'accepted', segmentName: null };
    } catch (error) {
      console.error('Error getting best segment for offer:', error);
      return { segmentId: null, status: 'accepted', segmentName: null };
    }
  }

  /**
   * Check if an offer has a "Completed" segment
   * @param offerId The offer ID
   * @returns true if a Completed segment exists
   */
  static async hasCompletedSegment(offerId: string): Promise<boolean> {
    try {
      const completedName = `Offer // ${offerId} // Completed`;
      const { data } = await supabase
        .from('segments')
        .select('cio_segment_id')
        .eq('name', completedName)
        .maybeSingle();

      return !!data;
    } catch {
      return false;
    }
  }
}