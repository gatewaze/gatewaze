import type { AuthAdapter } from '@gatewaze/shared/types/auth';

export type {
  AuthAdapter,
  AuthUser,
  AuthSession,
  SignInCredentials,
  SignInResult,
} from '@gatewaze/shared/types/auth';

export async function createAuthAdapter(): Promise<AuthAdapter> {
  const provider = import.meta.env.VITE_AUTH_PROVIDER || 'supabase';

  if (provider === 'oidc') {
    const { OIDCAuthAdapter } = await import('./oidc');
    return new OIDCAuthAdapter({
      issuerUrl: import.meta.env.VITE_OIDC_ISSUER_URL!,
      clientId: import.meta.env.VITE_OIDC_CLIENT_ID!,
      redirectUri: `${window.location.origin}/auth/callback`,
    });
  }

  const { SupabaseAuthAdapter } = await import('./supabase');
  return new SupabaseAuthAdapter(
    import.meta.env.VITE_SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_ANON_KEY!,
  );
}
