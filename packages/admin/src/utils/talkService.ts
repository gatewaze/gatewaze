// @ts-nocheck
import { supabase } from '@/lib/supabase';

// Session/talk types
export type SessionType = 'talk' | 'panel' | 'workshop' | 'lightning' | 'fireside' | 'keynote';
export type TalkStatus = 'draft' | 'pending' | 'approved' | 'rejected' | 'confirmed' | 'reserve' | 'placeholder';
export type SpeakerRole = 'presenter' | 'panelist' | 'moderator' | 'co_presenter' | 'host';

export interface EventTalk {
  id: string;
  event_uuid: string;
  title: string;
  synopsis?: string;
  duration_minutes?: number;
  session_type: SessionType;
  status: TalkStatus;
  submitted_at?: string;
  reviewed_at?: string;
  reviewed_by?: string;
  sort_order: number;
  is_featured: boolean;
  event_sponsor_id?: string;
  edit_token: string;
  presentation_url?: string;
  presentation_storage_path?: string;
  presentation_type?: 'link' | 'pdf' | 'powerpoint';
  calendar_added_at?: string;
  tracking_link_copied_at?: string;
  created_at: string;
  updated_at: string;
}

export interface TalkSpeaker {
  speaker_id: string;
  member_profile_id: string;
  role: SpeakerRole;
  is_primary: boolean;
  sort_order: number;
  is_featured: boolean;
  // Joined speaker details
  email?: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  company?: string;
  job_title?: string;
  linkedin_url?: string;
  avatar_url?: string;
  speaker_bio?: string;
  speaker_title?: string;
  company_logo_storage_path?: string;
  company_logo_url?: string;
}

export interface EventTalkWithSpeakers extends EventTalk {
  speakers: TalkSpeaker[];
  sponsor_name?: string;
  sponsor_logo_url?: string;
  sponsor_tier?: string;
}

export interface CreateTalkInput {
  event_uuid: string;
  title: string;
  synopsis?: string;
  duration_minutes?: number;
  session_type?: SessionType;
  status?: TalkStatus;
  submitted_at?: string;
  sort_order?: number;
  is_featured?: boolean;
  event_sponsor_id?: string;
}

export interface UpdateTalkInput {
  title?: string;
  synopsis?: string;
  duration_minutes?: number | null;
  session_type?: SessionType;
  status?: TalkStatus;
  reviewed_at?: string;
  reviewed_by?: string;
  sort_order?: number;
  is_featured?: boolean;
  event_sponsor_id?: string | null;
}

export interface TalkSpeakerInput {
  speaker_id: string;
  role: SpeakerRole;
  is_primary?: boolean;
  sort_order?: number;
}

export class TalkService {
  // ============ TALK CRUD ============

  static async getTalksByEvent(eventUuid: string, status?: TalkStatus | TalkStatus[]): Promise<EventTalkWithSpeakers[]> {
    let query = supabase
      .from('event_talks_with_speakers')
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
      console.error('Error fetching event talks:', error);
      throw error;
    }

