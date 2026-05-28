import Browserbase from '@browserbasehq/sdk';

/**
 * Browserbase Fetch + Search web-data APIs (stateless HTTP — NOT a browser
 * session). Spec §5 "evaluate-only": these tools exist so a recipe can A/B
 * Browserbase Fetch/Search against the scrapling-backed gatewaze_search.
 * Independent of the page backend; needs only BROWSERBASE_API_KEY.
 */
export class BrowserbaseWeb {
  private bb: Browserbase | null;

  constructor(apiKey: string | undefined) {
    this.bb = apiKey ? new Browserbase({ apiKey }) : null;
  }

  available(): boolean {
    return this.bb !== null;
  }

  async fetch(
    url: string,
    format: 'raw' | 'markdown',
  ): Promise<{ statusCode: number; contentType: string; content: string }> {
    if (!this.bb) throw new Error('browserbase_unavailable: BROWSERBASE_API_KEY not set');
    const res = await this.bb.fetchAPI.create({ url, format });
    const content = typeof res.content === 'string' ? res.content : JSON.stringify(res.content);
    return { statusCode: res.statusCode, contentType: res.contentType, content };
  }

  async search(
    query: string,
    numResults?: number,
  ): Promise<{ query: string; results: unknown[] }> {
    if (!this.bb) throw new Error('browserbase_unavailable: BROWSERBASE_API_KEY not set');
    const res = await this.bb.search.web({ query, ...(numResults ? { numResults } : {}) });
    return { query: res.query, results: res.results };
  }
}
