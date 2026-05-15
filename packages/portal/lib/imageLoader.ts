// next/image custom loader → Cloudflare Image Resizing.
// Per spec-portal-on-cloudflare-workers §4.6.
//
// Next's default optimizer relies on `sharp`, which doesn't run on
// Workers. Cloudflare Image Resizing exposes a URL-based transform at
// `/cdn-cgi/image/<options>/<source-url>` that's executed at the edge.
// Cached transforms are free; uncached transforms are billed per 1K
// (after the included quota).
//
// Source URL handling:
//   - Absolute URL (https://…) → Cloudflare's resizing worker fetches
//     and transforms it. The remote host must be allowed by the zone's
//     Image Resizing rules (Cloudflare dashboard).
//   - Relative path (/uploads/foo.png) → resolves against the same
//     origin as the request, which is the Worker itself. Worker serves
//     the asset from R2 (the ASSETS binding) and CF transforms it.
//
// Note: this loader runs in the BROWSER as well (next/image emits the
// generated URL into the HTML). It must be deterministic and free of
// runtime-only deps. No `node:*`, no env access at call time.

export default function cloudflareImageLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  // Build the option string. `format=auto` lets Cloudflare pick AVIF /
  // WebP / JPEG based on Accept header; `fit=scale-down` matches Next's
  // default behaviour (don't upscale beyond original).
  const params = [
    `width=${width}`,
    `quality=${quality ?? 75}`,
    "format=auto",
    "fit=scale-down",
  ].join(",");

  // Image Resizing requires the source URL to be the LAST path segment
  // (everything after the options chunk). For absolute URLs we leave
  // the protocol intact; CF's worker handles the upstream fetch.
  return `/cdn-cgi/image/${params}/${src}`;
}
