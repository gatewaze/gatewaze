import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { AuthUser, AuthAdapter } from '@gatewaze/shared';
import { AuthContext } from './context';
import { createAuthAdapter } from '@/lib/auth/adapter';

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  user: AuthUser | null;
}

type AuthAction =
  | { type: 'INITIALIZE'; payload: { isAuthenticated: boolean; user: AuthUser | null } }
  | { type: 'LOGIN_REQUEST' }
  | { type: 'LOGIN_SUCCESS'; payload: { user: AuthUser } }
  | { type: 'LOGIN_ERROR' }
  | { type: 'LOGOUT' };

const initialState: AuthState = {
  isAuthenticated: false,
  isLoading: true,
  isInitialized: false,
  user: null,
};

function reducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'INITIALIZE':
      return {
        ...state,
        isAuthenticated: action.payload.isAuthenticated,
        isLoading: false,
        isInitialized: true,
        user: action.payload.user,
      };
    case 'LOGIN_REQUEST':
      return { ...state, isLoading: true };
    case 'LOGIN_SUCCESS':
      return {
        ...state,
        isAuthenticated: true,
        isLoading: false,
        user: action.payload.user,
      };
    case 'LOGIN_ERROR':
      return { ...state, isLoading: false };
    case 'LOGOUT':
      return {
        ...state,
        isAuthenticated: false,
        isLoading: false,
        user: null,
      };
    default:
      return state;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const adapterRef = useRef<AuthAdapter | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const init = async () => {
      try {
        const adapter = await createAuthAdapter();
        adapterRef.current = adapter;

        const session = await adapter.getSession();

        if (mounted) {
          initializedRef.current = true;
          dispatch({
            type: 'INITIALIZE',
            payload: {
              isAuthenticated: !!session,
              user: session?.user ?? null,
            },
          });
        }

        adapter.onAuthStateChange((user: AuthUser | null) => {
          if (!mounted) return;
          if (user) {
            dispatch({ type: 'LOGIN_SUCCESS', payload: { user } });
          } else {
            dispatch({ type: 'LOGOUT' });
          }
        });
      } catch {
        if (mounted) {
          initializedRef.current = true;
          dispatch({
            type: 'INITIALIZE',
            payload: { isAuthenticated: false, user: null },
          });
        }
      }
    };

    // Timeout fallback — use ref to avoid stale closure over state
    const timeout = setTimeout(() => {
      if (mounted && !initializedRef.current) {
        dispatch({
          type: 'INITIALIZE',
          payload: { isAuthenticated: false, user: null },
        });
      }
    }, 5000);

    init();

    return () => {
      mounted = false;
      clearTimeout(timeout);
    };
  }, []);

  const login = useCallback(
    async (credentials: { method: 'magic_link' | 'password' | 'oidc'; email?: string; password?: string }) => {
      dispatch({ type: 'LOGIN_REQUEST' });

      const adapter = adapterRef.current;
      if (!adapter) {
        dispatch({ type: 'LOGIN_ERROR' });
        return { success: false, error: 'Auth adapter not initialized' };
      }

      let signInCredentials;
      if (credentials.method === 'magic_link') {
        signInCredentials = { method: 'magic_link' as const, email: credentials.email! };
      } else if (credentials.method === 'password') {
        signInCredentials = { method: 'password' as const, email: credentials.email!, password: credentials.password! };
      } else {
        signInCredentials = { method: 'oidc' as const, provider: 'default' };
      }

      const result = await adapter.signIn(signInCredentials);

      if (result.success) {
        if (result.user) {
          dispatch({ type: 'LOGIN_SUCCESS', payload: { user: result.user } });
        } else {
          // Magic link sent — not yet authenticated
          dispatch({ type: 'LOGIN_ERROR' });
        }
        return { success: true, message: result.message };
      } else {
        dispatch({ type: 'LOGIN_ERROR' });
        return { success: false, error: result.error };
      }
    },
    [],
  );

  const logout = useCallback(async () => {
    const adapter = adapterRef.current;
    if (adapter) {
      await adapter.signOut();
    }
    dispatch({ type: 'LOGOUT' });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
