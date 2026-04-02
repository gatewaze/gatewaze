/**
 * Jobs API Routes - Background job management via BullMQ
 */

import { Router, type Request, type Response } from 'express';
import {
  getJobs,
  getJobCounts,
  getJob,
  addJob,
  retryJob,
  removeJob,
  cleanJobs,
  getRepeatableJobs,
  removeRepeatableJob,
  isQueueAvailable,
  JobTypes,
} from '../lib/job-queue.js';
import { getSupabase } from '../lib/supabase.js';

export const jobsRouter = Router();

// Guard: all job routes require Redis
jobsRouter.use((_req: Request, res: Response, next) => {
  if (!isQueueAvailable()) {
    return res.status(503).json({ success: false, error: 'Job queue not available (Redis not configured)' });
  }
  next();
});

// List jobs
jobsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { status, start = '0', end = '100' } = req.query;
    const statusArray = status
      ? (status as string).split(',')
      : ['waiting', 'active', 'completed', 'failed', 'delayed'];

    const jobs = await getJobs({
      status: statusArray,
      start: parseInt(start as string, 10),
      end: parseInt(end as string, 10),
    });

    res.json({ success: true, jobs, count: jobs.length });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Job counts
jobsRouter.get('/counts', async (_req: Request, res: Response) => {
  try {
    const counts = await getJobCounts();
    res.json({ success: true, counts });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Job types
jobsRouter.get('/types', (_req: Request, res: Response) => {
  res.json({
    success: true,
    types: Object.entries(JobTypes).map(([key, value]) => ({
      key,
      value,
      category: value.split(':')[0],
    })),
  });
});

// Scheduled/repeatable jobs
jobsRouter.get('/scheduled', async (_req: Request, res: Response) => {
  try {
    const jobs = await getRepeatableJobs();
    res.json({ success: true, jobs });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Scraper schedules from DB
jobsRouter.get('/scraper-schedules', async (_req: Request, res: Response) => {
  try {
    const supabase = getSupabase();
    const { data: scrapers, error } = await supabase
      .from('scrapers')
      .select(`
        id, name, description, scraper_type, event_type,
        schedule_enabled, schedule_frequency, schedule_time,
        schedule_days, schedule_cron, next_scheduled_run,
        created_at, updated_at
      `)
      .order('schedule_enabled', { ascending: false })
      .order('next_scheduled_run', { ascending: true, nullsFirst: false });

    if (error) {
      return res.status(500).json({ success: false, error: error.message });
    }

    const schedules = (scrapers || []).map((s: any) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      scraperType: s.scraper_type,
      eventType: s.event_type,
      scheduleEnabled: s.schedule_enabled,
      scheduleFrequency: s.schedule_frequency,
      scheduleTime: s.schedule_time,
      scheduleDays: s.schedule_days,
      scheduleCron: s.schedule_cron,
      nextScheduledRun: s.next_scheduled_run,
      createdAt: s.created_at,
      updatedAt: s.updated_at,
    }));

    res.json({
      success: true,
      schedules,
      count: schedules.length,
      enabledCount: schedules.filter((s: any) => s.scheduleEnabled).length,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Manually trigger a scraper
jobsRouter.post('/scraper-schedules/:id/run', async (req: Request, res: Response) => {
  try {
    const scraperId = parseInt(req.params.id as string, 10);
    const supabase = getSupabase();

    const { data: scraper, error } = await supabase
      .from('scrapers')
      .select('id, name, scraper_type, event_type')
      .eq('id', scraperId)
      .single();

    if (error || !scraper) {
      return res.status(404).json({ success: false, error: 'Scraper not found' });
    }

    const job = await addJob(JobTypes.SCRAPER_RUN, {
      scraperId: scraper.id,
      scraperName: scraper.name,
      scraperType: scraper.scraper_type,
      eventType: scraper.event_type,
      manual: true,
    });

    res.json({
      success: true,
      message: `Scraper "${scraper.name}" job enqueued`,
      job: { id: job.id, name: job.name },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get specific job
jobsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const job = await getJob(req.params.id as string);
    if (!job) {
      return res.status(404).json({ success: false, error: 'Job not found' });
    }
    res.json({ success: true, job });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Create job
jobsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { type, data = {}, options = {} } = req.body;
    if (!type) {
      return res.status(400).json({ success: false, error: 'Job type is required' });
    }
    if (!(Object.values(JobTypes) as string[]).includes(type)) {
      return res.status(400).json({ success: false, error: `Invalid job type: ${type}`, validTypes: Object.values(JobTypes) });
    }

    const job = await addJob(type, data, options);
    res.json({ success: true, job: { id: job.id, name: job.name, data: job.data } });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Retry job
jobsRouter.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await retryJob(id);
    res.json({ success: true, message: `Job ${id} queued for retry` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove job
jobsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await removeJob(id);
    res.json({ success: true, message: `Job ${id} removed` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Remove scheduled job
jobsRouter.delete('/scheduled/:key', async (req: Request, res: Response) => {
  try {
    await removeRepeatableJob(decodeURIComponent(req.params.key as string));
    res.json({ success: true, message: 'Scheduled job removed' });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Clean old jobs
jobsRouter.post('/clean', async (req: Request, res: Response) => {
  try {
    const { status = 'completed', grace = 24 * 3600 * 1000, limit = 1000 } = req.body;
    const removed = await cleanJobs({ status, grace, limit });
    res.json({ success: true, removed, message: `Cleaned ${removed} ${status} jobs` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});
