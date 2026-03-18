// @ts-nocheck
import { supabase } from '@/lib/supabase';
import { TalkService, EventTalkWithSpeakers } from './talkService';

export type SpeakerStatus = 'pending' | 'approved' | 'rejected' | 'reserve' | 'confirmed' | 'placeholder';
export type ParticipationStatus = 'invited' | 'pending' | 'accepted' | 'declined' | 'confirmed';

export interface EventSpeaker {
  id: string;
  event_uuid: string;
  member_profile_id: string;
  speaker_title?: string;
  speaker_bio?: string;
  speaker_topic?: string;
  sort_order: number;
  is_featured: boolean;
  status: SpeakerStatus;
  participation_status?: ParticipationStatus;
  // Deprecated: Talk fields now live in event_talks table
  // Kept for backwards compatibility during migration
  talk_title?: string;
  talk_synopsis?: string;
  talk_duration_minutes?: number;
  submitted_at?: string;
  reviewed_at?: string;
  reviewed_by?: string;
  confirmation_token?: string;
  confirmed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface EventSpeakerWithDetails extends EventSpeaker {
  qr_code_id?: string;
  customer_id?: number;
  email?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  linkedin_url?: string;
  avatar_url?: string;
  // Sponsor info (if speaker is from a sponsor)
  event_sponsor_id?: string;
  sponsor_name?: string;
  sponsor_logo_url?: string;
  sponsor_tier?: string;
}

export interface AgendaEntrySpeaker {
  id: string;
  agenda_entry_id: string;
  speaker_id: string;
  sort_order: number;
  created_at: string;
}

export interface CreateEventSpeakerInput {
  event_uuid: string;
  member_profile_id: string;
  speaker_title?: string;
  speaker_bio?: string;
  speaker_topic?: string;
  sort_order?: number;
  is_featured?: boolean;
  status?: SpeakerStatus;
  talk_title?: string;
  talk_synopsis?: string;
  talk_duration_minutes?: number;
  submitted_at?: string;
  event_sponsor_id?: string;
}

export interface UpdateEventSpeakerInput {
  speaker_title?: string;
  speaker_bio?: string;
  speaker_topic?: string;
  sort_order?: number;
  is_featured?: boolean;
  status?: SpeakerStatus;
  talk_id?: string;
  talk_title?: string;
  talk_synopsis?: string;
  talk_duration_minutes?: number | null;
  reviewed_at?: string;
  reviewed_by?: string;
  event_sponsor_id?: string | null;
  confirmation_token?: string | null;
  confirmed_at?: string | null;
  company_logo_storage_path?: string | null;
}

export class SpeakerService {
  // ============ EVENT SPEAKERS ============

  static async getSpeakersByEvent(eventUuid: string, status?: SpeakerStatus | SpeakerStatus[]): Promise<EventSpeakerWithDetails[]> {
    let query = supabase
      .from('event_speakers_with_details')
      .select('*')
      .eq('event_uuid', eventUuid);

    if (status) {
      if (Array.isArray(status)) {
        query = query.in('status', status);
      } else {
        query = query.eq('status', status);
      }
    }

    const { data, error } = await query.order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching event speakers:', error);
      throw error;
    }

    return data || [];
  }

  static async getApprovedSpeakersByEvent(eventUuid: string): Promise<EventSpeakerWithDetails[]> {
    return this.getSpeakersByEvent(eventUuid, 'approved');
  }

  static async getPendingSpeakersByEvent(eventUuid: string): Promise<EventSpeakerWithDetails[]> {
    return this.getSpeakersByEvent(eventUuid, 'pending');
  }

  static async getReserveSpeakersByEvent(eventUuid: string): Promise<EventSpeakerWithDetails[]> {
    return this.getSpeakersByEvent(eventUuid, 'reserve');
  }

  static async getConfirmedSpeakersByEvent(eventUuid: string): Promise<EventSpeakerWithDetails[]> {
    return this.getSpeakersByEvent(eventUuid, 'confirmed');
  }

  static async getSpeakerById(speakerId: string): Promise<EventSpeakerWithDetails | null> {
    const { data, error } = await supabase
      .from('event_speakers_with_details')
      .select('*')
      .eq('id', speakerId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('Error fetching speaker:', error);
      throw error;
    }

    return data;
  }

