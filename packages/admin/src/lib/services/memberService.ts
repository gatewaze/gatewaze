// @ts-nocheck
/**
 * Member Profile Service
 * Handles member profile creation, updates, and QR code generation
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { generateQrCodeId, generateQrAccessToken } from '../qrCode';

export interface CreateMemberProfile {
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

export interface UpdateMemberProfile extends Partial<CreateMemberProfile> {
  id: string;
}

export class MemberService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Create a new member profile with QR code
   */
  async createMemberProfile(data: CreateMemberProfile) {
    // Generate unique QR code ID
    let qrCodeId = generateQrCodeId();

    // Ensure uniqueness
    let attempts = 0;
    while (attempts < 10) {
      const { data: existing } = await this.supabase
        .from('member_profiles')
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

    // Create member profile
    const { data: member, error } = await this.supabase
      .from('member_profiles')
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

    await this.supabase.from('qr_access_tokens').insert({
      member_profile_id: member.id,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    });

    return { ...member, qrToken: token };
  }

  /**
   * Get or create member profile from existing customer
   */
  async getOrCreateFromCustomer(customerCioId: string) {
    const { data, error } = await this.supabase
      .rpc('get_or_create_member_from_customer', {
        p_customer_cio_id: customerCioId,
      });

    if (error) throw error;
    return data;
  }

  /**
   * Get member profile by ID
   */
  async getMemberProfile(id: string) {
    const { data, error } = await this.supabase
      .from('member_profiles')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get member profile by QR code ID
   */
  async getMemberByQrCode(qrCodeId: string) {
    const { data, error } = await this.supabase
      .from('member_profiles')
      .select('*')
      .eq('qr_code_id', qrCodeId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get member profile by email
   */
  async getMemberByEmail(email: string) {
    const { data, error } = await this.supabase
      .from('member_profiles')
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
   * Update member profile
   */
  async updateMemberProfile(id: string, updates: Partial<CreateMemberProfile>) {
    const { data, error } = await this.supabase
      .from('member_profiles')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Generate new QR access token for member
   */
  async generateNewQrToken(memberId: string) {
    const { token, hash } = generateQrAccessToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { data, error } = await this.supabase
      .from('qr_access_tokens')
      .insert({
        member_profile_id: memberId,
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
    // Get member
    const member = await this.getMemberByQrCode(qrCodeId);
    if (!member) return { valid: false, member: null };

    // Get token hash
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(token).digest('hex');

    // Verify token
    const { data: tokenData, error } = await this.supabase
      .from('qr_access_tokens')
      .select('*')
      .eq('member_profile_id', member.id)
      .eq('token_hash', hash)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !tokenData) {
      return { valid: false, member };
    }

    // Update usage
    await this.supabase
      .from('qr_access_tokens')
      .update({
        used_count: tokenData.used_count + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', tokenData.id);

    return { valid: true, member, tokenData };
  }

  /**
   * Delete member profile (GDPR compliance)
   * Also deletes related event_attendance and event_registrations records
   */
  async deleteMemberProfile(id: string) {
    // First, delete event_attendance records (references both member_profiles and event_registrations)
    const { error: attendanceError } = await this.supabase
      .from('event_attendance')
      .delete()
      .eq('member_profile_id', id);

    if (attendanceError) throw attendanceError;

    // Then, delete event_registrations records
    const { error: registrationsError } = await this.supabase
      .from('event_registrations')
      .delete()
      .eq('member_profile_id', id);

    if (registrationsError) throw registrationsError;

    // Finally, delete the member profile
    const { error } = await this.supabase
      .from('member_profiles')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return { success: true };
  }
}
