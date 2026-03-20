import { supabase } from '@/lib/supabase';

/**
 * Service to reconcile Customer.io segment membership with interaction tables
 *
 * This ensures that:
 * 1. Every segment member has a corresponding interaction record (for timestamp tracking)
 * 2. Segment membership is the source of truth for WHO accepted
 * 3. Interaction tables provide the WHEN they accepted
 *
 * For new segment members without interaction records, we create entries with
 * the timestamp set to when they were first discovered during sync.
 */
export class SegmentInteractionReconciler {

  /**
   * Reconcile segment membership with interaction records for a specific offer
   * @param offerId The offer/competition/discount ID
   * @param segmentId The Customer.io segment ID
   * @returns Number of new interaction records created
   */
  static async reconcileOfferSegment(offerId: string, segmentId: number): Promise<number> {
    try {
      console.log(`[Reconciler] Starting reconciliation for offer: ${offerId}, segment: ${segmentId}`);

      // Determine which interaction table to use based on offer prefix
      const tableName = this.getInteractionTableName(offerId);

      // Get all segment members with their customer_cio_id
      const { data: segmentMembers, error: segmentError } = await supabase
        .from('segments_memberships')
        .select('customer_cio_id, last_verified_at, joined_at')
        .eq('segment_id', segmentId);

      if (segmentError) {
        console.error('[Reconciler] Error fetching segment members:', segmentError);
        return 0;
      }

      if (!segmentMembers || segmentMembers.length === 0) {
        console.log('[Reconciler] No segment members found');
        return 0;
      }

      console.log(`[Reconciler] Found ${segmentMembers.length} segment members`);

      // Get existing interactions for this offer (using customer_cio_id)
      const { data: existingInteractions, error: interactionError } = await supabase
        .from(tableName)
        .select('customer_cio_id')
        .eq('offer_id', offerId)
        .eq('offer_status', 'accepted');

      if (interactionError) {
        console.error('[Reconciler] Error fetching existing interactions:', interactionError);
        return 0;
      }

      // Create a set of existing customer CIO IDs for quick lookup
      const existingCustomerCioIds = new Set(
        existingInteractions?.map(i => i.customer_cio_id) || []
      );

      console.log(`[Reconciler] Found ${existingCustomerCioIds.size} existing interactions`);

      // Find segment members without interaction records (filter out those without customer_cio_id)
      const missingInteractions = segmentMembers.filter(
        member => member.customer_cio_id && !existingCustomerCioIds.has(member.customer_cio_id)
      );

      if (missingInteractions.length === 0) {
        console.log('[Reconciler] All segment members have interaction records');
        return 0;
      }

      console.log(`[Reconciler] Creating ${missingInteractions.length} missing interaction records`);

      // Create interaction records for missing members
      // Use joined_at if available, otherwise use last_verified_at
      const newInteractions = missingInteractions.map(member => ({
        customer_cio_id: member.customer_cio_id,
        offer_id: offerId,
        offer_status: 'accepted',
        timestamp: member.joined_at || member.last_verified_at || new Date().toISOString(),
        offer_referrer: 'segment_sync', // Mark as created by sync
        created_at: new Date().toISOString(),
      }));

      // Batch insert new interactions
      const { error: insertError } = await supabase
        .from(tableName)
        .insert(newInteractions);

      if (insertError) {
        console.error('[Reconciler] Error inserting interactions:', insertError);
        return 0;
      }

      console.log(`[Reconciler] Successfully created ${newInteractions.length} interaction records`);
      return newInteractions.length;

    } catch (error) {
      console.error('[Reconciler] Unexpected error:', error);
      return 0;
    }
  }

  /**
   * Reconcile all offer segments with interactions
   * This processes all segments that follow the "Offer // X // Accepted" pattern
   */
  static async reconcileAllOfferSegments(): Promise<{
    processed: number;
    created: number;
    errors: string[];
  }> {
    const results = {
      processed: 0,
      created: 0,
      errors: [] as string[]
    };

    try {
      // Get all offer segments
      const { data: segments, error } = await supabase
        .from('segments')
        .select('name, cio_segment_id')
        .like('name', 'Offer // % // Accepted');

      if (error) {
        console.error('[Reconciler] Error fetching segments:', error);
        results.errors.push('Failed to fetch segments');
        return results;
      }

      if (!segments || segments.length === 0) {
        console.log('[Reconciler] No offer segments found');
        return results;
      }

      console.log(`[Reconciler] Processing ${segments.length} offer segments`);

      // Process each segment
      for (const segment of segments) {
        results.processed++;

        // Extract offer ID from segment name
        const match = segment.name.match(/^Offer \/\/ (.+) \/\/ Accepted$/);
        if (!match) {
          console.warn(`[Reconciler] Invalid segment name format: ${segment.name}`);
          results.errors.push(`Invalid segment name: ${segment.name}`);
          continue;
        }

        const offerId = match[1];

        try {
          const created = await this.reconcileOfferSegment(offerId, segment.cio_segment_id);
          results.created += created;
        } catch (error) {
          console.error(`[Reconciler] Error processing segment ${segment.name}:`, error);
          results.errors.push(`Failed to process: ${segment.name}`);
        }
      }

      console.log(`[Reconciler] Reconciliation complete: ${results.processed} segments processed, ${results.created} interactions created`);
      return results;

    } catch (error) {
      console.error('[Reconciler] Unexpected error in reconcileAllOfferSegments:', error);
      results.errors.push('Unexpected error during reconciliation');
      return results;
    }
  }

