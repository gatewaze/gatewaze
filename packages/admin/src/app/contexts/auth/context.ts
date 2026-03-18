import { createContext } from 'react';
import type { AuthUser } from '@gatewaze/shared';

export interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  isInitialized: boolean;
  user: AuthUser | null;
  login: (credentials: { method: 'magic_link' | 'password' | 'oidc'; email?: string; password?: string }) => Promise<{ success: boolean; message?: string; error?: string }>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType | null>(null);

// Backward compatibility alias for ported gatewaze-admin components
export { useAuth as useAuthContext } from './useAuth';
