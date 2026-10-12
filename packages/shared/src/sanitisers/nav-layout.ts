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

import type { NavHubAccent, NavLayout, NavLayoutItem, NavLayoutSection } from '../types/modules';

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
const MAX_HUBS = 20;
const MAX_STR = 200;

/**
 * Valid hub id (see NavigationItem.hub): a lowercase slug. The admin resolver
 * ignores hubs whose id fails this, so the editor never offers a hub whose
 * items this sanitiser would drop on save. It also keeps prototype keys such
 * as `__proto__` out of the `hubs` record.
 */
export const NAV_HUB_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Key prefix of a custom hub card (one that links to a URL, not a nav item). */
export const NAV_HUB_LINK_PREFIX = 'link:';

/** Valid custom hub card key: `link:` plus a lowercase slug. */
export const NAV_HUB_LINK_KEY_PATTERN = /^link:[a-z0-9][a-z0-9-]{0,63}$/;

const MAX_HUB_DESCRIPTION = 300;
const MAX_HUB_EYEBROW = 60;
const MAX_HUB_TAGS = 5;
const MAX_HUB_TAG = 40;
const MAX_HUB_URL = 2000;

// A Record, so adding a colour to NavHubAccent fails to compile until it is
// listed here too.
const HUB_ACCENTS: Record<NavHubAccent, true> = {
  violet: true,
  blue: true,
  green: true,
  amber: true,
  red: true,
  sky: true,
  purple: true,
  teal: true,
};

/** Every hub card accent colour, in the order cards take them by default. */
export const NAV_HUB_ACCENTS = Object.keys(HUB_ACCENTS) as NavHubAccent[];

export function isNavHubAccent(value: unknown): value is NavHubAccent {
  return typeof value === 'string' && Object.hasOwn(HUB_ACCENTS, value);
}

/**
 * Whether `url` is safe as a custom hub card link: an absolute http(s) URL
 * with a host and no credentials, or a path starting with a single '/'.
 * Everything else is refused, including `javascript:` and `data:` URLs,
 * protocol-relative `//host` links, backslashes, whitespace and control
 * characters. The layout is stored data that other admins render, so this is
 * checked both when it is saved and when it is rendered.
 */
export function isSafeHubUrl(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0 || url.length > MAX_HUB_URL) return false;
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\u0000-\u0020\u007f\\]/.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
    parsed.hostname !== '' &&
    parsed.username === '' &&
    parsed.password === ''
  );
}

function str(value: unknown, max = MAX_STR): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function sanitizeItem(input: unknown, allowChildren: boolean): NavLayoutItem | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const key = str(raw.key);
  if (!key) return null;

  const item: NavLayoutItem = { key };
  const icon = str(raw.icon);
  const label = str(raw.label);
  if (icon) item.icon = icon;
  if (label) item.label = label;

  // Groups nest one level only — children are always leaves.
  if (allowChildren && Array.isArray(raw.children)) {
    const children = sanitizeItems(raw.children, false);
    if (children.length > 0) item.children = children;
  }
  return item;
}

function sanitizeItems(input: unknown, allowChildren = true): NavLayoutItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, MAX_ITEMS_PER_SECTION)
    .map((i) => sanitizeItem(i, allowChildren))
    .filter((i): i is NavLayoutItem => i !== null);
}

/** A hub's cards: a flat list (no groups), one card per key. */
function sanitizeHubCards(input: unknown): NavLayoutItem[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const cards: NavLayoutItem[] = [];
  for (const raw of input.slice(0, MAX_ITEMS_PER_SECTION)) {
    const card = sanitizeHubCard(raw);
    if (!card || seen.has(card.key)) continue;
    seen.add(card.key);
    cards.push(card);
  }
  return cards;
}

function sanitizeHubCard(input: unknown): NavLayoutItem | null {
  const card = sanitizeItem(input, false);
  if (!card) return null;
  const raw = input as Record<string, unknown>;

  const description = str(raw.description, MAX_HUB_DESCRIPTION);
  const eyebrow = str(raw.eyebrow, MAX_HUB_EYEBROW);
  const tags = Array.isArray(raw.tags)
    ? [...new Set(raw.tags.map((t) => str(t, MAX_HUB_TAG)).filter((t): t is string => t !== undefined))].slice(
        0,
        MAX_HUB_TAGS,
      )
    : [];
  if (description) card.description = description;
  if (eyebrow) card.eyebrow = eyebrow;
  if (tags.length > 0) card.tags = tags;
  if (isNavHubAccent(raw.accent)) card.accent = raw.accent;
  if (raw.comingSoon === true) card.comingSoon = true;

  if (card.key.startsWith(NAV_HUB_LINK_PREFIX)) {
    // A custom card needs a well-formed key and a title, and must link
    // somewhere unless it is marked coming soon.
    if (!NAV_HUB_LINK_KEY_PATTERN.test(card.key) || !card.label) return null;
    if (isSafeHubUrl(raw.url)) card.url = raw.url;
    if (!card.url && !card.comingSoon) return null;
    if (card.url && raw.newTab === true) card.newTab = true;
  }
  return card;
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

  if (raw.hubs && typeof raw.hubs === 'object' && !Array.isArray(raw.hubs)) {
    const hubs: Record<string, NavLayoutItem[]> = {};
    for (const [id, items] of Object.entries(raw.hubs as Record<string, unknown>).slice(0, MAX_HUBS)) {
      if (!NAV_HUB_ID_PATTERN.test(id)) continue;
      hubs[id] = sanitizeHubCards(items);
    }
    if (Object.keys(hubs).length > 0) layout.hubs = hubs;
  }

  const defaultRoute = str(raw.defaultRoute, 512);
  if (defaultRoute) layout.defaultRoute = defaultRoute;

  return layout;
}