  /**
   * Determine which interaction table to use based on offer ID prefix
   */
  private static getInteractionTableName(offerId: string): string {
    if (offerId.startsWith('win-')) {
      return 'competition_interactions';
    } else if (offerId.startsWith('discount-') || offerId.startsWith('free-tickets-')) {
      return 'discount_interactions';
    } else {
      return 'offer_interactions';
    }
  }

  /**
   * Get reconciliation status for an offer
   * Returns counts of members in segment vs interactions
   */
  static async getReconciliationStatus(offerId: string, segmentId: number): Promise<{
    segmentCount: number;
    interactionCount: number;
    syncedCount: number;
    pendingCount: number;
  }> {
    try {
      const tableName = this.getInteractionTableName(offerId);

      // Get segment member count
      const { count: segmentCount, error: segmentError } = await supabase
        .from('segments_memberships')
        .select('*', { count: 'exact', head: true })
        .eq('segment_id', segmentId);

      if (segmentError) {
        console.error('[Reconciler] Error getting segment count:', segmentError);
      }

      // Get interaction count
      const { count: interactionCount, error: interactionError } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true })
        .eq('offer_id', offerId)
        .eq('offer_status', 'accepted');

      if (interactionError) {
        console.error('[Reconciler] Error getting interaction count:', interactionError);
      }

      // Get count of synced records (marked with 'segment_sync' referrer)
      const { count: syncedCount, error: syncedError } = await supabase
        .from(tableName)
        .select('*', { count: 'exact', head: true })
        .eq('offer_id', offerId)
        .eq('offer_status', 'accepted')
        .eq('offer_referrer', 'segment_sync');

      if (syncedError) {
        console.error('[Reconciler] Error getting synced count:', syncedError);
      }

      const segmentTotal = segmentCount || 0;
      const interactionTotal = interactionCount || 0;
      const synced = syncedCount || 0;
      const pending = Math.max(0, segmentTotal - interactionTotal);

      return {
        segmentCount: segmentTotal,
        interactionCount: interactionTotal,
        syncedCount: synced,
        pendingCount: pending
      };

    } catch (error) {
      console.error('[Reconciler] Error getting reconciliation status:', error);
      return {
        segmentCount: 0,
        interactionCount: 0,
        syncedCount: 0,
        pendingCount: 0
      };
    }
  }

  /**
   * Clean up orphaned interactions (in interactions but not in segment)
   * This should be used carefully as it removes data
   */
  static async cleanOrphanedInteractions(offerId: string, segmentId: number): Promise<number> {
    try {
      console.log(`[Reconciler] Cleaning orphaned interactions for offer: ${offerId}`);

      const tableName = this.getInteractionTableName(offerId);

      // Get all segment members
      const { data: segmentMembers, error: segmentError } = await supabase
        .from('segments_memberships')
        .select('customer_cio_id')
        .eq('segment_id', segmentId);

      if (segmentError) {
        console.error('[Reconciler] Error fetching segment members:', segmentError);
        return 0;
      }

      const segmentMemberCioIds = new Set(
        segmentMembers?.map(m => m.customer_cio_id) || []
      );

      // Get all interactions for this offer
      const { data: interactions, error: interactionError } = await supabase
        .from(tableName)
        .select('customer_cio_id, id')
        .eq('offer_id', offerId)
        .eq('offer_status', 'accepted');

      if (interactionError) {
        console.error('[Reconciler] Error fetching interactions:', interactionError);
        return 0;
      }

      // Find orphaned interactions
      const orphaned = interactions?.filter(
        i => !segmentMemberCioIds.has(i.customer_cio_id)
      ) || [];

      if (orphaned.length === 0) {
        console.log('[Reconciler] No orphaned interactions found');
        return 0;
      }

      console.log(`[Reconciler] Found ${orphaned.length} orphaned interactions`);

      // Delete orphaned interactions
      const orphanedIds = orphaned.map(o => o.id);
      const { error: deleteError } = await supabase
        .from(tableName)
        .delete()
        .in('id', orphanedIds);

      if (deleteError) {
        console.error('[Reconciler] Error deleting orphaned interactions:', deleteError);
        return 0;
      }

      console.log(`[Reconciler] Successfully deleted ${orphaned.length} orphaned interactions`);
      return orphaned.length;

    } catch (error) {
      console.error('[Reconciler] Error cleaning orphaned interactions:', error);
      return 0;
    }
  }
}