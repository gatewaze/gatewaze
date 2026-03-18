import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AuthAdapter,
  AuthUser,
  AuthSession,
  SignInCredentials,
  SignInResult,
} from '@gatewaze/shared/types/auth';
import { getSupabase } from '@/lib/supabase';

export class SupabaseAuthAdapter implements AuthAdapter {
  readonly type = 'supabase';
  private client: SupabaseClient;

  constructor(_supabaseUrl: string, _supabaseAnonKey: string) {
    // Use the singleton Supabase client to avoid session conflicts
    // from multiple clients racing on detectSessionInUrl and localStorage
    this.client = getSupabase();
  }

  async getSession(): Promise<AuthSession | null> {
    const {
      data: { session },
    } = await this.client.auth.getSession();
    if (!session) return null;

    const { data: profile } = await this.client
      .from('admin_profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!profile) return null;

    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token ?? undefined,
      expiresAt: session.expires_at ?? 0,
      user: this.toAuthUser(profile, session.user.id),
    };
  }

  async refreshSession(): Promise<AuthSession | null> {
    const {
      data: { session },
    } = await this.client.auth.refreshSession();
    if (!session) return null;

    const { data: profile } = await this.client
      .from('admin_profiles')
      .select('*')
      .eq('user_id', session.user.id)
      .eq('is_active', true)
      .maybeSingle();

    if (!profile) return null;

    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token ?? undefined,
      expiresAt: session.expires_at ?? 0,
      user: this.toAuthUser(profile, session.user.id),
    };
  }

  async signIn(credentials: SignInCredentials): Promise<SignInResult> {
    if (credentials.method === 'magic_link') {
      // Send magic link via custom edge function (uses DB-stored email config)
      const { data, error } = await this.client.functions.invoke('send-magic-link', {
        body: { email: credentials.email },
      });

      if (error) {
        // Supabase wraps non-2xx as "Edge Function returned a non-2xx status code"
        // Try to get the actual error from the response data
        const detail = (data as { error?: string } | null)?.error;
        return { success: false, error: detail || error.message };
      }

      const result = data as { success?: boolean; error?: string };
      if (result.error) return { success: false, error: result.error };

      return { success: true, message: 'Magic link sent! Check your email.' };
    }

    if (credentials.method === 'password') {
      const { data, error } = await this.client.auth.signInWithPassword({
        email: credentials.email,
        password: credentials.password,
      });

      if (error) return { success: false, error: error.message };

      const { data: profile } = await this.client
        .from('admin_profiles')
        .select('*')
        .eq('user_id', data.user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (!profile) {
        await this.client.auth.signOut();
        return { success: false, error: 'No active admin account found' };
      }

      return { success: true, user: this.toAuthUser(profile, data.user.id) };
    }

    return { success: false, error: 'Unsupported authentication method' };
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
  }

  onAuthStateChange(callback: (user: AuthUser | null) => void) {
    const {
      data: { subscription },
    } = this.client.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        const { data: profile } = await this.client
          .from('admin_profiles')
          .select('*')
          .eq('user_id', session.user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (profile) {
          callback(this.toAuthUser(profile, session.user.id));
        } else {
          callback(null);
        }
      } else if (event === 'SIGNED_OUT') {
        callback(null);
      }
    });

    return { unsubscribe: () => subscription.unsubscribe() };
  }

  async getAccessToken(): Promise<string | null> {
    const {
      data: { session },
    } = await this.client.auth.getSession();
    return session?.access_token ?? null;
  }

  async createUser(
    email: string,
    name: string,
    role: string,
  ): Promise<{ userId: string }> {
    const { data, error } = await this.client.functions.invoke('user-signup', {
      body: { email, name, role },
    });
    if (error) throw new Error(error.message);
    return { userId: data.userId };
  }

  async updateUser(userId: string, updates: Partial<AuthUser>): Promise<void> {
    const { error } = await this.client
      .from('admin_profiles')
      .update({
        name: updates.name,
        role: updates.role,
        avatar_url: updates.avatarUrl,
        is_active: updates.isActive,
      })
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  async listUsers(): Promise<AuthUser[]> {
    const { data, error } = await this.client
      .from('admin_profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((p) => this.toAuthUser(p, p.user_id));
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.client
      .from('admin_profiles')
      .update({ is_active: false })
      .eq('user_id', userId);
    if (error) throw new Error(error.message);
  }

  private toAuthUser(
    profile: Record<string, unknown>,
    userId: string,
  ): AuthUser {
    return {
      id: userId,
      email: profile.email as string,
      name: (profile.name as string) ?? (profile.email as string),
      role: (profile.role as AuthUser['role']) ?? 'editor',
      avatarUrl: profile.avatar_url as string | undefined,
      isActive: (profile.is_active as boolean) ?? true,
    };
  }
}
