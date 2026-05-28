import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { type Page } from 'puppeteer-core';
import { assertNavigable } from './lib/url-guard.js';
import { type BrowserBackend } from './lib/backend/index.js';
import { BrowserbaseWeb } from './lib/browserbase-web.js';
import { DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS } from './lib/config.js';

// The browser comes from a pluggable BrowserBackend (local Chromium or a
// Browserbase cloud session); the tool handlers below are backend-agnostic.

// ── Tool definitions ─────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'browser_navigate',
    description:
      'Navigate the browser to a URL (http/https only; private/loopback/metadata addresses are blocked). Returns the final URL, HTTP status, and page title.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to open' },
        wait_until: {
          type: 'string',
          description: "Load condition: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2' (default 'load')",
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'browser_read',
    description:
      'Read content from the current page. Pass a CSS selector to scope the read to one element (strongly preferred — keeps responses small); omit it to read the whole page. format: text|html. Output is truncated to max_chars.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to scope the read (optional but recommended)' },
        format: { type: 'string', description: "'text' (default) or 'html'" },
        max_chars: { type: 'number', description: `Truncate output to this many chars (default ${DEFAULT_MAX_CHARS})` },
      },
    },
  },
  {
    name: 'browser_fill',
    description:
      'Type a value into an input/textarea identified by a CSS selector. Clears the field first. Set submit=true to press Enter afterwards.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the input' },
        value: { type: 'string', description: 'Value to type' },
        submit: { type: 'boolean', description: 'Press Enter after typing (default false)' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'browser_click',
    description:
      'Click the element matched by a CSS selector. Set wait_for_navigation=true when the click triggers a page load.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the element to click' },
        wait_for_navigation: { type: 'boolean', description: 'Wait for navigation after the click (default false)' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option (by value) in a <select> element matched by a CSS selector.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector of the <select>' },
        value: { type: 'string', description: 'The option value to select' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'browser_wait_for',
    description: 'Wait until an element matching a CSS selector appears (or a timeout elapses).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        timeout_ms: { type: 'number', description: `Max wait in ms (default ${DEFAULT_TIMEOUT_MS})` },
      },
      required: ['selector'],
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Capture a PNG screenshot of the current page (or a single element when selector is given).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        selector: { type: 'string', description: 'CSS selector to screenshot a single element (optional)' },
        full_page: { type: 'boolean', description: 'Capture the full scrollable page (default false)' },
      },
    },
  },
  {
    name: 'browser_get_url',
    description: 'Return the current page URL and title. Cheap — use it to confirm a login or redirect succeeded.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'browser_close',
    description: 'Close the browser session and free resources.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'browserbase_fetch',
    description:
      'Fetch a URL via the Browserbase Fetch API (proxy network) and return its content as markdown or raw. Read-only, no browser session. Requires BROWSERBASE_API_KEY. Useful for A/B-ing against gatewaze_search/scrapling.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'Absolute http(s) URL to fetch' },
        format: { type: 'string', description: "'markdown' (default) or 'raw'" },
        max_chars: { type: 'number', description: `Truncate content to this many chars (default ${DEFAULT_MAX_CHARS})` },
      },
      required: ['url'],
    },
  },
  {
    name: 'browserbase_search',
    description:
      'Web search via the Browserbase Search API; returns title/url/published-date per result. Requires BROWSERBASE_API_KEY.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query' },
        num_results: { type: 'number', description: 'Number of results, 1-25' },
      },
      required: ['query'],
    },
  },
];

// ── Handlers ─────────────────────────────────────────────────────────────────

type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
const WAIT_UNTIL: readonly WaitUntil[] = ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'];

async function handleNavigate(page: Page, p: Record<string, unknown>) {
  const url = await assertNavigable(String(p.url));
  const requested = String(p.wait_until ?? 'load') as WaitUntil;
  const waitUntil = WAIT_UNTIL.includes(requested) ? requested : 'load';
  const resp = await page.goto(url, { waitUntil });
  return { url: page.url(), status: resp?.status() ?? null, title: await page.title() };
}

async function handleRead(page: Page, p: Record<string, unknown>) {
  const max = Number(p.max_chars ?? DEFAULT_MAX_CHARS);
  const format = (p.format as string) === 'html' ? 'html' : 'text';
  const selector = p.selector ? String(p.selector) : null;

  let content: string;
  if (selector) {
    content = await page.$eval(
      selector,
      (el, fmt) => (fmt === 'html' ? (el as HTMLElement).outerHTML : (el as HTMLElement).innerText),
      format,
    );
  } else {
    content =
      format === 'html'
        ? await page.content()
        : await page.evaluate(() => document.body.innerText);
  }
  const truncated = content.length > max;
  return { format, truncated, content: truncated ? content.slice(0, max) : content };
}

