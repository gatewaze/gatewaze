// @ts-nocheck
/**
 * Member Profile Service (Updated)
 * Works with customers table as source of truth
 * member_profiles is just a lightweight QR extension
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { generateQrCodeId, generateQrAccessToken } from '../qrCode';

export interface UpdateCustomerAttributes {
  firstName?: string;
  lastName?: string;
  company?: string;
  jobTitle?: string;
  linkedinUrl?: string;
  phone?: string;
}

export class MemberService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Get or create member profile for a customer
   * This just adds QR capability to an existing customer
   */
  async getOrCreateMemberProfile(customerId: number) {
    const { data, error } = await this.supabase
      .rpc('get_or_create_member_from_customer', {
        p_customer_id: customerId,
      });

    if (error) throw error;

    // Get full member data with customer info
    const { data: member } = await this.supabase
      .from('member_profiles_with_customers')
      .select('*')
      .eq('id', data)
      .single();

    return member;
  }

  /**
   * Update customer attributes (used during registration)
   * This updates the customer's profile information
   */
  async updateCustomerAttributes(
    customerId: number,
    attributes: UpdateCustomerAttributes
  ) {
    const { error } = await this.supabase.rpc('update_customer_attributes', {
      p_customer_id: customerId,
      p_first_name: attributes.firstName,
      p_last_name: attributes.lastName,
      p_company: attributes.company,
      p_job_title: attributes.jobTitle,
      p_linkedin_url: attributes.linkedinUrl,
      p_phone: attributes.phone,
    });

    if (error) throw error;

    // Return updated customer
    const { data: customer } = await this.supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();

    return customer;
  }

  /**
   * Get member profile by QR code
   */
  async getMemberByQrCode(qrCodeId: string) {
    const { data, error } = await this.supabase
      .from('member_profiles_with_customers')
      .select('*')
      .eq('qr_code_id', qrCodeId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get member profile by customer email
   */
  async getMemberByEmail(email: string) {
    const { data: customer } = await this.supabase
      .from('customers')
      .select('id')
      .eq('email', email)
      .single();

    if (!customer) return null;

    return this.getOrCreateMemberProfile(customer.id);
  }

  /**
   * Get member profile by ID
   */
  async getMemberProfile(memberProfileId: string) {
    const { data, error } = await this.supabase
      .from('member_profiles_with_customers')
      .select('*')
      .eq('id', memberProfileId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Generate new QR access token for member
   */
  async generateNewQrToken(memberProfileId: string) {
    const { token, hash } = generateQrAccessToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const { data, error } = await this.supabase
      .from('qr_access_tokens')
      .insert({
        member_profile_id: memberProfileId,
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
   * Update member profile settings (QR-specific settings only)
   */
  async updateMemberSettings(
    memberProfileId: string,
    settings: {
      qrEnabled?: boolean;
      profileVisibility?: 'public' | 'event_only' | 'private';
      allowContactSharing?: boolean;
    }
  ) {
    const { data, error } = await this.supabase
      .from('member_profiles')
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
   * Delete member profile (removes QR extension, keeps customer)
   * For GDPR: delete customer separately if needed
   * Also deletes related event_attendance and event_registrations records
   */
  async deleteMemberProfile(memberProfileId: string) {
    // First, delete event_attendance records (references both member_profiles and event_registrations)
    const { error: attendanceError } = await this.supabase
      .from('event_attendance')
      .delete()
      .eq('member_profile_id', memberProfileId);

    if (attendanceError) throw attendanceError;

    // Then, delete event_registrations records
    const { error: registrationsError } = await this.supabase
      .from('event_registrations')
      .delete()
      .eq('member_profile_id', memberProfileId);

    if (registrationsError) throw registrationsError;

    // Finally, delete the member profile
    const { error } = await this.supabase
      .from('member_profiles')
      .delete()
      .eq('id', memberProfileId);

    if (error) throw error;
    return { success: true };
  }
}
