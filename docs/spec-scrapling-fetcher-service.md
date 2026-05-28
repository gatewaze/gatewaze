# Scrapling Fetcher Service — Technical Specification

**Status:** Approved — ready for implementation
**Owner:** Gatewaze platform team
**Last updated:** 2026-05-06
**Adversarial review:** 5 rounds complete; consensus reached among `gpt-4o`, `o1`, `gemini/gemini-2.5-flash` (with `--preserve-intent` mode); see `.adversarial-spec-checkpoints/scrapling-fetcher-round-{1..5}.md` for the round-by-round trail.

---

## 1. Overview / Context

Today, all Gatewaze scrapers (`LumaICalScraper`, `LumaSearchScraper`,
`LumaCategoryScraper`, plus four others) run inside a Node BullMQ worker
container and use Puppeteer to navigate every event page sequentially.
Per-event cost is roughly:

| Step | Time |
|---|---|
| `puppeteer.goto(url, { waitUntil: 'networkidle2' })` | 5–10 s |
| Fixed `setTimeout(3000)` for late JS | 3 s |
| `page.evaluate(() => extract __NEXT_DATA__)` | ~0.2 s |
| Inter-page rate-limit `setTimeout` | 1–2 s |
| **Subtotal** | **~10–15 s/event** |

A 100-event Luma calendar scrape takes 15–25 minutes. For a 1,000-event
backfill (the host-discovery flows), 3.5 hours.

