export type ClientId = 'claude-desktop' | 'claude-code' | 'goose' | 'chatgpt';

export const CLIENT_IDS: ClientId[] = ['claude-desktop', 'claude-code', 'goose', 'chatgpt'];

export interface DetectedClient {
  id: ClientId;
  label: string;
  detected: boolean;
  /** Human-readable note on how/where it was (not) found. */
  detail: string;
}

export type ApplyStatus =
  | 'added' // entry written
  | 'updated' // existing entry overwritten (force/confirmed)
  | 'unchanged' // entry already present and identical
  | 'conflict' // entry exists with different settings; caller must confirm
  | 'would-add' // dry-run: would write a new entry
  | 'would-update' // dry-run: would overwrite an existing entry
  | 'error';

export interface ApplyResult {
  status: ApplyStatus;
  message: string;
  /** Path of the timestamped backup written before mutation, when one was made. */
  backupPath?: string;
  /** Dry-run: the full content that would be written. */
  plannedContent?: string;
}

export interface ApplyOptions {
  /** Overwrite an existing, different entry with the same name. */
  overwrite?: boolean;
  /** Compute and report the change without writing anything. */
  dryRun?: boolean;
  /** Clock override for deterministic backup names in tests. */
  now?: Date;
}
