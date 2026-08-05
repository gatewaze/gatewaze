import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createHandler } from './handler.js';
import { Metrics } from './metrics.js';
import { createReadOnlyClient, createSupabaseAssetStore, createSupabaseCatalog } from './supabase.js';

// Arcade Serve — the only application behind PLAY_ORIGIN (spec §3).
// Serves /g/*, /sdk/*, /healthz, /readyz, /metrics and nothing else.

// Fail the container on bad config rather than serving a weakened policy.
const config = (() => {
  try {
    return loadConfig(process.env);
  } catch (err) {
    console.error(`[arcade-serve] invalid configuration: ${err instanceof Error ? err.message : String(err)}`);
    return process.exit(1);
  }
})();

// `sdk/` sits next to `src/` and `dist/`, so this resolves in both dev (tsx) and
// the built image.
const sdkPath = fileURLToPath(new URL('../sdk/gatewaze-arcade.js', import.meta.url));
const sdkSource = (() => {
  let source: string;
  try {
    source = readFileSync(sdkPath, 'utf8');
  } catch (err) {
    console.error(`[arcade-serve] cannot read SDK at ${sdkPath}: ${err instanceof Error ? err.message : String(err)}`);
    return process.exit(1);
  }
  // Pin the served copy's postMessage handshake to this deployment's portal
  // origin. Without it the SDK can only shape-check the host origin and leans
  // entirely on `frame-ancestors`; CSP should be defence in depth, not the only
  // control. A vendored copy keeps the placeholder and runs in local mode.
  const PLACEHOLDER = '__GATEWAZE_PORTAL_ORIGIN__';
  if (!source.includes(PLACEHOLDER)) {
    console.error('[arcade-serve] SDK is missing the portal-origin placeholder; refusing to serve an unpinned SDK');
    return process.exit(1);
  }
  return source.split(PLACEHOLDER).join(config.portalOrigin);
})();

const client = createReadOnlyClient(config);
const metrics = new Metrics();
const handler = createHandler({
  config,
  catalog: createSupabaseCatalog(client, config),
  assets: createSupabaseAssetStore(client, config),
  sdkSource,
  metrics,
});

const server = createServer(handler);
server.listen(config.port, () => {
  console.log(
    JSON.stringify({
      svc: 'arcade-serve',
      msg: 'listening',
      port: config.port,
      playOrigin: config.playOrigin,
      portalOrigin: config.portalOrigin,
      bucket: config.storageBucket,
      cacheTtlMs: config.cacheTtlMs,
      previewSecrets: config.previewSecrets.length,
    }),
  );
});

function shutdown(signal: string) {
  console.log(JSON.stringify({ svc: 'arcade-serve', msg: 'shutting down', signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
