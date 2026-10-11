/**
 * Timeline/listing card images.
 *
 * Every event card image we generate is normalised to exactly
 * CARD_IMAGE_WIDTH x CARD_IMAGE_HEIGHT by `scripts/generate-screenshots.js`
 * (and Luma covers come in at the same 1.905 aspect ratio), so for those we
 * can declare intrinsic dimensions on the `<img>` and ask Supabase Storage
 * for a right-sized render instead of shipping the full 640px bitmap to a
 * phone.
 *
 * Why the intrinsic dimensions matter beyond bandwidth: the timeline is
 * virtualised by date group, and group height is measured after mount. An
 * `<img>` with no width/height has no height until it loads, so each image
 * that arrived changed its group's measured height, which shifted the
 * offsets of every later group while the user was scrolling. Declaring the
 * ratio lets the browser reserve the box up front.
 *
 * Anything that is NOT one of our normalised previews (an `event_logo`, an
 * externally hosted image) is returned untouched. Those can be any aspect
 * ratio, so cropping them to 1.905 or claiming a ratio they do not have
 * would be wrong.
 */

export const CARD_IMAGE_WIDTH = 640;
export const CARD_IMAGE_HEIGHT = 336;

/** Supabase Storage public-object path, and its render-with-transform twin. */
const PUBLIC_OBJECT_PREFIX = '/storage/v1/object/public/';
const RENDER_IMAGE_PREFIX = '/storage/v1/render/image/public/';

/**
 * Only objects under this folder are known to be normalised to
 * 640x336 by the screenshot job. Brand logos live elsewhere in the same
 * bucket, so the marker is the folder, not the bucket.
 */
const NORMALISED_SEGMENT = 'event-previews';

/**
 * True only when `event-previews` appears as a WHOLE path segment with
 * something after it. A substring test would also match a sibling folder such
 * as `not-event-previews/` or `legacy-event-previews/`, whose contents carry no
 * promise of being 640x336, and we would then claim a ratio they do not have.
 */
function isNormalisedPreview(objectPath: string): boolean {
  const segments = objectPath.split('/');
  const index = segments.indexOf(NORMALISED_SEGMENT);
  return index !== -1 && index < segments.length - 1 && segments[segments.length - 1] !== '';
}

/**
 * Rendered widths offered to the browser.
 *
 * Capped at CARD_IMAGE_WIDTH because Supabase will not upscale past the stored
 * 640px source: asking for 960 returns a 640x336 body, so advertising a 960w
 * candidate would misdescribe its width to the browser.
 *
 * Worth knowing what this does and does not buy. `srcset` picks by DEVICE
 * pixels, so a 2x or 3x phone showing a ~350px card wants ~700-1050px and will
 * still choose the 640 candidate. The saving here is real for desktop and for
 * low-density screens, but it does NOT reduce what a modern phone decodes.
 * Forcing that would need a viewport-keyed `<picture>` source and would visibly
 * soften the image on a high-density phone.
 */
const SRCSET_WIDTHS = [360, 480, CARD_IMAGE_WIDTH] as const;

/**
 * Mobile stacks the image full width of the content column; from the `sm`
 * breakpoint it sits in the card's right-hand column capped at 55%.
 */
const SIZES = '(min-width: 640px) 55vw, 100vw';

export type CardImage = {
  src: string;
  /** Only set for normalised previews. */
  srcSet?: string;
  sizes?: string;
  width?: number;
  height?: number;
};

function heightFor(width: number): number {
  return Math.round((width * CARD_IMAGE_HEIGHT) / CARD_IMAGE_WIDTH);
}

function renderUrl(origin: string, objectPath: string, width: number): string {
  // objectPath comes from a parsed URL pathname, so it is already
  // percent-encoded and cannot contain a query or fragment. Query values go
  // through searchParams, never string concatenation.
  const url = new URL(RENDER_IMAGE_PREFIX + objectPath, origin);
  url.searchParams.set('width', String(width));
  url.searchParams.set('height', String(heightFor(width)));
  url.searchParams.set('resize', 'cover');
  return url.toString();
}

/**
 * Resolve the attributes for a card image. Returns `{ src }` alone when the
 * URL is not a normalised Supabase preview, which leaves today's behaviour
 * (natural intrinsic size, no transform) untouched for those.
 */
export function cardImage(raw: string): CardImage {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // Relative or malformed: hand it back and let the browser deal with it.
    return { src: raw };
  }

  // Storage renders are served over http(s) only. Anything else (data:,
  // blob:, javascript:) is passed through rather than rewritten.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { src: raw };

  // A URL that already carries a query or fragment is left alone rather than
  // guessing how our transform params should merge with it.
  if (url.search || url.hash) return { src: raw };

  if (!url.pathname.startsWith(PUBLIC_OBJECT_PREFIX)) return { src: raw };

  const objectPath = url.pathname.slice(PUBLIC_OBJECT_PREFIX.length);
  if (!objectPath || !isNormalisedPreview(objectPath)) return { src: raw };

  return {
    src: renderUrl(url.origin, objectPath, CARD_IMAGE_WIDTH),
    srcSet: SRCSET_WIDTHS.map((w) => `${renderUrl(url.origin, objectPath, w)} ${w}w`).join(', '),
    sizes: SIZES,
    width: CARD_IMAGE_WIDTH,
    height: CARD_IMAGE_HEIGHT,
  };
}
