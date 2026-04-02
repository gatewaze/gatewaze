/**
 * Permissions Module - Main Export
 *
 * This module provides a comprehensive permission management system for admin users.
 *
 * @example
 * ```tsx
 * // Import everything you need
 * import { PermissionsService, type AdminFeature } from '@/lib/permissions';
 *
 * // Check permission
 * const { hasPermission } = await PermissionsService.hasPermission(
 *   userId,
 *   'blog'
 * );
 * ```
 */

// Export service
export { PermissionsService, default as default } from './service';

// Export types
export type {
  AdminFeature,
  AdminPermission,
  PermissionGroup,
  PermissionGroupFeature,
  PermissionGroupAssignment,
  PermissionAuditLog,
  GrantPermissionRequest,
  RevokePermissionRequest,
  AssignGroupRequest,
  CreatePermissionGroupRequest,
  UpdatePermissionGroupRequest,
  PermissionCheckResult,
  AdminPermissionsMap,
  FeatureMetadata,
} from './types';

// Export constants and metadata
export {
  FEATURE_METADATA,
  FEATURE_CATEGORIES,
} from './types';