  static async createSpeaker(input: CreateEventSpeakerInput): Promise<EventSpeaker> {
    // Create the speaker record (speaker-specific fields only)
    const { data: speaker, error: speakerError } = await supabase
      .from('event_speakers')
      .insert([{
        event_uuid: input.event_uuid,
        member_profile_id: input.member_profile_id,
        speaker_title: input.speaker_title,
        speaker_bio: input.speaker_bio,
        speaker_topic: input.speaker_topic,
        sort_order: input.sort_order ?? 0,
        is_featured: input.is_featured ?? false,
        event_sponsor_id: input.event_sponsor_id,
      }])
      .select()
      .single();

    if (speakerError) {
      console.error('Error creating speaker:', speakerError);
      throw speakerError;
    }

    // Create the talk record if talk data is provided
    if (input.talk_title) {
      const { data: talk, error: talkError } = await supabase
        .from('event_talks')
        .insert([{
          event_uuid: input.event_uuid,
          title: input.talk_title,
          synopsis: input.talk_synopsis,
          duration_minutes: input.talk_duration_minutes,
          session_type: 'talk',
          status: input.status ?? 'confirmed',
          submitted_at: input.submitted_at,
          sort_order: 0,
          is_featured: input.is_featured ?? false,
          event_sponsor_id: input.event_sponsor_id,
        }])
        .select()
        .single();

      if (talkError) {
        console.error('Error creating talk:', talkError);
        // Clean up speaker if talk creation fails
        await supabase.from('event_speakers').delete().eq('id', speaker.id);
        throw talkError;
      }

      // Link the speaker to the talk
      const { error: linkError } = await supabase
        .from('event_talk_speakers')
        .insert([{
          talk_id: talk.id,
          speaker_id: speaker.id,
          role: 'presenter',
          is_primary: true,
          sort_order: 0,
        }]);

      if (linkError) {
        console.error('Error linking speaker to talk:', linkError);
        // Non-fatal for now, log and continue
      }
    }

    return speaker;
  }

