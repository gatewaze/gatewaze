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

export { buildListingQuery, renderProjection, renderComputedExpr } from './build-query';

export type { SchemaValidationIssue, ValidateOptions } from './validate-schema';
export { validateListingSchema } from './validate-schema';

export type {
  AdminListingRouteConfig,
  AdminListingHandler,
  AdminListingRequest,
  AdminListingResponse,
  PublicApiListingRouteConfig,
  McpListingToolConfig,
  PortalListingLoaderConfig,
  BuildHandlerContextInput,
} from './handler-factories';
export {
  createAdminListingRoute,
  createPublicApiListingRoute,
  createMcpListingTool,
  createPortalListingLoader,
  parseListingQueryFromHttp,
  buildHandlerContext,
} from './handler-factories';

export { listingQueryToSearchParams, listingQueryFromSearchParams } from './url-state';
