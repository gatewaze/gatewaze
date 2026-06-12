/**
 * Defensive sanitiser for the admin {@link NavLayout} document.
 *
 * The layout is written by clients (the Navigation editor) and stored as a
 * JSON string (org) / jsonb (per-user). Both write paths run untrusted input
 * through this function before persisting, so a hand-crafted request body can
 * never inject unknown fields, oversized payloads, or wrong-typed values. It
 * reconstructs a fresh object containing only known fields with coerced types
 * and bounded sizes — anything unrecognised is dropped, not preserved.
 */

import type { NavLayout, NavLayoutItem, NavLayoutSection } from '../types/modules';

/** Thrown when the input cannot be coerced into a NavLayout at all. */
export class NavLayoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NavLayoutValidationError';
  }
}

// Bounds — generous enough for any real layout, tight enough to reject abuse.
const MAX_SECTIONS = 50;
const MAX_ITEMS_PER_SECTION = 300;
const MAX_HIDDEN = 1000;
const MAX_STR = 200;

function str(value: unknown, max = MAX_STR): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function sanitizeItem(input: unknown): NavLayoutItem | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const key = str(raw.key);
  if (!key) return null;

  const item: NavLayoutItem = { key };
  const icon = str(raw.icon);
  const label = str(raw.label);
  if (icon) item.icon = icon;
  if (label) item.label = label;
  return item;
}

function sanitizeItems(input: unknown): NavLayoutItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_ITEMS_PER_SECTION)
    .map(sanitizeItem)
    .filter((i): i is NavLayoutItem => i !== null);
}

function sanitizeSection(input: unknown, index: number): NavLayoutSection | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  // A section must have a stable id; fall back to a positional slug so a
  // missing id doesn't silently merge two sections.
  const id = str(raw.id, 64) ?? `section-${index}`;

  const section: NavLayoutSection = { id, items: sanitizeItems(raw.items) };
  const title = str(raw.title);
  const icon = str(raw.icon);
  if (title) section.title = title;
  if (icon) section.icon = icon;
  return section;
}

/**
 * Coerce untrusted input into a clean NavLayout. Throws
 * {@link NavLayoutValidationError} only when the input is not a usable object;
 * structurally-odd-but-recoverable input is repaired (bad entries dropped).
 */
export function sanitizeNavLayout(input: unknown): NavLayout {
  if (!input || typeof input !== 'object') {
    throw new NavLayoutValidationError('Layout must be an object');
  }
  const raw = input as Record<string, unknown>;

  if (!Array.isArray(raw.sidebar)) {
    throw new NavLayoutValidationError('Layout.sidebar must be an array');
  }

  const sidebar = raw.sidebar
    .slice(0, MAX_SECTIONS)
    .map((s, i) => sanitizeSection(s, i))
    .filter((s): s is NavLayoutSection => s !== null);

  const settings = sanitizeItems(raw.settings);

  const hidden = Array.isArray(raw.hidden)
    ? raw.hidden
        .slice(0, MAX_HIDDEN)
        .map((h) => str(h))
        .filter((h): h is string => h !== undefined)
    : [];

  const layout: NavLayout = { version: 1, sidebar, settings, hidden };

  const defaultRoute = str(raw.defaultRoute, 512);
  if (defaultRoute) layout.defaultRoute = defaultRoute;

  return layout;
}