But Luma is a Next.js SSR app — `__NEXT_DATA__` is **inlined into the
HTML response**. We already proved this works without a browser in
`populateLumaCalendarCoverIfMissing` (last week's calendar header port),
which fetches `lu.ma/{slug}` with plain `node-fetch` and parses the
embedded JSON. A non-browser HTTP fetch returns the same `__NEXT_DATA__`
in ~300–500 ms — a ~20× per-page speedup, and an additional ~10× from
fetching N pages concurrently.

Scrapling (BSD-3, Python 3.10+, github.com/D4Vinci/Scrapling) provides
the fetcher tier we need (`Fetcher`: TLS-impersonating HTTP;
`StealthyFetcher`: Cloudflare bypass; `DynamicFetcher`: stealth Playwright)
behind one API, with built-in async concurrency, per-domain throttling,
proxy rotation, and adaptive selectors. It also ships a Microsoft-
maintained pre-built Docker image (`mcr.microsoft.com/playwright/python`)
that includes Chromium + system fonts/libs, so our Dockerfile is ~5 lines.

This spec defines a new HTTP service (`scrapling-fetcher`) that exposes
Scrapling to the rest of the Gatewaze stack, plus three new
scraper-class variants (`LumaICalScraperFast`, `LumaSearchScraperFast`,
`LumaCategoryScraperFast`) that route their per-event fetches through
the new service. **The existing scrapers are untouched.** The new
variants are selectable in the admin Scraper editor, allowing
side-by-side A/B operation against the same Luma calendars.

## 2. Goals and Non-Goals

### Goals

- **G1.** Reduce LumaICal/Search/Category per-job duration by ≥10× on
  the median 100-event calendar (target: ≤2 min vs current 15–25 min).
- **G2.** Ship the new variants as opt-in scraper types selectable from
  the existing scraper editor — zero-disruption coexistence with the
  current scrapers.
- **G3.** Make residential-proxy use (Rayobyte) a runtime config of the
  new service, not a per-scraper concern.
- **G4.** Provide a comparison harness so we can quantify the win
  per-calendar and decide when to retire the legacy scrapers.
- **G5.** Establish the foundation for **Phase 3** scrapers (Eventbrite,
  Meetup-at-scale, gated calendars) that need real anti-bot bypass.

### Non-Goals

- **NG1.** Replacing the existing seven scraper classes. They keep working.
  We add three new variants; the old ones are deleted only after the new
  ones beat them on success rate AND we've migrated all production scrapers.
- **NG2.** Replacing `node-ical` for iCal feed parsing. The iCal step
  stays in Node — only event-page enrichment moves to the fetcher service.
- **NG3.** A general-purpose scraping API for other Gatewaze modules.
  This service serves the scrapers module only; access is restricted to
  the worker container by network policy + shared secret.
- **NG4.** Building our own anti-bot bypass. We rely on Scrapling's
  `StealthyFetcher` and `DynamicFetcher`. If those fail on a target,
  we accept that source as out of scope until Scrapling adds support.
- **NG5.** Replacing BullMQ. Scrapling ships its own spider/queue
  framework (`crawldir` checkpoints); we ignore it. BullMQ stays the
  scheduler.

## 3. System Architecture

### Container topology (no change to existing layout)

```
┌─────────────────────┐     HTTP POST /fetch      ┌──────────────────────────┐
│  api / portal       │  ─────────────────────►   │  scrapling-fetcher       │
│  (Node, existing)   │                           │  (Python, NEW)           │
└─────────────────────┘                           │                          │
                                                  │  FastAPI + uvicorn       │
┌─────────────────────┐     HTTP POST /fetch      │  Scrapling 0.4.x         │
│  worker             │  ─────────────────────►   │  Pre-warmed              │
│  (Node, existing)   │                           │  DynamicFetcher pool     │
│                     │                           │                          │
│  scraper-job-       │                           │  Optional Rayobyte       │
│  handler.js         │                           │  proxy in rotation       │
└─────────────────────┘                           └──────────────────────────┘
        │                                                      │
        │ BullMQ                                               │ outbound HTTPS
        ▼                                                      ▼
┌─────────────────────┐                            ┌──────────────────────────┐
│  Redis (existing)   │                            │  Luma / Eventbrite /     │
└─────────────────────┘                            │  Meetup / target sites   │
                                                   └──────────────────────────┘
```

**Network:** the fetcher service exposes port 8080 inside the docker
network only. No Traefik route. Worker → service is plain HTTP over
the docker bridge / k8s ClusterIP. Internal authentication is a shared
secret in `X-Internal-Token` header.

### Code locations

| New artefact | Path |
|---|---|
| Python service | `gatewaze/services/scrapling-fetcher/` |
| Service Dockerfile | `gatewaze/services/scrapling-fetcher/Dockerfile` |
| Service compose entry | `gatewaze/docker/docker-compose.yml` |
| Service Helm template | `gatewaze/helm/gatewaze/templates/scrapling-fetcher.yaml` (chart lives in the gatewaze repo; gatewaze-environments only carries per-brand values) |
| Node adapter | `gatewaze-modules/modules/scrapers/scripts/lib/scrapling-fetcher.js` |
| Fast scraper classes | `gatewaze-modules/modules/scrapers/scripts/scrapers/LumaICalScraperFast.js` (and Search, Category equivalents) |
| Dispatch update | `gatewaze-modules/modules/scrapers/scripts/scraper-job-handler.js` |
| Editor UI | `gatewaze-modules/modules/scrapers/admin/pages/ScraperEditorModal.tsx` |
| Comparison view | `gatewaze-modules/modules/scrapers/admin/pages/ScraperComparisonPage.tsx` |
| Comparison RPC | `gatewaze-modules/modules/scrapers/migrations/018_fast_vs_slow_comparison.sql` |

## 4. Component Design

### 4.1 `scrapling-fetcher` Python service

**Runtime:** Python 3.12 via `mcr.microsoft.com/playwright/python:v1.49.0-noble`
(includes Chromium, Firefox, WebKit, system fonts, libnss).

**Stack:** FastAPI 0.115+ for the HTTP layer; uvicorn for the ASGI
runtime; Scrapling 0.4.7+ for the actual fetching.

**Why FastAPI + uvicorn (vs Flask, Starlette, or aiohttp):** Scrapling's
`Fetcher` and `DynamicFetcher` are async-first; FastAPI gives us native
async route handlers without sync-to-thread bridging. uvicorn is the
de-facto ASGI server for FastAPI in production. Pydantic v2 (used by
FastAPI for request validation) handles the per-field SSRF and bound
checks declaratively rather than scattered through the handler. Flask
would require gunicorn + threading or async hacks; aiohttp's
hand-rolled validation would re-implement what Pydantic already does.

**Process model:** single uvicorn worker process per container with
`--workers 1` (Scrapling's browser pool is in-process; multiple uvicorn
workers would each launch their own pool and starve memory). Scale
horizontally by running more containers behind the docker network; we
expect 1 replica per environment for Phase 1, scale to 2–3 if needed.

**Dockerfile:**

```dockerfile
FROM mcr.microsoft.com/playwright/python:v1.49.0-noble

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ /app/

# Pre-warm browser pool on startup so first request isn't cold.
ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
```

**`requirements.txt`:**

```
scrapling==0.4.7
fastapi==0.115.6
uvicorn[standard]==0.32.1
pydantic==2.10.3
prometheus-client==0.21.0
```

(Pinned exact versions — `pip install` does NOT auto-resolve transitive
conflicts the way pnpm does, and Scrapling's playwright pin must match
the base image's Playwright version. We bump these together as a single
unit each Scrapling release.)

**Why pin Scrapling exactly:** the service contract (response shape
returned to the Node adapter) is built on Scrapling's `Response` and
`Adaptor` object shape. Scrapling 0.5.x — currently in pre-release —
changes some attribute names (`html_content` → `content`, etc).
Pinning prevents a `pip install -U` accidentally breaking the contract
in CI. Each Scrapling bump is a deliberate PR with smoke-test re-runs.

**Pool strategy:** at startup, instantiate one each of `Fetcher`,
`StealthyFetcher`, and `DynamicFetcher`. Reuse across requests.

Two independent concurrency limits, **not gated by each other**:

- `mode: "fast"` and `mode: "stealth"` use Scrapling's HTTP fetchers
  (no browser). Concurrency is limited by `SCRAPLING_FAST_CONCURRENCY`
  (default 10) via an `asyncio.Semaphore`. These do **not** consume a
  browser pool slot.
- `mode: "browser"` uses `DynamicFetcher`, which manages a pool of
  Playwright browser contexts. Pool size is `SCRAPLING_BROWSER_POOL_SIZE`
  (default 4). When the pool is full, additional `mode: "browser"`
  requests queue with a 30 s ceiling before returning 503.

A flood of fast-mode requests therefore cannot starve browser requests
(or vice versa). Total in-flight cap = fast-semaphore + browser-pool
+ in-progress queueing.

**Endpoints:** see §5.

**Configuration via environment:**

| Var | Default | Purpose |
|---|---|---|
| `SCRAPLING_INTERNAL_TOKEN` | (required) | Shared secret; rejected if mismatched in `X-Internal-Token` |
| `SCRAPLING_PROXY_PROVIDER` | `none` | Provider plugin name (built-in: `none`, `rayobyte`, `brightdata`, `oxylabs`, `decodo`, `iproyal`); or a Python module path for a custom provider |
| `SCRAPLING_PROXY_CONFIG` | unset | JSON blob with provider-specific config (credentials, gateway, country, sticky duration). Schema differs per provider — see §4.1.1 |
| `SCRAPLING_PROXY_MODE` | `none` | `none` \| `stealth-only` \| `always` — when to engage the active provider |
| `SCRAPLING_BROWSER_POOL_SIZE` | `4` | Max concurrent DynamicFetcher contexts |
| `SCRAPLING_FAST_CONCURRENCY` | `10` | Max concurrent Fetcher requests per process |
| `SCRAPLING_PER_DOMAIN_RPS` | `5` | Per-domain rate limit (requests/sec) |
| `SCRAPLING_DEFAULT_TIMEOUT_MS` | `30000` | Hard timeout per fetch |
| `SCRAPLING_PROXY_DAILY_GB_CAP` | `10` | Soft cap on daily proxy bandwidth (see §9.4) |
| `LOG_LEVEL` | `INFO` | uvicorn log level |

### 4.1.1 Pluggable proxy-provider abstraction

Different residential proxy services expose subtly different request
formats (gateway URL, port-per-session, header-based country selection,
on-the-fly auth, etc.) and different usage-reporting APIs. Hard-coding
Rayobyte's specifics into the service makes provider switching a code
change. Instead, a small interface keeps providers swappable.

**Interface (Python ABC):**

```python
# app/proxy/base.py
from abc import ABC, abstractmethod
from typing import Optional, TypedDict

class ProxyDecision(TypedDict):
    proxy_url: str         # what Scrapling/httpx connects through
    headers: dict          # any extra headers (some providers use these for country/sticky)
    sticky_session_id: Optional[str]

class ProxyUsage(TypedDict):
    bytes_in: int
    bytes_out: int
    cost_usd_estimate: float  # provider-specific estimation; None if not derivable

class ProxyProvider(ABC):
    """Adapter for a residential proxy service. One instance per service replica."""

    name: str  # "rayobyte", "brightdata", etc — used in metrics/logs/cost ledger

    @abstractmethod
    async def get_proxy_for(self, target_url: str, mode: str, opts: dict) -> ProxyDecision:
        """Decide what proxy connection to use for a given request."""

    @abstractmethod
    async def record_usage(self, decision: ProxyDecision, response: 'FetchResponse') -> ProxyUsage:
        """After a fetch completes, derive byte counts and (when possible) cost estimate."""

    @abstractmethod
    async def health_check(self) -> dict:
        """Return provider health (account balance, daily bandwidth used, etc) for /readyz."""
```

**Built-in providers (ship with the service):**

- `none` — no-op (always returns `proxy_url: None`); used when
  `SCRAPLING_PROXY_MODE=none`.
- `rayobyte` — default for Phase 1 per the proxy comparison.
- `brightdata`, `oxylabs`, `decodo`, `iproyal` — premium / mid-tier
  parity options; minimal implementations exercised by their unit tests
  in Phase 1.
- `webshare` — mid-market alternative ($1.40-$3.50/GB rotating
  residential, transparent dashboard). Auth is suffix-encoded on the
  username (`-rotate`, `-CC-{country}`, `-rotate-{session_id}`).
- `dataimpulse` — budget tier ($0.80-$1.00/GB) with
  **never-expiring traffic**, well-suited to bursty low-volume scraper
  workloads. Auth uses the distinctive `__cr.{country}` / `__sid.{id}`
  username-suffix scheme.

Operators switch by changing `SCRAPLING_PROXY_PROVIDER` and
`SCRAPLING_PROXY_CONFIG`. No code change required.

**Custom providers:** an operator can add their own provider without
forking the service. Steps:

1. Create a Python module exporting a class implementing `ProxyProvider`.
2. Mount the module into the container (volume mount or `pip install`
   from a private package index).
3. Set `SCRAPLING_PROXY_PROVIDER=mymodule.MyProvider`.

The service uses Python's `importlib.import_module` + `getattr` to
load custom providers at startup. Failure to load raises immediately
(crash on bad config rather than silent fallback to `none`).

**Per-provider config schema:** each provider documents its
`SCRAPLING_PROXY_CONFIG` JSON shape in `app/proxy/<name>.py`'s
docstring. Example for Rayobyte:

```json
{
  "username": "user_xxxxx",
  "password": "$RAYOBYTE_PASSWORD",
  "gateway_host": "gw.rayobyte.com",
  "gateway_port": 8080,
  "default_country": null,
  "session_duration_minutes": 10
}
```

**`$VAR` interpolation rules** (resolved at service startup, before
the provider class is instantiated):

- A string value matching the regex `^\$([A-Z_][A-Z0-9_]*)$` is treated
  as an env-var reference and replaced with `os.environ[VAR]`.
- A string starting with `$$` is treated as a literal `$` followed by
  the rest, with no further interpretation. So `"$$literal"` resolves
  to the string `"$literal"`. Use this when a credential genuinely
  starts with `$`.
- A string with `$VAR` followed by other characters (e.g. `"prefix-$X"`)
  is **not** interpolated — the JSON value is taken verbatim. Only
  exact `^\$VAR$` matches are interpolated, so the parser is
  unambiguous and there's no shell-style partial substitution to get
  wrong.
- If `$VAR` references an env var that is **unset or empty**, the
  service refuses to start with a fatal error (`ProxyConfigError:
  required env var '$RAYOBYTE_PASSWORD' is unset`). Silent fallback
  to empty string would mask configuration mistakes.
- The rules apply only to top-level string values in the JSON. Nested
  arrays/objects are not recursively scanned (keeps parsing simple
  and predictable).

**Cost-ledger integration:** every successful fetch result records
into the cost ledger (§15) via the provider's `record_usage` return
value. This means swapping providers automatically re-bases cost
attribution to the new provider's pricing without code changes —
the provider knows its own per-GB cost.

### 4.2 Node-side adapter (`scripts/lib/scrapling-fetcher.js`)

Single ES module exporting:

```javascript
/**
 * Fetch a URL through the scrapling-fetcher service.
 *
 * Returns { html, nextData, status, headers, timing, mode } on success.
 * Throws on network error or non-2xx from the service.
 *
 * Caller decides whether to fall back to local Puppeteer on failure.
 */
export async function fetchPage(url, opts = {})
```

**Caller-supplied options:**

- `mode`: `"fast"` (default) | `"stealth"` | `"browser"`
- `extractNextData`: boolean (default true) — service runs the
  `__NEXT_DATA__` regex server-side and returns parsed JSON
- `waitFor`: optional string (CSS selector) — only honored when
  `mode: "browser"`
- `timeout`: ms (default 30000)
- `proxy`: `"auto"` (default — service decides) | `"force"` | `"never"`

**Service URL** comes from `SCRAPLING_FETCHER_URL` env var (e.g.
`http://scrapling-fetcher:8080` in compose). Internal token from
`SCRAPLING_INTERNAL_TOKEN`. Both injected by the worker container's
environment block.

**Behavior when `SCRAPLING_FETCHER_URL` is unset:**

- The adapter export is still importable; `fetchPage` immediately
  throws a typed `ScraplingNotConfiguredError`.
- `Luma*ScraperFast` classes catch this specific error in their
  override and fall back to the parent class's Puppeteer path *without*
  emitting a warning log (it's an expected configuration state, not
  an error). They emit one info-level log per scraper job:
  `"scrapling-fetcher not configured; falling back to browser path"`.
- This makes the new variants safe to enable in environments where
  the fetcher service hasn't been deployed yet — they degrade to the
  same behavior as the slow variants instead of crashing the job.
- A separate startup probe in the worker (`scripts/job-worker.js`)
  logs whether the service URL is set and whether `/healthz` returned
  200, so the operator sees the state at boot.

**Connection pooling:** uses the Node 18+ global `fetch` with `keepalive`
agent so the worker doesn't TCP-handshake on every call.

### 4.3 New scraper classes

Three new files, each importing the existing class as a base and
overriding only the page-fetch path:

```javascript
// LumaICalScraperFast.js
import { LumaICalScraper } from './LumaICalScraper.js';
import { fetchPage } from '../lib/scrapling-fetcher.js';

export class LumaICalScraperFast extends LumaICalScraper {
  /**
   * Override fetchEventPageData to use the service for the HTTP-only
   * path. Falls back to super.fetchEventPageData (Puppeteer) on
   * service failure or missing __NEXT_DATA__.
   */
  async fetchEventPageData(eventLink) {
    try {
      const result = await fetchPage(eventLink, {
        mode: 'fast',
        extractNextData: true,
        timeout: 15000,
      });
      if (result.status >= 400 || !result.nextData) {
        // Fall back to browser path
        return super.fetchEventPageData(eventLink);
      }
      return this.normalizePageData(result);
    } catch (err) {
      this.logger?.warn(`scrapling fast-path failed for ${eventLink}: ${err.message} — falling back to Puppeteer`);
      return super.fetchEventPageData(eventLink);
    }
  }

  /**
   * Override the per-event loop to fetch with controlled concurrency
   * (default 5; tunable via config.fast_concurrency).
   * Uses p-limit equivalent (we'll add `p-limit` to scripts/package.json).
   */
  async scrape() { /* ... see implementation notes below ... */ }
}
```

**`normalizePageData(result)`** translates the service's response
shape (`{ html, nextData, ... }`) into the same object shape the
existing Puppeteer path returns (`{ coverImageUrl, pageContent,
isVirtual, lumaData, lumaPageData, calendarData }`). All downstream
code (`scraper-job-handler.js`'s save loop, host extraction,
content-keyword pipeline) is unchanged.

**Concurrency** defaults to 5, configurable per-scraper via
`config.fast_concurrency` (1–20). Higher values consume more proxy
bandwidth and risk Luma rate-limiting.

`LumaSearchScraperFast` and `LumaCategoryScraperFast` follow the same
override pattern.

### 4.3.1 Per-method routing table (which path each scraper method takes)

The fast variants only override the *event-page enrichment* methods.
Other methods that genuinely need a browser stay on Puppeteer. This
table is the source of truth — implementers must match it exactly.

| Scraper | Method | Slow variant | Fast variant | Notes |
|---|---|---|---|---|
| LumaICal | `getICalUrl` (cached `ical_id` in config) | n/a (HTTP) | n/a (HTTP) | Plain URL string assembly; no fetch |
| LumaICal | `extractICalUrlFromPage` (when `ical_id` not in config) | Puppeteer | **Puppeteer** | Requires clicking the "Add iCal Subscription" button — DOM interaction, can't be HTTP |
| LumaICal | iCal feed download + parse (`node-ical`) | Node | Node | Out of scope for both variants |
| LumaICal | `fetchEventPageData(eventLink)` per event | Puppeteer | **Service `mode: "fast"`**, fall back to Puppeteer on `next_data == null` or status ≥ 400 | The big speedup |
| LumaSearch | Brave Search / Google CSE API calls | Node `fetch` | Node `fetch` | Out of scope; same in both |
| LumaSearch | `fetchEventPageData(eventLink)` per discovered event | Puppeteer | **Service `mode: "fast"`**, fall back | Same pattern as LumaICal |
| LumaCategory | Initial category-page navigate + infinite scroll | Puppeteer | **Puppeteer** | DOM scroll-and-wait loop; can't be HTTP |
| LumaCategory | `fetchEventPageData(eventLink)` per discovered event | Puppeteer | **Service `mode: "fast"`**, fall back | Same pattern |
| LumaHostEnricher | All methods | Puppeteer | n/a (no Fast variant in this spec) | Phase 3 candidate, not Phase 2 |

The fast variants therefore still launch Puppeteer at job start (for
the unavoidable methods above). The startup cost (~5 s) is paid once;
the per-event win comes from the loop. We do **not** lazy-launch
Puppeteer only on fallback in Phase 2 — that's a Phase 3 optimization.

### 4.3.2 Concurrency and existing job-lease invariants

Per-job concurrency in fast variants is implemented via `p-limit`
(added to `scripts/package.json`). Default 5; configurable per-scraper
via `config.fast_concurrency` (1–20).

The existing per-job lease (`scrapers_heartbeat`) ticks every 30 s and
the lease is 30 minutes. With 10 concurrent fetches each averaging
500 ms, a 100-event scrape completes in ~5 s — well under one
heartbeat interval. The heartbeat machinery is unaffected.

If `config.fast_concurrency` is set higher than 20, the editor
rejects the value (max bound). If a future scraper somehow ends up
with a runaway value, the service-side `SCRAPLING_FAST_CONCURRENCY`
semaphore caps total in-flight fetches per service replica
regardless of caller intent.

### 4.4 Dispatch registration

`scraper-job-handler.js`'s `scraperClasses` map gets three new entries:

```javascript
import { LumaICalScraperFast } from './scrapers/LumaICalScraperFast.js';
import { LumaSearchScraperFast } from './scrapers/LumaSearchScraperFast.js';
import { LumaCategoryScraperFast } from './scrapers/LumaCategoryScraperFast.js';

const scraperClasses = {
  // ...existing seven entries unchanged...
  'LumaICalScraperFast':     LumaICalScraperFast,
  'LumaSearchScraperFast':   LumaSearchScraperFast,
  'LumaCategoryScraperFast': LumaCategoryScraperFast,
};
```

The `scraper_type` column is `text NOT NULL` — no schema change.

### 4.5 Admin editor UI

`SCRAPER_TYPE_SPECS` in `ScraperEditorModal.tsx` gains three new entries
after the existing Luma block. Each variant duplicates the parent's
`baseUrlLabel`, `baseUrlPlaceholder`, and `configFields`, and adds one
field:

```typescript
{
  value: 'LumaICalScraperFast',
  label: 'Luma iCal (Fast)',
  description: 'Same as Luma iCal but fetches event pages through the scrapling-fetcher service. ~10–20× faster on healthy calendars; falls back to the browser path automatically when the fast path fails.',
  // ...same baseUrl + objectType as LumaICalScraper...
  configFields: [
    ...LUMA_ICAL_CONFIG_FIELDS,  // shared constant — single source of truth
    {
      key: 'fast_concurrency',
      label: 'Fast-path concurrency',
      type: 'number',
      default: 5,
      min: 1,
      max: 20,
      helpText: 'Number of event pages fetched in parallel. Higher = faster but more proxy bandwidth and risk of Luma rate-limiting.',
    },
  ],
},
```

The shared `LUMA_ICAL_CONFIG_FIELDS` constant prevents drift between
the slow and fast variants.

### 4.6 Comparison view

A new admin page `/admin/scrapers/comparison` that lists pairs of
(slow scraper, fast scraper) operating on the same `base_url` (or
same `config.ical_id`), and per pair shows:

- 7-day rolling stats: avg duration, p95 duration, success rate, items
  per run
- Per-job side-by-side table for the most recent N pairs
- A "promote" button that swaps the active scraper from slow → fast
  (UI affordance only — sets `enabled=false` on the slow one and
  `enabled=true` on the fast one)

Backed by RPC `scrapers_compare_variants(window_days int)` returning
the join. SQL in `migrations/018_fast_vs_slow_comparison.sql`.

## 5. API Design

### 5.1 `POST /fetch`

**Authentication:** `X-Internal-Token: <SCRAPLING_INTERNAL_TOKEN>` header
required. Mismatched / missing → `401`.

**Content negotiation:** request `Content-Type: application/json`
required (415 if missing or non-JSON). Response always
`Content-Type: application/json; charset=utf-8`. Both directions
are JSON only — no multipart, no form-encoded, no negotiation.

**Request:**

```json
{
  "url": "https://lu.ma/abc123",
  "mode": "fast",
  "extract_next_data": true,
  "wait_for": null,
  "timeout_ms": 15000,
  "proxy": "auto"
}
```

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `url` | string | yes | — | Validated as absolute http(s) URL; rejected if scheme isn't http/https or host resolves to a private IP (SSRF protection — see §8) |
| `mode` | enum | no | `"fast"` | `fast` \| `stealth` \| `browser` |
| `extract_next_data` | bool | no | `true` | When true, run `<script id="__NEXT_DATA__">…</script>` regex server-side and return parsed JSON in `next_data` field |
| `wait_for` | string\|null | no | `null` | CSS selector; only honored when `mode == "browser"` |
| `timeout_ms` | int | no | `30000` | Capped at 60000 server-side |
| `proxy` | enum | no | `"auto"` | `auto` (service decides per `SCRAPLING_PROXY_MODE`) \| `force` \| `never` |

**Response (200):**

```json
{
  "status": 200,
  "html": "<!doctype html>…",
  "next_data": { "props": { "pageProps": { "initialData": { "data": { "event": {…} } } } } },
  "headers": {
    "content-type": "text/html; charset=utf-8",
    "server": "Cloudflare"
  },
  "timing": {
    "fetch_ms": 412,
    "total_ms": 425
  },
  "mode_used": "fast"
}
```

`next_data` is `null` when the page didn't contain the script tag or
parsing failed. `status` is the upstream HTTP status (NOT the service
response code — the service always returns 200 on a successful fetch
attempt, even when the upstream returned 404 or 5xx).

**Error responses:**

| Code | When |
|---|---|
| 400 | Invalid URL, invalid mode, or missing required field |
| 401 | Missing/mismatched `X-Internal-Token`. Response includes `WWW-Authenticate: InternalToken realm="scrapling-fetcher"` per RFC 7235 §4.1, body `{ error: "auth_required" }`. |
| 403 | URL host resolves to a private/loopback IP (SSRF guard) |
| 415 | Request `Content-Type` is missing or not `application/json` |
| 422 | Pydantic validation error on payload |
| 503 | Browser pool full beyond 30s queue ceiling |
| 504 | Upstream fetch timed out at `timeout_ms` |
| 502 | Upstream connection failure (DNS, TCP) |
| 500 | Internal error — body has `{ error: string, request_id: string }` |

### 5.2 `GET /healthz`

Liveness probe. Returns `200 {"status":"ok"}` if the FastAPI app is up.
No Scrapling check (intentional — we don't want a flaky upstream
to cycle the container).

### 5.3 `GET /readyz`

Readiness probe. Returns `200 {"status":"ready"}` if the browser pool
has at least one warmed context. Otherwise `503 {"status":"warming"}`.

### 5.4 `GET /metrics`

Prometheus metrics:

- `scrapling_fetch_total{mode, status_class}` — counter
- `scrapling_fetch_duration_seconds{mode}` — histogram, p50/p95/p99
- `scrapling_browser_pool_size` — gauge (current in-use)
- `scrapling_browser_pool_max` — gauge (configured max)
- `scrapling_proxy_bytes_total{direction}` — counter (when proxy on)

Optional: not blocking for Phase 1 if k8s isn't yet scraping these.

## 6. Data Models / Database Schema

### 6.1 No changes to `scrapers` table

`scraper_type` is `text NOT NULL` — new values are valid without
migration. Existing rows untouched.

### 6.2 New SQL migration: `018_fast_vs_slow_comparison.sql`

A view + RPC that joins scrapers in pairs by `base_url` (or
`config->>'ical_id'`) and aggregates the last N days of jobs:

```sql
-- Normalize a base_url for pairing: strip scheme, trailing slash,
-- collapse luma.com↔lu.ma, lowercase host. Done in SQL so the join
-- catches user typos that semantically mean the same calendar.
CREATE OR REPLACE FUNCTION scrapers_normalize_pair_key(
  p_base_url text,
  p_ical_id  text
) RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT COALESCE(
    -- ical_id wins when both are present (it's globally unique)
    NULLIF(LOWER(BTRIM(p_ical_id)), ''),
    -- otherwise normalize the URL
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(LOWER(BTRIM(p_base_url)), '^https?://', ''),
        '^luma\.com/', 'lu.ma/'
      ),
      '/+$', ''
    )
  );
$$;

CREATE OR REPLACE VIEW scrapers_variant_pairs AS
SELECT
  slow.id           AS slow_id,
  slow.name         AS slow_name,
  slow.scraper_type AS slow_type,
  fast.id           AS fast_id,
  fast.name         AS fast_name,
  fast.scraper_type AS fast_type,
  scrapers_normalize_pair_key(slow.base_url, slow.config->>'ical_id') AS pairing_key
FROM public.scrapers slow
JOIN public.scrapers fast
  ON scrapers_normalize_pair_key(slow.base_url, slow.config->>'ical_id')
   = scrapers_normalize_pair_key(fast.base_url, fast.config->>'ical_id')
WHERE slow.scraper_type IN ('LumaICalScraper','LumaSearchScraper','LumaCategoryScraper')
  AND fast.scraper_type IN ('LumaICalScraperFast','LumaSearchScraperFast','LumaCategoryScraperFast')
  AND slow.scraper_type || 'Fast' = fast.scraper_type;

CREATE OR REPLACE FUNCTION scrapers_compare_variants(window_days int DEFAULT 7)
RETURNS TABLE (...)
LANGUAGE sql STABLE SECURITY INVOKER
AS $$
  SELECT
    p.slow_name, p.fast_name, p.pairing_key,
    -- aggregates from scraper_jobs
    AVG(EXTRACT(EPOCH FROM (slow_jobs.completed_at - slow_jobs.started_at))) AS slow_avg_duration_s,
    AVG(EXTRACT(EPOCH FROM (fast_jobs.completed_at - fast_jobs.started_at))) AS fast_avg_duration_s,
    -- ... etc
  FROM scrapers_variant_pairs p
  LEFT JOIN scraper_jobs slow_jobs ON slow_jobs.scraper_id = p.slow_id
    AND slow_jobs.completed_at > now() - (window_days || ' days')::interval
  LEFT JOIN scraper_jobs fast_jobs ON fast_jobs.scraper_id = p.fast_id
    AND fast_jobs.completed_at > now() - (window_days || ' days')::interval
  GROUP BY p.slow_name, p.fast_name, p.pairing_key;
$$;
```

`SECURITY INVOKER` (not DEFINER) — the caller's RLS applies. No new
admin permissions needed; the existing `admin` role can already read
both tables.

## 7. Infrastructure Requirements

### 7.1 Compose (local dev)

Add to `gatewaze/docker/docker-compose.yml`:

```yaml
  scrapling-fetcher:
    build: ../services/scrapling-fetcher
    container_name: ${BRAND_PREFIX:-example}-scrapling-fetcher
    restart: unless-stopped
    networks:
      - gatewaze
    environment:
      SCRAPLING_INTERNAL_TOKEN: ${SCRAPLING_INTERNAL_TOKEN}
      SCRAPLING_PROXY_URL: ${SCRAPLING_PROXY_URL:-}
      SCRAPLING_PROXY_MODE: ${SCRAPLING_PROXY_MODE:-none}
      SCRAPLING_BROWSER_POOL_SIZE: ${SCRAPLING_BROWSER_POOL_SIZE:-4}
      SCRAPLING_FAST_CONCURRENCY: ${SCRAPLING_FAST_CONCURRENCY:-10}
      SCRAPLING_PER_DOMAIN_RPS: ${SCRAPLING_PER_DOMAIN_RPS:-5}
      LOG_LEVEL: ${LOG_LEVEL:-INFO}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/healthz"]
      interval: 30s
      timeout: 5s
      retries: 3
    deploy:
      resources:
        limits:
          memory: 3G
        reservations:
          memory: 1G
```

The `worker` service gets two new env vars:

```yaml
      SCRAPLING_FETCHER_URL: http://scrapling-fetcher:8080
      SCRAPLING_INTERNAL_TOKEN: ${SCRAPLING_INTERNAL_TOKEN}
```

### 7.2 Kubernetes (production)

New Helm template `templates/scrapling-fetcher.yaml`:

- **Deployment:** 1 replica per environment, rolling update strategy.
  Resource requests `cpu: 200m, memory: 1Gi`, limits `cpu: 2,
  memory: 3Gi`. **Memory rationale:** each Chromium browser context
  consumes ~300–500 MB resident; the configured pool of 4 contexts
  alone is ~1.6–2.0 GB at peak, before the FastAPI process and
  Scrapling overhead. 1.5 GiB (the previous limit) is a near-certain
  OOMKill under load. 3 GiB gives headroom for monitoring and one
  unexpected oversized page; revisit downward if observed peak
  consumption stays well under (e.g., < 1.8 GiB sustained over a
  month). 2.5 GiB is a viable trim.
- **Service:** ClusterIP, port 8080, no external Ingress.
- **NetworkPolicy:** ingress only from worker pods (matchLabels on
  `app: gatewaze-worker`).
- **Secret:** `scrapling-fetcher-secrets` holding
  `SCRAPLING_INTERNAL_TOKEN` and `SCRAPLING_PROXY_URL`. Generated by
  the Helm chart from values in `values-{brand}.yaml` (the existing
  brand-secrets convention; see `gatewaze-environments/k8s/values-example.yaml`
  for the established pattern). The `Makefile`'s existing `helm-deploy`
  target picks them up — no new tooling required.
- **HorizontalPodAutoscaler:** *deferred*. Not in Phase 1. We start
  with 1 replica, observe load, scale manually if needed.

### 7.3 Brand env files

Each `gatewaze-environments/{brand}.{env}.env` gains:

```
SCRAPLING_INTERNAL_TOKEN=<openssl rand -hex 32>
SCRAPLING_PROXY_URL=<rayobyte gateway url, or unset for no-proxy>
SCRAPLING_PROXY_MODE=none  # change to 'stealth-only' once Phase 3 starts
SCRAPLING_BROWSER_POOL_SIZE=4
SCRAPLING_FAST_CONCURRENCY=10
```

## 8. Security Considerations

### 8.1 Internal authentication

Single shared secret `SCRAPLING_INTERNAL_TOKEN` in `X-Internal-Token`
header. Generated per-environment via `openssl rand -hex 32`, stored
in the brand env file. **Not** rotated automatically; manual rotation
documented in `gatewaze-environments/README.md` as part of routine
secrets hygiene.

The service rejects any request without the header at the FastAPI
middleware layer — before any URL parsing, before any browser context
is touched. Constant-time comparison via `secrets.compare_digest` to
prevent timing attacks.

### 8.2 SSRF protection

The `/fetch` endpoint accepts a URL. Without guards, an attacker who
penetrated the worker (or compromised an admin's session that can
edit scrapers) could point the service at internal addresses
(`http://10.0.0.1/admin`, `http://169.254.169.254/latest/meta-data`,
container-internal Supabase, etc.).

Mitigations layered:

1. Pydantic validator on `url`: must be absolute `http`/`https`,
   reject non-DNS hosts.
2. Pre-fetch DNS resolution via `socket.getaddrinfo`. Reject if **any**
   resolved IP (across both A and AAAA records) is in:
   - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (RFC 1918)
   - `127.0.0.0/8` (loopback)
   - `169.254.0.0/16` (link-local; AWS/GCP IMDS)
   - `::1`, `fc00::/7`, `fe80::/10` (IPv6 equivalents)
   - `0.0.0.0/8` and `100.64.0.0/10` (unspecified, CGNAT)
3. **TOCTOU residual risk (accepted Phase 1):** the pre-DNS check is
   tight, but between resolve-and-validate and httpx's own connection
   resolve, an attacker who controlled the answering DNS server could
   in principle race in a private-IP answer. **Originally** the spec
   prescribed an IP-literal rewrite + `Host:` header to defeat this,
   but httpx 0.28 doesn't expose a per-request SNI override and
   rewriting the URL to an IP literal breaks TLS SNI on every
   cert-pinned upstream (manifests as `SSLV3_ALERT_HANDSHAKE_FAILURE`
   on Cloudflare-fronted sites including Luma). Phase 1 therefore
   ships **without** the URL rewrite — the pre-DNS check is the only
   line of defence. Exploit requires DNS control AND a sub-millisecond
   race window AND our targets are public-internet event sites
   (Luma/Eventbrite), so the residual risk is acceptable. Phase 2
   re-introduces the rewrite via a custom `httpx.AsyncHTTPTransport`
   that pre-binds the resolved IP while preserving SNI through a
   manual `ssl.create_default_context()` with `server_hostname` set —
   tracked as a follow-up.
4. **Browser-mode caveat:** for `mode: "browser"`, after Pydantic
   validation and DNS check pass, the browser context is configured
   with a custom DNS-over-HTTPS resolver pointed at the same allowlist
   set, so a re-resolve still hits the guard. (Implementation detail:
   Playwright's `route` API intercepts and inspects each navigation;
   any URL whose host re-resolves to a blocked range is aborted.)
5. Rejection logs include `request_id`, source IP, target host, and
   the offending resolved IP. These flow to the same stdout structured
   log so we can detect probing patterns.

### 8.3 Network policy

In k8s, ingress to the service is restricted to pods labeled
`app=gatewaze-worker`. The api/portal pods cannot reach it (defence
in depth — only the worker should fetch).

In compose, the service is on the internal network only; no port
mapping to host.

### 8.4 Proxy credential handling

`SCRAPLING_PROXY_URL` contains `http://user:pass@gateway`. Loaded as
an env var; never logged (FastAPI middleware filters it from request
logs; uvicorn's access log doesn't include env). The Rayobyte
dashboard rotates the password monthly; we update the env file and
redeploy.

### 8.5 Secret rotation procedure

Documented in `gatewaze-environments/README.md` (added by this spec).
Two secrets to rotate: `SCRAPLING_INTERNAL_TOKEN` (per-environment
shared secret) and `SCRAPLING_PROXY_URL` (Rayobyte credentials).

**Rotation cadence:**

- `SCRAPLING_INTERNAL_TOKEN`: every 90 days, or immediately on
  suspected leak.
- `SCRAPLING_PROXY_URL`: monthly, aligned with Rayobyte's dashboard
  rotation reminder.

**Rotation procedure (zero-downtime):**

1. Generate the new value (`openssl rand -hex 32` for the token).
2. Update both `gatewaze-environments/{brand}.production.env` and the
   k8s `Secret` manifest (or `values-{brand}.yaml` if Helm-templated).
3. Deploy the worker container first with **both** old and new values
   (`SCRAPLING_INTERNAL_TOKEN_NEXT` env var; adapter sends the new
   value, falls back to `SCRAPLING_INTERNAL_TOKEN` on 401).
4. Deploy the fetcher service with the new value as primary and old
   value as `SCRAPLING_INTERNAL_TOKEN_PREV` (accepts either for one
   release cycle).
5. Once both are deployed and traffic stable, deploy the worker
   without the old value, then the fetcher without `_PREV`.
6. The whole rotation completes in ~30 min including two rolling deploys.

For the proxy URL, rotation is simpler: Rayobyte's dashboard supports
issuing a new credential while the old one stays valid for 24 hours.
We update the env file, deploy, and the old credential expires
automatically.

### 8.6 Mass-assignment in admin editor

The admin Scraper editor accepts arbitrary `config` JSON from the
admin user. The `fast_concurrency` field is validated by the
existing `ConfigField` machinery (numeric, min/max). The
`scraper_type` value is validated against `SCRAPER_TYPE_SPECS` — if
it doesn't match a known value, save is rejected client-side.

The API route that updates scrapers (`/api/scrapers/:id`) already uses
the `SCRAPER_WRITE_FIELDS` allowlist established in the prod-readiness
pass. We extend it to permit the new `fast_concurrency` config key —
no other routes touched.

### 8.7 Rate limiting on the new public surface

The `/fetch` endpoint is **internal only** (no Traefik route, no
ingress). Per the gatewaze-production-readiness skill's non-negotiable
#6, rate-limiting applies to "new public unauthenticated POST
endpoints." This is not public, but we add per-source-IP rate
limiting anyway as defence in depth: `slowapi` with **30 req/sec
per client IP** (revised down from 100 — the only legitimate clients
are 1–3 worker pods doing concurrency-10 fetches, so peak legit rate
is ~30 req/sec; anything above is a strong abuse signal). Excess
requests get `429 Retry-After: 1`. Worker pods don't hit this in
normal operation; an attacker who breached the network does.

### 8.8 Transport encryption (worker → service)

Phase 1 uses **plain HTTP over the docker bridge / k8s ClusterIP**,
not TLS. Rationale:

- Both endpoints live inside the cluster's private network. An
  attacker on the wire is already inside the cluster, at which point
  the threat model includes credentials theft, not just traffic
  inspection.
- The fetched HTML being relayed is itself public web content
  (Luma event pages, etc.) — no PII or credentials transit the link.
  Proxy credentials and the internal token are environment-scoped,
  not in payloads.
- Adding mTLS or TLS-with-self-signed-cert is a non-trivial ops
  burden (cert rotation, trust store mgmt) that the threat model
  doesn't justify.

If cluster-network trust is ever weakened (e.g., shared cluster
across tenants), revisit this with a separate spec.

## 9. Error Handling Strategy

### 9.1 Fast-path → browser fallback (Node side)

The new scraper classes wrap each `fetchPage` call in a try/catch.
Failure modes and fallbacks:

| Service response | Action |
|---|---|
| 2xx with `next_data` populated | Use it |
| 2xx with `next_data == null` (page lacks the script tag) | Fall back to Puppeteer |
| 4xx from the service | Log error, fall back to Puppeteer |
| 5xx from the service | Log error, fall back to Puppeteer |
| `status` field 4xx/5xx (upstream rejected us) | Single retry through `mode: "stealth"`; if that also fails, fall back |
| Network error / timeout calling the service | Fall back to Puppeteer |

The fallback path is the existing `LumaICalScraper.fetchEventPageData`
(or equivalent) — known-good code, no changes. So even if the service
is down for an hour, scrapes still complete (slowly).

### 9.2 Service-side error handling

- **Upstream 429:** record in metrics, surface as `status: 429` in the
  response. Caller (Node) decides whether to retry / fall back.
- **Upstream 5xx:** same — pass through `status`, let caller decide.
- **DNS failure / connection refused:** `502` from the service.
- **`timeout_ms` exceeded:** `504` from the service.
- **Browser pool exhausted past 30s queue ceiling:** `503` from the
  service. Caller falls back.
- **Internal Python exception:** `500` with `{ error, request_id }`.
  `request_id` is logged server-side with full traceback.

### 9.2.1 Retry policy in the Node adapter

For transient service-side errors only, the Node adapter performs **one
retry with 200 ms backoff** before declaring failure and falling back
to Puppeteer. Transient = `502`, `503`, `504`, network-level errors
(`ECONNRESET`, `ETIMEDOUT`). Non-transient (`400`, `401`, `403`, `404`,
`422`, `500`) skip the retry and go straight to fallback (`500` and
non-2xx upstream `status` codes are already a "the call worked but
something is wrong" signal — retrying won't help).

The retry budget per scraper job is capped at 5 (across all event
fetches in that job). Once exceeded, the adapter stops attempting the
service for the remainder of the job and uses Puppeteer for everything
remaining. This prevents thrashing when the service is sustained-down.

### 9.3 Per-error severity & log-level guidance

| Condition | Service log level | Worker log level | Alerts? |
|---|---|---|---|
| Upstream 200, `next_data` parsed | DEBUG | DEBUG | no |
| Upstream 200, `next_data: null` | INFO | INFO (note fallback) | no |
| Upstream 4xx (non-429) | INFO | INFO (note fallback) | no |
| Upstream 429 | WARN | WARN (consider proxy) | yes if rate ≥ 5%/10min |
| Upstream 5xx | WARN | WARN | yes if rate ≥ 5%/10min |
| Service `502` (DNS/connect) | WARN | WARN (retry once with backoff before fallback) | yes if rate ≥ 5%/10min |
| Service `503` (pool exhausted) | WARN | WARN | yes if rate ≥ 10%/10min |
| Service `504` (timeout) | WARN | WARN | yes if rate ≥ 5%/10min |
| Service `403` (SSRF guard tripped) | **ERROR** | ERROR | **yes immediate** (security signal) |
| Service `401` (token mismatch) | **ERROR** | ERROR | **yes immediate** (security signal) |
| Service `500` (internal) | **ERROR** | ERROR | yes if any in 5 min |
| Network error calling service | n/a | WARN (note fallback) | yes if rate ≥ 5%/10min |

The "alerts?" column is aspirational for Phase 1 — see §11.3 for the
real Phase 1 alerting reality (limited).

### 9.4 Bandwidth & cost runaway kill switch

A misconfigured scraper running at concurrency 20 against an unusually
chatty upstream could blow the proxy bandwidth budget unnoticed. Two
guards:

1. **Per-job byte ceiling:** the service tracks bytes-out (request) and
   bytes-in (response) per request. The Node adapter sums these per
   scraper job and aborts the job (sets `status='failed'`,
   `error_message='bandwidth_ceiling_exceeded'`) when the running total
   exceeds `config.bandwidth_ceiling_mb` (default 500 MB per job;
   editable in the Scraper editor for unusual workloads). **State
   location:** the accumulator is a `Map<jobId, { bytes, lastReset }>`
   inside `scripts/lib/scrapling-fetcher.js` module scope. It's cleared
   on `runScraperJob` exit (success or failure) by the existing
   try/finally in `scraper-job-handler.js`, with a defensive 1-hour
   TTL sweep on a `setInterval` to handle abandoned entries from
   crashed jobs. Per-job size in memory is ≤ 32 bytes — bounded.
2. **Service-wide daily proxy cap:** when `SCRAPLING_PROXY_MODE != none`,
   the service tracks daily bytes-through-proxy in a Prometheus counter.
   When the counter exceeds `SCRAPLING_PROXY_DAILY_GB_CAP` (default
   10 GB/day), all new requests with `proxy: "auto"` or `"force"`
   degrade to `proxy: "never"` and emit a WARN log per request. Resets
   at 00:00 UTC. This is a soft cap (the service keeps fetching, just
   without the proxy) so jobs still complete; the operator gets the
   signal via logs/metrics and decides whether to top up.

Both ceilings are documented in the runbook with the procedure to
raise them when expansion is intended.

### 9.3 Job-level invariants

The existing job-level invariants (lease, heartbeat, stuck-job
recovery) are unchanged. The new scrapers are subject to the same
timeout machinery in the worker. Faster scrapes = jobs complete
well within the existing 30-minute lease ceiling.

## 10. Performance Requirements / SLAs

### 10.0 Measurement methodology

How each target below is measured, by whom, and using what data:

| Metric | Source | Tool | Cadence |
|---|---|---|---|
| Per-event fetch latency (p50/p95) | Service `scrapling_fetch_duration_seconds` histogram | Prometheus query | Continuous |
| Scrape duration | `scraper_jobs.completed_at - started_at` | Comparison RPC `scrapers_compare_variants` | Per job |
| Items per run | `scraper_jobs.items_processed_count` | Comparison RPC | Per job |
| Service availability | `up{job="scrapling-fetcher"}` | Prometheus over month | Monthly review |
| Fast-path success rate | `scrapling_fetch_total{status_class="2xx",mode="fast"} / total` | Prometheus query | Continuous |
| Browser-fallback rate | Worker log scrape: `"falling back to Puppeteer"` count / total event fetches | Loki query (or grep on aggregated logs) | Per job, weekly review |

Phase 1 we do **not** wire up the Prometheus scraping — the metrics
endpoint exists but is consumed manually via `curl /metrics` during
the acceptance gate. Phase 2 adds Prometheus scraping to the cluster
config.

The acceptance-gate measurements (§12.7) are taken via the comparison
RPC, which is the source of truth for the slow-vs-fast comparison.

**Performance-validation timeline:** after deploy, the load test
(§12.5.1) and integration smoke test (§12.6) execute against EXAMPLE
staging, then again against EXAMPLE production. The acceptance gate
(§12.7) is then evaluated against ≥ 5 production calendars over a
1-week window before promoting any calendar's Fast variant. **No
production scraper is promoted to Fast without passing the gate
on its own.**

### 10.1 Targets (P1 acceptance criteria)

| Metric | Current | Target | Stretch |
|---|---|---|---|
| LumaICal 100-event scrape duration (median) | 15–25 min | ≤ 2 min | ≤ 1 min |
| LumaICal 100-event scrape duration (p95) | ~30 min | ≤ 5 min | ≤ 2 min |
| Per-event fetch latency (p50, fast mode) | ~10 s | ≤ 600 ms | ≤ 400 ms |
| Per-event fetch latency (p95, fast mode) | ~20 s | ≤ 2 s | ≤ 1 s |
| Service availability (Phase 1) | n/a | 99.5% / month | 99.9% |
| _**Why 99.5% (not 99.9%)?**_ | The fast-path falls back to the existing Puppeteer scrapers on service unavailability. Service downtime degrades performance (back to current speed) but **does not lose functionality**. 99.5% / month = ~3.6 hours of degraded performance per month, acceptable for a Phase 1 launch. The 99.9% stretch target maps to 43 min/month — chase this once Phase 2 traffic shows the failure modes. | | |
| Fast-path success rate (Luma) | n/a | ≥ 98% | ≥ 99.5% |
| Browser-fallback rate (Luma) | n/a | ≤ 2% | ≤ 0.5% |

### 10.2 Capacity

- Per worker container, expect ≤ 50 concurrent scraper jobs.
- Each fast-mode job at concurrency 10 = ≤ 10 in-flight requests to
  the service.
- 50 jobs × 10 concurrent = 500 in-flight requests max.
- Service processes fast-mode requests at ~500ms each → service
  needs to handle ~1000 req/sec sustained.
- Phase 1 single replica with `SCRAPLING_FAST_CONCURRENCY=10` per
  process won't hit this. If we do, scale to 3 replicas behind
  k8s Service load balancing — no code change.

### 10.3 Proxy bandwidth budget

- Per-event HTML response from Luma: ~150 KB.
- 1,000-event scrape ≈ 150 MB through Rayobyte.
- At Rayobyte $1.50/GB volume tier: ~$0.22 per 1,000-event scrape.
- Annual budget assuming 100 calendars × daily scrapes × avg 50
  events: 100 × 365 × 50 × 150 KB ≈ 270 GB/yr ≈ $400/yr proxy cost.
- Phase 1 (Luma fast path): proxy is **not** required because Luma
  doesn't currently rate-limit us. `SCRAPLING_PROXY_MODE=none`. The
  proxy is plumbing for Phase 3, not a Phase 1 cost.

## 11. Observability

### 11.1 Service-side

- **Logs:** uvicorn access log + structured app log to stdout.
  `request_id` (UUIDv4) generated per request, included in all log
  lines, returned to caller in `X-Request-ID` response header.
- **Metrics:** Prometheus on `/metrics` (see §5.4). Phase 1 we don't
  wire up scraping; Phase 2 we add to the cluster's Prometheus.
- **Tracing:** none in Phase 1. OpenTelemetry support in Scrapling is
  not yet required.

### 11.2 Node-side

- Per-job logs (existing scraper logger) gain new fields:
  `fast_path_ok`, `fast_path_failed`, `browser_fallback_count`,
  `service_avg_latency_ms`. These flow through the existing
  `scraper_jobs` row and into the comparison RPC.

### 11.3 Alerts (Phase 1: pragmatic, not aspirational)

Gatewaze does not currently operate a paging on-call rotation. Phase 1
alerts are therefore **logged warnings/errors visible in standard
operator dashboards**, not pager-style alerts. Each alert listed below
is a structured log line at WARN/ERROR level that the operator
reviews during the daily inbox/incidents check.

| Trigger | Log level | Visible in |
|---|---|---|
| Service `/readyz` failed > 5 min consecutively | ERROR (k8s pod restarts auto-emit) | k8s events |
| Service responds 5xx > 5% over 10 min | WARN (per-request) | Aggregated logs |
| Service `503` (browser pool exhausted) > 10% over 10 min | WARN | Aggregated logs |
| Service `403` SSRF guard tripped | ERROR | Logs (security incident — investigate manually) |
| Service `401` token mismatch | ERROR | Logs (security incident) |
| Daily proxy bandwidth cap hit | WARN | Logs |
| Fast-path failure rate > 5% per scraper-job | WARN | `scraper_jobs.warnings` JSON column |
| Browser-fallback rate > 10% per scraper-job | WARN | `scraper_jobs.warnings` JSON column |

When a paging on-call rotation is established (no current timeline),
the ERROR-level entries above are the candidates to promote to
pager alerts. The Phase 1 design exposes the data; the routing layer
is decoupled and added later.

## 12. Testing Strategy

Following the gatewaze-production-readiness skill's "every new feature
ships with tests" rule. Per-layer tests:

### 12.1 Python service (pytest)

Located in `gatewaze-environments/services/scrapling-fetcher/tests/`.

- `test_auth.py` — request without token → 401; wrong token → 401;
  correct token → 200.
- `test_ssrf.py` — URLs to RFC1918 / loopback / link-local → 403; one
  test per address family. **Mocking strategy:** `socket.getaddrinfo`
  is monkey-patched per test to return controlled IP results for the
  hostnames under test (no real DNS calls in CI). The actual upstream
  HTTP client is also mocked — these tests verify the guard logic,
  not the network layer. A separate (skipped-by-default) integration
  test in `test_ssrf_integration.py` runs the guard against real
  hostnames in a network-enabled CI environment when explicitly
  enabled with the `RUN_SSRF_INTEGRATION=1` env var.
- `test_validation.py` — invalid URL scheme, missing required fields,
  out-of-range `timeout_ms` → 400/422.
- `test_modes.py` — `mode: "fast"` returns html + next_data;
  `mode: "browser"` honors `wait_for`; `mode: "stealth"` uses
  StealthyFetcher (mocked).
- `test_next_data_extraction.py` — fixture HTML with `__NEXT_DATA__`
  → parsed JSON; HTML without it → `next_data: null`.
- `test_pool_exhaustion.py` — saturate the browser pool, 16th
  request → 503 after queue ceiling.

Coverage target: ≥ 90% of `app/` modules.

### 12.2 Node adapter (vitest)

`gatewaze-modules/modules/scrapers/scripts/lib/__tests__/scrapling-fetcher.test.js`:

- Service returns 200 → adapter returns parsed shape.
- Service returns 500 → adapter throws (caller decides fallback).
- Service times out → adapter throws.
- `X-Internal-Token` header is sent on every request.
- Connection pool reuses sockets across calls.

### 12.3 New scraper classes (vitest)

For each of `LumaICalScraperFast`, `LumaSearchScraperFast`,
`LumaCategoryScraperFast`:

- Happy path: service returns valid `next_data` → event normalized
  identically to the slow class's output.
- `next_data == null` → falls back to super's Puppeteer path (mocked).
- Service throws → falls back to super's Puppeteer path.
- Concurrency limit honored (assert ≤ N concurrent calls).

### 12.4 Comparison RPC (pgTAP or vitest + supertest)

`migrations/__tests__/018_fast_vs_slow_comparison.test.sql`:

- Inserts a slow + fast scraper pair sharing `base_url`.
- Inserts mock `scraper_jobs` for each.
- Calls `scrapers_compare_variants(7)` — assert grouped row matches.

### 12.5 Admin UI (vitest + react-testing-library)

`ScraperEditorModal.test.tsx`:

- New "Luma iCal (Fast)" option appears in the type dropdown.
- Selecting it shows the `fast_concurrency` field.
- Saving with `fast_concurrency: 25` shows validation error
  (max 20).

### 12.5.1 Load / stress test (one-time, before Phase 2 launch)

Before promoting the first production calendar to a Fast variant, run
a load test against the service in EXAMPLE staging:

- **Tool:** `hey` or `wrk` from a worker-equivalent pod inside the
  cluster (so the test traverses the same network path).
- **Scenarios:**
  1. Sustained 30 RPS of `mode: "fast"` against a known-good Luma URL
     for 5 minutes. Assert: p95 latency ≤ 1 s, zero 5xx, zero pool
     exhaustion.
  2. Burst 50 RPS for 30 s. Assert: rate-limit kicks in (some 429s),
     no 5xx, service recovers cleanly within 10 s of burst end.
  3. Sustained 5 RPS of `mode: "browser"` for 5 minutes (saturates
     the 4-context pool with backpressure). Assert: queueing keeps
     p95 ≤ 35 s (30 s ceiling + serve time), no orphaned contexts at
     end.
- **Pass criterion:** all three scenarios pass cleanly twice in a
  row. Captured in the acceptance gate (§12.7).

This is **not** a CI/CD-integrated test — load tests against live
upstream targets are flaky in CI. It's a documented runbook step
before each Phase 2 promotion.

### 12.6 Integration smoke test (manual, documented runbook)

Documented in `gatewaze-environments/specs/spec-scrapling-fetcher-service.md`
appendix:

1. Bring up the stack with `dev.sh example up`.
2. Create a `LumaICalScraperFast` scraper pointed at
   `https://lu.ma/genai`.
3. Run it. Assert: ≤ 2 min duration, ≥ 50 events ingested.
4. Compare against the existing `LumaICalScraper` for the same calendar.
5. Verify both paths produced identical event records (sample 5).

### 12.7 Acceptance gate before Phase 2 promotion

- All unit/integration tests green.
- One full-week parallel run of slow + fast variants on ≥ 5
  production calendars.
- Comparison RPC shows fast path within 1% of slow path's items
  ingested per run, AND ≥ 10× faster median.
- Browser-fallback rate ≤ 5% in production (proxy-less).

## 13. Deployment Strategy

### 13.1 Phase 1 — Service stand-up (week 1)

1. PR adds `scrapling-fetcher/` directory under
   `gatewaze-environments/services/`, plus compose entry, plus brand
   env-file additions for `SCRAPLING_INTERNAL_TOKEN`.
2. PR adds Helm template + NetworkPolicy + Secret manifest.
3. Deploy to EXAMPLE staging first. Smoke-test `/fetch`, `/healthz`.
4. Promote to EXAMPLE production. Monitor for 48h.
5. Promote to demo + acme production.

**Rollback options (in order of preference):**

1. **Helm release rollback** — `helm rollback gatewaze <previous-revision>`
   restores the previous service version. Used for "bad new image"
   scenarios where the image works at all (so we have something to
   roll back *to*).
2. **Scale to 0 replicas** — `kubectl scale deploy/scrapling-fetcher --replicas=0`.
   Stops the service entirely; the Node adapter's
   `ScraplingNotConfiguredError` path kicks in (or 502 fallback if
   `SCRAPLING_FETCHER_URL` is still set), and the Fast scrapers
   degrade to the existing Puppeteer path. Used for "bad service,
   no good prior version" scenarios.
3. **Disable Fast scraper variants per-row** — operator sets
   `enabled=false` on the affected `*Fast` scrapers via the admin UI.
   Used for "service is fine but a specific Fast scraper is misbehaving."
4. **Re-enable slow variants** — if the Fast variant was promoted by
   disabling its slow sibling, re-enable the slow one. Comparison-page
   button does this in one click.

The decision tree for which rollback to pick is in the runbook
appendix.

### 13.1.1 Contingency: Fast variants don't beat slow ones for some calendars

The acceptance gate (§12.7) is per-calendar, not blanket. If a specific
calendar's Fast variant fails the gate (e.g., that target is highly
JS-rendered and `__NEXT_DATA__` is incomplete), the operator has three
options:

1. **Leave the slow variant active**, disable the Fast one. The slow
   variant keeps working as it always has. The infrastructure is
   still useful for *other* calendars where Fast wins.
2. **Tune the Fast scraper's `fast_concurrency` down** and re-run the
   gate. Some calendars rate-limit aggressively; lower concurrency
   may help.
3. **File a bug** documenting the calendar URL + the comparison RPC
   output. Add it to the per-calendar exclusion list in the
   `LumaICalScraperFast.skip_calendars` config — Fast variant detects
   the URL and immediately falls back to Puppeteer for those.

The Fast→slow ratio is acceptable indefinitely; we don't force a
universal migration. Some calendars permanently stay on slow if Fast
can't win for them. Documented as expected outcome, not a project
failure.

### 13.2 Phase 2 — Fast scraper variants (week 2–3)

1. PR adds the three new scraper classes + dispatch registration +
   editor UI entries.
2. PR adds the `018_fast_vs_slow_comparison.sql` migration + admin
   comparison page.
3. In each production env: pick 1–2 LumaICal scrapers, clone them
   as `*Fast` variants in disabled state.
4. Enable the fast variants alongside the slow ones (both run on
   their own schedules — separate cron times so they don't compete).
5. Watch the comparison view for 1 week.
6. If acceptance gate passes, mark the slow variants disabled,
   leave the fast ones running.

**Rollback per scraper:** disable the fast variant, re-enable the
slow one. UI button on the comparison page does this in one click.

### 13.3 Phase 3 — New CF-protected sources (week 4+)

Out of scope for this spec. Once Phase 2 is bedded in, we add a
new `EventbriteFastScraper` (or similar) that uses
`mode: "stealth"` with `SCRAPLING_PROXY_MODE=stealth-only` and
Rayobyte residential IPs. That work gets its own spec.

## 14. Migration Plan

Migration is **per-scraper, opt-in**, driven by the comparison view.
No big-bang cut-over. Existing scrapers run unchanged for as long as
operators want them to. The legacy classes are deleted only after:

- All production scrapers of a given type have been promoted to the
  Fast variant.
- Comparison RPC shows zero usage of the slow variant for ≥ 30 days.
- A separate cleanup PR removes the slow class, its file, and its
  `SCRAPER_TYPE_SPECS` entry.

Estimated full migration timeline: **3–6 months** from Phase 2 launch,
gated on operator confidence.

## 15. Cost monitoring & throttling (proxy + AI providers)

This spec ships the foundation for Gatewaze's first **universal cost
ledger** — a single mechanism for tracking, attributing, and capping
spend on all external paid APIs. Phase 1 wires up the two adjacencies
(residential proxy bandwidth and the Anthropic call inside the scraper
pipeline). Other modules opt in by adopting the helper.

### 15.1 Why a unified ledger (vs per-feature counters)

Six known LLM call sites already exist across modules
(attendee-matching, recipes, scrapers, newsletters, sites, events;
see [Appendix C](#appendix-c--llm-call-site-inventory)).
Each currently calls Anthropic/OpenAI directly with no record of cost
or attribution. Per-feature counters would solve each in isolation
but produce N inconsistent dashboards and N config surfaces. A single
ledger:

- Attributes every dollar to a brand (EXAMPLE / Demo / Acme)
  and a feature (`scraper:speaker-extraction`,
  `attendee-matching:generate-matches`, etc).
- Lets us set per-brand caps without touching individual modules.
- Provides one admin view of "how much did this brand spend on
  external APIs last month, broken down by provider and feature."

### 15.2 Data model

New table `external_api_usage` (migration ships in this spec):

```sql
CREATE TABLE public.external_api_usage (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  brand_id        text NOT NULL,            -- 'example' | 'demo' | 'acme'
  provider        text NOT NULL,            -- 'anthropic' | 'openai' | 'rayobyte' | 'brightdata' | ...
  product         text NOT NULL,            -- 'claude-sonnet-4-5' | 'gpt-4o' | 'residential-proxy' | ...
  feature         text NOT NULL,            -- 'scraper:speaker-extraction' | 'attendee-matching' | 'newsletter-import' | ...
  units_in        bigint NOT NULL DEFAULT 0,  -- input tokens, or bytes-out for proxy
  units_out       bigint NOT NULL DEFAULT 0,  -- output tokens, or bytes-in for proxy
  cost_usd        numeric(12, 6) NOT NULL,    -- the dollar figure recorded at call time
  request_id      text,                       -- correlate with logs
  context         jsonb DEFAULT '{}'::jsonb,  -- arbitrary { scraper_id, calendar_id, event_id, user_id, ... }
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.external_api_usage (brand_id, provider, occurred_at DESC);
CREATE INDEX ON public.external_api_usage (feature, occurred_at DESC);
CREATE INDEX ON public.external_api_usage (occurred_at DESC);
-- Time-bucketed roll-ups via continuous aggregates (Postgres 14+: monthly partition would also work; we use simple indexes for Phase 1 and re-evaluate at 1B rows).
```

Cost is **recorded at call time**, not derived later from a price
sheet. Each provider helper knows its own per-unit cost and computes
`cost_usd` before insert. Price-sheet drift is therefore captured at
the moment of consumption — historical records reflect the real
cost. Re-pricing does not retroactively rewrite the ledger.

**Per-brand budgets table:**

```sql
CREATE TABLE public.external_api_budgets (
  brand_id        text NOT NULL,
  provider        text NOT NULL,                -- '*' = all providers for this brand
  period          text NOT NULL CHECK (period IN ('daily', 'monthly')),
  soft_cap_usd    numeric(12, 2) NOT NULL,      -- WARN log + admin notification
  hard_cap_usd    numeric(12, 2),               -- when set, throttle further calls (helper raises BudgetExceededError)
  notes           text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, provider, period)
);
```

Editable from the admin UI (§15.5). Defaults seeded by migration:
soft cap = $20/day per brand per provider, hard cap = $100/day. Tunable
per env via the seed migration — e.g. EXAMPLE production seed ships at
`soft=$50, hard=$200`; staging ships at `soft=$5, hard=$10`.

### 15.2.1 New module: `cost-governance`

The ledger table, RPC, helper SDK, and admin page live in a new
top-level module `cost-governance` under `gatewaze-modules/`. Module
shape follows the existing convention (e.g. `content-platform`):

```
gatewaze-modules/modules/cost-governance/
├── index.ts                          # GatewazeModule export
├── migrations/
│   └── 001_external_api_usage.sql    # ledger + budgets + RPCs
├── admin/
│   └── pages/
│       └── CostPage.tsx              # /admin/cost
├── api/
│   └── budgets.ts                    # CRUD endpoints (admin-gated)
└── shared/
    └── (proxy to packages/shared/src/cost/* — see below)
```

The TS helper (`callAnthropic`, `callOpenAI`, `recordUsage`) lives
in `packages/shared/src/cost/` so any module can import it without
a hard dependency on the `cost-governance` module being installed.
If `cost-governance` is not installed, the helper writes to the
table best-effort and silently no-ops the budget check — failure
mode is "no budget enforcement" not "the feature breaks." Modules
that want hard budget enforcement must declare `cost-governance` in
their `dependencies` array.

### 15.2.2 Ledger volume, retention, and partitioning

Worst-case projection: 100 LLM calls/day per brand × 3 brands × 365
days = ~110k rows/year. Even at 10× growth, table stays well under
10M rows for several years — within Postgres's comfortable single-
table range with the indexes in §15.2.

**Phase 1 retention:** 24 months of full-fidelity data; nothing is
purged. At ~5 GB tabular storage at 24 months, this is below the
Supabase plan baseline.

**Phase 2 retention (when row count > 10M):**

- Aggregate rows older than 90 days into a `external_api_usage_daily`
  rollup table (one row per `brand_id × provider × feature × day`).
- Drop the underlying detail rows after rollup.
- Admin UI's drill-down ("show me individual calls") is then limited
  to last 90 days — the rollup serves the long-tail trend chart.
- Ship as a new spec when triggered.

**Partitioning:** **not** in Phase 1. Postgres declarative partitioning
adds operational overhead (per-partition indexes, attach/detach DDL)
that's premature at our row counts. Re-evaluate at the same trigger
as the rollup migration.

### 15.3 Helper SDK

A thin wrapper module ships in `@gatewaze/shared`:

```typescript
// packages/shared/src/cost/record.ts
export interface UsageRecord {
  brand_id: string;
  provider: 'anthropic' | 'openai' | 'rayobyte' | 'brightdata' | string;
  product: string;
  feature: string;
  units_in: number;
  units_out: number;
  cost_usd: number;
  request_id?: string;
  context?: Record<string, unknown>;
}

/**
 * Records usage to external_api_usage (best-effort: a failed insert
 * logs WARN but never throws — we never want cost tracking to break
 * the actual feature). Also checks the per-brand budget; throws
 * `BudgetExceededError` if the relevant hard cap is exceeded.
 */
export async function recordUsage(supabase: SupabaseClient, record: UsageRecord): Promise<void>

/**
 * Convenience wrappers that wrap an SDK call, time it, derive cost
 * from the returned token counts, and call recordUsage automatically.
 * Throws BudgetExceededError BEFORE making the call when over hard cap.
 */
export async function callAnthropic<T>(
  supabase: SupabaseClient,
  args: { brand_id: string; feature: string; model: string; context?: object },
  fn: (anthropic: Anthropic) => Promise<T>
): Promise<T>

export async function callOpenAI<T>(
  supabase: SupabaseClient,
  args: { brand_id: string; feature: string; model: string; context?: object },
  fn: (openai: OpenAI) => Promise<T>
): Promise<T>
```

**`BudgetExceededError`** type signature (in `packages/shared/src/cost/errors.ts`):

```typescript
export class BudgetExceededError extends Error {
  readonly brand_id: string;
  readonly provider: string;
  readonly period: 'daily' | 'monthly';
  readonly hard_cap_usd: number;
  readonly current_spend_usd: number;
  readonly resets_at: string;          // ISO 8601 — when the cap window resets
  readonly retry_after_seconds: number; // convenience for HTTP 429 Retry-After header

  constructor(args: { ... });
}
```

Callers `catch (e) { if (e instanceof BudgetExceededError) ... }` to
translate into HTTP 429 (Edge functions, API routes), log + skip
(scrapers), or whatever the feature's degradation mode is.

**`record_external_api_usage` RPC return shape** (Postgres function;
called from Edge functions and the Python service):

```sql
RETURNS TABLE (
  inserted_id          bigint,        -- the new ledger row's id
  budget_status        text,          -- 'ok' | 'over_soft' | 'over_hard'
  current_spend_usd    numeric(12, 6),-- spend this period including the just-inserted row
  hard_cap_usd         numeric(12, 6),-- the active hard cap; NULL if none configured
  resets_at            timestamptz    -- when the period resets
);
```

The RPC inserts the row, computes the new period total, and returns
the budget status in a single roundtrip — callers don't make a
second query to check the cap.

**Pricing tables:** `packages/shared/src/cost/pricing.ts` holds a
versioned per-model price table (input + output token rates). Updated
manually when providers change pricing. The wrappers use this to
compute `cost_usd` from the SDK response's `usage` field.

**Edge functions:** Deno-runtime Edge functions can't import npm
shared packages. They use a Postgres RPC `record_external_api_usage(...)`
that takes the same fields and writes to the same table. The RPC
performs the budget check identically to the Node helper.

### 15.4 Throttling mechanism

Two-tier:

- **Soft cap:** WARN log + structured event written to
  `external_api_usage` `context.over_soft_cap = true`. Admin UI
  surfaces this. No throttling.
- **Hard cap:** `recordUsage` (and the wrapping `callAnthropic` /
  `callOpenAI` helpers) throws `BudgetExceededError` *before* the
  next call goes out. The caller decides how to handle:
  - **Scrapers:** speaker-extraction skips this event (logs the
    skip), continues with the rest of the scrape. Already-scraped
    events keep their existing speakers data; new events land
    without speakers until the budget resets.
  - **Attendee matching:** the Edge function returns 429 with
    `Retry-After: <seconds-until-period-reset>`.
  - **Newsletter import:** Edge function returns the same.

Hard cap has a **lookback window**: the budget check is
"`SUM(cost_usd) WHERE brand_id = X AND provider = Y AND occurred_at >
period_start`" with `period_start` = today 00:00 UTC for `daily`,
1st-of-month 00:00 UTC for `monthly`. Pure SQL, no caching, evaluated
on every call. At expected volumes (≤ 100k rows/day across all brands)
the indexed query is < 5 ms. We re-evaluate caching at 1M rows/month.

### 15.5 Admin UI

New page at `/admin/cost` in each brand's admin (similar pattern to
the existing `/admin/scrapers` page). Shows:

- Current period spend per provider, per feature
- Daily / monthly trend chart (last 30 days)
- Budget settings (editable, mass-assignment-safe per the prod-readiness
  skill — uses the existing `*_WRITE_FIELDS` allowlist pattern)
- Alert log: every soft-cap-exceeded and hard-cap-exceeded event in
  the last 30 days
- Per-feature drill-down: click a feature, see its individual call
  log with `context` JSONB rendered as key-value pairs

Backed by RPC `cost_summary(window_days int, group_by text)` returning
a pivot of brand × provider × feature. SQL in the migration ships
with this spec.

### 15.6 Phase 1 integration scope

Phase 1 wires the helper into the two adjacencies:

1. **Residential proxy bandwidth** — the `scrapling-fetcher` service
   calls a new Postgres RPC `record_external_api_usage` from Python
   on every successful fetch with `proxy_url != None`. The proxy
   provider's `record_usage` method returns the `cost_usd_estimate`,
   which the service passes through. (Service uses
   `psycopg[binary]` to talk to Supabase; a service-role key is
   provided via `SUPABASE_SERVICE_KEY` env.)
2. **Speaker extraction** in `luma-extractor.js` — replaces the
   direct `anthropic.messages.create(...)` call with
   `callAnthropic(supabase, { brand_id, feature: 'scraper:speaker-extraction', model, context: { scraper_id, event_id } }, anthropic => anthropic.messages.create({...}))`.

The other 5 LLM call sites (attendee-matching, recipes, newsletters,
sites, events generate-matches) **remain unchanged in this spec**.
Each is a separate per-module migration that follows the same
helper-wrap pattern. Spec'd as follow-on PRs (see Appendix C);
migration order driven by which features generate the most spend.

### 15.7 Out of scope (deferred)

- Multi-provider routing / failover (Anthropic→OpenAI on rate-limit) —
  a separate spec when needed.
- Real-time spend alerting (Slack / email push) — Phase 1 surfaces
  alerts in the admin UI only.
- Pre-purchase / batch-discount logic for proxy plans — operator
  manages this in the Rayobyte dashboard.
- Cost forecasting / anomaly detection — viable once the ledger
  has 90 days of data.

## 16. Open Questions / Future Considerations

### 16.1 Resolved during draft

- ✅ Container or subprocess? → **Container** (matches existing
  worker/api/portal layout; pre-built Playwright image makes it 5-line
  Dockerfile)
- ✅ Replace iCal parsing? → **No** (`node-ical` stays; only event-page
  enrichment moves)
- ✅ Replace existing scrapers? → **No** (new variants alongside,
  opt-in)
- ✅ Proxy provider? → **Rayobyte** (per separate proxy comparison)
- ✅ Browser engine in service? → **Microsoft Playwright pre-built
  image** (Chromium baked in, no apt-get gymnastics)

### 16.2 Open

- **Q1.** Should the comparison view auto-promote when criteria met,
  or always require human approval? → Default to human approval for
  the first 6 months; revisit.
- **Q2.** Do we expose `mode: "stealth"` as a per-scraper config option
  on the Fast variants, or only via the service's `SCRAPLING_PROXY_MODE`
  env? → Defer to Phase 3 — Phase 1/2 needs only `mode: "fast"`.
- **Q3.** Adaptive selectors (Scrapling's killer feature for
  brittle sites): worth wiring up for Luma? → No; `__NEXT_DATA__` is
  stable. Re-evaluate per-source in Phase 3.
- **Q4.** Should we ship a CLI for ad-hoc fetches (`gatewaze fetch
  https://lu.ma/...`)? → Out of scope; Scrapling has its own CLI
  installable separately if anyone wants it locally.
- **Q5.** Memory leak risk — Playwright contexts not closed properly
  bloat the container over time. Mitigation: scheduled container
  restart every 24h via k8s Deployment annotation. Acceptable
  Phase 1; revisit if it becomes a problem.

---

## Appendix A — Implementation file checklist

- [ ] `gatewaze-environments/services/scrapling-fetcher/Dockerfile`
- [ ] `gatewaze-environments/services/scrapling-fetcher/requirements.txt`
- [ ] `gatewaze-environments/services/scrapling-fetcher/app/main.py`
- [ ] `gatewaze-environments/services/scrapling-fetcher/app/auth.py`
- [ ] `gatewaze-environments/services/scrapling-fetcher/app/ssrf.py`
- [ ] `gatewaze-environments/services/scrapling-fetcher/app/fetcher_pool.py`
- [ ] `gatewaze-environments/services/scrapling-fetcher/app/models.py`
- [ ] `gatewaze-environments/services/scrapling-fetcher/tests/*` (per §12.1)
- [ ] `gatewaze/docker/docker-compose.yml` — new service block + worker env
- [ ] `gatewaze-environments/k8s/templates/scrapling-fetcher.yaml`
- [ ] `gatewaze-environments/example.local.env` — new env vars
- [ ] `gatewaze-environments/example.production.env` — new env vars (and same for demo, acme)
- [ ] `gatewaze-modules/modules/scrapers/scripts/lib/scrapling-fetcher.js`
- [ ] `gatewaze-modules/modules/scrapers/scripts/lib/__tests__/scrapling-fetcher.test.js`
- [ ] `gatewaze-modules/modules/scrapers/scripts/scrapers/LumaICalScraperFast.js`
- [ ] `gatewaze-modules/modules/scrapers/scripts/scrapers/LumaSearchScraperFast.js`
- [ ] `gatewaze-modules/modules/scrapers/scripts/scrapers/LumaCategoryScraperFast.js`
- [ ] `gatewaze-modules/modules/scrapers/scripts/scrapers/__tests__/*.test.js`
- [ ] `gatewaze-modules/modules/scrapers/scripts/scraper-job-handler.js` — register the three new classes
- [ ] `gatewaze-modules/modules/scrapers/migrations/018_fast_vs_slow_comparison.sql`
- [ ] `gatewaze-modules/modules/scrapers/admin/pages/ScraperEditorModal.tsx` — three new SPECS entries + shared `LUMA_*_CONFIG_FIELDS` constants
- [ ] `gatewaze-modules/modules/scrapers/admin/pages/ScraperComparisonPage.tsx` — new page
- [ ] `gatewaze-modules/modules/scrapers/index.ts` — `adminRoutes` entry for the comparison page
- [ ] Per-package: `pnpm --filter @gatewaze/<pkg> exec tsc --noEmit` clean
- [ ] Per-package: lint clean
- [ ] CI workflows updated if Python service needs its own job (yes — `pytest` job for `services/scrapling-fetcher`)
- [ ] `gatewaze-environments/services/scrapling-fetcher/app/proxy/base.py` — `ProxyProvider` ABC
- [ ] `gatewaze-environments/services/scrapling-fetcher/app/proxy/{none,rayobyte,brightdata,oxylabs,decodo,iproyal}.py` — built-in providers
- [ ] `gatewaze-environments/services/scrapling-fetcher/app/cost_ledger.py` — psycopg client, `record_external_api_usage` RPC caller
- [ ] `packages/shared/src/cost/record.ts`, `packages/shared/src/cost/pricing.ts`, `packages/shared/src/cost/errors.ts` — TS helper SDK
- [ ] `gatewaze-modules/modules/scrapers/scripts/lib/luma-extractor.js` — wrap `anthropic.messages.create` with `callAnthropic`
- [ ] `gatewaze-modules/modules/cost-governance/migrations/001_external_api_usage.sql` — ledger table + RPC + budget table + `cost_summary` RPC (lives in a new module so any deployment that wants cost tracking enables one module rather than scattering migrations)
- [ ] `gatewaze-modules/modules/cost-governance/admin/pages/CostPage.tsx` — `/admin/cost` page

## Appendix B — Residential proxy provider analysis

(Captured during spec drafting to inform the proxy choice. Recommendation
adopted: **Rayobyte**.)

### B.1 Comparison matrix

All prices in USD/GB unless stated. Captured May 2026.

| Provider | Entry $/GB | Volume $/GB (~250 GB) | Min. commit | IP pool | Sticky | Traffic expiry | Free trial |
|---|---|---|---|---|---|---|---|
| Bright Data | $4.00 PAYG | $2.50 ($1,999/mo) | $499/mo to leave PAYG | 400M | Yes | Monthly | Yes, no CC |
| Oxylabs | $6.00 (5 GB) | $4.00 ($500/mo) | $30/mo | 175M | Yes (24h) | Monthly | Yes (manual) |
| Decodo (ex-Smartproxy) | $3.75 (3 GB) | $2.50 ($625/mo) | $11.25/mo | 115M | Yes (30 min) | Monthly | 3-day, 100 MB |
| SOAX | $3.60 (25 GB) | $2.46 ($740/mo) | $90/mo | 155M | Yes (1h) | Monthly | $1.99 / 400 MB |
| NodeMaven | $2.00 starting | quote | $3.50 trial | 30M | **Yes (7-day)** | PAYG: never | $3.50 / 750 MB |
| IPRoyal | $7.00 (1 GB) | $4.90 (50 GB) | None | 32M | Yes | **Never expires** | Yes (Google) |
| Webshare | $3.50 (1 GB rotating) | $2.25 (100 GB) | None | 80M | Yes | Monthly | 10 free DC proxies |
| **Rayobyte** | **$3.50 (1–49 GB)** | **$1.50 (250–999 GB)** | **None** | 40M | Yes | **Never expires** | Yes |
| Evomi | $0.49 advertised | $0.49 (claim) | $49.99/mo | 54M | Yes | Monthly | $0 / 1-day |
| DataImpulse | $1.00 ($5/5 GB) | $0.80 (1 TB) | $5 one-time | 90M | Yes | **Never expires** | $5 starter |
| Proxy Empire | "from $0.75" | unverified | unverified | 30M | Yes | unverified | unverified |
| BirdProxies | €1.40/IP | €1.10/IP | €35/mo | not pub. | per-IP | unlimited bw | not pub. |

### B.2 Why Rayobyte

- **Cheapest mid-volume tier** that still has a credible IP pool size
  (40M, 163+ countries) — $1.50/GB at 250+ GB is half the market median.
- **No commitment + never-expiring traffic** — fits our bursty,
  low-volume reality (single-digit GB/month for years).
- **Free trial** available without credit-card friction.
- US-based, ethical-sourcing claims, established reputation in the
  scraping community.

Bright Data and Oxylabs are premium-tier overkill for our targets.
Evomi and DataImpulse are cheaper but smaller community footprint;
acceptable as future fallback. BirdProxies' per-IP unlimited model
suits steady-state, not bursty workloads. NodeMaven's 7-day sticky
sessions are unique but our use case doesn't need them.

### B.3 Onboarding plan (Rayobyte)

1. Sign up for Rayobyte free trial.
2. Run a 100-event LumaICalScraperFast against a known calendar with
   `SCRAPLING_PROXY_URL` set to the Rayobyte gateway.
3. Compare success rate / latency / bandwidth against the same
   scraper without the proxy.
4. If success rate parity (within 1%), purchase the 50 GB starter
   pack ($98).
5. Watch monthly bandwidth consumption; upgrade to 250 GB when
   monthly use reaches 100 GB.

### B.4 Switching providers later (per §4.1.1)

To swap Rayobyte for any other built-in provider:

1. Sign up for the alternative service; obtain credentials.
2. Update `SCRAPLING_PROXY_PROVIDER` (e.g. `iproyal`) and
   `SCRAPLING_PROXY_CONFIG` JSON in the brand env file to that
   provider's expected schema.
3. Redeploy the `scrapling-fetcher` service. No code change.
4. Watch the cost ledger (§15): `provider` column flips to the new
   value on first request through the new provider. Historical
   Rayobyte rows remain for audit.
5. Old credentials can be revoked once the deploy is stable.

To add a custom provider not shipped in-tree:

1. Implement `ProxyProvider` ABC in a Python module (typically
   ≤ 50 lines).
2. Publish to a private package index OR mount via volume.
3. Set `SCRAPLING_PROXY_PROVIDER=mymodule.MyProvider`.
4. Same redeploy + ledger flip as above.

## Appendix C — LLM call-site inventory

(Used to size the rollout of §16's cost-monitoring helper. Each row
is a separate follow-on PR adopting the helper.)

| Module | File | Provider | Phase 1 instrumented? |
|---|---|---|---|
| scrapers | `lib/luma-extractor.js` (speaker extraction) | Anthropic | **Yes** (§15.6) |
| attendee-matching | `functions/events-generate-matches/index.ts` (Edge) | Anthropic | No — follow-on PR |
| events | `functions/events-generate-matches/index.ts` (Edge) | Anthropic | No — follow-on PR |
| recipes | `api.ts` (two call sites) | Anthropic | No — follow-on PR |
| newsletters | `functions/newsletter-gdoc-import/ai-mapper.ts` (Edge) | Anthropic | No — follow-on PR |
| sites | `lib/media/ai-alt-text.ts` (Anthropic + OpenAI clients) | Both | No — follow-on PR |

Migration order is driven by observed cost per feature. The
`/admin/cost` page exposes spend before any of these are migrated
(Phase 1 instruments the proxy + speaker-extraction; the others
appear as `provider: 'unknown'` rows from a separate audit task
that scrapes provider dashboards monthly until each feature is
properly instrumented).
