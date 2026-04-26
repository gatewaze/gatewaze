/**
 * @gatewaze/shared/listing — public surface.
 * Implements spec-platform-listing-pattern.md.
 */

export type {
  HandlerContext,
  SupabaseFilterFn,
  ProjectionItem,
  ComputedExpr,
  FkLookup,
  FilterDeclaration,
  SummaryDeclaration,
  AdminDisplayColumn,
  AdminTableStyle,
  PiiExposureAcknowledgement,
  ListingSchema,
  ListingQuery,
  ListingResult,
  BuildListingQueryOpts,
  ListingErrorCode,
} from './types';
export { ListingError } from './types';

export { buildListingQuery, buildListingCount, renderProjection, renderComputedExpr } from './build-query';

export { cachedEnricher, type CachedEnricherConfig } from './cached-enricher';

export type { SchemaValidationIssue, ValidateOptions } from './validate-schema';
export { validateListingSchema } from './validate-schema';

export type {
  AdminListingRouteConfig,
  AdminListingHandler,
  AdminListingRequest,
  AdminListingResponse,
  AdminDistinctRouteConfig,
  AdminDistinctHandler,
  AdminDistinctRequest,
  AdminDistinctResponse,
  DistinctValue,
  PublicApiListingRouteConfig,
  PublicApiListingHandler,
  McpListingToolConfig,
  McpListingTool,
  McpListingToolInput,
  McpListingToolOutput,
  PortalListingLoaderConfig,
  PortalListingLoader,
  PortalListingLoaderResult,
  BuildHandlerContextInput,
} from './handler-factories';
export {
  createAdminListingRoute,
  createAdminDistinctRoute,
  createPublicApiListingRoute,
  createMcpListingTool,
  createPortalListingLoader,
  publicApiCacheControl,
  parseListingQueryFromHttp,
  buildHandlerContext,
  roundedNowIsoBucket,
} from './handler-factories';

// Phase 12 — cache invalidation
export {
  listingCache,
  type ListingCacheKey,
  type ListingMutationEvent,
} from './cache';

// Phase 14 — summary endpoint
export {
  createAdminSummaryRoute,
  type AdminSummaryRouteConfig,
  type AdminSummaryHandler,
} from './summary-factory';

export { listingQueryToSearchParams, listingQueryFromSearchParams } from './url-state';
