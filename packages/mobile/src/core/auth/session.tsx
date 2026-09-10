/**
 * Session orchestration: restore → sign-in (email OTP) → module
 * onSessionReady hooks → entitlement probes → ready. Re-evaluates on app
 * foreground; flushes the outbox whenever a session is live.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from './supabase';
import { wipeLocalStore } from '../db';
import { clearModuleStore } from '../context';
import { flush } from '../outbox';
import type { EntitlementState, SessionGate } from '../entitlement';

/**
 * The registry and entitlement modules are loaded lazily, not imported at
 * the top.
 *
 * Importing them here would close a require cycle: session -> registry ->
 * generated module list -> a module's index -> '@gatewaze/mobile' (which
 * re-exports useSession) -> session. Under Metro that can leave one of the
 * bindings undefined at load time. Requiring inside the call keeps the
 * graph acyclic.
 */
function registry() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../registry') as typeof import('../registry');
}
function entitlement() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../entitlement') as typeof import('../entitlement');
}

export type SessionStatus =
  | { phase: 'loading' }
  | { phase: 'signedOut'; note?: string }
  | { phase: 'bootstrapping' }
  | { phase: 'blocked'; moduleId: string }
  | { phase: 'ready'; enabled: Record<string, boolean> };

interface SessionContextValue {
  status: SessionStatus;
  requestCode: (email: string) => Promise<void>;
  verifyCode: (email: string, token: string) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: (note?: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within <SessionProvider>');
  return value;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>({ phase: 'loading' });
  const entitlementRef = useRef<EntitlementState | undefined>(undefined);
  const bootstrappingRef = useRef(false);

  const bootstrap = useCallback(async (opts?: { background?: boolean }) => {
    if (bootstrappingRef.current) return;
    bootstrappingRef.current = true;
    try {
      if (!opts?.background) setStatus({ phase: 'bootstrapping' });
      registry().wireOutboxKinds();

      // Offline-tolerant: paint from persisted entitlement first.
      if (!entitlementRef.current) {
        entitlementRef.current = await entitlement().loadPersistedEntitlement();
        if (entitlementRef.current && !opts?.background) {
          setStatus({ phase: 'ready', enabled: entitlementRef.current.enabled });
        }
      }

      const gate: SessionGate = await entitlement().runSessionReadyHooks();
      if (gate.state === 'blocked') {
        setStatus({ phase: 'blocked', moduleId: gate.moduleId });
        return;
      }

      const state = await entitlement().evaluateEntitlement(entitlementRef.current);
      entitlementRef.current = state;
      setStatus({ phase: 'ready', enabled: state.enabled });
      void flush();
    } finally {
      bootstrappingRef.current = false;
    }
  }, []);

  const signOut = useCallback(async (note?: string) => {
    try {
      await getSupabase().auth.signOut();
    } catch {
      // Local sign-out proceeds regardless.
    }
    wipeLocalStore();
    clearModuleStore();
    entitlementRef.current = undefined;
    setStatus({ phase: 'signedOut', note });
  }, []);

  // Initial restore.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await getSupabase().auth.getSession();
      if (cancelled) return;
      if (data.session) {
        void bootstrap();
        return;
      }
      // Development convenience: sign in automatically so rebuilding the
      // simulator does not mean retyping an emailed code every time.
      //
      // Safety: these variables live in .env.development, which Expo loads
      // ONLY for development builds — a production/TestFlight build never
      // has them, so the credentials cannot be embedded in a shipped
      // bundle. __DEV__ guards the code path as well.
      const devEmail = process.env.EXPO_PUBLIC_DEV_EMAIL;
      const devPassword = process.env.EXPO_PUBLIC_DEV_PASSWORD;
      if (__DEV__ && devEmail && devPassword) {
        const { error } = await getSupabase().auth.signInWithPassword({
          email: devEmail,
          password: devPassword,
        });
        if (cancelled) return;
        if (!error) {
          void bootstrap();
          return;
        }
        console.warn('[dev auto sign-in] failed:', error.message);
      }
      setStatus({ phase: 'signedOut' });
    })();

    const { data: sub } = getSupabase().auth.onAuthStateChange(
      (_event: string, session: Session | null) => {
        if (_event === 'SIGNED_OUT' || !session) {
          // Auth failures (expired refresh token) land here via the client.
          setStatus((prev) =>
            prev.phase === 'signedOut' ? prev : { phase: 'signedOut', note: 'Session expired' }
          );
        }
      }
    );
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [bootstrap]);

  // Re-evaluate on foreground (a trainer enabling a module appears without
  // an app update — the code was already in the binary).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && statusRef.current.phase === 'ready') {
        void bootstrap({ background: true });
      }
    });
    return () => sub.remove();
  }, [bootstrap]);

  const statusRef = useRef(status);
  statusRef.current = status;

  const requestCode = useCallback(async (email: string) => {
    const { error } = await getSupabase().auth.signInWithOtp({ email });
    if (error) throw new Error(error.message);
  }, []);

  const verifyCode = useCallback(
    async (email: string, token: string) => {
      const { error } = await getSupabase().auth.verifyOtp({ email, token, type: 'email' });
      if (error) throw new Error(error.message);
      await bootstrap();
    },
    [bootstrap]
  );

  const refresh = useCallback(() => bootstrap({ background: true }), [bootstrap]);

  return (
    <SessionContext.Provider value={{ status, requestCode, verifyCode, refresh, signOut }}>
      {children}
    </SessionContext.Provider>
  );
}