  static async updateSpeaker(speakerId: string, input: UpdateEventSpeakerInput): Promise<EventSpeaker> {
    // Separate speaker-only fields from talk fields
    const speakerFields: Record<string, any> = {};
    const talkFields: Record<string, any> = {};

    // Speaker-specific fields (stay on event_speakers)
    if (input.speaker_title !== undefined) speakerFields.speaker_title = input.speaker_title;
    if (input.speaker_bio !== undefined) speakerFields.speaker_bio = input.speaker_bio;
    if (input.speaker_topic !== undefined) speakerFields.speaker_topic = input.speaker_topic;
    if (input.sort_order !== undefined) speakerFields.sort_order = input.sort_order;
    if (input.is_featured !== undefined) speakerFields.is_featured = input.is_featured;
    if (input.event_sponsor_id !== undefined) speakerFields.event_sponsor_id = input.event_sponsor_id;
    if (input.company_logo_storage_path !== undefined) speakerFields.company_logo_storage_path = input.company_logo_storage_path;

    // Talk-specific fields (now on event_talks)
    if (input.status !== undefined) talkFields.status = input.status;
    if (input.talk_title !== undefined) talkFields.title = input.talk_title;
    if (input.talk_synopsis !== undefined) talkFields.synopsis = input.talk_synopsis;
    if (input.talk_duration_minutes !== undefined) talkFields.duration_minutes = input.talk_duration_minutes;
    if (input.reviewed_at !== undefined) talkFields.reviewed_at = input.reviewed_at;
    if (input.reviewed_by !== undefined) talkFields.reviewed_by = input.reviewed_by;
    if (input.confirmation_token !== undefined) talkFields.confirmation_token = input.confirmation_token;
    if (input.confirmed_at !== undefined) talkFields.confirmed_at = input.confirmed_at;

    // Update speaker record if there are speaker fields
    if (Object.keys(speakerFields).length > 0) {
      const { error: speakerError } = await supabase
        .from('event_speakers')
        .update(speakerFields)
        .eq('id', speakerId);

      if (speakerError) {
        console.error('Error updating speaker:', speakerError);
        throw speakerError;
      }
    }

    // Update talk if there are talk fields
    if (Object.keys(talkFields).length > 0) {
      let talkId = input.talk_id;

      if (!talkId) {
        // Fallback: find the most recent primary talk for this speaker
        const { data: talkSpeaker, error: findError } = await supabase
          .from('event_talk_speakers')
          .select('talk_id')
          .eq('speaker_id', speakerId)
          .eq('is_primary', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (findError) {
          console.error('Error finding primary talk:', findError);
          throw findError;
        }

        talkId = talkSpeaker?.talk_id;
      }

      if (talkId) {
        const { error: talkError } = await supabase
          .from('event_talks')
          .update(talkFields)
          .eq('id', talkId);

        if (talkError) {
          console.error('Error updating talk:', talkError);
          throw talkError;
        }
      } else {
        console.warn(`Speaker ${speakerId} has no primary talk - talk fields not updated`);
      }
    }

    // Return the updated speaker data from the view
    const speaker = await this.getSpeakerById(speakerId);
    if (!speaker) {
      throw new Error('Speaker not found after update');
    }
    return speaker as EventSpeaker;
  }

  static async deleteSpeaker(speakerId: string): Promise<void> {
    const { error } = await supabase
      .from('event_speakers')
      .delete()
      .eq('id', speakerId);

    if (error) {
      console.error('Error deleting speaker:', error);
      throw error;
    }
  }

  // ============ AGENDA ENTRY SPEAKERS ============

  static async getSpeakersForAgendaEntry(agendaEntryId: string): Promise<EventSpeakerWithDetails[]> {
    const { data, error } = await supabase
      .from('event_agenda_entry_speakers')
      .select(`
        id,
        agenda_entry_id,
        speaker_id,
        sort_order,
        created_at,
        speaker:event_speakers_with_details!speaker_id (*)
      `)
      .eq('agenda_entry_id', agendaEntryId)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching agenda entry speakers:', error);
      throw error;
    }

    // Flatten the response to return speaker details directly
    return (data || []).map((item: any) => ({
      ...item.speaker,
      agenda_entry_speaker_id: item.id,
      agenda_entry_sort_order: item.sort_order,
    }));
  }

  static async getSpeakersForAgendaEntries(agendaEntryIds: string[]): Promise<Record<string, EventSpeakerWithDetails[]>> {
    if (agendaEntryIds.length === 0) return {};

    const { data, error } = await supabase
      .from('event_agenda_entry_speakers')
      .select(`
        id,
        agenda_entry_id,
        speaker_id,
        sort_order,
        created_at,
        speaker:event_speakers_with_details!speaker_id (*)
      `)
      .in('agenda_entry_id', agendaEntryIds)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching agenda entry speakers:', error);
      throw error;
    }

    // Group by agenda entry
    const result: Record<string, EventSpeakerWithDetails[]> = {};
    for (const entryId of agendaEntryIds) {
      result[entryId] = [];
    }

    for (const item of data || []) {
      if (item.speaker) {
        result[item.agenda_entry_id].push({
          ...item.speaker,
          agenda_entry_speaker_id: item.id,
          agenda_entry_sort_order: item.sort_order,
        } as EventSpeakerWithDetails);
      }
    }

