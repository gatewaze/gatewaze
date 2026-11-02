import { describe, it, expect } from 'vitest';
import { decideUpdateState } from '../modules';

/**
 * Regression cover for the permanent "update available" banner.
 *
 * /sources/refresh used to compare upstream against installed_modules
 * .source_snapshot_hash alone. That column is only written by /enable and
 * /apply-update, so a module installed before the dual-tree flow, or updated
 * through /update-all, carries a stale or absent value while running code
 * that is already identical to upstream. The operator saw an update banner
 * for a module with nothing to update, "Update All" reported 0 modules
 * updated because it looks at versions rather than that table, and the
 * banner returned on every refresh.
 */
describe('decideUpdateState', () => {
  const UPSTREAM = 'a'.repeat(64);
  const OTHER = 'b'.repeat(64);

  it('reports nothing when the recorded hash already agrees with upstream', () => {
    expect(
      decideUpdateState({ upstreamHash: UPSTREAM, snapshotHash: UPSTREAM, liveHash: UPSTREAM }),
    ).toBe('none');
  });

  it('repairs instead of flagging when the record is stale but the live tree matches upstream', () => {
    expect(
      decideUpdateState({ upstreamHash: UPSTREAM, snapshotHash: OTHER, liveHash: UPSTREAM }),
    ).toBe('repair');
  });

  it('repairs when the record is missing entirely, as it is for older installs', () => {
    expect(
      decideUpdateState({ upstreamHash: UPSTREAM, snapshotHash: null, liveHash: UPSTREAM }),
    ).toBe('repair');
  });

  it('still reports a genuine update when the live tree really differs', () => {
    expect(
      decideUpdateState({ upstreamHash: UPSTREAM, snapshotHash: OTHER, liveHash: OTHER }),
    ).toBe('available');
  });

  it('reports an update when the record agrees but the live tree has drifted', () => {
    // Someone edited the live tree by hand, or a snapshot install half-failed.
    // Upstream is what should be running, so this is a real update.
    expect(
      decideUpdateState({ upstreamHash: UPSTREAM, snapshotHash: OTHER, liveHash: null }),
    ).toBe('available');
  });

  it('does not repair on an unreadable live tree', () => {
    // No live tree means nothing proves the deployed code matches upstream,
    // so it must not silently rewrite the record.
    expect(
      decideUpdateState({ upstreamHash: UPSTREAM, snapshotHash: null, liveHash: null }),
    ).toBe('available');
  });
});
