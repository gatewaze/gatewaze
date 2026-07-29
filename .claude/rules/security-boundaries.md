---
paths: ["packages/api/src/routes/**", "packages/api/src/lib/**", "packages/portal/app/api/**", "packages/portal/app/**/api/**", "supabase/functions/**"]
source: gatewaze-skills/production-readiness/references/security-boundaries.md
---

# Security boundaries

Patterns drawn from the two pragma:security audit rounds in the
prod-hardening pass. Every finding listed here was exploitable when
audited and is now closed; the goal is to prevent re-introduction.

## PostgREST `.or()` filter injection

**Don't:**
```ts
if (search) {
  query = query.or(`email.ilike.%${search}%,first_name.ilike.%${search}%`);
}
```

A search value containing `,` (filter separator), `(` (filter group),
`*` (wildcard), or `\` (escape) injects extra disjunction clauses. A
caller who passes `jane,id.gt.0` makes the second clause a top-level
filter that returns every row in the table.

**Do:**
```ts
if (search) {
  // Strip PostgREST filter-grammar metacharacters before interpolation.
  const safe = String(search).replace(/[,()*\\]/g, '').slice(0, 100);
  if (safe) {
    query = query.or(`email.ilike.%${safe}%,first_name.ilike.%${safe}%`);
  }
}
```

The 100-char cap is a defence-in-depth on the cost of the search; raise
it if you have a good reason and a regression test.

**Existing fixes:**
- `packages/api/src/routes/people.ts:26-35`
- `packages/api/src/routes/redirects.ts:110-117`
- `packages/portal/app/api/calendars/[slug]/feed.ics/route.ts:44-50`
  (slug path-param sanitiser before `.or()` interpolation)

**Regression test:** `packages/api/src/routes/__tests__/people.test.ts`
has the canonical pattern — assert on the `mockSupabase.client.or` call
arg, looking for `%${safe}%` substring presence and the absence of
`%${attacker_payload}` substring patterns.

## Mass assignment via `req.body`

**Don't:**
```ts
const { data, error } = await supabase
  .from('calendars')
  .insert(req.body)
  .select()
  .single();
```

Without an allowlist, the caller can set internal columns: `account_id`,
`created_at`, `auth_user_id`, etc. RLS may catch some but is not the
right defence layer for column-level field control.

**Do:**
```ts
const CALENDAR_WRITE_FIELDS = new Set([
  'name', 'slug', 'description', 'visibility', 'is_active',
  'external_url', 'cover_image_url', 'theme', 'theme_colors', 'category',
]);

function pickCalendarFields(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (CALENDAR_WRITE_FIELDS.has(k)) out[k] = v;
  }
  return out;
}

// then:
.insert(pickCalendarFields(req.body))
```

**Existing fixes:**
- `packages/api/src/routes/calendars.ts` (`CALENDAR_WRITE_FIELDS` +
  `pickCalendarFields`)
- `packages/api/src/routes/people.ts` (`PERSON_WRITE_FIELDS` inline
  loop)

## Enum / string-union validation

**Don't:**
```ts
.update({ rsvp_status: r.rsvp_status, rsvp_responded_at: ... })
```

A token-holder who can hit the route can persist arbitrary values
(`'admin'`, `'\x00'`, etc.) into a column the rest of the pipeline
switches on by string equality.

**Do:**
```ts
const VALID_RSVP_STATUSES = new Set(['accepted', 'declined', 'pending']);
for (const r of responses) {
  if (!VALID_RSVP_STATUSES.has(r.rsvp_status)) {
    return NextResponse.json(
      { error: 'INVALID_RSVP_STATUS', message: '...' },
      { status: 400 },
    );
  }
}
```

For optional/derived statuses where the default is well-defined, coerce
instead of reject:
```ts
const rsvpStatus = VALID_RSVP_STATUSES.has(rawStatus) ? rawStatus : 'accepted';
```

**Existing fix:** `packages/portal/app/api/invite-rsvp/route.ts:228-246`
(reject) and `:357-365` (coerce).

## Service-role Supabase client null-guards

`packages/api/src/routes/public-api.ts` accepts a
`SupabaseClient | null` parameter (the client is null when the env vars
aren't configured). Every handler that uses it must short-circuit
before parsing user input:

```ts
router.get('/categories', async (_req, res) => {
  try {
    if (!supabase) {
      return res.status(503).json({
        error: { code: 'DB_UNAVAILABLE', message: 'Database not configured' },
      });
    }
    // ... real handler ...
  }
});
```

Place the guard FIRST in the try block, before `req.query.*` or
`req.body.*` is read. The audit specifically checked for input parsing
before the null-guard.

## ICS / CR-LF injection

ICS line termination is `\r\n`. Any DB-controlled string value emitted
into an ICS line must have CR/LF stripped (URI/UID values) or escaped
(text values). See `references/ics-output.md` for the helpers.

## Path-param validation in URL construction

When a path param flows into a URL constructed downstream (`fetch`,
`fetch` to an edge function, redirect target, etc.), validate the
shape early and reject with 400/404 before constructing the URL.

```ts
// /api/calendars/[slug]/feed.ics
if (!/^[a-zA-Z0-9_-]+$/.test(slug) || slug.length > 100) {
  return new NextResponse('Calendar not found', { status: 404 });
}

