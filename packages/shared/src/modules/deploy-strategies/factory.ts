import type { DeploymentStrategy } from './types';
import { CloudApiStrategy } from './cloud-api';
import { LocalFilesystemStrategy } from './local-filesystem';

export type DeploymentEnvironment = 'local-filesystem' | 'cloud-api' | 'k8s-shared-storage';

/**
 * Detect the deployment environment based on env vars.
 *
 * Precedence (first match wins):
 * 1. Cloud API — SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN
 * 2. K8s Shared Storage — EDGE_FUNCTIONS_SHARED_DIR (future, Phase 2)
 * 3. Local Filesystem — fallback
 *
 * Throws if SUPABASE_PROJECT_REF is set without SUPABASE_ACCESS_TOKEN
 * to prevent silent fallback to local-filesystem in a misconfigured cloud env.
 */
export function detectDeploymentEnvironment(): DeploymentEnvironment {
  if (process.env.SUPABASE_PROJECT_REF) {
    if (!process.env.SUPABASE_ACCESS_TOKEN) {
      console.error(
        '[modules] SUPABASE_PROJECT_REF is set but SUPABASE_ACCESS_TOKEN is missing. ' +
          'Cloud deployment will not work. Set SUPABASE_ACCESS_TOKEN in your environment.',
      );
      throw new Error(
        'SUPABASE_PROJECT_REF requires SUPABASE_ACCESS_TOKEN for cloud deployment',
      );
    }
    return 'cloud-api';
  }

  if (process.env.EDGE_FUNCTIONS_SHARED_DIR) {
    return 'k8s-shared-storage';
  }

  return 'local-filesystem';
}

export function createDeploymentStrategy(env: DeploymentEnvironment): DeploymentStrategy {
  switch (env) {
    case 'cloud-api':
      return new CloudApiStrategy();
    case 'k8s-shared-storage':
      // Phase 2: SharedStorageStrategy — for now fall back to local filesystem
      console.warn('[modules] K8s shared storage strategy not yet implemented, using local filesystem');
      return new LocalFilesystemStrategy();
    default:
      return new LocalFilesystemStrategy();
  }
}
