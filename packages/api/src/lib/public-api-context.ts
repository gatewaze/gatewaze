import type { Request, Response, NextFunction } from 'express';
import type {
  PublicApiContext,
  CachePolicy,
  ModuleRuntimeContext,
} from '@gatewaze/shared/types/modules';

/**
 * Creates a PublicApiContext for a given module, extending the base
 * ModuleRuntimeContext with public-API-specific helpers (scope checking,
 * field parsing, pagination, and cache control).
 */
export function createPublicApiContext(
  moduleId: string,
  baseCtx: ModuleRuntimeContext,
): PublicApiContext {
  return {
    ...baseCtx,

    /**
     * Returns Express middleware that checks the authenticated API key
     * has the scope `${moduleId}:${action}`.
     */
    requireScope(action: string) {
      const scope = `${moduleId}:${action}`;
      return (req: Request, res: Response, next: NextFunction) => {
        if (!req.apiKey) {
          return res.status(401).json({
            error: {
              code: 'MISSING_API_KEY',
              message: 'Authentication is required.',
            },
          });
        }
        if (!req.apiKey.scopes.includes(scope)) {
          return res.status(403).json({
            error: {
              code: 'INSUFFICIENT_SCOPE',
              message: `This API key does not have the required scope: ${scope}.`,
            },
          });
        }
        next();
      };
    },

    /**
     * Parse a `?fields=` query parameter against an allowlist.
     * Returns only allowed fields; any unrecognised fields are silently stripped.
     */
    parseFields(
      fieldsParam: string | undefined,
      allowedFields: string[],
      defaultFields?: string[],
    ): string[] {
      if (fieldsParam === undefined) {
        return defaultFields ?? allowedFields;
      }

      const requested = fieldsParam
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);

      const allowed = new Set(allowedFields);
      const filtered = requested.filter((f) => allowed.has(f));

      // If nothing survived filtering, fall back to defaults
      if (filtered.length === 0) {
        return defaultFields ?? allowedFields;
      }

      return filtered;
    },

    /**
     * Parse and validate `limit` / `offset` pagination query parameters.
     * Throws a structured error object (code: VALIDATION_ERROR) on bad input.
     */
    parsePagination(query: { limit?: string; offset?: string }): {
      limit: number;
      offset: number;
    } {
      let limit = 25;
      let offset = 0;

      if (query.limit !== undefined) {
        const parsed = Number(query.limit);
        if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
          throw {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'Parameter "limit" must be an integer.',
          };
        }
        if (parsed < 1 || parsed > 100) {
          throw {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'Parameter "limit" must be between 1 and 100.',
          };
        }
        limit = parsed;
      }

      if (query.offset !== undefined) {
        const parsed = Number(query.offset);
        if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
          throw {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'Parameter "offset" must be a non-negative integer.',
          };
        }
        if (parsed < 0) {
          throw {
            statusCode: 400,
            code: 'VALIDATION_ERROR',
            message: 'Parameter "offset" must be a non-negative integer.',
          };
        }
        offset = parsed;
      }

      return { limit, offset };
    },

    /**
     * Set Cache-Control headers on a response based on a typed CachePolicy.
     */
    setCache(res: unknown, policy: CachePolicy): void {
      const response = res as Response;
      if (policy.kind === 'public') {
        let value = `public, max-age=${policy.maxAge}`;
        if (policy.sMaxAge !== undefined) {
          value += `, s-maxage=${policy.sMaxAge}`;
        }
        response.setHeader('Cache-Control', value);
      } else if (policy.kind === 'no-store') {
        response.setHeader('Cache-Control', 'no-store');
      }
    },
  };
}
