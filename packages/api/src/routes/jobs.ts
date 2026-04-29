/**
 * Jobs API Routes — background job management via BullMQ.
 *
 * Routes read from / write to the queue layer at packages/api/src/lib/queue.
 * See spec-job-queue-redis-architecture.md §6.3 for the admin endpoint
 * contract.
 */

import { type Request, type Response } from 'express';
import {
  getJobs,
  getJobCounts,
  getAllQueueCounts,
  getJob,
  retryJob,
  removeJob,
  cleanJobs,
  getRepeatableJobs,
  removeRepeatableJob,
  isQueueConfigured,
  enqueue,
  JobTypes,
  listQueues,
} from '../lib/queue/index.js';
// SERVICE-ROLE OK: admin job-queue management. Reads job-state tables
// that are platform-wide (no account_id); BullMQ data lives in Redis
// and is operator-managed. Service-role here is correct.
import { getSupabase } from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';

export const jobsRouter = labeledRouter('jwt');
jobsRouter.use(requireJwt());

// Guard: all job routes require Redis.
jobsRouter.use((_req: Request, res: Response, next) => {
  if (!isQueueConfigured()) {
    return res.status(503).json({ success: false, error: 'Job queue not available (Redis not configured)' });
  }
  next();
});

jobsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { status, start = '0', end = '100', queue } = req.query;
    const statusArray = status
      ? (status as string).split(',')
      : ['waiting', 'active', 'completed', 'failed', 'delayed'];
    const jobs = await getJobs({
      queue: queue as string | undefined,
      status: statusArray,
      start: parseInt(start as string, 10),
      end: parseInt(end as string, 10),
    });
    res.json({ success: true, jobs, count: jobs.length });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

jobsRouter.get('/counts', async (req: Request, res: Response) => {
  try {
    const queue = req.query.queue as string | undefined;
    const counts = queue ? await getJobCounts(queue) : await getAllQueueCounts();
    res.json({ success: true, counts });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

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

jobsRouter.get('/queues', (_req: Request, res: Response) => {
  res.json({ success: true, queues: listQueues().map((q) => ({ name: q.name, module: q.module })) });
});

jobsRouter.get('/scheduled', async (req: Request, res: Response) => {
  try {
    const queue = req.query.queue as string | undefined;
    const jobs = await getRepeatableJobs(queue);
    res.json({ success: true, jobs });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

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

    if (error) return res.status(500).json({ success: false, error: error.message });

    const schedules = (scrapers ?? []).map((s: Record<string, unknown>) => ({
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
      enabledCount: schedules.filter((s) => s.scheduleEnabled).length,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

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

    const result = await enqueue('jobs', JobTypes.SCRAPER_RUN, {
      scraperId: scraper.id,
      scraperName: scraper.name,
      scraperType: scraper.scraper_type,
      eventType: scraper.event_type,
      manual: true,
    });

    res.json({
      success: true,
      message: `Scraper "${scraper.name}" job enqueued`,
      job: { id: result.jobId, name: JobTypes.SCRAPER_RUN },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

jobsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const queue = req.query.queue as string | undefined;
    const job = await getJob(req.params.id as string, queue);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, job });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

jobsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { type, data = {}, options = {}, queue = 'jobs' } = req.body;
    if (!type) return res.status(400).json({ success: false, error: 'Job type is required' });

    const result = await enqueue(queue, type, data, undefined, options);
    res.json({ success: true, job: { id: result.jobId, name: type, data, queue } });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

jobsRouter.post('/:id/retry', async (req: Request, res: Response) => {
  try {
    const queue = req.query.queue as string | undefined;
    await retryJob(req.params.id as string, queue);
    res.json({ success: true, message: `Job ${req.params.id} queued for retry` });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

jobsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const queue = req.query.queue as string | undefined;
    await removeJob(req.params.id as string, queue);
    res.json({ success: true, message: `Job ${req.params.id} removed` });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

jobsRouter.delete('/scheduled/:key', async (req: Request, res: Response) => {
  try {
    const queue = req.query.queue as string | undefined;
    await removeRepeatableJob(decodeURIComponent(req.params.key as string), queue);
    res.json({ success: true, message: 'Scheduled job removed' });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

jobsRouter.post('/clean', async (req: Request, res: Response) => {
  try {
    const { status = 'completed', grace = 24 * 3600 * 1000, limit = 1000, queue } = req.body;
    const removed = await cleanJobs({ queue, status, grace, limit });
    res.json({ success: true, removed, message: `Cleaned ${removed} ${status} jobs` });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});
