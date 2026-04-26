import { type NextRequest, NextResponse } from 'next/server';
import { eventsListingSchema } from '@gatewaze-modules/events/listing-schema';
import type { ListingSchema } from '@gatewaze/shared/listing';
import { createPortalListingApiRoute } from '@/lib/listing/api-route';

export const dynamic = 'force-dynamic';

/**
 * Module → ListingSchema registry.
 *
 * The platform spec describes a global registry populated at module load
 * time. Until that lands, statically register the modules that ship a
 * portal projection here. Adding a new portal listing is a one-line
 * import + entry below.
 */
const PORTAL_LISTING_SCHEMAS: Record<string, ListingSchema> = {
  events: eventsListingSchema,
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ module: string }> },
): Promise<NextResponse> {
  const { module: moduleId } = await params;
  const schema = PORTAL_LISTING_SCHEMAS[moduleId];
  if (!schema || !schema.projections.portal || schema.projections.portal.length === 0) {
    return NextResponse.json(
      {
        error: {
          code: 'LISTING_NOT_FOUND',
          message: `No portal listing registered for '${moduleId}'`,
        },
      },
      { status: 404 },
    );
  }
  const handler = createPortalListingApiRoute({ schema });
  return handler(req);
}
