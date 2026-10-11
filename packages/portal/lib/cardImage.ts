/**
 * Timeline/listing card images.
 *
 * Every event card image we generate is normalised to the
 * CARD_IMAGE_WIDTH x CARD_IMAGE_HEIGHT aspect ratio by
 * `scripts/generate-screenshots.js`, and Luma covers arrive at the same 1.905
 * ratio (AAIF stores them at 1200x628, techtickets at 640x336). So for those
 * we can declare intrinsic dimensions on the `<img>` and ask for a right-sized
 * render instead of shipping the full bitmap to a phone.
 *
 * Why the intrinsic dimensions matter beyond bandwidth: the timeline is
 * virtualised by date group, and group height is measured after mount. An
 * `<img>` with no width/height has no height until it loads, so each image
 * that arrived changed its group's measured height, which shifted the
 * offsets of every later group while the user was scrolling. Declaring the
 * ratio lets the browser reserve the box up front.
 *
 * Two resize providers, in order of preference:
 *
 *   1. A Bunny CDN pull zone, when the brand has one (`brandConfig.cdnBaseUrl`,
 *      fed from BUNNY_PULLZONE_URL + BUNNY_CDN_ENABLED). The zone's origin is
 *      the brand's own Supabase storage domain, so the object path carries over
 *      unchanged and only the host differs. Resizing is Bunny's Optimizer, which
 *      must have the manipulation engine enabled on the zone.
 *   2. Supabase Storage's own `render/image` endpoint, which every project has
 *      but which bills against the project's transformation quota.
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
 * Only objects under this folder are known to be normalised to the card
 * ratio by the screenshot job. Brand logos live elsewhere in the same
 * bucket, so the marker is the folder, not the bucket.
 */
const NORMALISED_SEGMENT = 'event-previews';

/**
 * Rendered widths offered to the browser.
 *
 * Capped at CARD_IMAGE_WIDTH on purpose. techtickets stores its previews at
 * exactly 640x336 and neither provider upscales (Supabase returns the 640
 * body for a width=960 request; the Bunny zones have
 * OptimizerEnableUpscaling off), so a wider candidate would misdescribe its
 * own width to the browser. AAIF's are 1200x628, so capping at 640 also cuts
 * what a phone decodes there from ~3.0MB to ~0.82MB.
 *
 * Worth knowing what this does and does not buy. `srcset` picks by DEVICE
 * pixels, so a 2x or 3x phone showing a ~350px card will still choose the 640
 * candidate. The saving is real for desktop and low-density screens, and the
 * hard cap is what helps a modern phone.
 */
const SRCSET_WIDTHS = [360, 480, CARD_IMAGE_WIDTH] as const;

/**
 * Mobile stacks the image full width of the content column; from the `sm`
 * breakpoint it sits in the card's right-hand column capped at 55%.
 */
const SIZES = '(min-width: 640px) 55vw, 100vw';

/** Matches the Optimizer quality already configured on the Bunny zones. */
const CDN_QUALITY = 85;

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

/**
 * True only when `event-previews` appears as a WHOLE path segment with
 * something after it. A substring test would also match a sibling folder such
 * as `not-event-previews/` or `legacy-event-previews/`, whose contents carry no
 * promise of being the card ratio, and we would then claim a ratio they do not
 * have.
 */
function isNormalisedPreview(objectPath: string): boolean {
  const segments = objectPath.split('/');
  const index = segments.indexOf(NORMALISED_SEGMENT);
  return index !== -1 && index < segments.length - 1 && segments[segments.length - 1] !== '';
}

/**
 * The origin of a configured pull zone, or null when there is none or the
 * value is unusable. Only the origin is kept: an operator who pastes a URL
 * with a path, a query or credentials does not get those smuggled into every
 * image URL on the page.
 */
function cdnOrigin(cdnBaseUrl: string | undefined): string | null {
  if (!cdnBaseUrl) return null;
  try {
    const url = new URL(cdnBaseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Bunny Optimizer: resize on the pull zone that fronts our storage domain. */
function bunnyUrl(origin: string, objectPath: string, width: number): string {
  const url = new URL(PUBLIC_OBJECT_PREFIX + objectPath, origin);
  url.searchParams.set('width', String(width));
  url.searchParams.set('height', String(heightFor(width)));
  // Bunny's crop keeps the requested box and trims the overflow, which is what
  // `object-cover` on the <img> would otherwise have to do with a bigger
  // download. `aspect_ratio` is Bunny's name for it.
  url.searchParams.set('aspect_ratio', 'crop');
  url.searchParams.set('quality', String(CDN_QUALITY));
  return url.toString();
}

/** Supabase Storage's built-in transform, used when the brand has no pull zone. */
function supabaseRenderUrl(origin: string, objectPath: string, width: number): string {
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
 * URL is not a normalised preview, which leaves today's behaviour (natural
 * intrinsic size, no transform) untouched for those.
 *
 * `cdnBaseUrl` is the brand's Bunny pull zone, from `brandConfig.cdnBaseUrl`.
 * When it is absent the Supabase render endpoint is used instead, so a brand
 * with no zone still gets right-sized images.
 */
export function cardImage(raw: string, cdnBaseUrl?: string): CardImage {
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

  // Prefer the brand's CDN. Its origin is a pull zone whose own origin is this
  // brand's storage domain, so the path carries over and only the host changes.
  const cdn = cdnOrigin(cdnBaseUrl);
  const build = cdn
    ? (width: number) => bunnyUrl(cdn, objectPath, width)
    : (width: number) => supabaseRenderUrl(url.origin, objectPath, width);

  return {
    src: build(CARD_IMAGE_WIDTH),
    srcSet: SRCSET_WIDTHS.map((w) => `${build(w)} ${w}w`).join(', '),
    sizes: SIZES,
    width: CARD_IMAGE_WIDTH,
    height: CARD_IMAGE_HEIGHT,
  };
}
