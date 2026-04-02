/**
 * Impersonation Banner Component
 * Displays a prominent banner when an admin is impersonating another user
 */

import { XMarkIcon, ArrowLeftIcon } from '@heroicons/react/24/outline';
import { useAuthContext } from '@/app/contexts/auth/context';
import { Button } from '@/components/ui';
import { toast } from 'sonner';

export function ImpersonationBanner() {
  const { impersonation, stopImpersonation } = useAuthContext();

  // Don't render if not impersonating
  if (!impersonation.isImpersonating) {
    return null;
  }

  const handleStopImpersonation = async () => {
    try {
      const success = await stopImpersonation();

      if (success) {
        toast.success(
          `Returned to your account as ${impersonation.originalUser?.name || 'admin'}`
        );
      } else {
        toast.error('Failed to stop impersonation');
      }
    } catch (error) {
      toast.error('An error occurred while stopping impersonation');
    }
  };

  return (
    <div className="bg-amber-500 dark:bg-amber-600 text-white shadow-lg">
      <div className="max-w-full mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {/* Warning Icon */}
            <div className="flex-shrink-0">
              <div className="h-8 w-8 rounded-full bg-white/20 flex items-center justify-center">
                <ArrowLeftIcon className="h-5 w-5" />
              </div>
            </div>

            {/* Message */}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">
                You are viewing as another user
              </p>
              <p className="text-xs opacity-90 truncate">
                Currently viewing as:{' '}
                <span className="font-medium">
                  {impersonation.impersonatedUser?.name}
                </span>{' '}
                ({impersonation.impersonatedUser?.email})
              </p>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex-shrink-0">
            <Button
              onClick={handleStopImpersonation}
              size="1"
              className="bg-white/20 hover:bg-white/30 text-white border-white/30 gap-2 whitespace-nowrap"
              variant="outline"
            >
              <XMarkIcon className="h-4 w-4" />
              Exit Impersonation
            </Button>
          </div>
        </div>

        {/* Additional Info */}
        <div className="mt-2 text-xs opacity-75">
          <span className="inline-flex items-center gap-1">
            <svg
              className="h-3 w-3"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Your actions are being logged for security purposes
          </span>
        </div>
      </div>
    </div>
  );
}

export default ImpersonationBanner;
