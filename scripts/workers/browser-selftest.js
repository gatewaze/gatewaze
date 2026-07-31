#!/usr/bin/env node

/**
 * Worker Browser Self-Test
 *
 * Launches the system Chromium through puppeteer-core with the SAME flag set
 * the scrapers use (see modules/scrapers/scripts/scrapers/BaseScraper.js),
 * loads a trivial page, and confirms the render pipeline works end to end.
 *
 * Why this exists: the worker image ships Chromium for the browser scrapers,
 * but a bad Chromium (a version that crashes on our nodes, a missing lib, a
 * broken sandbox) fails ONLY the browser jobs — every non-browser job keeps
 * working, so the image looks healthy and the breakage is only discovered when
 * a scraper silently stops returning events in production. This gives us a
 * cheap, explicit check to run right after a worker deploy (or as a canary):
 *
 *     kubectl -n <ns> exec deploy/<brand>-worker -- node scripts/workers/browser-selftest.js
 *
 * Exit code 0 = browser launches and renders. Exit code 1 = it does not.
 * It is intentionally NOT wired into the k8s liveness probe: a browser fault
 * must not restart-loop a worker that is happily processing newsletters,
 * broadcasts, AI-sync and every other non-browser job.
 */

import puppeteer from 'puppeteer-core';

const TIMEOUT_MS = 60000;

// Mirror BaseScraper's launch args. --single-process / --no-zygote are
// deliberately absent (they crash containerised Chromium non-deterministically:
// "Cannot use V8 Proxy resolver in single process mode").
const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-web-security',
  '--disable-features=VizDisplayCompositor',
  '--disable-blink-features=AutomationControlled',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-crash-reporter',
  '--disable-breakpad',
];

async function main() {
  const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: LAUNCH_ARGS,
      timeout: TIMEOUT_MS,
    });

    const version = await browser.version();
    const page = await browser.newPage();
    // Navigate to about:blank then run JS in the renderer — this is the exact
    // launch -> newPage -> goto -> evaluate path the scrapers depend on, with no
    // network egress (which can be slow/blocked on a node). NOTE: use goto +
    // evaluate, NOT setContent + $eval — in a headless container the execution
    // context from setContent can leave $eval hanging indefinitely, whereas a
    // goto reliably establishes the context the scrapers use.
    await page.goto('about:blank', { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
    const result = await page.evaluate(() => 6 * 7);
    await page.close();

    if (result !== 42) {
      throw new Error(`unexpected evaluate result: ${JSON.stringify(result)}`);
    }

    console.log(`BROWSER_SELFTEST_OK executable=${executablePath} version=${version}`);
    await browser.close();
    process.exit(0);
  } catch (err) {
    console.error(`BROWSER_SELFTEST_FAIL executable=${executablePath}`);
    console.error(err && err.stack ? err.stack : String(err));
    if (browser) {
      try { await browser.close(); } catch {}
    }
    process.exit(1);
  }
}

// Hard timeout so the process can never hang a CI step or an exec.
setTimeout(() => {
  console.error(`BROWSER_SELFTEST_FAIL timed out after ${TIMEOUT_MS}ms`);
  process.exit(1);
}, TIMEOUT_MS + 5000).unref();

main();
