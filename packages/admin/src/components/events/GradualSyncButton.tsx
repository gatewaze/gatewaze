// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import {
  ArrowPathIcon,
  CheckCircleIcon,
  XCircleIcon,
  CloudArrowUpIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui-legacy';

interface GradualSyncJob {
  id: string;
  event_id: string;
  gradual_eventslug: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  total_registrations: number;
  processed_registrations: number;
  successful_syncs: number;
  failed_syncs: number;
  errors: Array<{ registrationId: string; email: string; error: string }>;
  created_at: string;
  updated_at: string;
}

// Shared hook for Gradual sync state
export function useGradualSync(eventId: string, gradualEventslug: string | null | undefined, onComplete?: () => void) {
  const [job, setJob] = useState<GradualSyncJob | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  const isActive = job && (job.status === 'pending' || job.status === 'processing');
  const progress =
    job && job.total_registrations > 0
      ? Math.round((job.processed_registrations / job.total_registrations) * 100)
      : 0;

  // Check for active/recent jobs on mount
  const loadActiveJob = useCallback(async () => {
    const { data } = await supabase
      .from('gradual_sync_jobs')
      .select('*')
      .eq('event_id', eventId)
      .in('status', ['pending', 'processing'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) {
      setJob(data);
    } else {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      const { data: recentJob } = await supabase
        .from('gradual_sync_jobs')
        .select('*')
        .eq('event_id', eventId)
        .gte('updated_at', oneHourAgo)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (recentJob) setJob(recentJob);
    }
    setReady(true);
  }, [eventId]);

  useEffect(() => {
    loadActiveJob();
  }, [loadActiveJob]);

  // Realtime subscription
  useEffect(() => {
    if (!job || !isActive) return;

    const channel = supabase
      .channel(`gradual-sync-${job.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'gradual_sync_jobs',
          filter: `id=eq.${job.id}`,
        },
        (payload) => {
          setJob(payload.new as GradualSyncJob);
          if (payload.new.status === 'completed') onComplete?.();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [job?.id, isActive, onComplete]);

  // Polling fallback
  useEffect(() => {
    if (!job || !isActive) return;

    const interval = setInterval(async () => {
      const { data } = await supabase
        .from('gradual_sync_jobs')
        .select('*')
        .eq('id', job.id)
        .single();

      if (data) {
        setJob(data);
        if (data.status !== 'pending' && data.status !== 'processing') {
          if (data.status === 'completed') onComplete?.();
          clearInterval(interval);
        }
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [job?.id, isActive, onComplete]);

  const startSync = async () => {
    if (!gradualEventslug) return;
    setLoading(true);

    const { count, error: countError } = await supabase
      .from('event_registrations')
      .select('id', { count: 'exact', head: true })
      .eq('event_id', eventId)
      .eq('status', 'confirmed')
      .is('gradual_synced_at', null);

    if (countError) {
      toast.error('Failed to check registration count');
      setLoading(false);
      return;
    }

    if (!count || count === 0) {
      toast.info('All confirmed registrations are already synced to Gradual');
      setLoading(false);
      return;
    }

    const confirmed = window.confirm(
      `Sync ${count} registration${count !== 1 ? 's' : ''} to Gradual event "${gradualEventslug}"?\n\nThis will create users and register them in Gradual.`
    );

    if (!confirmed) {
      setLoading(false);
      return;
    }

    const { data: newJob, error: jobError } = await supabase
      .from('gradual_sync_jobs')
      .insert({
        event_id: eventId,
        gradual_eventslug: gradualEventslug,
        total_registrations: count,
      })
      .select()
      .single();

    if (jobError || !newJob) {
      toast.error('Failed to create sync job');
      setLoading(false);
      return;
    }

    setJob(newJob);

    const { error: invokeError } = await supabase.functions.invoke('gradual-sync', {
      body: { mode: 'batch_sync', jobId: newJob.id },
    });

    if (invokeError) {
      console.error('Failed to invoke gradual-sync:', invokeError);
      toast.error('Failed to start sync. Check edge function logs.');
    } else {
      toast.success(`Started syncing ${count} registrations to Gradual`);
    }

    setLoading(false);
  };

  const cancelSync = async () => {
    if (!job || !isActive) return;
    if (!window.confirm('Cancel the Gradual sync? Registrations already synced will remain.')) return;

    const { error } = await supabase
      .from('gradual_sync_jobs')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', job.id);

    if (error) {
      toast.error('Failed to cancel sync');
    } else {
      setJob({ ...job, status: 'cancelled' });
      toast.info('Sync cancelled');
    }
  };

  const dismiss = () => setJob(null);

  return { job, loading, ready, isActive: !!isActive, progress, startSync, cancelSync, dismiss };
}

// Button component — place in the action buttons row
interface GradualSyncButtonProps {
  gradualEventslug: string | null | undefined;
  loading: boolean;
  isActive: boolean;
  progress: number;
  onSync: () => void;
}

export const GradualSyncButton = ({ gradualEventslug, loading, isActive, progress, onSync }: GradualSyncButtonProps) => {
  if (!gradualEventslug) return null;

  return (
    <Button
      variant="outlined"
      color="primary"
      className="gap-1.5 text-sm"
      onClick={onSync}
      disabled={isActive || loading}
    >
      {loading ? (
        <ArrowPathIcon className="h-4 w-4 animate-spin" />
      ) : (
        <CloudArrowUpIcon className="h-4 w-4" />
      )}
      {isActive ? `Syncing (${progress}%)` : 'Sync to Gradual'}
    </Button>
  );
};

// Status component — place below LumaUploadStatus
interface GradualSyncStatusProps {
  job: GradualSyncJob | null;
  isActive: boolean;
  progress: number;
  onCancel: () => void;
  onDismiss: () => void;
}

export const GradualSyncStatus = ({ job, isActive, progress, onCancel, onDismiss }: GradualSyncStatusProps) => {
  if (!job) return null;

  const isCompleted = job.status === 'completed';
  const isFailed = job.status === 'failed';
  const isCancelled = job.status === 'cancelled';

  if (!isActive && !isCompleted && !isFailed && !isCancelled) return null;

  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800 overflow-hidden">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {isActive && <ArrowPathIcon className="h-5 w-5 text-blue-500 animate-spin shrink-0" />}
          {isCompleted && <CheckCircleIcon className="h-5 w-5 text-green-500 shrink-0" />}
          {(isFailed || isCancelled) && <XCircleIcon className="h-5 w-5 text-red-500 shrink-0" />}

          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {isActive && `Syncing to Gradual (${progress}%)`}
              {isCompleted && 'Gradual Sync Complete'}
              {isFailed && 'Gradual Sync Failed'}
              {isCancelled && 'Gradual Sync Cancelled'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {job.processed_registrations} / {job.total_registrations} processed
              {job.successful_syncs > 0 && ` · ${job.successful_syncs} synced`}
              {job.failed_syncs > 0 && ` · ${job.failed_syncs} failed`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-4">
          {isActive ? (
            <button
              onClick={onCancel}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors"
              title="Cancel sync"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          ) : (
            <button
              onClick={onDismiss}
              className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title="Dismiss"
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {isActive && (
        <div className="h-1 bg-gray-200 dark:bg-gray-700">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Error details */}
      {job.failed_syncs > 0 && job.errors.length > 0 && !isActive && (
        <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-2">
          <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">
            Failed registrations ({job.failed_syncs}):
          </p>
          <div className="max-h-24 overflow-y-auto space-y-0.5">
            {job.errors.slice(-10).map((err, i) => (
              <p key={i} className="text-xs text-gray-500 dark:text-gray-400 truncate">
                {err.email}: {err.error}
              </p>
            ))}
            {job.errors.length > 10 && (
              <p className="text-xs text-gray-400 dark:text-gray-500">
                ...and {job.errors.length - 10} more
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
