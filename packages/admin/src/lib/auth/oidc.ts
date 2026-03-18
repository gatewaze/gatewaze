import type {
  AuthAdapter,
  AuthUser,
  AuthSession,
  SignInCredentials,
  SignInResult,
} from '@gatewaze/shared/types/auth';

interface OIDCConfig {
  issuerUrl: string;
  clientId: string;
  redirectUri: string;
  scopes?: string[];
  roleMapping?: {
    claimPath: string;
    superAdmin: string;
    admin: string;
    editor: string;
  };
}

interface OIDCTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token: string;
  expires_in: number;
  token_type: string;
}

interface OIDCDiscovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  end_session_endpoint?: string;
  jwks_uri: string;
}

export class OIDCAuthAdapter implements AuthAdapter {
  readonly type = 'oidc';
  private config: OIDCConfig;
  private discovery: OIDCDiscovery | null = null;
  private tokenData: OIDCTokenResponse | null = null;
  private currentUser: AuthUser | null = null;
  private stateChangeCallbacks: Set<(user: AuthUser | null) => void> =
    new Set();

  constructor(config: OIDCConfig) {
    this.config = config;
    this.loadStoredSession();
  }

  private async getDiscovery(): Promise<OIDCDiscovery> {
    if (this.discovery) return this.discovery;
    const res = await fetch(
      `${this.config.issuerUrl}/.well-known/openid-configuration`,
    );
    this.discovery = await res.json();
    return this.discovery!;
  }

  private loadStoredSession(): void {
    const stored = localStorage.getItem('gatewaze-oidc-session');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        this.tokenData = parsed.tokenData;
        this.currentUser = parsed.user;
      } catch {
        localStorage.removeItem('gatewaze-oidc-session');
      }
    }
  }

  private saveSession(): void {
    if (this.tokenData && this.currentUser) {
      localStorage.setItem(
        'gatewaze-oidc-session',
        JSON.stringify({
          tokenData: this.tokenData,
          user: this.currentUser,
        }),
      );
    }
  }

  async getSession(): Promise<AuthSession | null> {
    if (!this.tokenData || !this.currentUser) return null;
    return {
      accessToken: this.tokenData.access_token,
      refreshToken: this.tokenData.refresh_token,
      expiresAt: Date.now() + this.tokenData.expires_in * 1000,
      user: this.currentUser,
    };
  }

  async refreshSession(): Promise<AuthSession | null> {
    if (!this.tokenData?.refresh_token) return null;

    const discovery = await this.getDiscovery();
    const res = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.tokenData.refresh_token,
        client_id: this.config.clientId,
      }),
    });

    if (!res.ok) {
      this.tokenData = null;
      this.currentUser = null;
      localStorage.removeItem('gatewaze-oidc-session');
      return null;
    }

    this.tokenData = await res.json();
    this.saveSession();
    return this.getSession();
  }

  async signIn(credentials: SignInCredentials): Promise<SignInResult> {
    if (credentials.method !== 'oidc') {
      return {
        success: false,
        error: 'Only OIDC sign-in is supported with this adapter',
      };
    }

    const discovery = await this.getDiscovery();
    const state = crypto.randomUUID();
    const codeVerifier = crypto.randomUUID() + crypto.randomUUID();

    // Store PKCE verifier
    sessionStorage.setItem('gatewaze-oidc-state', state);
    sessionStorage.setItem('gatewaze-oidc-verifier', codeVerifier);

    // Generate code challenge
    const encoder = new TextEncoder();
    const data = encoder.encode(codeVerifier);
    const digest = await crypto.subtle.digest('SHA-256', data);
    const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const scopes = this.config.scopes ?? ['openid', 'profile', 'email'];
    const authUrl = new URL(discovery.authorization_endpoint);
    authUrl.searchParams.set('client_id', this.config.clientId);
    authUrl.searchParams.set('redirect_uri', this.config.redirectUri);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', scopes.join(' '));
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    window.location.href = authUrl.toString();
    return { success: true, message: 'Redirecting to identity provider...' };
  }

  async handleCallback(code: string, state: string): Promise<SignInResult> {
    const storedState = sessionStorage.getItem('gatewaze-oidc-state');
    const codeVerifier = sessionStorage.getItem('gatewaze-oidc-verifier');

    if (state !== storedState) {
      return { success: false, error: 'Invalid state parameter' };
    }

    sessionStorage.removeItem('gatewaze-oidc-state');
    sessionStorage.removeItem('gatewaze-oidc-verifier');

    const discovery = await this.getDiscovery();
    const res = await fetch(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
        client_id: this.config.clientId,
        code_verifier: codeVerifier ?? '',
      }),
    });

    if (!res.ok) {
      return { success: false, error: 'Token exchange failed' };
    }

    this.tokenData = await res.json();

    // Fetch user info
    const userRes = await fetch(discovery.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${this.tokenData!.access_token}` },
    });
    const userInfo = await userRes.json();

    // Map OIDC claims to AuthUser
    this.currentUser = this.mapUserInfo(userInfo);
    this.saveSession();

    // Notify listeners
    for (const cb of this.stateChangeCallbacks) {
      cb(this.currentUser);
    }

    return { success: true, user: this.currentUser };
  }

  async signOut(): Promise<void> {
    const discovery = await this.getDiscovery();
    this.tokenData = null;
    this.currentUser = null;
    localStorage.removeItem('gatewaze-oidc-session');

    for (const cb of this.stateChangeCallbacks) {
      cb(null);
    }

    if (discovery.end_session_endpoint) {
      window.location.href = `${discovery.end_session_endpoint}?post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`;
    }
  }

  onAuthStateChange(callback: (user: AuthUser | null) => void) {
    this.stateChangeCallbacks.add(callback);
    return {
      unsubscribe: () => {
        this.stateChangeCallbacks.delete(callback);
      },
    };
  }

  async getAccessToken(): Promise<string | null> {
    return this.tokenData?.access_token ?? null;
  }

  private mapUserInfo(userInfo: Record<string, unknown>): AuthUser {
    const roleMapping = this.config.roleMapping;
    let role: AuthUser['role'] = 'editor';

    if (roleMapping) {
      const claims = this.getNestedClaim(userInfo, roleMapping.claimPath);
      const roles = Array.isArray(claims) ? claims : [claims];
      if (roles.includes(roleMapping.superAdmin)) role = 'super_admin';
      else if (roles.includes(roleMapping.admin)) role = 'admin';
      else if (roles.includes(roleMapping.editor)) role = 'editor';
    }

    return {
      id: userInfo.sub as string,
      email: userInfo.email as string,
      name:
        (userInfo.name as string) ??
        (userInfo.preferred_username as string) ??
        (userInfo.email as string),
      role,
      avatarUrl: userInfo.picture as string | undefined,
      isActive: true,
    };
  }

  private getNestedClaim(
    obj: Record<string, unknown>,
    path: string,
  ): unknown {
    return path.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object')
        return (acc as Record<string, unknown>)[key];
      return undefined;
    }, obj);
  }
}
