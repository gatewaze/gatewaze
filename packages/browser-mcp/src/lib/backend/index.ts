import { type BrowserBackend } from './types.js';
import { LocalBackend } from './local.js';
import { BrowserbaseBackend, BROWSERBASE_REGIONS, type BrowserbaseRegion } from './browserbase.js';

export { type BrowserBackend } from './types.js';

/**
 * Pick the browser backend from env. Default is `local` (in-infra Chromium),
 * so existing registrations with no BROWSER_MCP_BACKEND are unchanged.
 * Throws a descriptive error on misconfiguration (index.ts converts that to a
 * clean process exit, mirroring api-mcp's startup validation).
 */
export function resolveBackend(env: NodeJS.ProcessEnv): BrowserBackend {
  const backend = (env.BROWSER_MCP_BACKEND ?? 'local').toLowerCase();

  if (backend === 'local') return new LocalBackend();

  if (backend === 'browserbase') {
    const apiKey = env.BROWSERBASE_API_KEY;
    const projectId = env.BROWSERBASE_PROJECT_ID;
    if (!apiKey || !projectId) {
      throw new Error(
        'BROWSER_MCP_BACKEND=browserbase requires BROWSERBASE_API_KEY and BROWSERBASE_PROJECT_ID',
      );
    }
    const rawRegion = env.BROWSERBASE_REGION;
    if (rawRegion && !BROWSERBASE_REGIONS.includes(rawRegion as BrowserbaseRegion)) {
      throw new Error(
        `BROWSERBASE_REGION '${rawRegion}' invalid (expected one of: ${BROWSERBASE_REGIONS.join(', ')})`,
      );
    }
    return new BrowserbaseBackend({
      apiKey,
      projectId,
      contextId: env.BROWSERBASE_CONTEXT_ID || undefined,
      region: (rawRegion as BrowserbaseRegion) || undefined,
    });
  }

  throw new Error(`Unknown BROWSER_MCP_BACKEND '${backend}' (expected 'local' or 'browserbase')`);
}
