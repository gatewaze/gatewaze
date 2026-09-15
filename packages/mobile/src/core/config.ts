/**
 * Runtime configuration. All values come from the environment (EXPO_PUBLIC_*
 * vars are inlined at bundle time by Expo). The open-source core ships no
 * brand defaults; a missing value fails loudly at first use rather than
 * silently pointing somewhere wrong.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `[config] ${name} is not set. Configure it in the EAS build profile or .env — the core app ships no defaults.`
    );
  }
  return value;
}

export const config = {
  get apiUrl(): string {
    return required('EXPO_PUBLIC_API_URL', process.env.EXPO_PUBLIC_API_URL).replace(/\/$/, '');
  },
  get supabaseUrl(): string {
    return required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey(): string {
    return required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  },
  /** Set by the EAS profile; used only for display. */
  get appName(): string {
    return process.env.EXPO_PUBLIC_APP_NAME || 'Gatewaze';
  },
};