    return (data || []).map(this.mapTalkWithSpeakers);
  }

  static async getTalkById(talkId: string): Promise<EventTalkWithSpeakers | null> {
    const { data, error } = await supabase
      .from('event_talks_with_speakers')
      .select('*')
      .eq('id', talkId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('Error fetching talk:', error);
      throw error;
    }

    return this.mapTalkWithSpeakers(data);
  }

  static async getTalkByEditToken(token: string): Promise<EventTalkWithSpeakers | null> {
    const { data, error } = await supabase
      .from('event_talks_with_speakers')
      .select('*')
      .eq('edit_token', token)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('Error fetching talk by edit token:', error);
      throw error;
    }

    return this.mapTalkWithSpeakers(data);
  }

  static async createTalk(input: CreateTalkInput): Promise<EventTalk> {
    const { data, error } = await supabase
      .from('event_talks')
      .insert([{
        event_uuid: input.event_uuid,
        title: input.title,
        synopsis: input.synopsis,
        duration_minutes: input.duration_minutes,
        session_type: input.session_type ?? 'talk',
        status: input.status ?? 'draft',
        submitted_at: input.submitted_at,
        sort_order: input.sort_order ?? 0,
        is_featured: input.is_featured ?? false,
        event_sponsor_id: input.event_sponsor_id,
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating talk:', error);
      throw error;
    }

    return data;
  }

  static async updateTalk(talkId: string, input: UpdateTalkInput): Promise<EventTalk> {
    const { data, error } = await supabase
      .from('event_talks')
      .update(input)
      .eq('id', talkId)
      .select()
      .single();

    if (error) {
      console.error('Error updating talk:', error);
      throw error;
    }

    return data;
  }

  static async deleteTalk(talkId: string): Promise<void> {
    const { error } = await supabase
      .from('event_talks')
      .delete()
      .eq('id', talkId);

    if (error) {
      console.error('Error deleting talk:', error);
      throw error;
    }
  }

  // ============ TALK-SPEAKER MANAGEMENT ============

  static async addSpeakerToTalk(
    talkId: string,
    speakerId: string,
    role: SpeakerRole = 'presenter',
    isPrimary: boolean = false,
    sortOrder: number = 0
  ): Promise<void> {
    const { error } = await supabase
      .from('event_talk_speakers')
      .insert([{
        talk_id: talkId,
        speaker_id: speakerId,
        role,
        is_primary: isPrimary,
        sort_order: sortOrder,
      }]);

    if (error) {
      console.error('Error adding speaker to talk:', error);
      throw error;
    }
  }

  static async removeSpeakerFromTalk(talkId: string, speakerId: string): Promise<void> {
    const { error } = await supabase
      .from('event_talk_speakers')
      .delete()
      .eq('talk_id', talkId)
      .eq('speaker_id', speakerId);

    if (error) {
      console.error('Error removing speaker from talk:', error);
      throw error;
    }
  }

  static async updateTalkSpeakers(talkId: string, speakers: TalkSpeakerInput[]): Promise<void> {
    // Delete all existing speakers for this talk
    const { error: deleteError } = await supabase
      .from('event_talk_speakers')
      .delete()
      .eq('talk_id', talkId);

    if (deleteError) {
      console.error('Error clearing talk speakers:', deleteError);
      throw deleteError;
    }

    // Add new speakers
    if (speakers.length > 0) {
      const { error: insertError } = await supabase
        .from('event_talk_speakers')
        .insert(
          speakers.map((speaker, index) => ({
            talk_id: talkId,
            speaker_id: speaker.speaker_id,
            role: speaker.role,
            is_primary: speaker.is_primary ?? (index === 0),
            sort_order: speaker.sort_order ?? index,
          }))
        );

      if (insertError) {
        console.error('Error adding speakers to talk:', insertError);
        throw insertError;
      }
    }
  }

  static async updateSpeakerRole(talkId: string, speakerId: string, role: SpeakerRole): Promise<void> {
    const { error } = await supabase
      .from('event_talk_speakers')
      .update({ role })
      .eq('talk_id', talkId)
      .eq('speaker_id', speakerId);

    if (error) {
      console.error('Error updating speaker role:', error);
      throw error;
    }
  }

  // ============ TALK WORKFLOW ============

  static async approveTalk(talkId: string, reviewedBy?: string): Promise<EventTalk> {
    return this.updateTalk(talkId, {
      status: 'approved',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
    });
  }

  static async rejectTalk(talkId: string, reviewedBy?: string): Promise<EventTalk> {
    return this.updateTalk(talkId, {
      status: 'rejected',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
    });
  }

  static async reserveTalk(talkId: string, reviewedBy?: string): Promise<EventTalk> {
    return this.updateTalk(talkId, {
      status: 'reserve',
      reviewed_at: new Date().toISOString(),
      reviewed_by: reviewedBy,
    });
  }

  static async confirmTalk(talkId: string): Promise<EventTalk> {
    return this.updateTalk(talkId, {
      status: 'confirmed',
    });
  }

  /**
   * Generate a confirmation token for a talk
   * Used when approving a talk to allow the speaker to confirm their participation
   */
  static async generateConfirmationToken(talkId: string): Promise<string> {
    const token = crypto.randomUUID();

    const { error } = await supabase
      .from('event_talks')
      .update({ confirmation_token: token })
      .eq('id', talkId);

    if (error) {
      console.error('Error setting confirmation token:', error);
      throw error;
    }

    return token;
  }

  /**
   * Get talk by confirmation token
   */
  static async getTalkByConfirmationToken(token: string): Promise<EventTalkWithSpeakers | null> {
    const { data, error } = await supabase
      .from('event_talks_with_speakers')
      .select('*')
      .eq('confirmation_token', token)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      console.error('Error fetching talk by confirmation token:', error);
      throw error;
    }

    return this.mapTalkWithSpeakers(data);
  }

  // ============ SPEAKER'S TALKS ============

  static async getTalksBySpeaker(speakerId: string): Promise<EventTalkWithSpeakers[]> {
    // First get all talk IDs for this speaker
    const { data: talkSpeakers, error: linkError } = await supabase
      .from('event_talk_speakers')
      .select('talk_id, role, is_primary')
      .eq('speaker_id', speakerId);

    if (linkError) {
      console.error('Error fetching speaker talk links:', linkError);
      throw linkError;
    }

    if (!talkSpeakers || talkSpeakers.length === 0) {
      return [];
    }

    const talkIds = talkSpeakers.map(ts => ts.talk_id);

    // Now get the full talk details
    const { data: talks, error: talksError } = await supabase
      .from('event_talks_with_speakers')
      .select('*')
      .in('id', talkIds)
      .order('created_at', { ascending: false });

    if (talksError) {
      console.error('Error fetching speaker talks:', talksError);
      throw talksError;
    }

    return (talks || []).map(this.mapTalkWithSpeakers);
  }

  static async getTalksByMemberProfile(memberProfileId: string, eventUuid?: string): Promise<EventTalkWithSpeakers[]> {
    // First find the speaker ID for this member profile
    let speakerQuery = supabase
      .from('event_speakers')
      .select('id')
      .eq('member_profile_id', memberProfileId);

    if (eventUuid) {
      speakerQuery = speakerQuery.eq('event_uuid', eventUuid);
    }

    const { data: speakers, error: speakerError } = await speakerQuery;

    if (speakerError) {
      console.error('Error fetching speakers for member:', speakerError);
      throw speakerError;
    }

    if (!speakers || speakers.length === 0) {
      return [];
    }

    // Get talks for all speaker IDs
    const speakerIds = speakers.map(s => s.id);
    const { data: talkSpeakers, error: linkError } = await supabase
      .from('event_talk_speakers')
      .select('talk_id')
      .in('speaker_id', speakerIds);

    if (linkError) {
      console.error('Error fetching talk links:', linkError);
      throw linkError;
    }

    if (!talkSpeakers || talkSpeakers.length === 0) {
      return [];
    }

    const talkIds = [...new Set(talkSpeakers.map(ts => ts.talk_id))];

    // Get full talk details
    const { data: talks, error: talksError } = await supabase
      .from('event_talks_with_speakers')
      .select('*')
      .in('id', talkIds)
      .order('created_at', { ascending: false });

    if (talksError) {
      console.error('Error fetching talks:', talksError);
      throw talksError;
    }

    return (talks || []).map(this.mapTalkWithSpeakers);
  }

  // ============ CONVENIENCE METHODS ============

  static async getPendingTalksByEvent(eventUuid: string): Promise<EventTalkWithSpeakers[]> {
    return this.getTalksByEvent(eventUuid, 'pending');
  }

  static async getApprovedTalksByEvent(eventUuid: string): Promise<EventTalkWithSpeakers[]> {
    return this.getTalksByEvent(eventUuid, 'approved');
  }

  static async getConfirmedTalksByEvent(eventUuid: string): Promise<EventTalkWithSpeakers[]> {
    return this.getTalksByEvent(eventUuid, 'confirmed');
  }

  static async getReserveTalksByEvent(eventUuid: string): Promise<EventTalkWithSpeakers[]> {
    return this.getTalksByEvent(eventUuid, 'reserve');
  }

  static async getTalksBySessionType(eventUuid: string, sessionType: SessionType): Promise<EventTalkWithSpeakers[]> {
    const { data, error } = await supabase
      .from('event_talks_with_speakers')
      .select('*')
      .eq('event_uuid', eventUuid)
      .eq('session_type', sessionType)
      .order('sort_order', { ascending: true });

    if (error) {
      console.error('Error fetching talks by session type:', error);
      throw error;
    }

    return (data || []).map(this.mapTalkWithSpeakers);
  }

  static async getPanelsByEvent(eventUuid: string): Promise<EventTalkWithSpeakers[]> {
    return this.getTalksBySessionType(eventUuid, 'panel');
  }

  // ============ HELPER METHODS ============

  private static mapTalkWithSpeakers(data: any): EventTalkWithSpeakers {
    return {
      id: data.id,
      event_uuid: data.event_uuid,
      title: data.title,
      synopsis: data.synopsis,
      duration_minutes: data.duration_minutes,
      session_type: data.session_type,
      status: data.status,
      submitted_at: data.submitted_at,
      reviewed_at: data.reviewed_at,
      reviewed_by: data.reviewed_by,
      sort_order: data.sort_order,
      is_featured: data.is_featured,
      event_sponsor_id: data.event_sponsor_id,
      edit_token: data.edit_token,
      presentation_url: data.presentation_url,
      presentation_storage_path: data.presentation_storage_path,
      presentation_type: data.presentation_type,
      calendar_added_at: data.calendar_added_at,
      tracking_link_copied_at: data.tracking_link_copied_at,
      created_at: data.created_at,
      updated_at: data.updated_at,
      speakers: data.speakers || [],
      sponsor_name: data.sponsor_name,
      sponsor_logo_url: data.sponsor_logo_url,
      sponsor_tier: data.sponsor_tier,
    };
  }

  /**
   * Get session type display label
   */
  static getSessionTypeLabel(sessionType: SessionType): string {
    const labels: Record<SessionType, string> = {
      talk: 'Talk',
      panel: 'Panel Discussion',
      workshop: 'Workshop',
      lightning: 'Lightning Talk',
      fireside: 'Fireside Chat',
      keynote: 'Keynote',
    };
    return labels[sessionType] || sessionType;
  }

  /**
   * Get speaker role display label
   */
  static getSpeakerRoleLabel(role: SpeakerRole): string {
    const labels: Record<SpeakerRole, string> = {
      presenter: 'Presenter',
      panelist: 'Panelist',
      moderator: 'Moderator',
      co_presenter: 'Co-Presenter',
      host: 'Host',
    };
    return labels[role] || role;
  }

  /**
   * Get count of confirmed talks grouped by duration
   * Used for capacity tracking on speaker submission forms
   */
  static async getConfirmedDurationCounts(eventUuid: string): Promise<Record<number, number>> {
    const { data, error } = await supabase
      .from('event_talks')
      .select('duration_minutes')
      .eq('event_uuid', eventUuid)
      .eq('status', 'confirmed')
      .not('duration_minutes', 'is', null);

    if (error) {
      console.error('Error fetching confirmed duration counts:', error);
      throw error;
    }

    // Count occurrences of each duration
    const counts: Record<number, number> = {};
    for (const talk of data || []) {
      const duration = talk.duration_minutes;
      if (duration !== null) {
        counts[duration] = (counts[duration] || 0) + 1;
      }
    }

    return counts;
  }
}
