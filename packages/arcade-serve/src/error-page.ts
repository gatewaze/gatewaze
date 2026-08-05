// Static error pages. They are served inside an iframe on the portal, so they
// must be self-contained (no external assets — the CSP would block them anyway)
// and must never leak why a lookup failed: a draft game and a typo'd slug both
// render "Game not found" (spec §6 — 404 rather than 403 so the origin does not
// confirm that an unpublished game exists).

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; text-align:center; padding:2rem; }
  h1 { font-size:1.125rem; font-weight:600; margin:0 0 .375rem; }
  p  { margin:0; opacity:.7; font-size:.875rem; }
</style>
</head>
<body><main><h1>${title}</h1><p>${body}</p></main></body>
</html>
`;
}

export const NOT_FOUND_PAGE = page('Game not found', 'This game is not available at this address.');
export const SERVER_ERROR_PAGE = page('Temporarily unavailable', 'Please try again in a moment.');
