/**
 * Resource-server auth for the hosted MCP endpoint
 * (spec-mcp-lfid-access.md §2, §3).
 *
 * Validates Bearer access tokens minted by the platform's MCP
 * authorization server (HS256, shared MCP_TOKEN_SECRET, audience-bound to
 * this endpoint). No token → anonymous (the keyless public profile,
 * unchanged). Valid token → the caller's identity + scope set, which the
 * server factory turns into a scope-gated tool registry.
 */
import jwt from 'jsonwebtoken';

export interface McpIdentity {
  kind: 'oauth';
  subject: string;
  email: string;
  personId: string;
  tier: string;
  authMode: string;
  clientId: string;
  scopes: Set<string>;
}

export interface AuthOutcome {
  identity: McpIdentity | null;
  /** Set when a token was PRESENT but invalid — must 401 with a challenge. */
  invalid?: string;
}

export function authenticate(authorizationHeader: string | null | undefined): AuthOutcome {
  if (!authorizationHeader?.startsWith('Bearer ')) return { identity: null };
  const secret = process.env.MCP_TOKEN_SECRET;
  const audience = (process.env.PUBLIC_MCP_URL ?? '').replace(/\/+$/, '');
  if (!secret || !audience) return { identity: null, invalid: 'token auth not configured on this deployment' };
  try {
    const claims = jwt.verify(authorizationHeader.slice(7), secret, {
      algorithms: ['HS256'],
      audience,
    }) as {
      sub: string; email: string; person_id: string; tier: string;
      auth_mode: string; scope: string; client_id: string;
    };
    return {
      identity: {
        kind: 'oauth',
        subject: claims.sub,
        email: claims.email,
        personId: claims.person_id,
        tier: claims.tier,
        authMode: claims.auth_mode,
        clientId: claims.client_id,
        scopes: new Set((claims.scope ?? '').split(' ').filter(Boolean)),
      },
    };
  } catch (err) {
    return { identity: null, invalid: err instanceof Error ? err.message : 'invalid token' };
  }
}

/** RFC 9728 Protected Resource Metadata body. */
export function protectedResourceMetadata(): Record<string, unknown> {
  const resource = (process.env.PUBLIC_MCP_URL ?? '').replace(/\/+$/, '');
  const as = (process.env.GATEWAZE_AUTH_SERVER_URL ?? process.env.GATEWAZE_API_URL ?? '').replace(/\/+$/, '');
  return {
    resource,
    authorization_servers: [as],
    bearer_methods_supported: ['header'],
    scopes_supported: [],
  };
}

export function wwwAuthenticateChallenge(error?: string, scope?: string): string {
  const resource = (process.env.PUBLIC_MCP_URL ?? '').replace(/\/+$/, '');
  const parts = [`Bearer resource_metadata="${resource}/.well-known/oauth-protected-resource"`];
  if (error) parts.push(`error="${error}"`);
  if (scope) parts.push(`scope="${scope}"`);
  return parts.join(', ');
}
