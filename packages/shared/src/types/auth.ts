export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'super_admin' | 'admin' | 'editor';
  avatarUrl?: string;
  isActive: boolean;
  metadata?: Record<string, unknown>;
}

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  user: AuthUser;
}

export interface AuthAdapter {
  readonly type: string;
  getSession(): Promise<AuthSession | null>;
  refreshSession(): Promise<AuthSession | null>;
  signIn(credentials: SignInCredentials): Promise<SignInResult>;
  signOut(): Promise<void>;
  onAuthStateChange(callback: (user: AuthUser | null) => void): { unsubscribe: () => void };
  getAccessToken(): Promise<string | null>;
  createUser?(email: string, name: string, role: string): Promise<{ userId: string }>;
  updateUser?(userId: string, updates: Partial<AuthUser>): Promise<void>;
  listUsers?(): Promise<AuthUser[]>;
  deleteUser?(userId: string): Promise<void>;
}

export type SignInCredentials =
  | { method: 'magic_link'; email: string }
  | { method: 'password'; email: string; password: string }
  | { method: 'oidc'; provider: string; redirectUri?: string };

export type SignInResult =
  | { success: true; message?: string; user?: AuthUser }
  | { success: false; error: string };
