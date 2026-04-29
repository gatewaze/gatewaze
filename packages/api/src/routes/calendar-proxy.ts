/**
 * Calendar Proxy API Routes
 *
 * Proxies calendar requests to the Supabase Edge Function for
 * Google Calendar, Outlook, and ICS file downloads.
 */

import { type Request, type Response } from 'express';
import { labeledRouter } from '../lib/router-registry.js';

export const calendarProxyRouter = labeledRouter('public');

function getEdgeFunctionUrl(): string {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  return `${supabaseUrl}/functions/v1/calendar`;
}

// Health check
calendarProxyRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'calendar-proxy',
    edge_function_url: getEdgeFunctionUrl(),
    timestamp: new Date().toISOString(),
  });
});

// Proxy calendar requests to Supabase Edge Function
calendarProxyRouter.get('/:eventId/:calendarType/:emailEncoded', async (req: Request, res: Response) => {
  const { eventId, calendarType, emailEncoded } = req.params;

  try {
    const fullUrl = `${getEdgeFunctionUrl()}/${eventId}/${calendarType}/${emailEncoded}`;

    const response = await fetch(fullUrl, {
      method: 'GET',
      headers: {
        'x-forwarded-for': req.ip || '',
        'user-agent': req.headers['user-agent'] || '',
        'referer': (req.headers['referer'] as string) || '',
      },
      redirect: 'manual',
    });

    // Handle redirects (Google/Outlook calendars)
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (location) return res.redirect(response.status, location);
    }

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/calendar')) {
      const icsContent = await response.text();
      const contentDisposition = response.headers.get('content-disposition');
      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', contentDisposition || `attachment; filename="event-${eventId}.ics"`);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.send(icsContent);
    }

    if (contentType.includes('text/html')) {
      const html = await response.text();
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(html);
    }

    // JSON responses
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    return res.json(data);
  } catch (error) {
    res.status(500).json({
      error: 'Internal server error',
      message: (error instanceof Error ? error.message : String(error)),
      details: 'Failed to proxy calendar request',
    });
  }
});

// Catch-all for invalid calendar URLs
calendarProxyRouter.get('/*', (_req: Request, res: Response) => {
  res.status(400).json({
    error: 'Invalid calendar URL format',
    expected: '/api/calendar/{event_id}/{calendar_type}/{email_encoded}',
  });
});
