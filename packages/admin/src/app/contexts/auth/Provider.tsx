// Import Dependencies
import { useEffect, useReducer, useRef, ReactNode } from "react";

// Local Imports
import { SupabaseAuthService, AdminUser } from "@/utils/supabaseAuth";
import { AuthProvider as AuthContextProvider, AuthContextType } from "./context";
import { User } from "@/@types/user";
import { isHostSession, supabase } from "@/lib/supabase";
import { isEmbedded } from "@/embed/embedMode";
import { ImpersonationService } from "@/utils/impersonationService";

// ----------------------------------------------------------------------

interface AuthAction {
  type:
    | "INITIALIZE"
    | "LOGIN_REQUEST"
    | "LOGIN_SUCCESS"
    | "LOGIN_ERROR"
    | "LOGOUT"
    | "START_IMPERSONATION"
    | "STOP_IMPERSONATION";
  payload?: Partial<AuthContextType>;
}

// Initial state
const initialState: AuthContextType = {
  isAuthenticated: false,
  isLoading: true, // Start as loading
  isInitialized: false,
  errorMessage: null,
  user: null,
  login: async () => {},
  logout: async () => {},
  impersonation: {
    isImpersonating: false,
    originalUser: null,
    impersonatedUser: null,
    sessionId: null,
  },
  startImpersonation: async () => false,
  stopImpersonation: async () => false,
};

const NO_IMPERSONATION: AuthContextType["impersonation"] = {
  isImpersonating: false,
  originalUser: null,
  impersonatedUser: null,
  sessionId: null,
};

function sameProfile(a: User | null, b: User): boolean {
  return (
    !!a &&
    a.id === b.id &&
    a.name === b.name &&
    a.email === b.email &&
    a.role === b.role &&
    a.avatarUrl === b.avatarUrl
  );
}

// Reducer handlers
const reducerHandlers: Record<
  AuthAction["type"],
  (state: AuthContextType, action: AuthAction) => AuthContextType
> = {
  INITIALIZE: (state, action) => ({
    ...state,
    isAuthenticated: action.payload?.isAuthenticated ?? false,
    isInitialized: true,
    isLoading: false,
    user: action.payload?.user ?? null,
    errorMessage: action.payload?.errorMessage ?? null,
    accessDenied: action.payload?.accessDenied ?? false,
  }),

  LOGIN_REQUEST: (state) => ({
    ...state,
    isLoading: true,
    errorMessage: null,
  }),

  LOGIN_SUCCESS: (state, action) => {
    const incoming = action.payload?.user ?? null;
    const impersonating = state.impersonation.isImpersonating;
    // The signed-in (not impersonated) user is originalUser while
    // impersonating, otherwise user.
    const signedIn = impersonating ? state.impersonation.originalUser : state.user;
    if (state.isAuthenticated && incoming && signedIn?.id === incoming.id) {
      // auth-js re-emits SIGNED_IN for the same user (tab focus, token
      // refresh). Nothing changed: keep the same state object so React
      // skips the re-render.
      if (sameProfile(signedIn, incoming)) return state;
      // Same user, edited profile (name, role, avatar): apply it without
      // touching an active impersonation.
      return impersonating
        ? { ...state, impersonation: { ...state.impersonation, originalUser: incoming } }
        : { ...state, user: incoming };
    }
    // A different user (or a first sign-in): a new identity. Any
    // impersonation belonged to the previous user, so it ends, as on LOGOUT.
    return {
      ...state,
      isAuthenticated: true,
      isLoading: false,
      user: incoming,
      errorMessage: null,
      accessDenied: false,
      impersonation: NO_IMPERSONATION,
    };
  },

  LOGIN_ERROR: (state, action) => ({
    ...state,
    isAuthenticated: false,
    errorMessage: action.payload?.errorMessage ?? "An error occurred",
    isLoading: false,
    user: null,
  }),

  LOGOUT: (state, action) => ({
    ...state,
    isAuthenticated: false,
    isLoading: false,
    user: null,
    errorMessage: null,
    accessDenied: action.payload?.accessDenied ?? false,
    impersonation: {
      isImpersonating: false,
      originalUser: null,
      impersonatedUser: null,
      sessionId: null,
    },
  }),

  START_IMPERSONATION: (state, action) => ({
    ...state,
    impersonation: action.payload?.impersonation ?? state.impersonation,
    user: action.payload?.impersonation?.impersonatedUser ?? state.user,
  }),

  STOP_IMPERSONATION: (state, action) => ({
    ...state,
    impersonation: {
      isImpersonating: false,
      originalUser: null,
      impersonatedUser: null,
      sessionId: null,
    },
    user: action.payload?.impersonation?.originalUser ?? state.user,
  }),
};

