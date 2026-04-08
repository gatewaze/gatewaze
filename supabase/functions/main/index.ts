/**
 * Main Service — Edge Function Router
 *
 * Uses EdgeRuntime.userWorkers to create isolated per-function workers.
 * Each function runs in its own Deno isolate — a broken function cannot
 * crash other functions or the router itself.
 *
 * Functions are discovered automatically from subdirectories containing
 * an index.ts file with a Deno.serve() call.
 */

const FUNCTIONS_DIR = '/home/deno/functions';
const SKIP_DIRS = new Set(['main', '_shared', 'node_modules', '.git']);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Track which functions exist on disk for 404 vs routing
const knownFunctions = new Set<string>();

async function discoverFunctions() {
  try {
    for await (const entry of Deno.readDir(FUNCTIONS_DIR)) {
      if (!entry.isDirectory || SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      try {
        await Deno.stat(`${FUNCTIONS_DIR}/${entry.name}/index.ts`);
        knownFunctions.add(entry.name);
      } catch { /* no index.ts */ }
    }
  } catch (err) {
    console.error('[main] Failed to scan functions directory:', err);
  }
  console.log(`[main] Discovered ${knownFunctions.size} functions`);
}

await discoverFunctions();

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  // Extract function name from path
  let functionName: string | undefined;
  if (pathSegments.length >= 3 && pathSegments[0] === 'functions' && pathSegments[1] === 'v1') {
    functionName = pathSegments[2];
  } else if (pathSegments.length >= 1) {
    functionName = pathSegments[0];
  }

  if (!functionName || !knownFunctions.has(functionName)) {
    return new Response(
      JSON.stringify({ error: `Function not found: ${functionName ?? 'unknown'}` }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }

  try {
    // Create an isolated worker for this function
    const envVars = Object.entries(Deno.env.toObject()).map(
      ([name, value]) => [name, value]
    );

    const worker = await EdgeRuntime.userWorkers.create({
      servicePath: `${FUNCTIONS_DIR}/${functionName}`,
      memoryLimitMb: 256,
      workerTimeoutMs: 300_000, // 5 minutes
      noModuleCache: false,
      envVars,
      forceCreate: false,
    });

    return await worker.fetch(req);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[main] Error in "${functionName}":`, message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
