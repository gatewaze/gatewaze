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
    // No-op: the main service spawns workers on demand from disk.
    // New function directories are automatically available without restart.
  }

  async syncSecrets(_secrets: Array<{ name: string; value: string }>): Promise<void> {
    // Local dev: secrets are environment variables set in docker-compose.yml.
    // Module-specific secrets from admin UI are stored in installed_modules.config
    // and read by edge functions at invocation time via Supabase client.
  }

  isAvailable(): boolean {
    return true;
  }
}
