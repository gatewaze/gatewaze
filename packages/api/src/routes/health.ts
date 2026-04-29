import { queueHealth, isQueueConfigured } from '../lib/queue/index.js';
import { labeledRouter } from '../lib/router-registry.js';
// SERVICE-ROLE OK: health probe runs SELECT 1 to verify Postgres is
// reachable. The query itself is trivial and the service-role client
// here is *only* used for that one probe — no row data exposed.
import { getSupabase } from '../lib/supabase.js';

export const healthRouter = labeledRouter('public');

const VERSION = process.env.npm_package_version ?? '1.0.0';

/**
 * Liveness probe: process is up. No dependency checks. Per spec §6.4
 * this should never fail unless the process is wedged — k8s
 * livenessProbe restarts the pod on failure.
 */
healthRouter.get('/health/live', (_req, res) => {
  res.status(200).json({ status: 'live', version: VERSION });
});

/**
 * Readiness probe: process can serve traffic. Checks Postgres + Redis
 * connectivity. Returns 503 on any check failure (k8s readinessProbe
 * pulls the pod out of service).
 */
healthRouter.get('/health/ready', async (_req, res) => {
  const checks: Record<string, 'ok' | 'fail'> = {};
  let allOk = true;

  // Postgres: a SELECT 1 via PostgREST is the cheapest reachable test.
  try {
    const supabase = getSupabase();
    const { error } = await supabase.from('platform_settings').select('key').limit(1);
    if (error) throw error;
    checks.postgres = 'ok';
  } catch {
    checks.postgres = 'fail';
    allOk = false;
  }

  // Redis (queue): if configured, probe; else mark 'fail' so operators
  // know the queue is degraded.
  if (isQueueConfigured()) {
    try {
      const q = await queueHealth();
      checks.redis = q.ok ? 'ok' : 'fail';
      if (!q.ok) allOk = false;
    } catch {
      checks.redis = 'fail';
      allOk = false;
    }
  } else {
    checks.redis = 'fail';
    allOk = false;
  }

  res.status(allOk ? 200 : 503).json({
    status: allOk ? 'ready' : 'not_ready',
    timestamp: new Date().toISOString(),
    version: VERSION,
    checks,
  });
});

/**
 * Legacy /api/health endpoint retained for back-compat. Behaves like
 * /health/ready but always returns 200 (with `status: degraded`) so
 * existing clients don't break. Operators should migrate probes to
 * /health/live and /health/ready.
 */
healthRouter.get('/health', async (_req, res) => {
  const queue = isQueueConfigured()
    ? await queueHealth()
    : { ok: false, latencyMs: 0, error: 'not configured' };
  const overall = queue.ok ? 'ok' : 'degraded';
  res.json({
    status: overall,
    timestamp: new Date().toISOString(),
    version: VERSION,
    checks: { queue },
  });
});
