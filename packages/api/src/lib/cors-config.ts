/**
 * CORS configuration for the module API.
 * Default: deny all cross-origin.
 * GATEWAZE_CORS_ALLOWED_ORIGINS enables specific origins.
 */

import cors from 'cors';
import type { CorsOptions } from 'cors';

export function createCorsMiddleware() {
  const allowedOriginsEnv = process.env.GATEWAZE_CORS_ALLOWED_ORIGINS;

  if (!allowedOriginsEnv) {
    // Deny all cross-origin by default
    return cors({ origin: false });
  }

  const allowedOrigins = allowedOriginsEnv
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const options: CorsOptions = {
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server, same-origin)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    credentials: false,
    maxAge: 600, // 10 minutes
  };

  return cors(options);
}
