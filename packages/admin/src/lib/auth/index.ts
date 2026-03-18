export { createAuthAdapter } from './adapter';
export { SupabaseAuthAdapter } from './supabase';
export { OIDCAuthAdapter } from './oidc';
export type {
  AuthAdapter,
  AuthUser,
  AuthSession,
  SignInCredentials,
  SignInResult,
} from '@gatewaze/shared/types/auth';
