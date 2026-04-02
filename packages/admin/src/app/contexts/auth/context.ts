import { User } from "@/@types/user";
import { createSafeContext } from "@/utils/createSafeContext";

export interface ImpersonationState {
  isImpersonating: boolean;
  originalUser: User | null;
  impersonatedUser: User | null;
  sessionId: string | null;
}

export interface AuthContextType {
  isAuthenticated: boolean;
  isLoading: boolean;
  loading?: boolean;
  isInitialized: boolean;
  errorMessage: string | null;
  user: User | null;
  adminProfile?: any;
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
