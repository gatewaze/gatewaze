/**
 * Slack Invitation API Routes
 *
 * Provides endpoints for managing Slack workspace invitations.
 * Uses a database-backed queue processed by a background worker.
 */

import { type Request, type Response } from 'express';
// SERVICE-ROLE OK: Slack invite queue is a system-managed table the
// scheduler/worker drain on a cron. The route writes to it on behalf
// of the admin user but the table itself is service-role-managed.
import { getSupabase } from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';

export const slackRouter = labeledRouter('jwt');
slackRouter.use(requireJwt());

// Request a Slack invitation
slackRouter.post('/invite', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email || !email.includes('@')) {
      return res.status(400).json({ success: false, error: 'Valid email address is required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const supabase = getSupabase();

    // Check for existing pending invitation
    const { data: existing } = await supabase
      .from('integrations_slack_invitations')
      .select('id, status')
      .eq('email', normalizedEmail)
      .in('status', ['pending', 'processing'])
      .maybeSingle();

    if (existing) {
      return res.json({
        success: true,
        message: 'Invitation already in queue',
        invitationId: existing.id,
        status: existing.status,
      });
    }

    // Add to queue
    const { data: invitation, error } = await supabase
      .from('integrations_slack_invitations')
      .insert({
        email: normalizedEmail,
        status: 'pending',
        metadata: {
          source: 'api',
          ip: req.ip,
          userAgent: req.get('user-agent'),
          timestamp: new Date().toISOString(),
        },
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ success: false, error: 'Failed to queue invitation' });
    }

    // Get pending count
    const { count } = await supabase
      .from('integrations_slack_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    res.json({
      success: true,
      message: 'Slack invitation request received. You will receive an email invitation shortly.',
      invitationId: invitation.id,
      status: 'pending',
      queuePosition: count || 0,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to process invitation request' });
  }
});

// Get invitation status
slackRouter.get('/invitation-status/:id', async (req: Request, res: Response) => {
  try {
    const invitationId = parseInt(req.params.id as string);
    if (isNaN(invitationId)) {
      return res.status(400).json({ success: false, error: 'Invalid invitation ID' });
    }

    const supabase = getSupabase();
    const { data: invitation, error } = await supabase
      .from('integrations_slack_invitations')
      .select('id, email, status, error_message, invited_at, created_at')
      .eq('id', invitationId)
      .single();

    if (error || !invitation) {
      return res.status(404).json({ success: false, error: 'Invitation not found' });
    }

    res.json({ success: true, invitation });
  } catch (error) {
    res.status(500).json({ success: false, error: (error instanceof Error ? error.message : String(error)) });
  }
});

// Queue stats (admin)
slackRouter.get('/queue-stats', async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabase();

    const statuses = ['pending', 'processing', 'sent', 'failed'];
    const stats: Record<string, number> = {};

    for (const status of statuses) {
      const { count } = await supabase
        .from('integrations_slack_invitations')
        .select('*', { count: 'exact', head: true })
        .eq('status', status);
      stats[status] = count || 0;
    }

    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: (error instanceof Error ? error.message : String(error)) });
  }
});

// Pending count
slackRouter.get('/pending-count', async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { count } = await supabase
      .from('integrations_slack_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    res.json({ success: true, pendingCount: count || 0 });
  } catch (error) {
    res.status(500).json({ success: false, error: (error instanceof Error ? error.message : String(error)) });
  }
});
