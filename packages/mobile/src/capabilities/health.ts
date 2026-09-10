/**
 * The health-data capability: HealthKit, wrapped.
 *
 * Part of the capability kit, beside camera and barcode. The core owns the
 * native tooling and knows nothing about what the data means, so this file
 * mentions no metric, no module and no body part. A module maps
 * `HKQuantityTypeIdentifierBodyMass` to whatever it calls a weight; the core
 * only knows how to read it.
 *
 * Two rules are encoded here rather than left to callers, because getting
 * either wrong produces plausible, wrong numbers:
 *
 * 1. Cumulative totals (steps, distance, energy) MUST go through a statistics
 *    query. A member carrying an iPhone and wearing a Watch has each step
 *    recorded by both, and summing raw samples counts them twice. Apple's
 *    statistics queries apply their own source-priority rules; nothing we
 *    could write would match them.
 *
 * 2. Day boundaries come from the caller, not the device. `Calendar.current`
 *    cuts days wherever the phone currently is, so a member who flies gets a
 *    short day and then a long one. The caller passes the zone it wants.
 *
 * Everything is iOS-only. On any other platform `isAvailable()` answers false
 * and the rest throw, so a caller has one thing to check.
 */

import { Platform } from 'react-native';

type Hk = typeof import('@kingstinct/react-native-healthkit');

/**
 * Loaded on demand. The native module is only in a build whose modules asked
 * for the `health` capability, so importing it at file scope would break
 * every other build at startup.
 */
let hk: Hk | null = null;
function native(): Hk {
  if (Platform.OS !== 'ios') {
    throw new Error('Health data is only available on iOS.');
  }
  if (!hk) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    hk = require('@kingstinct/react-native-healthkit') as Hk;
  }
  return hk;
}

export interface HealthSample {
  /** HealthKit's own UUID for this sample. Stable, so callers dedupe on it. */
  uuid: string;
  startDate: string;
  endDate: string;
  value: number;
  unit: string;
  /** The app that wrote it, e.g. 'com.withings.HealthMate'. */
  sourceBundleId: string;
  sourceName: string;
}

export interface HealthDailyTotal {
  /** Local calendar date, YYYY-MM-DD, in the zone the caller asked for. */
  date: string;
  value: number;
  unit: string;
}

export interface AnchoredResult {
  samples: HealthSample[];
  /** Sample UUIDs HealthKit reports as deleted since the anchor. */
  deleted: string[];
  /** Opaque; hand it back next time to get only what changed. */
  anchor: string | null;
}

export function isAvailable(): boolean {
  if (Platform.OS !== 'ios') return false;
  try {
    return native().isHealthDataAvailable();
  } catch {
    return false;
  }
}

/**
 * Ask for permission.
 *
 * iOS deliberately does not report which types were denied, only that the
 * sheet was answered. A caller therefore cannot tell "denied" from "no data",
 * and must treat an empty read as the latter. Never tell a member they have no
 * steps on the strength of an empty result.
 */
export async function requestPermissions(opts: {
  read?: string[];
  write?: string[];
}): Promise<boolean> {
  const api = native();
  return api.requestAuthorization({
    toRead: (opts.read ?? []) as never,
    toShare: (opts.write ?? []) as never,
  } as never);
}

/** This app's own bundle id, so callers can skip samples they wrote. */
export function ownSourceBundleId(): string | null {
  try {
    return native().currentAppSource()?.bundleIdentifier ?? null;
  } catch {
    return null;
  }
}

function toSample(s: Record<string, unknown>, unit: string): HealthSample {
  const src = (s.sourceRevision as Record<string, unknown> | undefined)?.source as
    | Record<string, unknown>
    | undefined;
  return {
    uuid: String(s.uuid ?? ''),
    startDate: new Date(s.startDate as string).toISOString(),
    endDate: new Date(s.endDate as string).toISOString(),
    value: Number(s.quantity ?? s.value ?? 0),
    unit,
    sourceBundleId: String(src?.bundleIdentifier ?? ''),
    sourceName: String(src?.name ?? ''),
  };
}

/**
 * Everything that changed for one type since `anchor`, including deletions.
 *
 * Deletions are the reason to use an anchored query rather than a date range.
 * A member who corrects a bad weight in Apple Health should not be left with
 * the wrong value in our copy.
 */
export async function readChanged(opts: {
  type: string;
  unit: string;
  anchor?: string | null;
  limit?: number;
}): Promise<AnchoredResult> {
  const api = native();
  const res = (await api.queryQuantitySamplesWithAnchor(opts.type as never, {
    anchor: opts.anchor ?? undefined,
    limit: opts.limit ?? 500,
    unit: opts.unit,
  } as never)) as unknown as {
    samples?: Record<string, unknown>[];
    deletedSamples?: { uuid?: string }[];
    newAnchor?: string;
  };
  return {
    samples: (res.samples ?? []).map((s) => toSample(s, opts.unit)),
    deleted: (res.deletedSamples ?? []).map((d) => String(d.uuid ?? '')).filter(Boolean),
    anchor: res.newAnchor ?? null,
  };
}

/** The same, for category types such as sleep. */
export async function readChangedCategory(opts: {
  type: string;
  anchor?: string | null;
  limit?: number;
}): Promise<AnchoredResult> {
  const api = native();
  const res = (await api.queryCategorySamplesWithAnchor(opts.type as never, {
    anchor: opts.anchor ?? undefined,
    limit: opts.limit ?? 500,
  } as never)) as unknown as {
    samples?: Record<string, unknown>[];
    deletedSamples?: { uuid?: string }[];
    newAnchor?: string;
  };
  return {
    // A category sample's "value" is its enum case, e.g. which sleep stage.
    samples: (res.samples ?? []).map((s) => toSample(s, 'category')),
    deleted: (res.deletedSamples ?? []).map((d) => String(d.uuid ?? '')).filter(Boolean),
    anchor: res.newAnchor ?? null,
  };
}

