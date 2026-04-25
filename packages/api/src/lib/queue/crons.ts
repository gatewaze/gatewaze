import type { CronDefinition } from '@gatewaze/shared/modules';
import { getQueueOrThrow, listQueues, UnknownQueueError } from './registry.js';
import { logger } from './logger.js';

export interface LoadedCron {
  module: string;
  def: CronDefinition;
}

/**
 * Upsert all module crons. Returns the set of (queue, schedulerKey) tuples
 * installed. Caller (scheduler reconciliation) diffs this against the
 * currently-installed schedulers to prune removed modules.
 */
export async function upsertCrons(entries: LoadedCron[]): Promise<Set<string>> {
  const seenNames = new Set<string>();
  const installed = new Set<string>();

  for (const { module, def } of entries) {
    if (seenNames.has(def.name)) {
      throw new Error(
        `Duplicate cron name "${def.name}" (second occurrence in module "${module}")`,
      );
    }
    seenNames.add(def.name);

    let queue;
    try {
      queue = getQueueOrThrow(def.queue);
    } catch (err) {
      if (err instanceof UnknownQueueError) {
        logger.error(
          { cron: def.name, module, queue: def.queue },
          'cron references unknown queue — skipping',
        );
        continue;
      }
      throw err;
    }

    const repeatOpts = 'every' in def.schedule
      ? { every: def.schedule.every }
      : { pattern: def.schedule.pattern, tz: def.schedule.tz };

    await upsertWithRetry(async () => {
      await queue.upsertJobScheduler(
        def.name,
        repeatOpts,
        { name: def.data.kind, data: def.data },
      );
    }, def.name);

    installed.add(`${def.queue}::${def.name}`);
    logger.info({ cron: def.name, queue: def.queue, module }, 'cron upserted');
  }

  return installed;
}

async function upsertWithRetry(fn: () => Promise<void>, cronName: string): Promise<void> {
  const maxAttempts = 5;
  let delay = 1000;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      logger.warn(
        { cron: cronName, attempt, err: (err as Error).message, nextDelayMs: delay },
        'cron upsert failed, retrying',
      );
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 30_000);
    }
  }
}

/**
 * Prune scheduler entries not in the installed set. Walks every known
 * queue's scheduler list; drops any whose key isn't in `installed`.
 */
export async function pruneCrons(installed: Set<string>): Promise<number> {
  let removed = 0;
  for (const cfg of listQueues()) {
    const q = getQueueOrThrow(cfg.name);
    const schedulers = await q.getJobSchedulers();
    for (const sched of schedulers) {
      const key = `${cfg.name}::${sched.key ?? sched.name}`;
      if (!installed.has(key)) {
        try {
          await q.removeJobScheduler(sched.key ?? sched.name);
          removed++;
          logger.info({ cron: sched.name, queue: cfg.name }, 'pruned orphan cron');
        } catch (err) {
          logger.warn(
            { cron: sched.name, queue: cfg.name, err: (err as Error).message },
            'failed to prune cron',
          );
        }
      }
    }
  }
  return removed;
}
