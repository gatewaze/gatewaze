import type { DeploymentStrategy, DeployFunctionRequest, DeployFunctionResult } from './types';

/**
 * Local Filesystem Strategy — DEVELOPMENT ONLY
 *
 * Deploys edge functions by writing files to a shared Docker volume.
 * The edge runtime's main service uses EdgeRuntime.userWorkers.create()
 * to load functions from disk on demand — no restart or reload is needed.
 */
export class LocalFilesystemStrategy implements DeploymentStrategy {
  async deploy(_request: DeployFunctionRequest): Promise<DeployFunctionResult> {
    // File copying is handled by the caller (deployEdgeFunctions) for local/k8s
    return { functionName: _request.functionName, success: true };
  }

  async remove(functionName: string): Promise<DeployFunctionResult> {
    // File removal is handled by the caller
    return { functionName, success: true };
  }

  async reload(): Promise<void> {
    const reloadUrl = process.env.EDGE_RUNTIME_RELOAD_URL;
    const reloadToken = process.env.EDGE_RUNTIME_RELOAD_TOKEN;
    const pidFile = process.env.EDGE_RUNTIME_PID_FILE;

    if (reloadUrl) {
      // Mechanism A: HTTP reload endpoint (preferred)
      if (!reloadToken) {
        console.warn('[modules] EDGE_RUNTIME_RELOAD_URL is set but EDGE_RUNTIME_RELOAD_TOKEN is missing');
      }

      const maxRetries = 2;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(reloadUrl, {
            method: 'POST',
            headers: {
              ...(reloadToken ? { 'X-Edge-Reload-Token': reloadToken } : {}),
            },
            signal: AbortSignal.timeout(5000),
          });

          if (response.ok) {
            console.log('[modules] Edge runtime reloaded via HTTP');
            return;
          }

          console.warn(`[modules] Edge runtime reload failed (attempt ${attempt + 1}/${maxRetries + 1}): HTTP ${response.status}`);
        } catch (err) {
          console.warn(`[modules] Edge runtime reload failed (attempt ${attempt + 1}/${maxRetries + 1}):`, err instanceof Error ? err.message : err);
        }

        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, Math.pow(2, attempt) * 1000));
        }
      }

      throw new Error('EDGE_RELOAD_UNAVAILABLE: Failed to reload edge runtime via HTTP after retries');
    }

    if (pidFile) {
      // Mechanism B: POSIX signal (Docker Compose only)
      if (process.env.KUBERNETES_SERVICE_HOST) {
        throw new Error(
          'EDGE_RELOAD_UNAVAILABLE: EDGE_RUNTIME_PID_FILE is set but Kubernetes detected. ' +
          'PID-based reload is not reliable in Kubernetes. Use EDGE_RUNTIME_RELOAD_URL instead.'
        );
      }

      try {
        const { readFileSync } = await import('fs');
        const pid = parseInt(readFileSync(pidFile, 'utf-8').trim(), 10);
        if (isNaN(pid)) {
          throw new Error(`Invalid PID in ${pidFile}`);
        }
        process.kill(pid, 'SIGHUP');
        console.log(`[modules] Edge runtime reloaded via SIGHUP (PID ${pid})`);
        return;
      } catch (err) {
        throw new Error(
          `EDGE_RELOAD_UNAVAILABLE: Failed to send SIGHUP: ${err instanceof Error ? err.message : err}`
        );
      }
    }

    // No reload mechanism configured — log warning but don't fail
    // (files are already copied; edge runtime may pick them up on restart)
    console.warn('[modules] No edge runtime reload mechanism configured (set EDGE_RUNTIME_RELOAD_URL or EDGE_RUNTIME_PID_FILE)');
  }

  async syncSecrets(_secrets: Array<{ name: string; value: string }>): Promise<void> {
    // Local dev: secrets are environment variables set in docker-compose.yml.
    // Module-specific secrets from admin UI are stored in installed_modules.config
    // and read by edge functions at invocation time via Supabase client.
  }

  isAvailable(): boolean {
    // Local filesystem is always available for file copying,
    // but reload may not work without a configured mechanism
    return true;
  }
}