/**
 * Per-day totals between two dates, deduplicated across sources by HealthKit.
 *
 * `timeZone` decides where a day starts and ends. Pass the one the member's
 * data is anchored to, not the device's, or a trip abroad silently reshapes
 * their history.
 */
export async function readDailyTotals(opts: {
  type: string;
  unit: string;
  from: Date;
  to: Date;
  timeZone: string;
  statistic?: 'cumulativeSum' | 'discreteAverage' | 'discreteMin' | 'discreteMax';
}): Promise<HealthDailyTotal[]> {
  const api = native();
  const statistic = opts.statistic ?? 'cumulativeSum';

  // Anchor on midnight of the first day IN THE TARGET ZONE, so the buckets
  // line up with the member's days rather than the device's.
  const anchorDate = startOfDayInZone(opts.from, opts.timeZone);

  const res = (await api.queryStatisticsCollectionForQuantity(
    opts.type as never,
    [statistic] as never,
    anchorDate,
    { day: 1 } as never,
    { filter: { startDate: opts.from, endDate: opts.to }, unit: opts.unit } as never
  )) as unknown as Record<string, unknown>[];

  return (res ?? []).map((r) => {
    const holder = (r[statistic] ?? r.sumQuantity ?? r.averageQuantity) as
      | Record<string, unknown>
      | number
      | undefined;
    const value =
      typeof holder === 'number' ? holder : Number((holder as Record<string, unknown>)?.quantity ?? 0);
    return {
      date: formatDateInZone(new Date(r.startDate as string), opts.timeZone),
      value,
      unit: opts.unit,
    };
  });
}

/** Wake the app when new data of these types lands. */
export async function observe(types: string[]): Promise<void> {
  const api = native();
  for (const type of types) {
    await api.enableBackgroundDelivery(type as never, 'hourly' as never).catch(() => undefined);
  }
}

export async function stopObserving(): Promise<void> {
  try {
    await native().disableAllBackgroundDelivery();
  } catch {
    // Nothing to stop is a normal outcome, not an error.
  }
}

// ── Writing ────────────────────────────────────────────────────────────────
//
// HealthKit has no update. Changing a value means deleting the sample and
// saving a new one, and an app may only delete samples it wrote itself. So a
// caller that wants to keep our data and Apple's in step has to remember which
// UUID it created for each of its records.

export async function writeSample(opts: {
  type: string;
  unit: string;
  value: number;
  start: Date;
  end?: Date;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  const api = native();
  // The library types identifiers and units as narrow string unions. The
  // caller passes HealthKit identifiers as plain strings, so the whole call is
  // cast once here rather than the union being restated across the core.
  const save = api.saveQuantitySample as unknown as (
    id: string, unit: string, value: number, start: Date, end: Date, meta?: unknown,
  ) => Promise<{ uuid?: string } | undefined>;
  const saved = await save(
    opts.type,
    opts.unit,
    opts.value,
    opts.start,
    opts.end ?? opts.start,
    opts.metadata
  );
  // The UUID is the only handle we get for deleting it later, so a caller
  // that means to keep the two sides in step has to store it.
  return saved?.uuid ?? null;
}

/** Returns the new workout's UUID, which the caller must keep to delete it. */
export async function writeWorkout(opts: {
  activityType: number;
  start: Date;
  end: Date;
  energyKcal?: number;
  distanceM?: number;
  metadata?: Record<string, unknown>;
}): Promise<string | null> {
  const api = native();
  const totals: Record<string, unknown> = {};
  if (opts.energyKcal != null) totals.totalEnergyBurned = { unit: 'kcal', quantity: opts.energyKcal };
  if (opts.distanceM != null) totals.totalDistance = { unit: 'm', quantity: opts.distanceM };

  const proxy = (await api.saveWorkoutSample(
    opts.activityType as never,
    [] as never,
    opts.start,
    opts.end,
    totals as never,
    opts.metadata as never
  )) as unknown as { uuid?: string } | null;
  return proxy?.uuid ?? null;
}

/**
 * Remove samples this app wrote. HealthKit refuses to delete another app's
 * data, so this only ever affects our own, and deletion is by type plus a
 * uuid filter rather than by uuid alone.
 */
export async function deleteWritten(type: string, uuids: string[]): Promise<number> {
  if (uuids.length === 0) return 0;
  const api = native();
  const n = (await api.deleteObjects(type as never, { uuids } as never)) as unknown as number;
  return Number(n ?? 0);
}

// ── Zone helpers ───────────────────────────────────────────────────────────

/** YYYY-MM-DD for an instant, as seen in a given zone. */
export function formatDateInZone(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Midnight, in a given zone, of the day containing `at`.
 *
 * Built by asking what the wall clock reads in that zone and subtracting it,
 * which avoids hardcoding any offset and so survives daylight saving.
 */
export function startOfDayInZone(at: Date, timeZone: string): Date {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const num = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? '0');
  const ms =
    num('hour') * 3_600_000 + num('minute') * 60_000 + num('second') * 1000 + at.getMilliseconds();
  return new Date(at.getTime() - ms);
}

/** The zone the device is in. Only for a first guess when nothing is stored. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