async function handleFill(page: Page, p: Record<string, unknown>) {
  const selector = String(p.selector);
  await page.waitForSelector(selector);
  await page.click(selector, { clickCount: 3 }); // select existing text
  await page.type(selector, String(p.value));
  if (p.submit) await page.keyboard.press('Enter');
  return { ok: true, selector };
}

async function handleClick(page: Page, p: Record<string, unknown>) {
  const selector = String(p.selector);
  await page.waitForSelector(selector);
  if (p.wait_for_navigation) {
    await Promise.all([page.waitForNavigation(), page.click(selector)]);
  } else {
    await page.click(selector);
  }
  return { ok: true, selector, url: page.url() };
}

async function handleSelect(page: Page, p: Record<string, unknown>) {
  const selector = String(p.selector);
  await page.waitForSelector(selector);
  await page.select(selector, String(p.value));
  return { ok: true, selector };
}

async function handleWaitFor(page: Page, p: Record<string, unknown>) {
  const selector = String(p.selector);
  await page.waitForSelector(selector, { timeout: Number(p.timeout_ms ?? DEFAULT_TIMEOUT_MS) });
  return { ok: true, selector };
}

async function handleScreenshot(page: Page, p: Record<string, unknown>) {
  let data: string;
  if (p.selector) {
    const el = await page.$(String(p.selector));
    if (!el) throw new Error(`No element matches selector: ${p.selector}`);
    data = (await el.screenshot({ encoding: 'base64', type: 'png' })) as string;
  } else {
    data = (await page.screenshot({
      encoding: 'base64',
      type: 'png',
      fullPage: Boolean(p.full_page),
    })) as string;
  }
  return { image: data };
}

async function handleGetUrl(page: Page) {
  return { url: page.url(), title: await page.title() };
}

// ── Server factory ─────────────────────────────────────────────────────────

export function createBrowserMcpServer(backend: BrowserBackend): Server {
  const server = new Server(
    { name: 'gatewaze-browser-mcp', version: '0.1.0' },
    { capabilities: { tools: {} } },
  );
  // Stateless Fetch/Search web-data API (separate from the page backend).
  const web = new BrowserbaseWeb(process.env.BROWSERBASE_API_KEY);

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const p = (args ?? {}) as Record<string, unknown>;

    try {
      if (name === 'browser_close') {
        await backend.close();
        return { content: [{ type: 'text', text: JSON.stringify({ ok: true, closed: true }) }] };
      }

      // ── Browserbase Fetch/Search (no browser session needed) ──────────────
      if (name === 'browserbase_fetch') {
        const url = await assertNavigable(String(p.url)); // SSRF guard applies here too
        const format = p.format === 'raw' ? 'raw' : 'markdown';
        const res = await web.fetch(url, format);
        const max = Number(p.max_chars ?? DEFAULT_MAX_CHARS);
        const truncated = res.content.length > max;
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: res.statusCode,
                  contentType: res.contentType,
                  truncated,
                  content: truncated ? res.content.slice(0, max) : res.content,
                },
                null,
                2,
              ),
            },
          ],
        };
      }
      if (name === 'browserbase_search') {
        const res = await web.search(
          String(p.query),
          p.num_results !== undefined ? Number(p.num_results) : undefined,
        );
        return { content: [{ type: 'text', text: JSON.stringify(res, null, 2) }] };
      }

      const page = await backend.getPage();
      let result: unknown;

      switch (name) {
        case 'browser_navigate': result = await handleNavigate(page, p); break;
        case 'browser_read': result = await handleRead(page, p); break;
        case 'browser_fill': result = await handleFill(page, p); break;
        case 'browser_click': result = await handleClick(page, p); break;
        case 'browser_select': result = await handleSelect(page, p); break;
        case 'browser_wait_for': result = await handleWaitFor(page, p); break;
        case 'browser_get_url': result = await handleGetUrl(page); break;
        case 'browser_screenshot': {
          const shot = await handleScreenshot(page, p);
          return { content: [{ type: 'image', data: shot.image, mimeType: 'image/png' }] };
        }
        default:
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
            isError: true,
          };
      }

      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true };
    }
  });

  return server;
}
