import { useCallback, useEffect, useRef, useState } from 'react';

import { NOT_ADMIN_CACHE_MS } from '@/lib/hostSession';
import { getHostStatus, type HostStatus } from '@/lib/supabase';

/** How many times a pending admin check is polled before giving up and offering Retry. */
export const MAX_PENDING_CHECKS = 5;

/**
 * Asks the session holder (host-session mode) whether the signed-in user may
 * use the admin, and keeps asking while the answer can still change:
 *
 * - pending: polled after its Retry-After, at most MAX_PENDING_CHECKS times,
 *   then reported as unavailable so the caller offers Retry.
 * - not_admin: checked once more after NOT_ADMIN_CACHE_MS (defence in depth;
 *   a retrying check answers pending, not not_admin).
 * - a rejected check: reported as unavailable.
 *
 * `status` is null while a check is in flight. `onAccessGranted` runs when a
 * check turns ok after an earlier answer that was not ok; an ok on the first
 * check does not call it, so a caller that navigates cannot loop.
 *
 * Shared by the sign-in page and the embed's access gate so both behave the
 * same way.
 *
 * `check` replaces getHostStatus (the gate passes the auth context's
 * recheckAccess, which also resolves the user on ok). `initialStatus` seeds
 * the first round with an answer the caller already has, so it is not asked
 * for again straight away: a pending seed waits its Retry-After first, an
 * unavailable seed shows Retry.
 */
export function useHostAccessCheck({
  enabled,
  onAccessGranted,
  check = getHostStatus,
  initialStatus,
}: {
  enabled: boolean;
  onAccessGranted?: () => void;
  check?: () => Promise<HostStatus>;
  initialStatus?: HostStatus;
}) {
  const [status, setStatus] = useState<HostStatus | null>(null);
  // Bumped to ask again (a pending poll, the not_admin re-check, or retry()).
  const [round, setRound] = useState(0);
  const pendingChecks = useRef(0);
  const notAdminRechecked = useRef(false);
  const sawNotOk = useRef(false);
  const onAccessGrantedRef = useRef(onAccessGranted);
  onAccessGrantedRef.current = onAccessGranted;
  const checkRef = useRef(check);
  checkRef.current = check;
  // Used for the first round only (round 0; read, not consumed, so a
  // StrictMode re-run of the effect sees it too).
  const seed = useRef(initialStatus);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const checkAgainAfter = (ms: number) => {
      timer = setTimeout(() => {
        if (live) setRound((n) => n + 1);
      }, ms);
    };
    const handle = (next: HostStatus) => {
      if (!live) return;
      if (next.status === 'ok') {
        if (sawNotOk.current) onAccessGrantedRef.current?.();
        setStatus(next);
        return;
      }
      sawNotOk.current = true;
      if (next.status === 'pending') {
        pendingChecks.current += 1;
        if (pendingChecks.current > MAX_PENDING_CHECKS) {
          setStatus({ status: 'unavailable' });
          return;
        }
        setStatus(next);
        checkAgainAfter(next.retryAfterMs);
        return;
      }
      if (next.status === 'not_admin' && !notAdminRechecked.current) {
        notAdminRechecked.current = true;
        checkAgainAfter(NOT_ADMIN_CACHE_MS);
      }
      setStatus(next);
    };
    const seeded = round === 0 ? seed.current : undefined;
    if (seeded) {
      handle(seeded);
    } else {
      checkRef
        .current()
        .then(handle)
        .catch(() => {
          if (live) setStatus({ status: 'unavailable' });
        });
    }
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, round]);

  /** Ask again now, with a fresh pending budget. */
  const retry = useCallback(() => {
    pendingChecks.current = 0;
    setStatus(null);
    setRound((n) => n + 1);
  }, []);

  return { status, setStatus, retry };
}
