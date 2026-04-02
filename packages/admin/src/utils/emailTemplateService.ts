import { supabase } from '@/lib/supabase';
import EmailService from './emailService';

export interface EmailTemplate {
  id: string;
  name: string;
  description?: string;
  subject: string;
  content_html: string;
  created_by_admin_id?: string;
  sendgrid_from_key?: string;
  template_type: 'sponsor_email' | 'member_email' | 'general';
  available_scopes: string[];
  is_active: boolean;
  usage_count: number;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
  // Joined fields
  created_by?: {
    id: string;
    name: string;
    email: string;
  };
}

export interface CreateEmailTemplateInput {
  name: string;
  description?: string;
  subject: string;
  content_html: string;
  created_by_admin_id?: string;
  sendgrid_from_key?: string;
  template_type?: 'sponsor_email' | 'member_email' | 'general' | 'registration_email';
  available_scopes?: string[];
}

export interface UpdateEmailTemplateInput {
  name?: string;
  description?: string;
  subject?: string;
  content_html?: string;
  sendgrid_from_key?: string;
  template_type?: 'sponsor_email' | 'member_email' | 'general' | 'registration_email';
  available_scopes?: string[];
  is_active?: boolean;
}

/**
 * Email Template Service
 * Handles CRUD operations for email templates
 */
class EmailTemplateService {
  /**
   * Get all email templates
   */
  static async getAll(options?: {
    templateType?: string;
    isActive?: boolean;
  }): Promise<EmailTemplate[]> {
    let query = supabase
      .from('email_templates')
      .select(`
        *,
        created_by:admin_profiles(id, name, email)
      `)
      .order('updated_at', { ascending: false });

    if (options?.templateType) {
      query = query.eq('template_type', options.templateType);
    }

    if (options?.isActive !== undefined) {
      query = query.eq('is_active', options.isActive);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching email templates:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Get templates available to a specific admin user
   * This includes:
   * 1. Templates created by the user
   * 2. Templates shared via SendGrid from addresses
   */
  static async getTemplatesForAdmin(
    adminId: string,
    currentFromKey?: string
  ): Promise<EmailTemplate[]> {
    // Build the query to get templates the user can access
    // Don't use join - just get the raw data
    const { data, error } = await supabase
      .from('email_templates')
      .select('*')
      .eq('is_active', true)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching templates for admin:', error);
      throw error;
    }

    console.log('Raw templates from DB:', data);
    console.log('Filtering with adminId:', adminId, 'currentFromKey:', currentFromKey);

    // Filter templates client-side based on access rules
    const templates = (data || []).filter((template: EmailTemplate) => {
      // User's own templates
      if (template.created_by_admin_id === adminId) {
        console.log('Template matched by admin ID:', template.name);
        return true;
      }
      // Templates shared via SendGrid from address
      if (template.sendgrid_from_key && currentFromKey === template.sendgrid_from_key) {
        console.log('Template matched by from key:', template.name, template.sendgrid_from_key);
        return true;
      }
      console.log('Template not matched:', template.name, 'fromKey:', template.sendgrid_from_key, 'vs', currentFromKey);
      return false;
    });

    console.log('Filtered templates:', templates);
    return templates;
  }

  /**
   * Get templates by SendGrid from key
   */
  static async getTemplatesByFromKey(fromKey: string): Promise<EmailTemplate[]> {
    const { data, error } = await supabase
      .from('email_templates')
      .select(`
        *,
        created_by:admin_profiles(id, name, email)
      `)
      .eq('sendgrid_from_key', fromKey)
      .eq('is_active', true)
      .order('updated_at', { ascending: false });

    if (error) {
      console.error('Error fetching templates by from key:', error);
      throw error;
    }

    return data || [];
  }

  /**
   * Get a single template by ID
   */
  static async getById(id: string): Promise<EmailTemplate | null> {
    const { data, error } = await supabase
      .from('email_templates')
      .select(`
        *,
        created_by:admin_profiles(id, name, email)
      `)
      .eq('id', id)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return null; // Not found
      }
      console.error('Error fetching email template:', error);
      throw error;
    }

    return data;
  }

  /**
   * Create a new email template
   */
  static async create(input: CreateEmailTemplateInput): Promise<EmailTemplate> {
    const { data, error } = await supabase
      .from('email_templates')
      .insert({
        name: input.name,
        description: input.description,
        subject: input.subject,
        content_html: input.content_html,
        created_by_admin_id: input.created_by_admin_id,
        sendgrid_from_key: input.sendgrid_from_key,
        template_type: input.template_type || 'sponsor_email',
        available_scopes: input.available_scopes || ['customer', 'sponsor', 'event'],
      })
      .select(`
        *,
        created_by:admin_profiles(id, name, email)
      `)
      .single();

    if (error) {
      console.error('Error creating email template:', error);
      throw error;
    }

    return data;
  }

  /**
   * Update an existing email template
   */
  static async update(id: string, input: UpdateEmailTemplateInput): Promise<EmailTemplate> {
    const { data, error } = await supabase
      .from('email_templates')
      .update({
        ...input,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select(`
        *,
        created_by:admin_profiles(id, name, email)
      `)
      .single();

    if (error) {
      console.error('Error updating email template:', error);
      throw error;
    }

    return data;
  }

  /**
   * Delete an email template
   */
  static async delete(id: string): Promise<void> {
    const { error } = await supabase
      .from('email_templates')
      .delete()
      .eq('id', id);

    if (error) {
      console.error('Error deleting email template:', error);
      throw error;
    }
  }

  /**
   * Increment usage count for a template
   */
  static async incrementUsage(id: string): Promise<void> {
    const { error } = await supabase.rpc('email_increment_template_usage', {
      template_id: id,
    });

    // If RPC doesn't exist, fall back to direct update
    if (error) {
      await supabase
        .from('email_templates')
        .update({
          usage_count: supabase.rpc('increment', { x: 1 }) as any,
          last_used_at: new Date().toISOString(),
        })
        .eq('id', id);
    }
  }

  /**
   * Get the SendGrid from key from a from address string
   * Matches the email part against known SendGrid addresses
   */
  static getFromKeyFromAddress(fromAddress: string): string | null {
    const addresses = EmailService.getFromAddresses();
    const parsed = EmailService.parseEmailAddress(fromAddress);
    const email = parsed.email.toLowerCase();

    for (const [key, value] of Object.entries(addresses)) {
      if (!value) continue;
      const parsedValue = EmailService.parseEmailAddress(value);
      if (parsedValue.email.toLowerCase() === email) {
        return key;
      }
    }

    return null;
  }

  /**
   * Duplicate a template
   */
  static async duplicate(id: string, newName?: string): Promise<EmailTemplate> {
    const original = await this.getById(id);
    if (!original) {
      throw new Error('Template not found');
    }

    return this.create({
      name: newName || `${original.name} (Copy)`,
      description: original.description,
      subject: original.subject,
      content_html: original.content_html,
      created_by_admin_id: original.created_by_admin_id,
      sendgrid_from_key: original.sendgrid_from_key,
      template_type: original.template_type,
      available_scopes: original.available_scopes,
    });
  }
}

export default EmailTemplateService;
