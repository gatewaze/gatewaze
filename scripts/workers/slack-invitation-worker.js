import { supabase } from '../supabase-client.js';
import { SlackInvitationManager } from '../scrapers/SlackInvitationManager.js';

// Worker state
let isProcessingQueue = false;
let invitationManager = null;

/**
 * Process the Slack invitation queue
 * Continuously processes pending invitations until queue is empty
 */
export async function processQueue() {
  // Prevent multiple processors from running
  if (isProcessingQueue) {
    console.log('⚠️  Queue processor already running');
    return;
  }

  isProcessingQueue = true;
  console.log('🚀 Starting Slack invitation queue processor...');

  try {
    // Initialize invitation manager once
    invitationManager = new SlackInvitationManager({
      workspaceUrl: process.env.SLACK_WORKSPACE_URL,
      adminEmail: process.env.SLACK_ADMIN_EMAIL,
      adminPassword: process.env.SLACK_ADMIN_PASSWORD,
      headless: true
    });

    await invitationManager.initialize();

    // Ensure we're authenticated before starting
    await invitationManager.ensureAuthenticated();

    let processedCount = 0;

    while (true) {
      // Get next pending invitation
      const { data, error } = await supabase
        .rpc('integrations_get_pending_slack_invitations', { limit_count: 1 });

      if (error) {
        console.error('❌ Error getting next invitation:', error);
        break;
      }

      // If no pending invitations, stop processing
      if (!data || data.length === 0) {
        console.log('📋 Queue empty - processor stopping');
        console.log(`✅ Processed ${processedCount} invitations`);
        break;
      }

      const invitation = data[0];
      console.log(`\n📋 Processing invitation ${processedCount + 1} for ${invitation.email} (ID: ${invitation.id})`);

      // Mark as processing
      await updateInvitationStatus(invitation.id, 'processing');

      try {
        // Send the invitation
        const result = await invitationManager.inviteUser(invitation.email);

        if (result.success) {
          // Mark as completed
          await updateInvitationStatus(invitation.id, 'completed', null);
          console.log(`✅ Completed invitation for ${invitation.email}`);
          processedCount++;
        } else if (result.alreadyInvited) {
          // Mark as completed (already invited counts as success)
          await updateInvitationStatus(invitation.id, 'completed', 'User already invited or is a member');
          console.log(`✅ User ${invitation.email} already invited/member`);
          processedCount++;
        } else {
          // Mark as failed
          await updateInvitationStatus(invitation.id, 'failed', result.message);
          console.error(`❌ Failed invitation for ${invitation.email}: ${result.message}`);
        }
      } catch (error) {
        // Mark as failed
        await updateInvitationStatus(invitation.id, 'failed', error.message);
        console.error(`❌ Exception during invitation for ${invitation.email}:`, error.message);
      }

      // Wait 5 seconds between invitations to allow Slack UI to stabilize
      if (data.length > 0) {
        console.log('⏱️  Waiting 5 seconds before next invitation...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

  } catch (error) {
    console.error('❌ Fatal error in queue processor:', error);
  } finally {
    // Cleanup
    if (invitationManager) {
      await invitationManager.cleanup();
      invitationManager = null;
    }

    isProcessingQueue = false;
    console.log('🛑 Queue processor stopped');
  }
}

/**
 * Update invitation status in database
 */
async function updateInvitationStatus(invitationId, status, errorMessage = null) {
  const { error } = await supabase
    .rpc('integrations_update_slack_invitation_status', {
      p_invitation_id: invitationId,
      p_status: status,
      p_error_message: errorMessage
    });

  if (error) {
    console.error('❌ Error updating invitation status:', error);
  }
}

/**
 * Add an invitation to the queue
 */
export async function addToQueue(email, account = 'mlops', metadata = {}) {
  const { data, error } = await supabase
    .rpc('integrations_request_slack_invitation', {
      p_email: email,
      p_account: account,
      p_metadata: metadata
    });

  if (error) {
    console.error('❌ Error adding to queue:', error);
    throw error;
  }

  console.log(`✅ Added ${email} to invitation queue (ID: ${data})`);

  // Note: Queue processor runs automatically in the worker pod every 30 seconds
  // No need to trigger it manually here (API pod doesn't have Puppeteer/Chrome)

  return data;
}

/**
 * Get queue statistics
 */
export async function getQueueStats() {
  const { data, error } = await supabase.rpc('integrations_get_slack_invitation_stats');

  if (error) {
    console.error('❌ Error getting queue stats:', error);
    return [];
  }

  return data || [];
}

/**
 * Get pending invitation count
 */
export async function getPendingCount() {
  const { count, error } = await supabase
    .from('integrations_slack_invitation_queue')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');

  if (error) {
    console.error('❌ Error getting pending count:', error);
    return 0;
  }

  return count || 0;
}

/**
 * Get invitation status by ID
 */
export async function getInvitationStatus(invitationId) {
  const { data, error } = await supabase
    .from('integrations_slack_invitation_queue')
    .select('*')
    .eq('id', invitationId)
    .single();

  if (error) {
    console.error('❌ Error getting invitation status:', error);
    return null;
  }

  return data;
}

/**
 * Manual trigger for queue processing (for testing/admin use)
 */
export async function triggerQueueProcessor() {
  if (isProcessingQueue) {
    return { success: false, message: 'Queue processor already running' };
  }

  processQueue().catch(err => {
    console.error('❌ Queue processor error:', err);
  });

  return { success: true, message: 'Queue processor started' };
}

// Export worker state for monitoring
export function getWorkerStatus() {
  return {
    isProcessing: isProcessingQueue,
    hasManager: invitationManager !== null
  };
}
