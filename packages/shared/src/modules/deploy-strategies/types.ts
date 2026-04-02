export interface DeployFunctionRequest {
  functionName: string;
  entrypointPath: string;
  sourceFiles: Map<string, string>;
}

export type DeployErrorCode =
  | 'NETWORK_ERROR'
  | 'AUTH_ERROR'
  | 'DEPLOY_ERROR'
  | 'NOT_FOUND'
  | 'INVALID_SOURCE'
  | 'RELOAD_ERROR';

export interface DeployFunctionResult {
  functionName: string;
  success: boolean;
  error?: string;
  errorCode?: DeployErrorCode;
}

export interface DeploymentStrategy {
  deploy(request: DeployFunctionRequest): Promise<DeployFunctionResult>;
  remove(functionName: string): Promise<DeployFunctionResult>;
  reload(): Promise<void>;
  syncSecrets(secrets: Array<{ name: string; value: string }>): Promise<void>;
  isAvailable(): boolean;
}
