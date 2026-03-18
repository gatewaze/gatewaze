// @ts-nocheck
/**
 * Utility to cancel stuck CSV imports
 * Run this from browser console or as an admin utility
 */

import { getBrandSupabase } from '@/lib/supabaseAdmin';

/**
 * Cancel all processing calendar member imports
 * This is useful when imports get stuck in "processing" state
 */
export async function cancelAllProcessingImports() {
  const client = getBrandSupabase();

  if (!client) {
    console.error('Supabase client not available');
    return { success: false, error: 'Supabase not configured' };
  }

  // Update all processing imports to failed
  const { data, error } = await client
    .from('luma_csv_uploads')
    .update({
      status: 'failed',
      errors: [{
        row: 0,
        error: 'Import cancelled manually - was stuck in processing state'
      }],
      processing_completed_at: new Date().toISOString(),
    })
    .eq('csv_type', 'calendar_members_import')
    .eq('status', 'processing')
    .select('id, file_name, processed_rows, row_count');

  if (error) {
    console.error('Error cancelling imports:', error);
    return { success: false, error: error.message };
  }

  console.log(`Cancelled ${data?.length || 0} stuck imports:`, data);
  return { success: true, cancelledCount: data?.length || 0, imports: data };
}

/**
 * Cancel a specific import by ID
 */
export async function cancelImport(uploadId: string) {
  const client = getBrandSupabase();

  if (!client) {
    console.error('Supabase client not available');
    return { success: false, error: 'Supabase not configured' };
  }

  const { data, error } = await client
    .from('luma_csv_uploads')
    .update({
      status: 'failed',
      errors: [{
        row: 0,
        error: 'Import cancelled manually'
      }],
      processing_completed_at: new Date().toISOString(),
    })
    .eq('id', uploadId)
    .select('id, file_name, processed_rows, row_count')
    .single();

  if (error) {
    console.error('Error cancelling import:', error);
    return { success: false, error: error.message };
  }

  console.log('Cancelled import:', data);
  return { success: true, import: data };
}

/**
 * Reset a failed import to allow retry
 */
export async function resetImport(uploadId: string) {
  const client = getBrandSupabase();

  if (!client) {
    console.error('Supabase client not available');
    return { success: false, error: 'Supabase not configured' };
  }

  const { data, error } = await client
    .from('luma_csv_uploads')
    .update({
      status: 'pending',
      processed_rows: 0,
      error_count: 0,
      errors: [],
      registrations_created: 0,
      processing_started_at: null,
      processing_completed_at: null,
    })
    .eq('id', uploadId)
    .select('id, file_name, row_count')
    .single();

  if (error) {
    console.error('Error resetting import:', error);
    return { success: false, error: error.message };
  }

  console.log('Reset import:', data);
  return { success: true, import: data };
}

// Make functions available globally for console access
if (typeof window !== 'undefined') {
  (window as any).cancelAllProcessingImports = cancelAllProcessingImports;
  (window as any).cancelImport = cancelImport;
  (window as any).resetImport = resetImport;
}
