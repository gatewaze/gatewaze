import type { DeploymentStrategy, DeployFunctionRequest, DeployFunctionResult } from './types';

const SUPABASE_API_BASE = 'https://api.supabase.com';
const DEPLOY_TIMEOUT_MS = 30_000;

/**
 * Cloud API Strategy — Supabase Cloud
 *
 * Deploys edge functions via the Supabase Management API.
 * Accepts raw TypeScript source files; Supabase handles bundling server-side.
 *
 * Requires SUPABASE_PROJECT_REF and SUPABASE_ACCESS_TOKEN.
 */
export class CloudApiStrategy implements DeploymentStrategy {
  private projectRef: string;
  private accessToken: string;

  constructor() {
    this.projectRef = process.env.SUPABASE_PROJECT_REF!;
    this.accessToken = process.env.SUPABASE_ACCESS_TOKEN!;
  }

  async deploy(request: DeployFunctionRequest): Promise<DeployFunctionResult> {
    const { functionName, entrypointPath, sourceFiles } = request;
    const url = `${SUPABASE_API_BASE}/v1/projects/${this.projectRef}/functions/deploy?slug=${encodeURIComponent(functionName)}`;

    const formData = new FormData();

    formData.append(
      'metadata',
      JSON.stringify({
        entrypoint_path: entrypointPath,
        name: functionName,
        verify_jwt: false,
      }),
    );

    for (const [path, content] of sourceFiles) {
      let fileContent = content;
      // Rewrite import paths for cloud deployment: the Supabase API places all
      // uploaded files at the same level, so '../_shared/' must become './_shared/'
      if (path === 'index.ts') {
        fileContent = content.replace(
          /from\s+(['"])\.\.?\/_shared\//g,
          "from $1./_shared/",
        );
      }
      formData.append('file', new Blob([fileContent]), path);
    }

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.accessToken}` },
        body: formData,
        signal: AbortSignal.timeout(DEPLOY_TIMEOUT_MS),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        functionName,
        success: false,
        error: `Network error deploying ${functionName}: ${message}`,
        errorCode: 'NETWORK_ERROR',
      };
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const errorCode =
        response.status === 401 || response.status === 403
          ? ('AUTH_ERROR' as const)
          : response.status === 404
            ? ('NOT_FOUND' as const)
            : ('DEPLOY_ERROR' as const);

      return {
        functionName,
        success: false,
        error: `HTTP ${response.status} deploying ${functionName}: ${body}`,
        errorCode,
      };
    }

    return { functionName, success: true };
  }

  async remove(functionName: string): Promise<DeployFunctionResult> {
    const url = `${SUPABASE_API_BASE}/v1/projects/${this.projectRef}/functions/${encodeURIComponent(functionName)}`;

    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${this.accessToken}` },
        signal: AbortSignal.timeout(DEPLOY_TIMEOUT_MS),
      });

      if (!response.ok && response.status !== 404) {
        const body = await response.text().catch(() => '');
        return {
          functionName,
          success: false,
          error: `HTTP ${response.status} removing ${functionName}: ${body}`,
          errorCode: 'DEPLOY_ERROR',
        };
      }

      return { functionName, success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        functionName,
        success: false,
        error: `Network error removing ${functionName}: ${message}`,
        errorCode: 'NETWORK_ERROR',
      };
    }
  }

  async reload(): Promise<void> {
    // Cloud functions are live immediately after deploy — no reload needed
  }

  async syncSecrets(secrets: Array<{ name: string; value: string }>): Promise<void> {
    if (secrets.length === 0) return;

    const url = `${SUPABASE_API_BASE}/v1/projects/${this.projectRef}/secrets`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(secrets),
      signal: AbortSignal.timeout(DEPLOY_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Do not log the response body — it may echo back secret values
      console.error(`[modules] Failed to sync secrets: HTTP ${response.status}`);
    } else {
      console.log(`[modules] Synced ${secrets.length} secret(s) to Supabase Cloud`);
    }
  }

  isAvailable(): boolean {
    return !!(this.projectRef && this.accessToken);
  }
}
