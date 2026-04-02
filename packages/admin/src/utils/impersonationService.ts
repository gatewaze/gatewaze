/**
 * Admin User Impersonation Service
 * Handles starting and stopping impersonation sessions with audit logging
 */

import { supabase } from '@/lib/supabase';
import { AdminUser } from './supabaseAuth';

export interface ImpersonationSession {
  id: string;
  impersonator_id: string;
  impersonated_id: string;
  started_at: string;
  ended_at: string | null;
  is_active: boolean;
  session_metadata: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface ImpersonationAuditLog {
  id: string;
  session_id: string | null;
  impersonator_id: string;
  impersonated_id: string;
  action: 'started' | 'ended' | 'failed';
  action_metadata: Record<string, any>;
  created_at: string;
}

export interface StartImpersonationResult {
  success: boolean;
  session?: ImpersonationSession;
  impersonatedUser?: AdminUser;
  error?: string;
}

export interface StopImpersonationResult {
  success: boolean;
  error?: string;
}

export class ImpersonationService {
  /**
   * Start impersonating another admin user
   * Only super admins can start impersonation
   */
  static async startImpersonation(
    impersonatorId: string,
    impersonatedId: string
  ): Promise<StartImpersonationResult> {
    try {
      // Validate that users are different
      if (impersonatorId === impersonatedId) {
        return {
          success: false,
          error: 'Cannot impersonate yourself',
        };
      }

      // Get the impersonator's profile to verify they're a super admin
      const { data: impersonator, error: impersonatorError } = await supabase
        .from('admin_profiles')
        .select('role, is_active')
        .eq('id', impersonatorId)
        .single();

      if (impersonatorError || !impersonator) {
        return {
          success: false,
          error: 'Impersonator not found',
        };
      }

      if (impersonator.role !== 'super_admin') {
        await this.logAuditEvent({
          session_id: null,
          impersonator_id: impersonatorId,
          impersonated_id: impersonatedId,
          action: 'failed',
          action_metadata: { reason: 'Not a super admin' },
        });

        return {
          success: false,
          error: 'Only super admins can impersonate other users',
        };
      }

      if (!impersonator.is_active) {
        return {
          success: false,
          error: 'Impersonator account is inactive',
        };
      }

      // Get the target user's profile
      const { data: impersonatedUser, error: impersonatedError } = await supabase
        .from('admin_profiles')
        .select('*')
        .eq('id', impersonatedId)
        .single();

      if (impersonatedError || !impersonatedUser) {
        return {
          success: false,
          error: 'User to impersonate not found',
        };
      }

      if (!impersonatedUser.is_active) {
        return {
          success: false,
          error: 'Cannot impersonate an inactive user',
        };
      }

      // End any existing active impersonation sessions for this impersonator
      await this.endActiveSessionsForImpersonator(impersonatorId);

      // Create new impersonation session
      const { data: session, error: sessionError } = await supabase
        .from('admin_impersonation_sessions')
        .insert({
          impersonator_id: impersonatorId,
          impersonated_id: impersonatedId,
          is_active: true,
          session_metadata: {
            user_agent: navigator.userAgent,
            timestamp: new Date().toISOString(),
          },
        })
        .select()
        .single();

      if (sessionError || !session) {
        await this.logAuditEvent({
          session_id: null,
          impersonator_id: impersonatorId,
          impersonated_id: impersonatedId,
          action: 'failed',
          action_metadata: { error: sessionError?.message },
        });

        return {
          success: false,
          error: 'Failed to create impersonation session',
        };
      }

      // Log successful start
      await this.logAuditEvent({
        session_id: session.id,
        impersonator_id: impersonatorId,
        impersonated_id: impersonatedId,
        action: 'started',
        action_metadata: {},
      });

      return {
        success: true,
        session,
        impersonatedUser: impersonatedUser as AdminUser,
      };
    } catch (error) {
      console.error('Error starting impersonation:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Stop the current impersonation session
   */
  static async stopImpersonation(
    impersonatorId: string,
    sessionId: string
  ): Promise<StopImpersonationResult> {
    try {
      // Get the session to verify it belongs to this impersonator
      const { data: session, error: sessionError } = await supabase
        .from('admin_impersonation_sessions')
        .select('*')
        .eq('id', sessionId)
        .eq('impersonator_id', impersonatorId)
        .eq('is_active', true)
        .single();

      if (sessionError || !session) {
        return {
          success: false,
          error: 'Active impersonation session not found',
        };
      }

      // End the session
      const { error: updateError } = await supabase
        .from('admin_impersonation_sessions')
        .update({
          ended_at: new Date().toISOString(),
          is_active: false,
        })
        .eq('id', sessionId);

      if (updateError) {
        return {
          success: false,
          error: 'Failed to end impersonation session',
        };
      }

      // Log successful end
      await this.logAuditEvent({
        session_id: sessionId,
        impersonator_id: impersonatorId,
        impersonated_id: session.impersonated_id,
        action: 'ended',
        action_metadata: {},
      });

      return {
        success: true,
      };
    } catch (error) {
      console.error('Error stopping impersonation:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Get the current active impersonation session for a user
   */
  static async getActiveSession(
    impersonatorId: string
  ): Promise<ImpersonationSession | null> {
    try {
      const { data, error } = await supabase
        .from('admin_impersonation_sessions')
        .select('*')
        .eq('impersonator_id', impersonatorId)
        .eq('is_active', true)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Error getting active session:', error);
        return null;
      }

      return data;
    } catch (error) {
      console.error('Error getting active session:', error);
      return null;
    }
  }

  /**
   * End all active impersonation sessions for an impersonator
   */
  private static async endActiveSessionsForImpersonator(
    impersonatorId: string
  ): Promise<void> {
    try {
      await supabase
        .from('admin_impersonation_sessions')
        .update({
          ended_at: new Date().toISOString(),
          is_active: false,
        })
        .eq('impersonator_id', impersonatorId)
        .eq('is_active', true);
    } catch (error) {
      console.error('Error ending active sessions:', error);
    }
  }

  /**
   * Log an impersonation audit event
   */
  private static async logAuditEvent(
    event: Omit<ImpersonationAuditLog, 'id' | 'created_at'>
  ): Promise<void> {
    try {
      await supabase.from('admin_impersonation_audit').insert(event);
    } catch (error) {
      console.error('Error logging audit event:', error);
    }
  }

  /**
   * Get impersonation audit logs
   */
  static async getAuditLogs(
    filters?: {
      impersonatorId?: string;
      impersonatedId?: string;
      sessionId?: string;
      limit?: number;
    }
  ): Promise<ImpersonationAuditLog[]> {
    try {
      let query = supabase
        .from('admin_impersonation_audit')
        .select('*')
        .order('created_at', { ascending: false });

      if (filters?.impersonatorId) {
        query = query.eq('impersonator_id', filters.impersonatorId);
      }

      if (filters?.impersonatedId) {
        query = query.eq('impersonated_id', filters.impersonatedId);
      }

      if (filters?.sessionId) {
        query = query.eq('session_id', filters.sessionId);
      }

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error getting audit logs:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting audit logs:', error);
      return [];
    }
  }

  /**
   * Get all impersonation sessions
   */
  static async getAllSessions(
    filters?: {
      impersonatorId?: string;
      impersonatedId?: string;
      isActive?: boolean;
      limit?: number;
    }
  ): Promise<ImpersonationSession[]> {
    try {
      let query = supabase
        .from('admin_impersonation_sessions')
        .select('*')
        .order('started_at', { ascending: false });

      if (filters?.impersonatorId) {
        query = query.eq('impersonator_id', filters.impersonatorId);
      }

      if (filters?.impersonatedId) {
        query = query.eq('impersonated_id', filters.impersonatedId);
      }

      if (filters?.isActive !== undefined) {
        query = query.eq('is_active', filters.isActive);
      }

      if (filters?.limit) {
        query = query.limit(filters.limit);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error getting sessions:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('Error getting sessions:', error);
      return [];
    }
  }
}

export default ImpersonationService;
