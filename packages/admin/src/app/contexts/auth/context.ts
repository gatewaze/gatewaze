import { User } from "@/@types/user";
import type { HostStatus } from "@/lib/hostSession";
import { createSafeContext } from "@/utils/createSafeContext";

export interface ImpersonationState {
  isImpersonating: boolean;
  originalUser: User | null;
  impersonatedUser: User | null;
  sessionId: string | null;
}

export interface AdminProfile {
  id: string;
  email?: string;
  name?: string;
  role?: string;
  avatar_url?: string | null;
  is_active?: boolean;
  permissions?: Record<string, unknown> | null;
  created_at?: string;
  updated_at?: string;
}

export interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  loading?: boolean;
  isInitialized: boolean;
  errorMessage: string | null;
  /**
   * True when the user is signed in but has no admin access: a definite
   * not_admin, from the admin profile lookup (local mode) or from the
   * session holder's /me (host-session mode). Set by INITIALIZE and by a
   * not_admin LOGOUT; any other INITIALIZE, LOGOUT or a new sign-in clears
   * it. FeatureGuard uses it to send an embedded user to /unauthorized
   * instead of /login, so the host is not handed a sign-in it cannot satisfy.
   * Standalone, the user still goes to /login, whose page explains it.
   */
  accessDenied?: boolean;
  /**
   * Host-session mode only: the session holder has not decided yet
   * (pending, its admin check is still running; carries Retry-After) or
   * could not answer (unavailable, including a start-up that timed out).
   * Embedded, FeatureGuard shows an in-embed "Checking your access" or
   * "Retry" state, seeded with this answer, instead of sending the user to
   * /login. Cleared by any later INITIALIZE, LOGOUT or sign-in.
   */
  hostAccess?: Extract<HostStatus, { status: "pending" } | { status: "unavailable" }>;
  /**
   * Host-session mode: ask the session holder again and, on ok, resolve the
   * user into auth state. Settles to the resulting status; a profile lookup
   * that fails or times out comes back as unavailable.
   */
  recheckAccess?: () => Promise<HostStatus>;
  user: User | null;
  adminProfile?: AdminProfile;
  isAdmin?: boolean;
  login: (credentials: { email: string }) => Promise<void>;
  logout: () => Promise<void>;
  impersonation: ImpersonationState;
  startImpersonation: (userId: string) => Promise<boolean>;
  stopImpersonation: () => Promise<boolean>;
}

export const [AuthProvider, useAuthContext] =
  createSafeContext<AuthContextType>(
    "useAuthContext must be used within AuthProvider",
  );
