import pg from 'pg';
import { logger } from './logger.js';

const { Client: PgClient } = pg;

export interface ListenHandle {
  channel: string;
  close: () => Promise<void>;
}

/**
 * Open a dedicated Postgres connection and LISTEN on `channel`. When a
 * notification arrives, calls `onNotify(payload)`. Also runs `onPoll()`
 * every `pollIntervalMs` as a fallback (Postgres does not queue NOTIFY
 * for disconnected listeners).
 *
 * The connection is independent of any pool the caller already uses —
 * it's a long-lived, dedicated LISTEN connection.
 *
 * DATABASE_URL or the individual PG* env vars are read by the `pg`
 * Client from its usual places.
 */
export async function startListener(opts: {
  channel: string;
  onNotify: (payload: string) => Promise<void> | void;
  onPoll: () => Promise<void> | void;
  pollIntervalMs?: number;
  connectionString?: string;
}): Promise<ListenHandle> {
  const connectionString = opts.connectionString ?? process.env.DATABASE_URL;
  if (!connectionString && !process.env.PGHOST) {
    throw new Error(
      `LISTEN on "${opts.channel}" requested but DATABASE_URL / PGHOST are not set`,
    );
  }

  const client = new PgClient({ connectionString });
  await client.connect();
  await client.query(`LISTEN "${opts.channel.replace(/"/g, '""')}"`);

  client.on('notification', (msg: pg.Notification) => {
    if (msg.channel !== opts.channel) return;
    Promise.resolve(opts.onNotify(msg.payload ?? ''))
      .catch((err: unknown) => logger.error(
        { channel: opts.channel, err: (err as Error).message },
        'listener onNotify failed',
      ));
  });

  client.on('error', (err: Error) => {
    logger.error({ channel: opts.channel, err: err.message }, 'listener connection error');
  });

  const poll = setInterval(() => {
    Promise.resolve(opts.onPoll())
      .catch((err) => logger.error(
        { channel: opts.channel, err: (err as Error).message },
        'listener onPoll failed',
      ));
  }, opts.pollIntervalMs ?? 30_000);
  poll.unref?.();

  logger.info({ channel: opts.channel }, 'listener started');

  return {
    channel: opts.channel,
    close: async () => {
      clearInterval(poll);
      try {
        await client.query(`UNLISTEN "${opts.channel.replace(/"/g, '""')}"`);
      } catch {
        // ignore
      }
      await client.end();
    },
  };
}
