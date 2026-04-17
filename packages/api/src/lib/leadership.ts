/**
 * Application-level single-replica enforcement using Redis SETNX.
 * Prevents data corruption from concurrent migrations and edge deploys
 * in multi-replica scenarios.
 */

import type { Redis } from 'ioredis';
import { randomUUID } from 'crypto';

const LEADER_KEY = 'gatewaze:api:leader';
const LEASE_TTL_SECONDS = 30;
const REFRESH_INTERVAL_MS = 15_000;
const SAFE_MODE_GRACE_SECONDS = parseInt(process.env.SAFE_MODE_GRACE_SECS ?? '60', 10);

export interface LeadershipState {
  isLeader: boolean;
  instanceId: string;
  inSafeMode: boolean;
}

let state: LeadershipState = {
  isLeader: false,
  instanceId: randomUUID(),
  inSafeMode: false,
};

/**
 * Whether acquireLeadership() has been called.
 * If leadership was never initialized (e.g. no Redis configured),
 * isLeader() returns true to allow normal operation.
 */
let leadershipInitialized = false;

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let safeModeTimer: ReturnType<typeof setTimeout> | null = null;
let redisClient: Redis | null = null;
let onSafeMode: (() => void) | null = null;
let onShutdown: (() => void) | null = null;

/**
 * Attempt to acquire the leadership lease.
 * Returns true if acquired, false if another process holds it.
 */
export async function acquireLeadership(
  redis: Redis,
  callbacks?: { onSafeMode?: () => void; onShutdown?: () => void },
): Promise<boolean> {
  leadershipInitialized = true;
  redisClient = redis;
  onSafeMode = callbacks?.onSafeMode ?? null;
  onShutdown = callbacks?.onShutdown ?? null;

  const value = JSON.stringify({
    instanceId: state.instanceId,
    acquiredAt: new Date().toISOString(),
  });

  // SET NX EX — atomic acquire
  const result = await redis.set(LEADER_KEY, value, 'EX', LEASE_TTL_SECONDS, 'NX');

  if (result === 'OK') {
    state.isLeader = true;
    state.inSafeMode = false;

    // Start lease renewal
    refreshTimer = setInterval(async () => {
      try {
        const renewed = await redis.set(LEADER_KEY, value, 'EX', LEASE_TTL_SECONDS, 'XX');
        if (renewed !== 'OK') {
          enterSafeMode();
        }
      } catch {
        enterSafeMode();
      }
    }, REFRESH_INTERVAL_MS);

    console.log(JSON.stringify({
      level: 'info',
      message: 'Leadership acquired',
      instanceId: state.instanceId,
      ts: new Date().toISOString(),
    }));

    return true;
  }

  // Another process holds the lease
  const multiReplicaOk = process.env.GATEWAZE_MULTI_REPLICA_OK === 'true';
  if (multiReplicaOk) {
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'MULTI_REPLICA_ENABLED_UNSAFE_V1_1',
      instanceId: state.instanceId,
      ts: new Date().toISOString(),
    }));
    return false;
  }

  // Fatal — exit
  const currentLeader = await redis.get(LEADER_KEY);
  console.error(JSON.stringify({
    level: 'fatal',
    message: 'SINGLE_REPLICA_LOCK_FAILED',
    instanceId: state.instanceId,
    currentLeader: currentLeader ? JSON.parse(currentLeader) : null,
    ts: new Date().toISOString(),
  }));

  return false;
}

function enterSafeMode() {
  if (state.inSafeMode) return;

  state.isLeader = false;
  state.inSafeMode = true;

  console.error(JSON.stringify({
    level: 'error',
    message: 'Leadership lost — entering safe mode',
    instanceId: state.instanceId,
    ts: new Date().toISOString(),
  }));

  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }

  onSafeMode?.();

  // Schedule graceful shutdown
  safeModeTimer = setTimeout(() => {
    console.error(JSON.stringify({
      level: 'fatal',
      message: 'Safe mode grace period expired — shutting down',
      instanceId: state.instanceId,
      ts: new Date().toISOString(),
    }));
    onShutdown?.();
  }, SAFE_MODE_GRACE_SECONDS * 1000);
}

/**
 * Get current leadership state. Used by middleware to gate mutating operations.
 */
export function getLeadershipState(): LeadershipState {
  return { ...state };
}

/**
 * Check if this instance is currently the leader.
 * If leadership was never initialized (no Redis, dev mode),
 * returns true to allow normal single-instance operation.
 */
export function isLeader(): boolean {
  if (!leadershipInitialized) return true;
  return state.isLeader && !state.inSafeMode;
}

/**
 * Release leadership lease and clean up timers.
 */
export async function releaseLeadership(): Promise<void> {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (safeModeTimer) {
    clearTimeout(safeModeTimer);
    safeModeTimer = null;
  }
  if (redisClient && state.isLeader) {
    try {
      await redisClient.del(LEADER_KEY);
    } catch {
      // Best effort
    }
  }
  state.isLeader = false;
}
