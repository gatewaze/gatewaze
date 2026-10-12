import { forwardRef } from 'react';

import { Button, Spinner } from '@/components/ui';
import { SIGN_IN_UNAVAILABLE_MESSAGE } from '@/app/pages/Auth/signInErrors';

/**
 * The two in-between states of a host-session access check, shared by the
 * sign-in page and the embed's access gate: still checking (a spinner), or
 * the session holder could not answer (a message and Retry).
 */
export const HostAccessStatusView = forwardRef<
  HTMLButtonElement,
  { state: 'checking' | 'unavailable'; onRetry: () => void }
>(function HostAccessStatusView({ state, onRetry }, retryRef) {
  if (state === 'checking') {
    return (
      <div className="flex flex-col items-center gap-3 py-2 text-center">
        <Spinner className="size-6" />
        <p className="text-sm text-black dark:text-white">Checking your access…</p>
      </div>
    );
  }
  return (
    <div className="space-y-4 text-center">
      <p className="text-sm text-black dark:text-white">{SIGN_IN_UNAVAILABLE_MESSAGE}</p>
      <Button ref={retryRef} type="button" style={{ width: '100%' }} color="cyan" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
});
