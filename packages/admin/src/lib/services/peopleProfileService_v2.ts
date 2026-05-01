/**
 * People Profile Service (Updated)
 * Works with customers table as source of truth
 * people_profiles is just a lightweight QR extension
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { generateQrCodeId, generateQrAccessToken } from '../qrCode';

export interface UpdatePersonAttributes {
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  phone?: string;
}

export class PeopleProfileService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get or create people profile for a person
   * This just adds QR capability to an existing person
   */
  async getOrCreatePeopleProfile(customerId: string) {
    const { data, error } = await this.supabase
      .rpc('people_get_or_create_profile', {
        p_person_id: customerId,
      });

    if (error) throw error;

    // Get full profile data with person info
    const { data: profile } = await this.supabase
      .from('people_profiles_with_people')
      .select('*')
      .eq('id', data)
      .single();

    return profile;
  }

  /**
   * Update person attributes (used during registration)
   * This updates the person's profile information
   */
  async updatePersonAttributes(
    customerId: string,
    attributes: UpdatePersonAttributes
  ) {
    const { error } = await this.supabase.rpc('people_update_attributes', {
      p_person_id: customerId,
      p_first_name: attributes.firstName,
      p_last_name: attributes.lastName,
      p_company: attributes.company,
      p_job_title: attributes.jobTitle,
      p_linkedin_url: attributes.linkedinUrl,
      p_phone: attributes.phone,
    });

    if (error) throw error;

    // Return updated person
    const { data: person } = await this.supabase
      .from('people')
      .select('*')
      .eq('id', customerId)
      .single();

    return person;
  }

  /**
   * Get person by QR code
   */
  async getPersonByQrCode(qrCodeId: string) {
    const { data, error } = await this.supabase
      .from('people_profiles_with_people')
      .select('*')
      .eq('qr_code_id', qrCodeId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get person by email
   */
  async getPersonByEmail(email: string) {
    const { data: person } = await this.supabase
      .from('people')
      .select('id')
      .eq('email', email)
      .single();

    if (!person) return null;

    return this.getOrCreatePeopleProfile(person.id);
  }

  /**
   * Get people profile by ID
   */
  async getPeopleProfile(memberProfileId: string) {
    const { data, error } = await this.supabase
      .from('people_profiles_with_people')
      .select('*')
      .eq('id', memberProfileId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Generate new QR access token for person
   */
  async generateNewQrToken(memberProfileId: string) {
    const { token, hash } = generateQrAccessToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { data, error } = await this.supabase
      .from('events_qr_access_tokens')
      .insert({
        people_profile_id: memberProfileId,
        token_hash: hash,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (error) throw error;

    return { ...data, token };
  }

  /**
   * Verify QR access token
   */
  async verifyQrToken(qrCodeId: string, token: string) {
    // Get person
    const person = await this.getPersonByQrCode(qrCodeId);
    if (!person) return { valid: false, member: null };

    // Get token hash
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(token).digest('hex');

    // Verify token
    const { data: tokenData, error } = await this.supabase
      .from('events_qr_access_tokens')
      .select('*')
      .eq('people_profile_id', person.id)
      .eq('token_hash', hash)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !tokenData) {
      return { valid: false, member: person };
    }

    // Update usage
    await this.supabase
      .from('events_qr_access_tokens')
      .update({
        used_count: tokenData.used_count + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', tokenData.id);

    return { valid: true, member: person, tokenData };
  }

  /**
   * Update people profile settings (QR-specific settings only)
   */
  async updatePeopleProfileSettings(
    memberProfileId: string,
    settings: {
      qrEnabled?: boolean;
      profileVisibility?: 'public' | 'event_only' | 'private';
      allowContactSharing?: boolean;
    }
  ) {
    const { data, error } = await this.supabase
      .from('people_profiles')
      .update({
        qr_enabled: settings.qrEnabled,
        profile_visibility: settings.profileVisibility,
        allow_contact_sharing: settings.allowContactSharing,
      })
      .eq('id', memberProfileId)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Delete people profile (removes QR extension, keeps person record)
   * For GDPR: delete person separately if needed
   * Also deletes related event_attendance and event_registrations records
   */
  async deletePeopleProfile(memberProfileId: string) {
    // First, delete event_attendance records (references both people_profiles and event_registrations)
    const { error: attendanceError } = await this.supabase
      .from('events_attendance')
      .delete()
      .eq('people_profile_id', memberProfileId);

    if (attendanceError) throw attendanceError;

    // Then, delete event_registrations records
    const { error: registrationsError } = await this.supabase
      .from('events_registrations')
      .delete()
      .eq('people_profile_id', memberProfileId);

    if (registrationsError) throw registrationsError;

    // Finally, delete the people profile
    const { error } = await this.supabase
      .from('people_profiles')
      .delete()
      .eq('id', memberProfileId);

    if (error) throw error;
    return { success: true };
  }
}
