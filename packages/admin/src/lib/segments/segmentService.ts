/**
 * Segment Service
 * Handles segment CRUD operations, membership queries, and previews
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  Segment,
  SegmentDefinition,
  SegmentMember,
  SegmentPreviewResult,
  CreateSegmentInput,
  UpdateSegmentInput,
  SegmentListParams,
  SegmentMembersParams,
  PaginatedResult,
  ConditionSource,
  SegmentGeoPoint,
} from './types';

export class SegmentService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * List segments with optional filtering and pagination
   */
  async listSegments(params: SegmentListParams = {}): Promise<PaginatedResult<Segment>> {
    const {
      status,
      type,
      account_id,
      page = 0,
      page_size = 50,
      search,
    } = params;

    let query = this.supabase
      .from('segments')
      .select('*', { count: 'exact' });

    if (status) {
      query = query.eq('status', status);
    }
    if (type) {
      query = query.eq('type', type);
    }
    if (account_id) {
      query = query.eq('account_id', account_id);
    }
    if (search) {
      query = query.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
    }

    query = query
      .order('created_at', { ascending: false })
      .range(page * page_size, (page + 1) * page_size - 1);

    const { data, error, count } = await query;

    if (error) throw error;

    const total = count || 0;
    return {
      data: data || [],
      total,
      page,
      page_size,
      total_pages: Math.ceil(total / page_size),
    };
  }

  /**
   * Get a single segment by ID
   */
  async getSegment(id: string): Promise<Segment | null> {
    const { data, error } = await this.supabase
      .from('segments')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  }

  /**
   * Create a new segment
   */
  async createSegment(input: CreateSegmentInput): Promise<Segment> {
    const { data, error } = await this.supabase
      .from('segments')
      .insert({
        name: input.name,
        description: input.description,
        definition: input.definition,
        type: input.type || 'dynamic',
        account_id: input.account_id,
      })
      .select()
      .single();

    if (error) throw error;

    // Calculate initial count
    await this.recalculateSegment(data.id);

    // Fetch updated segment with count
    const updated = await this.getSegment(data.id);
    return updated!;
  }

  /**
   * Update an existing segment
   */
  async updateSegment(id: string, updates: UpdateSegmentInput): Promise<Segment> {
    const updateData: Record<string, unknown> = {};

    if (updates.name !== undefined) updateData.name = updates.name;
    if (updates.description !== undefined) updateData.description = updates.description;
    if (updates.definition !== undefined) updateData.definition = updates.definition;
    if (updates.status !== undefined) updateData.status = updates.status;

    const { data, error } = await this.supabase
      .from('segments')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    // Recalculate if definition changed
    if (updates.definition) {
      await this.recalculateSegment(id);
    }

    // Fetch updated segment with count
    const updated = await this.getSegment(id);
    return updated!;
  }

  /**
   * Delete a segment
   */
  async deleteSegment(id: string): Promise<void> {
    const { error } = await this.supabase
      .from('segments')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  /**
   * Archive a segment (soft delete)
   */
  async archiveSegment(id: string): Promise<Segment> {
    return this.updateSegment(id, { status: 'archived' });
  }

  /**
   * Preview segment results without saving
   */
  async previewSegment(definition: SegmentDefinition): Promise<SegmentPreviewResult & { isEstimate?: boolean }> {
    const { data, error } = await this.supabase.rpc('segments_preview', {
      p_definition: definition,
      p_limit: 10,
    });

    if (error) throw error;

    return {
      count: data?.count || 0,
      sample: data?.sample || [],
      isEstimate: data?.is_estimate || false,
    };
  }

  /**
   * Distinct event names recorded in people_events (for the Person Event picker)
   */
  async listEventNames(): Promise<string[]> {
    const { data, error } = await this.supabase.rpc('segments_event_names');
    if (error) throw error;
    return (data as string[] | null) || [];
  }

  /**
   * Module-contributed condition sources (registry) + their vocabulary, for the
   * builder's registry-condition editors (geo_radius, event_registration, …).
   * Best-effort: returns [] if the registry RPC isn't present.
   */
  async listConditionSources(search?: string): Promise<ConditionSource[]> {
    const { data, error } = await this.supabase.rpc('segments_sources_catalog', {
      p_search: search ?? null,
      p_entity_limit: 200,
    });
    if (error) return [];
    const sources = (data as { sources?: ConditionSource[] } | null)?.sources;
    return Array.isArray(sources) ? sources : [];
  }

  /** Geocode a place name to a lat/lng centroid from our own data (for the
   *  geo_radius condition). Returns null when we have no coordinates. */
  async geocodePlace(place: string): Promise<{ lat: number; lng: number; n?: number } | null> {
    const { data, error } = await this.supabase.rpc('segments_geocode_place', { p_place: place });
    if (error || !data) return null;
    const g = data as { lat?: number; lng?: number; n?: number };
    return typeof g.lat === 'number' && typeof g.lng === 'number' ? { lat: g.lat, lng: g.lng, n: g.n } : null;
  }

  /** Aggregate the segment's members by city/country (avg lat/lng + count) for
   *  the audience map preview — one point per location, not per person. */
  async geoAggregate(definition: SegmentDefinition, limit = 500): Promise<SegmentGeoPoint[]> {
    const { data, error } = await this.supabase.rpc('segments_geo_aggregate', { p_definition: definition, p_limit: limit });
    if (error) throw error;
    return ((data as SegmentGeoPoint[] | null) || []).filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
  }

  /**
   * Get segment member count (with optional caching)
   */
  async getSegmentCount(id: string, useCache: boolean = true): Promise<number> {
    const { data, error } = await this.supabase.rpc('segments_get_member_count', {
      p_segment_id: id,
      p_use_cache: useCache,
    });

    if (error) throw error;
    return data || 0;
  }

  /**
   * Get paginated segment members
   */
  async getSegmentMembers(
    id: string,
    params: SegmentMembersParams = {}
  ): Promise<{ members: SegmentMember[]; total: number }> {
    const { page = 0, page_size = 50, search } = params;

    const { data, error } = await this.supabase.rpc('segments_get_members_paginated', {
      p_segment_id: id,
      p_offset: page * page_size,
      p_limit: page_size,
      p_search: search || null,
    });

    if (error) throw error;

    return {
      members: data?.members || [],
      total: data?.total || 0,
    };
  }

  /**
   * Trigger segment recalculation
   */
  async recalculateSegment(id: string): Promise<void> {
    const { error } = await this.supabase.rpc('segments_calculate_members', {
      p_segment_id: id,
    });

    if (error) throw error;
  }

  /**
   * Export segment members as CSV string
   */
  async exportSegmentCSV(id: string): Promise<string> {
    // Get all members (up to 100k)
    const { members } = await this.getSegmentMembers(id, { page_size: 100000 });

    const headers = [
      'email',
      'first_name',
      'last_name',
      'company',
      'job_title',
      'country',
      'city',
    ];

    const rows = members.map((member) => [
      member.email || '',
      member.attributes?.first_name || '',
      member.attributes?.last_name || '',
      member.attributes?.company || '',
      member.attributes?.job_title || '',
      member.attributes?.country || '',
      member.attributes?.city || '',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  /**
   * Export segment members as Blob for download
   */
  async exportSegmentBlob(id: string): Promise<Blob> {
    const csv = await this.exportSegmentCSV(id);
    return new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  }

  /**
   * Duplicate a segment
   */
  async duplicateSegment(id: string, newName?: string): Promise<Segment> {
    const original = await this.getSegment(id);
    if (!original) throw new Error('Segment not found');

    return this.createSegment({
      name: newName || `${original.name} (Copy)`,
      description: original.description,
      definition: original.definition,
      type: original.type,
      account_id: original.account_id || undefined,
    });
  }

  /**
   * Get segment calculation history
   */
  async getCalculationHistory(
    segmentId: string,
    limit: number = 20
  ): Promise<Array<{
    calculated_at: string;
    member_count: number;
    calculation_duration_ms: number;
    triggered_by: string;
  }>> {
    const { data, error } = await this.supabase
      .from('segments_calculation_history')
      .select('calculated_at, member_count, calculation_duration_ms, triggered_by')
      .eq('segment_id', segmentId)
      .order('calculated_at', { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  }

  /**
   * Manually add members to a manual segment
   */
  async addMembersToSegment(segmentId: string, customerIds: string[]): Promise<void> {
    const memberships = customerIds.map((customerId) => ({
      segment_id: segmentId,
      person_id: customerId,
      source: 'manual' as const,
    }));

    const { error } = await this.supabase
      .from('segments_memberships')
      .upsert(memberships, { onConflict: 'segment_id,person_id' });

    if (error) throw error;

    // Update cached count
    const { count } = await this.supabase
      .from('segments_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('segment_id', segmentId);

    await this.supabase
      .from('segments')
      .update({ cached_count: count || 0, last_calculated_at: new Date().toISOString() })
      .eq('id', segmentId);
  }

  /**
   * Remove members from a manual segment
   */
  async removeMembersFromSegment(segmentId: string, customerIds: string[]): Promise<void> {
    const { error } = await this.supabase
      .from('segments_memberships')
      .delete()
      .eq('segment_id', segmentId)
      .in('person_id', customerIds);

    if (error) throw error;

    // Update cached count
    const { count } = await this.supabase
      .from('segments_memberships')
      .select('*', { count: 'exact', head: true })
      .eq('segment_id', segmentId);

    await this.supabase
      .from('segments')
      .update({ cached_count: count || 0, last_calculated_at: new Date().toISOString() })
      .eq('id', segmentId);
  }
}

// Export a factory function to create service instance
export function createSegmentService(supabase: SupabaseClient): SegmentService {
  return new SegmentService(supabase);
}