    return result;
  }

  static async addSpeakerToAgendaEntry(agendaEntryId: string, speakerId: string, sortOrder?: number): Promise<AgendaEntrySpeaker> {
    const { data, error } = await supabase
      .from('event_agenda_entry_speakers')
      .insert([{
        agenda_entry_id: agendaEntryId,
        speaker_id: speakerId,
        sort_order: sortOrder ?? 0,
      }])
      .select()
      .single();

    if (error) {
      console.error('Error adding speaker to agenda entry:', error);
      throw error;
    }

    return data;
  }

  static async removeSpeakerFromAgendaEntry(agendaEntryId: string, speakerId: string): Promise<void> {
    const { error } = await supabase
      .from('event_agenda_entry_speakers')
      .delete()
      .eq('agenda_entry_id', agendaEntryId)
      .eq('speaker_id', speakerId);

    if (error) {
      console.error('Error removing speaker from agenda entry:', error);
      throw error;
    }
  }

  static async updateAgendaEntrySpeakers(agendaEntryId: string, speakerIds: string[]): Promise<void> {
    // Delete all existing speakers for this entry
    const { error: deleteError } = await supabase
      .from('event_agenda_entry_speakers')
      .delete()
      .eq('agenda_entry_id', agendaEntryId);

    if (deleteError) {
      console.error('Error clearing agenda entry speakers:', deleteError);
      throw deleteError;
    }

    // Add new speakers
    if (speakerIds.length > 0) {
      const { error: insertError } = await supabase
        .from('event_agenda_entry_speakers')
        .insert(
          speakerIds.map((speakerId, index) => ({
            agenda_entry_id: agendaEntryId,
            speaker_id: speakerId,
            sort_order: index,
          }))
        );

      if (insertError) {
        console.error('Error adding speakers to agenda entry:', insertError);
        throw insertError;
      }
    }
  }

  // ============ SPEAKER APPROVAL WORKFLOW ============
  // Note: Status is now stored on event_talks, not event_speakers.
  // These methods update the speaker's primary talk's status.

  /**
   * Helper to get and update a speaker's primary talk
   */
  private static async updatePrimaryTalkStatus(
    speakerId: string,
    status: SpeakerStatus,
    additionalFields?: { reviewed_at?: string; reviewed_by?: string; confirmed_at?: string }
  ): Promise<EventSpeaker> {
    // Find the speaker's primary talk
    // Order by role to prefer 'presenter' (their own talk) over 'panelist'/'moderator' (someone else's session)
    // Use limit(1) to handle edge case where multiple is_primary=true entries exist (data issue)
    const { data: talkSpeakers, error: findError } = await supabase
      .from('event_talk_speakers')
      .select('talk_id, role')
      .eq('speaker_id', speakerId)
      .eq('is_primary', true)
      .order('role', { ascending: true }) // 'presenter' comes before 'panelist' alphabetically
      .limit(1);

    const talkSpeaker = talkSpeakers?.[0];
    if (findError || !talkSpeaker) {
      console.error('Error finding primary talk for speaker:', findError);
      throw new Error('No primary talk found for speaker');
    }

    // Update the talk's status
    const { error: updateError } = await supabase
      .from('event_talks')
      .update({
        status,
        ...additionalFields,
      })
      .eq('id', talkSpeaker.talk_id);

    if (updateError) {
      console.error('Error updating talk status:', updateError);
      throw updateError;
    }

    // Return the speaker data (re-fetch to get updated view data)
    const speaker = await this.getSpeakerById(speakerId);
    if (!speaker) {
      throw new Error('Speaker not found after update');
    }
    return speaker as EventSpeaker;
  }

  /**
   * @deprecated Use TalkService.approveTalk(talkId) instead.
   * The workflow is now talk-centric, not speaker-centric.
   */
  static async approveSpeaker(speakerId: string, reviewedBy?: string): Promise<EventSpeaker> {
    return this.updatePrimaryTalkStatus(speakerId, 'approved', {
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
    });
  }

  /**
   * @deprecated Use TalkService.rejectTalk(talkId) instead.
   * The workflow is now talk-centric, not speaker-centric.
   */
  static async rejectSpeaker(speakerId: string, reviewedBy?: string): Promise<EventSpeaker> {
    return this.updatePrimaryTalkStatus(speakerId, 'rejected', {
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
    });
  }

  /**
   * @deprecated Use TalkService.reserveTalk(talkId) instead.
   * The workflow is now talk-centric, not speaker-centric.
   */
  static async reserveSpeaker(speakerId: string, reviewedBy?: string): Promise<EventSpeaker> {
    return this.updatePrimaryTalkStatus(speakerId, 'reserve', {
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
    });
  }

  /**
   * @deprecated Use TalkService.confirmTalk(talkId) instead.
   * The workflow is now talk-centric, not speaker-centric.
   */
  static async confirmSpeaker(speakerId: string): Promise<EventSpeaker> {
    return this.updatePrimaryTalkStatus(speakerId, 'confirmed', {
      confirmed_at: new Date().toISOString(),
    });
  }

  /**
   * Generate a confirmation token for a speaker's primary talk
   * This should be called when approving a speaker
   * Note: Confirmation tokens are stored on event_talks, not event_speakers
   */
  static async generateConfirmationToken(speakerId: string): Promise<string> {
    // Find the speaker's primary talk
    // Order by role to prefer 'presenter' over 'panelist'/'moderator', use limit(1) for safety
    const { data: talkSpeakers, error: findError } = await supabase
      .from('event_talk_speakers')
      .select('talk_id')
      .eq('speaker_id', speakerId)
      .eq('is_primary', true)
      .order('role', { ascending: true })
      .limit(1);

    const talkSpeaker = talkSpeakers?.[0];
    if (findError || !talkSpeaker) {
      console.error('Error finding primary talk for speaker:', findError);
      throw new Error('No primary talk found for speaker');
    }

    const token = crypto.randomUUID();

    // Update the talk with the confirmation token
    const { error: updateError } = await supabase
      .from('event_talks')
      .update({ confirmation_token: token })
      .eq('id', talkSpeaker.talk_id);

    if (updateError) {
      console.error('Error setting confirmation token:', updateError);
      throw updateError;
    }

    return token;
  }

  /**
   * Get speaker by their primary talk's confirmation token
   * Note: Confirmation tokens are now stored on event_talks
   */
  static async getSpeakerByConfirmationToken(token: string): Promise<EventSpeakerWithDetails | null> {
    // The view now includes confirmation_token from the primary talk
    const { data, error } = await supabase
      .from('event_speakers_with_details')
      .select('*')
      .eq('confirmation_token', token)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('Error fetching speaker by token:', error);
      throw error;
    }

    return data;
  }

  /**
   * Confirm speaker using confirmation token
   * Returns the speaker if successful, null if token is invalid or already confirmed
   * Note: This updates the talk's status, not the speaker's
   */
  static async confirmSpeakerByToken(token: string): Promise<EventSpeakerWithDetails | null> {
    const speaker = await this.getSpeakerByConfirmationToken(token);

    if (!speaker) {
      return null;
    }

    // Only allow confirmation if status is 'approved'
    if (speaker.status !== 'approved') {
      console.log(`Speaker ${speaker.id} status is ${speaker.status}, not approved - cannot confirm`);
      return speaker; // Return the speaker so we can show appropriate message
    }

    await this.confirmSpeaker(speaker.id);

    // Re-fetch to get updated data
    return this.getSpeakerById(speaker.id);
  }

  static async submitSpeakerApplication(input: CreateEventSpeakerInput): Promise<EventSpeaker> {
    return this.createSpeaker({
      ...input,
      status: 'pending',
      submitted_at: new Date().toISOString(),
      is_featured: false,
    });
  }

  /**
   * Get count of confirmed speakers grouped by talk duration
   * Used for capacity tracking on speaker submission forms
   * @deprecated Use TalkService.getConfirmedDurationCounts instead
   */
  static async getConfirmedDurationCounts(eventUuid: string): Promise<Record<number, number>> {
    // Delegate to TalkService for new talk-based counting
    return TalkService.getConfirmedDurationCounts(eventUuid);
  }

  // ============ SPEAKER TALKS ============

  /**
   * Get all talks for a speaker
   * Delegates to TalkService
   */
  static async getSpeakerTalks(speakerId: string): Promise<EventTalkWithSpeakers[]> {
    return TalkService.getTalksBySpeaker(speakerId);
  }

  /**
   * Get speaker by their event and member profile
   */
  static async getSpeakerByMemberProfile(eventUuid: string, memberProfileId: string): Promise<EventSpeakerWithDetails | null> {
    const { data, error } = await supabase
      .from('event_speakers_with_details')
      .select('*')
      .eq('event_uuid', eventUuid)
      .eq('member_profile_id', memberProfileId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('Error fetching speaker by member profile:', error);
      throw error;
    }

    return data;
  }

  /**
   * Update speaker participation status
   */
  static async updateParticipationStatus(speakerId: string, status: ParticipationStatus): Promise<EventSpeaker> {
    const { data, error } = await supabase
      .from('event_speakers')
      .update({ participation_status: status })
      .eq('id', speakerId)
      .select()
      .single();

    if (error) {
      console.error('Error updating participation status:', error);
      throw error;
    }

    return data;
  }
}
