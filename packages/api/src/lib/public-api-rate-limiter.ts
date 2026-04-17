const WINDOW_MS = 60_000;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

/** Per-key, per-bucket sliding window: stores request timestamps. */
const keyBuckets = new Map<string, number[]>();

/** Global sliding window: stores request timestamps. */
const globalBucket: number[] = [];

function bucketKey(keyId: string, bucket: 'read' | 'write'): string {
  return `${keyId}:${bucket}`;
}

function pruneTimestamps(timestamps: number[], now: number): void {
  while (timestamps.length > 0 && now - timestamps[0] >= WINDOW_MS) {
    timestamps.shift();
  }
}

function checkLimit(timestamps: number[], limitRpm: number, now: number): RateLimitResult {
  pruneTimestamps(timestamps, now);

  if (timestamps.length >= limitRpm) {
    const oldestInWindow = timestamps[0];
    const resetAt = Math.ceil((oldestInWindow + WINDOW_MS) / 1000);
    const retryAfter = Math.ceil((oldestInWindow + WINDOW_MS - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter: Math.max(1, retryAfter),
    };
  }

  timestamps.push(now);

  const resetAt = timestamps.length > 0
    ? Math.ceil((timestamps[0] + WINDOW_MS) / 1000)
    : Math.ceil((now + WINDOW_MS) / 1000);

  return {
    allowed: true,
    remaining: limitRpm - timestamps.length,
    resetAt,
  };
}

/**
 * Check rate limit for a specific API key and bucket (read or write).
 * Records the request if allowed.
 */
export function checkKeyRateLimit(
  keyId: string,
  bucket: 'read' | 'write',
  limitRpm: number,
): RateLimitResult {
  const key = bucketKey(keyId, bucket);
  let timestamps = keyBuckets.get(key);
  if (!timestamps) {
    timestamps = [];
    keyBuckets.set(key, timestamps);
  }
  return checkLimit(timestamps, limitRpm, Date.now());
}

/**
 * Check the global rate limit across all API keys.
 * Uses the PUBLIC_API_GLOBAL_RPM env var (default 1000).
 */
export function checkGlobalRateLimit(): RateLimitResult {
  const globalLimitRpm = parseInt(process.env.PUBLIC_API_GLOBAL_RPM ?? '1000', 10);
  return checkLimit(globalBucket, globalLimitRpm, Date.now());
}
