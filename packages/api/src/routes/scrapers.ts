/**
 * Scraper API Routes
 *
 * Provides endpoints for managing event scrapers.
 * Heavy scraper execution happens via the job queue worker.
 */

import { Router, type Request, type Response } from 'express';
import { getSupabase } from '../lib/supabase.js';
import { addJob, getJob, isQueueAvailable, JobTypes } from '../lib/job-queue.js';

export const scrapersRouter = Router();

// List all scrapers
scrapersRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('scrapers')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, scrapers: data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get scraper details
scrapersRouter.get('/:jobId/details', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data: scraper, error } = await supabase
      .from('scrapers')
      .select('*')
      .eq('id', req.params.jobId)
      .single();

    if (error || !scraper) {
      return res.status(404).json({ success: false, error: 'Scraper not found' });
    }

    // Get recent jobs
    const { data: logs } = await supabase
      .from('scrapers_jobs')
      .select('*')
      .eq('scraper_id', req.params.jobId)
      .order('created_at', { ascending: false })
      .limit(20);

    res.json({ success: true, scraper, logs: logs || [] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get scraper logs
scrapersRouter.get('/:jobId/logs', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data: logs, error } = await supabase
      .from('scrapers_jobs')
      .select('*')
      .eq('scraper_id', req.params.jobId)
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, logs: logs || [] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Start a scraper via job queue
scrapersRouter.post('/:jobId/start', async (req: Request, res: Response) => {
  try {
    if (!isQueueAvailable()) {
      return res.status(503).json({ success: false, error: 'Job queue not available (Redis not configured)' });
    }

    const supabase = getSupabase();
    const scraperJobId = parseInt(req.params.jobId, 10);

    // Look up the scrapers_jobs row and its parent scraper
    const { data: jobRow, error: jobError } = await supabase
      .from('scrapers_jobs')
      .select('id, scraper_id, scrapers(id, name, scraper_type, event_type)')
      .eq('id', scraperJobId)
      .single();

    if (jobError || !jobRow) {
      // Fallback: treat param as scraper ID (direct start without pre-created job)
      const { data: scraper, error } = await supabase
        .from('scrapers')
        .select('id, name, scraper_type, event_type')
        .eq('id', req.params.jobId)
        .single();

      if (error || !scraper) {
        return res.status(404).json({ success: false, error: 'Scraper or job not found' });
      }

      // Create a scrapers_jobs row first
      const { data: newJobs, error: createError } = await supabase.rpc('scrapers_create_job', {
        scraper_ids: [scraper.id],
        created_by_user: 'api'
      });

      if (createError || !newJobs?.length) {
        return res.status(500).json({ success: false, error: 'Failed to create scraper job' });
      }

      const newJobId = newJobs[0].job_id;

      const bullJob = await addJob(JobTypes.SCRAPER_RUN, {
        scraperJobId: newJobId,
        scraperId: scraper.id,
        scraperName: scraper.name,
        scraperType: scraper.scraper_type,
        eventType: scraper.event_type,
        manual: true,
      });

      return res.json({
        success: true,
        message: `Scraper "${scraper.name}" started`,
        jobId: bullJob.id,
        scraperJobId: newJobId,
      });
    }

    // Normal path: scrapers_jobs row already exists
    const scraper = jobRow.scrapers as any;

    const bullJob = await addJob(JobTypes.SCRAPER_RUN, {
      scraperJobId: jobRow.id,
      scraperId: scraper.id,
      scraperName: scraper.name,
      scraperType: scraper.scraper_type,
      eventType: scraper.event_type,
      manual: true,
    });

    res.json({
      success: true,
      message: `Scraper "${scraper.name}" started`,
      jobId: bullJob.id,
      scraperJobId: jobRow.id,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get active scraper jobs
scrapersRouter.get('/active', async (_req: Request, res: Response) => {
  try {
    if (!isQueueAvailable()) {
      return res.json({ success: true, jobs: [] });
    }

    const { getJobs } = await import('../lib/job-queue.js');
    const jobs = await getJobs({ status: ['active', 'waiting'] });
    const scraperJobs = jobs.filter((j: any) => j.name === JobTypes.SCRAPER_RUN);
    res.json({ success: true, jobs: scraperJobs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Stop a running scraper job
scrapersRouter.post('/:jobId/stop', async (req: Request, res: Response) => {
  try {
    if (!isQueueAvailable()) {
      return res.status(503).json({ success: false, error: 'Job queue not available' });
    }

    // Try to remove the job from the queue
    const { removeJob } = await import('../lib/job-queue.js');
    try {
      await removeJob(req.params.jobId as string);
      res.json({ success: true, message: 'Job stopped' });
    } catch {
      res.status(404).json({ success: false, error: 'Job not found or already completed' });
    }
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// SSE stream for scraper logs (requires Redis pub/sub)
scrapersRouter.get('/:jobId/stream', async (req: Request, res: Response) => {
  if (!isQueueAvailable()) {
    return res.status(503).json({ success: false, error: 'Streaming not available (Redis not configured)' });
  }

  try {
    const Redis = (await import('ioredis')).default;
    const subscriber = new Redis(process.env.REDIS_URL!);
    const channel = `scraper:${req.params.jobId}:logs`;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    await subscriber.subscribe(channel);

    subscriber.on('message', (ch: string, message: string) => {
      if (ch === channel) {
        res.write(`data: ${message}\n\n`);
      }
    });

    req.on('close', () => {
      subscriber.unsubscribe(channel);
      subscriber.quit();
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create a new scraper
scrapersRouter.post('/', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('scrapers')
      .insert(req.body)
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, scraper: data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Update a scraper
scrapersRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('scrapers')
      .update(req.body)
      .eq('id', req.params.id)
      .select()
      .single();

    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, scraper: data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Delete a scraper
scrapersRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('scrapers')
      .delete()
      .eq('id', req.params.id);

    if (error) return res.status(500).json({ success: false, error: error.message });
    res.json({ success: true, message: 'Scraper deleted' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
