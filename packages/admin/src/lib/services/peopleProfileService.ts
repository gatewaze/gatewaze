/**
 * People Profile Service
 * Handles people profile creation, updates, and QR code generation
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { generateQrCodeId, generateQrAccessToken } from '../qrCode';

export interface CreatePeopleProfile {
  customerCioId?: string;
  authUserId?: string;
  email: string;
  fullName: string;
  company?: string;
  jobTitle?: string;
  phone?: string;
  linkedinUrl?: string;
  twitterHandle?: string;
  bio?: string;
  avatarSource?: 'uploaded' | 'linkedin' | 'gravatar' | 'customerio';
  avatarStoragePath?: string;
  avatarUrl?: string;
  profileVisibility?: 'public' | 'event_only' | 'private';
}

export interface UpdatePeopleProfile extends Partial<CreatePeopleProfile> {
  id: string;
}

export class PeopleProfileService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a new people profile with QR code
   */
  async createPeopleProfile(data: CreatePeopleProfile) {
    // Generate unique QR code ID
    let qrCodeId = generateQrCodeId();

    // Ensure uniqueness
    let attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await this.supabase
        .from('people_profiles')
        .select('id')
        .eq('qr_code_id', qrCodeId)
        .single();

      if (!existing) break;

      qrCodeId = generateQrCodeId();
      attempts++;
    }

    if (attempts >= 10) {
      throw new Error('Failed to generate unique QR code ID');
    }

    // Create people profile
    const { data: profile, error } = await this.supabase
      .from('people_profiles')
      .insert({
        ...data,
        qr_code_id: qrCodeId,
      })
      .select()
      .single();

    if (error) throw error;

    // Generate initial QR access token
    const { token, hash } = generateQrAccessToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

    await this.supabase.from('events_qr_access_tokens').insert({
      people_profile_id: profile.id,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    });

    return { ...profile, qrToken: token };
  }

  /**
   * Get or create people profile from existing customer
   */
  async getOrCreateFromCustomer(customerCioId: string) {
    const { data, error } = await this.supabase
      .rpc('people_get_or_create_profile', {
        p_customer_cio_id: customerCioId,
      });

    if (error) throw error;
    return data;
  }

  /**
   * Get people profile by ID
   */
  async getPeopleProfile(id: string) {
    const { data, error } = await this.supabase
      .from('people_profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get person by QR code ID
   */
  async getPersonByQrCode(qrCodeId: string) {
    const { data, error } = await this.supabase
      .from('people_profiles')
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
    const { data, error } = await this.supabase
      .from('people_profiles')
      .select('*')
      .eq('email', email)
      .single();

    if (error) {
      if (error.code === 'PGRST116') return null; // Not found
      throw error;
    }
    return data;
  }

  /**
   * Update people profile
   */
  async updatePeopleProfile(id: string, updates: Partial<CreatePeopleProfile>) {
    const { data, error } = await this.supabase
      .from('people_profiles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Generate new QR access token for person
   */
  async generateNewQrToken(memberId: string) {
    const { token, hash } = generateQrAccessToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { data, error } = await this.supabase
      .from('events_qr_access_tokens')
      .insert({
        people_profile_id: memberId,
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
   * Delete people profile (GDPR compliance)
   * Also deletes related event_attendance and event_registrations records
   */
  async deletePeopleProfile(id: string) {
    // First, delete event_attendance records (references both people_profiles and event_registrations)
    const { error: attendanceError } = await this.supabase
      .from('events_attendance')
      .delete()
      .eq('people_profile_id', id);

    if (attendanceError) throw attendanceError;

    // Then, delete event_registrations records
    const { error: registrationsError } = await this.supabase
      .from('events_registrations')
      .delete()
      .eq('people_profile_id', id);

    if (registrationsError) throw registrationsError;

    // Finally, delete the people profile
    const { error } = await this.supabase
      .from('people_profiles')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return { success: true };
  }
}