// Reducer function
const reducer = (
  state: AuthContextType,
  action: AuthAction,
): AuthContextType => {
  const handler = reducerHandlers[action.type];
  return handler ? handler(state, action) : state;
};

// Convert AdminUser to User for context
const adminUserToUser = (adminUser: AdminUser): User => ({
  id: adminUser.id,
  name: adminUser.name,
  email: adminUser.email,
  role: adminUser.role,
  avatarUrl: adminUser.avatar_url,
});

// The local client reads its session from localStorage, so 3s is generous.
// In host-session mode the first getSession() is a round trip to the session
// holder, which may refresh the GoTrue session before answering.
const LOCAL_INIT_TIMEOUT_MS = 3000;
const HOST_SESSION_INIT_TIMEOUT_MS = 10000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  // The auth listener below is registered once, in a mount-only effect, so
  // it must not read `state` (that closure would see the first render's
  // isInitialized=false forever and drop every later sign-in or sign-out).
  // It reads this ref instead, set in the same step as the INITIALIZE
  // dispatch so there is no window between the two.
  const isInitializedRef = useRef(false);
  // The auth (GoTrue) user id behind the current state, as opposed to
  // state.user.id, which is the admin profile id. Lets the listener tell
  // whether an event whose profile lookup failed is about this user.
  const authUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let isInitializing = true;

    // Failsafe timeout — declared first so `initialize()` can reference
    // and clear it from inside its async body.
    const initializeTimeout: NodeJS.Timeout = setTimeout(() => {
      if (mounted) {
        console.warn('Auth initialization timed out, forcing unauthenticated state');
        dispatch({
          type: "INITIALIZE",
          payload: {
            isAuthenticated: false,
            user: null,
            errorMessage: null, // Don't show timeout error to user
          }
        });
        isInitializing = false;
        isInitializedRef.current = true;
      }
    }, isHostSession() ? HOST_SESSION_INIT_TIMEOUT_MS : LOCAL_INIT_TIMEOUT_MS);

    const initialize = async () => {
      try {
        // Quick session check first - don't wait for full auth validation during init
        const { data: { session } } = await supabase.auth.getSession()

        if (!mounted) return;
        clearTimeout(initializeTimeout);

        if (session?.user) {
          // We have a session, get the full user profile
          try {
            const { user: adminUser, error, reason } = await SupabaseAuthService.getCurrentUser();

            if (adminUser && !error) {
              authUserIdRef.current = session.user.id;
              dispatch({
                type: "INITIALIZE",
                payload: {
                  isAuthenticated: true,
                  user: adminUserToUser(adminUser),
                  errorMessage: null,
                }
              });
            } else if (reason === "not_admin" || reason === "no_user") {
              // A definite answer: no admin profile, or no user behind the
              // session. This used to fall through to the fallback below and
              // let a signed-in non-admin into the UI with a default 'admin'
              // role, where RLS refused its data and the feature guards,
              // finding no permissions, sent it to /unauthorized. Now:
              // - standalone, the user stays signed out and the sign-in page
              //   shows why (errorMessage);
              // - embedded, accessDenied makes FeatureGuard send the user to
              //   /unauthorized as before, not to /login, so the host is not
              //   sent round a sign-in loop.
              // Deliberate behaviour change for a signed-in non-admin.
              dispatch({
                type: "INITIALIZE",
                payload: {
                  isAuthenticated: false,
                  user: null,
                  errorMessage: reason === "not_admin" ? error : null,
                  accessDenied: reason === "not_admin",
                }
              });
            } else {
              // The lookup itself failed (network, a transient database
              // error): fall back to basic session info and let the auth
              // listener correct it.
              console.warn('Auth Provider - admin profile lookup failed; using basic session info', error);
              authUserIdRef.current = session.user.id;
              // Fallback to basic session info if profile fetch fails
              dispatch({
                type: "INITIALIZE",
                payload: {
                  isAuthenticated: true,
                  user: {
                    id: session.user.id,
                    name: session.user.email || 'Admin User',
                    email: session.user.email || '',
                    role: 'admin', // Default role
                    avatarUrl: undefined,
                  },
                  errorMessage: error || null,
                }
              });
            }
          } catch (profileError) {
            console.error('Auth Provider - Error getting user profile:', profileError);
            authUserIdRef.current = session.user.id;
            // Fallback to basic session info
            dispatch({
              type: "INITIALIZE",
              payload: {
                isAuthenticated: true,
                user: {
                  id: session.user.id,
                  name: session.user.email || 'Admin User',
                  email: session.user.email || '',
                  role: 'admin', // Default role
                  avatarUrl: undefined,
                },
                errorMessage: null,
              }
            });
          }
        } else {
          dispatch({
            type: "INITIALIZE",
            payload: {
              isAuthenticated: false,
              user: null,
              errorMessage: null,
            }
          });
        }

        // Mark initialization as complete
        isInitializing = false;
        isInitializedRef.current = true;

      } catch (error) {
        if (!mounted) return;
        clearTimeout(initializeTimeout);

        console.error('Auth Provider - Initialization error:', error);
        dispatch({
          type: "INITIALIZE",
          payload: {
            isAuthenticated: false,
            user: null,
            errorMessage: null,
          }
        });
        // Mark initialization as complete even on error
        isInitializing = false;
        isInitializedRef.current = true;
      }
    };

    // Set up auth state listener - but only act on explicit sign in/out events
    const { data: { subscription } } = SupabaseAuthService.onAuthStateChange(
      async (adminUser, outcome, sessionUserId) => {
        if (!mounted) return;

        try {
          // Skip auth state changes during initialization
          if (isInitializing) {
            return;
          }

          // Only process auth state changes after initial setup is complete
          if (!isInitializedRef.current) {
            return;
          }

          if (adminUser) {
            authUserIdRef.current = sessionUserId ?? authUserIdRef.current;
            dispatch({
              type: "LOGIN_SUCCESS",
              payload: {
                user: adminUserToUser(adminUser),
              }
            });
          } else if (outcome === "signed_out" || outcome === "not_admin") {
            authUserIdRef.current = null;
            dispatch({ type: "LOGOUT", payload: { accessDenied: outcome === "not_admin" } });
          } else if (
            outcome === "lookup_failed" &&
            sessionUserId &&
            authUserIdRef.current &&
            sessionUserId !== authUserIdRef.current
          ) {
            // A different user signed in and the check for them failed:
            // never keep showing the previous user's identity. (A check that
            // takes longer than SupabaseAuthService's 1.5s timeout never
            // reaches this listener at all; that skip is pre-existing.)
            authUserIdRef.current = null;
            dispatch({ type: "LOGOUT" });
          }
          // Otherwise 'lookup_failed' for the same user: the check itself
          // failed (network, a transient database error), which says nothing
          // about the session, so the current state stands.
        } catch (error) {
          // Never sign the user out because handling an event failed.
          console.error('Auth state change handling error:', error)
        }
      }
    );

    // Initialize
    initialize();

    return () => {
      mounted = false;
      clearTimeout(initializeTimeout);
      subscription.unsubscribe();
    };
  }, []);

  // Login function (send magic link)
  const login = async (credentials: { email: string }) => {
    dispatch({ type: "LOGIN_REQUEST" });

    try {
      const result = await SupabaseAuthService.sendMagicLink(credentials.email);

      if (result.success) {
        if (result.magicLink) {
          // Unreachable from the browser since the CI direct-link path
          // started requiring x-ci-secret: this app never sends that header
          // and the shared CORS allow-list doesn't admit it. Kept only so
          // the response contract stays handled if the service ever runs in
          // a non-browser harness. Normal CI_MODE stacks take the verifyOnly
          // path (signInWithOtp inside SupabaseAuthService.sendMagicLink).
          window.location.href = result.magicLink;
          return;
        }

        // Clear loading state when magic link is sent successfully
        // The actual authentication will be handled by the auth state listener
        dispatch({
          type: "INITIALIZE", // Use INITIALIZE to clear loading state
          payload: {
            isAuthenticated: false,
            user: null,
            errorMessage: null,
          }
        });
        console.log(result.message);
      } else {
        dispatch({
          type: "LOGIN_ERROR",
          payload: { errorMessage: result.error }
        });
      }
    } catch (error) {
      dispatch({
        type: "LOGIN_ERROR",
        payload: {
          errorMessage: error instanceof Error ? error.message : "Login failed"
        }
      });
    }
  };

  // Logout function
  const logout = async () => {
    try {
      // If impersonating, stop impersonation first
      if (state.impersonation.isImpersonating && state.impersonation.sessionId) {
        await stopImpersonation();
      }

      const { error: signOutError } = await SupabaseAuthService.signOut();
      // The auth state listener will handle the logout dispatch

      // Host-session sign-out that did not reach the session holder: the
      // service has told the user. Do not reload into /login, which would
      // drop that message and could sign them straight back in; the shim's
      // SIGNED_OUT already moved this page to the signed-out state.
      if (signOutError && isHostSession()) {
        dispatch({ type: "LOGOUT" });
        return;
      }

      // Embedded with a host-held session, /login is a host route, not ours.
      // The shim's signOut() has already handed the sign-out to the host's
      // hook, so there is nothing to navigate to here.
      if (isEmbedded() && isHostSession()) {
        dispatch({ type: "LOGOUT" });
        return;
      }

      // Redirect to login page
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout error:', error);
      // Force logout even if signOut fails
      dispatch({ type: "LOGOUT" });
      if (isEmbedded() && isHostSession()) return;
      // Still redirect to login
      window.location.href = '/login';
    }
  };

  // Start impersonating another admin user
  const startImpersonation = async (targetUserId: string): Promise<boolean> => {
    if (!state.user?.id) {
      console.error('No authenticated user');
      return false;
    }

    try {
      const result = await ImpersonationService.startImpersonation(
        state.user.id,
        targetUserId
      );

      if (result.success && result.session && result.impersonatedUser) {
        const impersonatedUser: User = adminUserToUser(result.impersonatedUser);

        dispatch({
          type: "START_IMPERSONATION",
          payload: {
            impersonation: {
              isImpersonating: true,
              originalUser: state.user,
              impersonatedUser,
              sessionId: result.session.id,
            },
          },
        });

        return true;
      }

      return false;
    } catch (error) {
      console.error('Error starting impersonation:', error);
      return false;
    }
  };

  // Stop impersonating and return to original user
  const stopImpersonation = async (): Promise<boolean> => {
    if (!state.impersonation.isImpersonating || !state.impersonation.sessionId || !state.user?.id) {
      return false;
    }

    try {
      // Use the original user's ID to stop impersonation
      const originalUserId = state.impersonation.originalUser?.id || state.user.id;

      const result = await ImpersonationService.stopImpersonation(
        originalUserId,
        state.impersonation.sessionId
      );

      if (result.success) {
        dispatch({
          type: "STOP_IMPERSONATION",
          payload: {
            impersonation: {
              isImpersonating: false,
              originalUser: state.impersonation.originalUser,
              impersonatedUser: null,
              sessionId: null,
            },
          },
        });

        return true;
      }

      return false;
    } catch (error) {
      console.error('Error stopping impersonation:', error);
      return false;
    }
  };

  const contextValue: AuthContextType = {
    ...state,
    login,
    logout,
    startImpersonation,
    stopImpersonation,
  };

  return (
    <AuthContextProvider value={contextValue}>
      {children}
    </AuthContextProvider>
  );
}