// /api/calendar-proxy/:eventId/:calendarType/:emailEncoded
const ALLOWED_CALENDAR_TYPES = new Set(['google', 'outlook', 'ics']);
const eventId = String(req.params.eventId ?? '');
const calendarType = String(req.params.calendarType ?? '');
const emailEncoded = String(req.params.emailEncoded ?? '');

if (!ALLOWED_CALENDAR_TYPES.has(calendarType)) {
  return res.status(400).json({ error: 'Unsupported calendar type' });
}
if (!/^[a-zA-Z0-9_-]{1,128}$/.test(eventId)) {
  return res.status(400).json({ error: 'Invalid eventId' });
}
if (emailEncoded.length > 256 || /[^A-Za-z0-9%._-]/.test(emailEncoded)) {
  return res.status(400).json({ error: 'Invalid emailEncoded' });
}
```

Express types path params as `string | string[]` (multi-value matcher),
so the `String(req.params.x ?? '')` coercion is intentional — don't
skip it.

## Rate-limiting public endpoints

Any public unauthenticated POST that sends email, generates a magic
link, or creates auth/people rows MUST be IP-rate-limited. The portal
has an in-memory sliding-window limiter at `@/lib/rate-limit`:

```ts
import { checkRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const rateLimit = checkRateLimit(`<route>:${ip}`, 5, 60_000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: { code: 'RATE_LIMITED', message: '...' } },
      { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter ?? 60) } },
    );
  }
  // ... real handler ...
}
```

The limiter is per-process — for horizontal scaling beyond one Next
instance it needs to migrate to Upstash/Redis. The doc-comment in
`lib/rate-limit/index.ts` calls that out.

**Existing rate-limited routes:**
- `packages/portal/app/(main)/api/chat/route.ts` (60/min user, 20/min IP)
- `packages/portal/app/api/calendar-members/route.ts` (5/min IP)
- `packages/portal/app/api/open-rsvp/route.ts` (10/min IP)

Pick the limit by thinking about a real user's retry pattern, not by
picking a round number.

## SSRF

`packages/portal/app/api/open-rsvp/route.ts` calls
`http://ip-api.com/json/{encodedIp}` for geolocation. The IP is
encoded with `encodeURIComponent` and the host is hardcoded — host
injection isn't possible. Don't refactor that endpoint to take a
configurable host without re-evaluating SSRF risk.

`packages/api/src/routes/calendar-proxy.ts` forwards an upstream
`Location` header to `res.redirect()`. The upstream is operator-
controlled (`SUPABASE_URL`); a comment in the file flags that swapping
the upstream to a third-party source needs re-evaluation.

## Shell-command safety

The api package has an allowlist-based `safeExec` at
`packages/api/src/lib/safe-exec.ts`:

```ts
const ALLOWED_BINARIES = new Set(['git', 'pgbackrest', 'pg_dump', 'pg_restore']);
```

`scripts/audit-shell-calls.ts` enforces in CI that no
`child_process.exec`, `execSync` with a single string, or `spawn` with
`shell: true` appears outside this module. Don't add raw shell calls
elsewhere.
