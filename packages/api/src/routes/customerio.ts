/**
 * Customer.io Proxy API Routes
 *
 * Provides CORS-safe endpoints to fetch segment/customer data from Customer.io.
 * All routes require CUSTOMERIO_APP_API_KEY environment variable.
 */

import { type Request, type Response } from 'express';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';

const CUSTOMERIO_BASE_URL = 'https://api.customer.io/v1';
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

interface CustomerioIdentifier {
  cio_id?: string;
  id?: string;
  email?: string;
  [key: string]: unknown;
}
interface SegmentsResponse {
  segments?: unknown[];
  [key: string]: unknown;
}

let segmentsCache: SegmentsResponse | null = null;
let segmentsCacheTime: number | null = null;

export const customerioRouter = labeledRouter('jwt');
customerioRouter.use(requireJwt());

function getApiKey(): string | null {
  return process.env.CUSTOMERIO_APP_API_KEY || null;
}

// Guard: all routes require API key
customerioRouter.use((_req: Request, res: Response, next) => {
  if (!getApiKey()) {
    return res.status(503).json({ error: 'Customer.io not configured (CUSTOMERIO_APP_API_KEY not set)' });
  }
  next();
});

// List all segments
customerioRouter.get('/segments', async (_req: Request, res: Response) => {
  try {
    const now = Date.now();
    if (segmentsCache && segmentsCacheTime && (now - segmentsCacheTime) < CACHE_DURATION) {
      return res.json(segmentsCache);
    }

    const response = await fetch(`${CUSTOMERIO_BASE_URL}/segments`, {
      headers: {
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Customer.io API error: ${response.status}`, details: errorText });
    }

    const data = (await response.json()) as SegmentsResponse;
    segmentsCache = data;
    segmentsCacheTime = now;
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error instanceof Error ? error.message : String(error) });
  }
});

// Segment people count
customerioRouter.get('/segments/:id/customer_count', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${CUSTOMERIO_BASE_URL}/segments/${req.params.id}/customer_count`, {
      headers: {
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) return res.json({ count: 0 });
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Customer.io API error: ${response.status}`, details: errorText });
    }

    res.json(await response.json());
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error instanceof Error ? error.message : String(error) });
  }
});

// Get ALL customers in a segment (server-side pagination)
customerioRouter.get('/segments/:id/customers', async (req: Request, res: Response) => {
  try {
    const allIdentifiers: CustomerioIdentifier[] = [];
    let cursor: string | null = null;

    do {
      const url = cursor
        ? `${CUSTOMERIO_BASE_URL}/segments/${req.params.id}/membership?start=${cursor}&limit=30000`
        : `${CUSTOMERIO_BASE_URL}/segments/${req.params.id}/membership?limit=30000`;

      const response = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${getApiKey()}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: 'Failed to fetch segment membership', message: errorText });
      }

      const data = (await response.json()) as { identifiers?: CustomerioIdentifier[]; next?: string };
      allIdentifiers.push(...(data.identifiers ?? []));
      cursor = data.next ?? null;
    } while (cursor);

    res.json({
      customers: allIdentifiers.map((id) => ({
        cio_id: id.cio_id,
        id: id.id,
        email: id.email,
        created_at: id.created_at,
      })),
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error instanceof Error ? error.message : String(error) });
  }
});

// Customer details
customerioRouter.get('/customers/:cio_id/details', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${CUSTOMERIO_BASE_URL}/customers/${req.params.cio_id}/attributes`, {
      headers: {
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Customer.io API error: ${response.status}`, details: errorText });
    }

    const data = (await response.json()) as { customer: { email?: string; attributes?: Record<string, unknown> } };
    res.json({ cio_id: req.params.cio_id, email: data.customer.email, ...data.customer.attributes });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error instanceof Error ? error.message : String(error) });
  }
});

// Customer activities
customerioRouter.get('/customers/:cio_id/activities', async (req: Request, res: Response) => {
  try {
    const response = await fetch(`${CUSTOMERIO_BASE_URL}/customers/${req.params.cio_id}/activities`, {
      headers: {
        'Authorization': `Bearer ${getApiKey()}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return res.status(response.status).json({ error: `Customer.io API error: ${response.status}`, details: errorText });
    }

    const data = (await response.json()) as { activities?: unknown[] };
    res.json({ activities: data.activities ?? [] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error', message: error instanceof Error ? error.message : String(error) });
  }
});

// People list (CIO limitation)
customerioRouter.get('/people', (_req: Request, res: Response) => {
  res.json({
    customers: [],
    next: null,
    total: 0,
    message: 'Customer.io requires fetching people from specific segments. Please use the segments endpoint instead.',
  });
});

// Trigger sync
customerioRouter.post('/sync/:syncType', async (req: Request, res: Response) => {
  const { syncType } = req.params;
  const { fullSync = false } = req.body;

  const validTypes = ['customers', 'segments', 'activities', 'reconcile_segments', 'import_segments', 'customers_missing'];
  if (!validTypes.includes(syncType as string)) {
    return res.status(400).json({ error: 'Invalid sync type', message: `Must be one of: ${validTypes.join(', ')}` });
  }

  try {
    const { spawn } = await import('child_process');
    const scriptMapping: Record<string, string> = {
      customers: 'sync:customerio:customers',
      segments: 'sync:customerio:segments',
      activities: 'sync:customerio:activities',
      reconcile_segments: 'reconcile:segments',
      import_segments: 'import:customerio:segments',
      customers_missing: 'sync:customerio:customers:missing',
    };

    let script = scriptMapping[syncType as string];
    if (fullSync && ['customers', 'segments', 'activities'].includes(syncType as string)) {
      script = `${script}:full`;
    }

    const syncProcess = spawn('npm', ['run', script], {
      cwd: process.cwd(),
      detached: true,
      stdio: 'ignore',
    });
    syncProcess.unref();

    res.json({ success: true, message: `${syncType} sync started`, syncType, fullSync, pid: syncProcess.pid });
  } catch (error) {
    res.status(500).json({ error: 'Failed to trigger sync', message: error instanceof Error ? error.message : String(error) });
  }
});
