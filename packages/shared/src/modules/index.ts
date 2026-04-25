export { loadModules, loadModulesWithDbSources, discoverModules, resolveModules, validateModule, computeShadowedSourceIds } from './loader';
export {
  dataRoot,
  sourcesRoot,
  modulesRoot,
  liveModuleDir,
  liveModuleNewDir,
  liveModulePrevDir,
  snapshotFile,
  rebuildSentinelFile,
  rebuildStatusFile,
  repoSlug,
  readSnapshot,
  writeSnapshot,
  isSymlink,
  removeLiveModule,
  sweepOrphanedNewDirs,
  symlinkLiveModule,
} from './module-paths';
export type { SnapshotMetadata } from './module-paths';
export { installLiveSnapshot, removeLiveSnapshot, readLiveSnapshotHash } from './live-tree';
export type { SnapshotInput, SnapshotResult } from './live-tree';
export { triggerRebuild, readRebuildStatus, summariseRebuild } from './rebuild-trigger';
export type { RebuildComponent, RebuildSentinel, RebuildStatus } from './rebuild-trigger';
export { reconcileModules, seedModuleSources, detectCircularDependencies } from './lifecycle';
export { applyModuleMigrations } from './migrations';
export { compareSemver, isNewerVersion } from './semver';
export { deployEdgeFunctions, removeEdgeFunctions } from './deploy-edge-functions';
export { computeModuleHash, computeModuleHash as computeEdgeFunctionsHash, computeModuleHashFromPath } from './module-hash';
export { detectDeploymentEnvironment, createDeploymentStrategy, resolveSourceFiles, resolveModuleSecrets } from './deploy-strategies';
export { detectEnvironment, checkExecSqlExists, validateCloudCredentials, applyCoreMigrations, bootstrapCheck } from './bootstrap';
export { validateFeatureNamespace } from './feature-validation';
export { lintMigrationSql, hasMigrationViolations } from './migration-linter';
export type { BootstrapResult } from './bootstrap';
export type { DeployEdgeFunctionsOptions, DeployResult } from './deploy-edge-functions';
export type { DeploymentStrategy, DeployFunctionRequest, DeployFunctionResult, DeployErrorCode, DeploymentEnvironment } from './deploy-strategies';
export type { MigrationLintResult } from './migration-linter';
export { encryptSecret, decryptSecret, getLast4, maskSecret, isEncryptionConfigured } from './secrets';
export type {
  GatewazeModule,
  GatewazeConfig,
  LoadedModule,
  InstalledModuleRow,
  ModuleSourceRow,
  ModuleSource,
  AdminRouteDefinition,
  NavigationItem,
  PortalRouteDefinition,
  WorkerDefinition,
  SchedulerDefinition,
  QueueDefinition,
  QueueHandlerDefinition,
  CronDefinition,
  ConfigField,
  ThemeOverrides,
  SlotRegistration,
  StructuredLogger,
  ModuleRuntimeContext,
  ModuleWarning,
  LoadedModuleRecord,
  ModuleErrorCode,
  ModuleApiError,
  ModuleWorkerHandler,
  ModuleSchedulerHandler,
  ModuleConfigEnvelope,
} from '../types/modules';
