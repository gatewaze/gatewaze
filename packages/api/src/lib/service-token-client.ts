/**
 * Service-token rotation client used by the worker and scheduler to
 * fetch short-lived tokens for inbound API calls (e.g. webhook
 * receivers). Tokens TTL 5 min; we refresh every 4 min.
 *
 * Exposes:
 *   getCurrentToken() — returns a token, refreshing if needed.
 *   startRotation()   — schedules background refresh; call once at boot.
 *   stopRotation()    — cancels the refresh interval (for shutdown).
 */

import { logger } from './logger.js';

interface CachedToken {
  token: string;
  exp: number; // unix seconds
}

let cached: CachedToken | null = null;
let rotationTimer: NodeJS.Timeout | null = null;

const REFRESH_INTERVAL_MS = 4 * 60 * 1000;

interface ClientConfig {
  apiBase: string; // e.g. http://gatewaze-api:3002
  bootstrapSecret: string;
  service: 'worker' | 'scheduler' | 'module-runner';
}

function getConfig(): ClientConfig | null {
  const apiBase = process.env.GATEWAZE_API_BASE;
  const bootstrapSecret = process.env.SERVICE_BOOTSTRAP_SECRET;
  const service = process.env.GATEWAZE_SERVICE as ClientConfig['service'] | undefined;
  if (!apiBase || !bootstrapSecret || !service) return null;
  return { apiBase, bootstrapSecret, service };
}

async function fetchToken(cfg: ClientConfig): Promise<CachedToken> {
  const res = await fetch(`${cfg.apiBase}/api/internal/issue-token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.bootstrapSecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ service: cfg.service }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`issue-token failed: ${res.status} ${body}`);
  }
  const body = (await res.json()) as { token: string; exp: number };
  return { token: body.token, exp: body.exp };
}

export async function getCurrentToken(): Promise<string | null> {
  const cfg = getConfig();
  if (!cfg) return null;
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - now > 60) return cached.token;
  cached = await fetchToken(cfg);
  return cached.token;
}

export function startRotation(): void {
  const cfg = getConfig();
  if (!cfg || rotationTimer) return;
  rotationTimer = setInterval(() => {
    fetchToken(cfg).then(
      t => {
        cached = t;
      },
      err => {
        logger.warn({ err: (err as Error).message }, 'service-token rotation failed');
      },
    );
  }, REFRESH_INTERVAL_MS);
  // Avoid blocking process shutdown.
  rotationTimer.unref?.();
}

export function stopRotation(): void {
  if (rotationTimer) clearInterval(rotationTimer);
  rotationTimer = null;
  cached = null;
}
