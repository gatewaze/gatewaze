import { z } from 'zod';

export const ScreenshotJobSchema = z.object({
  eventIds: z.array(z.string()).nullable(),
  forceRegenerate: z.boolean().default(false),
  forceBrowserless: z.boolean().optional(),
  screenshotJobId: z.string().optional(),
});
export type ScreenshotJobData = z.infer<typeof ScreenshotJobSchema>;

export const EmailJobSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  html: z.string().optional(),
  templateId: z.string().optional(),
}).refine((d) => d.html || d.templateId, {
  message: 'Either html or templateId is required',
});
export type EmailJobData = z.infer<typeof EmailJobSchema>;

export const ImageProcessJobSchema = z.object({
  eventId: z.string(),
  imageUrl: z.string().url(),
});
export type ImageProcessJobData = z.infer<typeof ImageProcessJobSchema>;

export const ScraperRunSchema = z.object({
  scraperId: z.union([z.string(), z.number()]),
  scraperName: z.string().optional(),
  scraperType: z.string().optional(),
  eventType: z.string().optional(),
  manual: z.boolean().optional(),
});
export type ScraperRunData = z.infer<typeof ScraperRunSchema>;

/**
 * Minimal passthrough schema for handler types where validation is best-
 * effort. Built-in job types that don't yet have formal schemas use this
 * until they're hardened. Prefer defining an explicit schema.
 */
export const PassthroughSchema = z.record(z.string(), z.unknown());

/**
 * Built-in job type identifiers. Stringly-typed values are the job names
 * used on the `jobs` queue.
 */
export const JobTypes = {
  SCRAPER_RUN: 'scraper:run',
  SCRAPER_RUN_ALL: 'scraper:run-all',
  CUSTOMERIO_SYNC_INCREMENTAL: 'customerio:sync-incremental',
  CUSTOMERIO_SYNC_FULL: 'customerio:sync-full',
  CUSTOMERIO_SYNC_ACTIVITIES: 'customerio:sync-activities',
  CUSTOMERIO_SYNC_SEGMENTS: 'customerio:sync-segments',
  EMBEDDING_GENERATE: 'embedding:generate',
  AVATAR_SYNC: 'avatar:sync',
  GRAVATAR_SYNC: 'gravatar:sync',
  SCREENSHOT_GENERATE: 'screenshot:generate',
  LUMA_CONTENT_PROCESS: 'luma:content-process',
  MEETUP_CONTENT_PROCESS: 'meetup:content-process',
  MEDIA_PROCESS_ZIP: 'media:process-zip',
  // Bulk speaker extraction enqueued at the end of a scrape run; payload
  // is { event_uuids: string[], scraper_id, brand_id }. The handler runs
  // Anthropic per-event with budget enforcement via callAnthropic.
  // See premium-gatewaze-modules/modules/scrapers/scripts/workers/speaker-extract-handler.js
  SCRAPER_SPEAKER_EXTRACT: 'scraper:speaker-extract',
} as const;

export type JobTypeValue = (typeof JobTypes)[keyof typeof JobTypes];

/**
 * Mapping from built-in job names on the shared `jobs` queue to their
 * Zod schemas. Used by `enqueue()` when no explicit schema is passed
 * (defence in depth at the boundary).
 */
export const builtInJobSchemas: Record<string, z.ZodTypeAny> = {
  [JobTypes.SCREENSHOT_GENERATE]: ScreenshotJobSchema,
  [JobTypes.SCRAPER_RUN]: ScraperRunSchema,
  // Others fall through to PassthroughSchema until formalised.
};
