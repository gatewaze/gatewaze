// Import Dependencies
import { useEffect, useReducer, ReactNode } from "react";

// Local Imports
import { SupabaseAuthService, AdminUser } from "@/utils/supabaseAuth";
import { AuthProvider as AuthContextProvider, AuthContextType } from "./context";
import { User } from "@/@types/user";
import { supabase } from "@/lib/supabase";
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
  }),

  LOGIN_REQUEST: (state) => ({
    ...state,
    isLoading: true,
    errorMessage: null,
  }),

  LOGIN_SUCCESS: (state, action) => ({
    ...state,
    isAuthenticated: true,
    isLoading: false,
    user: action.payload?.user ?? null,
    errorMessage: null,
  }),

  LOGIN_ERROR: (state, action) => ({
    ...state,
    isAuthenticated: false,
    errorMessage: action.payload?.errorMessage ?? "An error occurred",
    isLoading: false,
    user: null,
  }),

  LOGOUT: (state) => ({
    ...state,
    isAuthenticated: false,
    isLoading: false,
    user: null,
    errorMessage: null,
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

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
      }
    }, 3000);

    const initialize = async () => {
      try {
        // Quick session check first - don't wait for full auth validation during init
        const { data: { session } } = await supabase.auth.getSession()

        if (!mounted) return;
        clearTimeout(initializeTimeout);

        if (session?.user) {
          // We have a session, get the full user profile
          try {
            const { user: adminUser, error } = await SupabaseAuthService.getCurrentUser();

            if (adminUser && !error) {
              dispatch({
                type: "INITIALIZE",
                payload: {
                  isAuthenticated: true,
                  user: adminUserToUser(adminUser),
                  errorMessage: null,
                }
              });
            } else {
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
      }
    };

    // Set up auth state listener - but only act on explicit sign in/out events
    const { data: { subscription } } = SupabaseAuthService.onAuthStateChange(
      async (adminUser) => {
        if (!mounted) return;

        try {
          // Skip auth state changes during initialization
          if (isInitializing) {
            return;
          }

          // Only process auth state changes after initial setup is complete
          if (!state.isInitialized) {
            return;
          }

          if (adminUser) {
            dispatch({
              type: "LOGIN_SUCCESS",
              payload: {
                user: adminUserToUser(adminUser),
              }
            });
          } else {
            dispatch({ type: "LOGOUT" });
          }
        } catch (error) {
          console.error('Auth state change handling error:', error)
          // Only logout if we're initialized to avoid interfering with init
          if (state.isInitialized) {
            dispatch({ type: "LOGOUT" });
          }
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
          // CI mode: magic link returned directly — auto-authenticate
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

      await SupabaseAuthService.signOut();
      // The auth state listener will handle the logout dispatch

      // Redirect to login page
      window.location.href = '/login';
    } catch (error) {
      console.error('Logout error:', error);
      // Force logout even if signOut fails
      dispatch({ type: "LOGOUT" });
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

// Export useAuthContext as useAuth for backward compatibility
export { useAuthContext as useAuth } from './context';