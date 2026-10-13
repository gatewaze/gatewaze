import { useRef } from 'react';
import { Navigate } from 'react-router-dom';

import { SIGN_IN_UNAVAILABLE_MESSAGE } from '@/app/pages/Auth/signInErrors';
import { useAuthContext } from '@/app/contexts/auth/context';
import { useHostAccessCheck } from '@/hooks/useHostAccessCheck';
import { getHostStatus } from '@/lib/supabase';

import { HostAccessStatusView } from './HostAccessStatusView';
import { LiveAnnouncement } from './LiveAnnouncement';

/**
 * Shown by FeatureGuard inside the embed when the host's session holder has
 * not yet let the user in: the admin check is still running, or the session
 * holder could not answer. Sending the user to /login here would hand the
 * host a sign-in it cannot satisfy, so the embed waits (or offers Retry)
 * instead.
 *
 * Each check is the auth context's recheckAccess(): it asks the session
 * holder and, on ok, resolves the user into auth state itself, so
 * FeatureGuard renders the page and this gate unmounts. It does not rely on
 * the SIGNED_IN event chain, which drops a slow or failed profile lookup; a
 * lookup that fails or times out comes back as unavailable, so the gate
 * always ends on the page or on Retry. The first round is seeded with the
 * answer the Provider just got, so /me is not asked again straight away.
 *
 * A definite answer goes where FeatureGuard would have sent it. The page
 * is never reloaded: inside an embed that would reload the host.
 */
export function HostAccessGate() {
  const { hostAccess, recheckAccess } = useAuthContext();
  const { status, retry } = useHostAccessCheck({
    enabled: true,
    check: recheckAccess ?? getHostStatus,
    initialStatus: hostAccess,
  });
  const regionRef = useRef<HTMLDivElement>(null);
  // Retry removes the focused button; keep focus in the gate, not on <body>.
  const onRetry = () => {
    retry();
    regionRef.current?.focus();
  };

  if (status?.status === 'not_admin') return <Navigate to="/unauthorized" replace />;
  if (status?.status === 'signed_out') return <Navigate to="/login" replace />;

  const state = status?.status === 'unavailable' ? 'unavailable' : 'checking';
  return (
    <div className="flex min-h-[12rem] items-center justify-center p-6">
      <div ref={regionRef} tabIndex={-1} className="w-full max-w-sm outline-none">
        <LiveAnnouncement message={state === 'unavailable' ? SIGN_IN_UNAVAILABLE_MESSAGE : 'Checking your access…'} />
        <HostAccessStatusView state={state} onRetry={onRetry} />
      </div>
    </div>
  );
}
