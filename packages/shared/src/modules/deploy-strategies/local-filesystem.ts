import http from 'http';
import type { DeploymentStrategy, DeployFunctionRequest, DeployFunctionResult } from './types';

/**
 * Local Filesystem Strategy — DEVELOPMENT ONLY
 *
 * Deploys edge functions by writing files to the local filesystem (volume-mounted
 * from host) and restarting the edge runtime Docker container via Docker socket.
 *
 * This strategy is the fallback when neither cloud nor K8s env vars are set.
 */
export class LocalFilesystemStrategy implements DeploymentStrategy {
  async deploy(_request: DeployFunctionRequest): Promise<DeployFunctionResult> {
    // File copying is handled by the caller (deployEdgeFunctions) for local/k8s
    // This strategy only handles reload and secrets
    return { functionName: _request.functionName, success: true };
  }

  async remove(functionName: string): Promise<DeployFunctionResult> {
    // File removal is handled by the caller
    return { functionName, success: true };
  }

  async reload(): Promise<void> {
    const container = process.env.EDGE_FUNCTIONS_CONTAINER;
    if (!container) return;

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) {
      console.warn(`[modules] Invalid EDGE_FUNCTIONS_CONTAINER value, skipping restart`);
      return;
    }

    return new Promise((resolve) => {
      const req = http.request(
        {
          socketPath: '/var/run/docker.sock',
          path: `/containers/${container}/restart`,
          method: 'POST',
        },
        (res: { statusCode?: number }) => {
          const status = res.statusCode === 204 ? 'OK' : res.statusCode;
          console.log(`[modules] Edge runtime restart: ${status}`);
          resolve();
        },
      );
      req.on('error', (err: Error) => {
        console.warn(`[modules] Edge runtime restart failed: ${err.message}`);
        resolve();
      });
      req.end();
    });
  }

  async syncSecrets(_secrets: Array<{ name: string; value: string }>): Promise<void> {
    // Local dev: secrets are environment variables set in docker-compose.yml.
    // No runtime sync needed — module-specific secrets from admin UI are stored
    // in installed_modules.config and read by the edge function at invocation time.
  }

  isAvailable(): boolean {
    return true;
  }
}
