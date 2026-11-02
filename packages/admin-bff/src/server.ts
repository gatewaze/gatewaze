// Entry point: reads the environment, connects the session store, and serves
// the BFF until SIGTERM/SIGINT.
import type { FastifyBaseLogger } from 'fastify';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { SessionStore } from '@gatewaze/host-session';
import { appOptionsFromEnv, storeOptionsFromEnv } from './wiring.js';

const env = loadConfig();

// Redis errors can arrive before the app (and its logger) exists.
const logRef: { current?: FastifyBaseLogger } = {};
const store = await SessionStore.connect(env.cfg, env.redisUrl, {
  ...storeOptionsFromEnv(env),
  onError: (err) =>
    logRef.current ? logRef.current.error({ err: err.message }, 'redis error') : console.error('redis error:', err.message),
});

const app = await buildApp(appOptionsFromEnv(env, store));
logRef.current = app.log;

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  let code = 0;
  try {
    await app.close();
  } catch (e) {
    code = 1;
    app.log.error({ err: (e as Error).message }, 'error while closing the server');
  } finally {
    await store.close();
  }
  process.exit(code);
};
// Backstop only: an error that escaped every handler leaves the process in
// an unknown state, so log it and exit; Kubernetes restarts the pod. Errors
// the BFF expects are handled where they happen.
process.on('uncaughtException', (err) => {
  app.log.fatal({ err: err.message, stack: err.stack }, 'uncaught exception; exiting');
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  app.log.fatal({ err: (reason as Error)?.message ?? String(reason) }, 'unhandled rejection; exiting');
  process.exit(1);
});
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));

await app.listen({ host: env.host, port: env.port });
