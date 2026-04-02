import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * SlackSessionManager - Manages persistent authentication sessions for Slack
 * Saves and loads cookies to maintain logged-in state across invitations
 */
export class SlackSessionManager {
  constructor(workspaceUrl, sessionFilePath = null) {
    this.workspaceUrl = workspaceUrl;
    this.sessionFilePath = sessionFilePath || path.join(__dirname, '../data/slack-session.json');
    this.sessionData = null;
  }

  /**
   * Ensure the data directory exists
   */
  ensureDataDirectory() {
    const dataDir = path.dirname(this.sessionFilePath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
      console.log(`📁 Created data directory: ${dataDir}`);
    }
  }

  /**
   * Save session cookies to disk
   * @param {Array} cookies - Array of cookie objects from Puppeteer
   */
  async saveSession(cookies) {
    try {
      this.ensureDataDirectory();

      const sessionData = {
        workspaceUrl: this.workspaceUrl,
        cookies: cookies,
        savedAt: new Date().toISOString(),
        expiresAt: this.calculateExpiry(cookies)
      };

      fs.writeFileSync(
        this.sessionFilePath,
        JSON.stringify(sessionData, null, 2),
        'utf-8'
      );

      this.sessionData = sessionData;
      console.log(`✅ Slack session saved to ${this.sessionFilePath}`);
      console.log(`📅 Session expires at: ${sessionData.expiresAt}`);

      return true;
    } catch (error) {
      console.error(`❌ Failed to save session: ${error.message}`);
      return false;
    }
  }

  /**
   * Load session cookies from disk
   * @returns {Object|null} Session data or null if not found/invalid
   */
  loadSession() {
    try {
      if (!fs.existsSync(this.sessionFilePath)) {
        console.log(`⚠️  No saved session found at ${this.sessionFilePath}`);
        return null;
      }

      const fileContent = fs.readFileSync(this.sessionFilePath, 'utf-8');
      this.sessionData = JSON.parse(fileContent);

      // Validate workspace URL matches
      if (this.sessionData.workspaceUrl !== this.workspaceUrl) {
        console.log(`⚠️  Session workspace mismatch. Expected: ${this.workspaceUrl}, Found: ${this.sessionData.workspaceUrl}`);
        return null;
      }

      // Check if session is expired
      if (this.isSessionExpired()) {
        console.log(`⚠️  Session expired at ${this.sessionData.expiresAt}`);
        return null;
      }

      console.log(`✅ Loaded valid session from ${this.sessionFilePath}`);
      console.log(`📅 Session saved at: ${this.sessionData.savedAt}`);
      console.log(`📅 Session expires at: ${this.sessionData.expiresAt}`);

      return this.sessionData;
    } catch (error) {
      console.error(`❌ Failed to load session: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if the current session is expired
   * @returns {boolean}
   */
  isSessionExpired() {
    if (!this.sessionData || !this.sessionData.expiresAt) {
      return true;
    }

    const expiryDate = new Date(this.sessionData.expiresAt);
    const now = new Date();

    return now >= expiryDate;
  }

  /**
   * Calculate expiry date based on cookies
   * Looks for the main authentication cookie ('d' or 'b'), ignoring short-lived tokens
   * @param {Array} cookies
   * @returns {string} ISO date string
   */
  calculateExpiry(cookies) {
    // Look for main auth cookies (d = session token, b = browser ID)
    // Ignore short-lived cookies like 'x' which expire in minutes
    const authCookieNames = ['d', 'b', 'lc'];
    let latestAuthExpiry = null;

    for (const cookie of cookies) {
      // Only consider cookies that are likely auth-related
      if (authCookieNames.includes(cookie.name) && cookie.expires && cookie.expires > 0) {
        const expiryDate = new Date(cookie.expires * 1000);

        // Use the latest expiry among auth cookies (they should refresh together)
        if (!latestAuthExpiry || expiryDate > latestAuthExpiry) {
          latestAuthExpiry = expiryDate;
        }
      }
    }

    // If no auth cookies found, default to 7 days from now
    // (conservative estimate for session lifetime)
    if (!latestAuthExpiry) {
      latestAuthExpiry = new Date();
      latestAuthExpiry.setDate(latestAuthExpiry.getDate() + 7);
    }

    return latestAuthExpiry.toISOString();
  }

  /**
   * Apply saved cookies to a Puppeteer page
   * @param {Page} page - Puppeteer page instance
   * @returns {boolean} Success status
   */
  async applyCookiesToPage(page) {
    try {
      const sessionData = this.loadSession();

      if (!sessionData || !sessionData.cookies) {
        console.log(`⚠️  No valid session to apply`);
        return false;
      }

      await page.setCookie(...sessionData.cookies);
      console.log(`✅ Applied ${sessionData.cookies.length} cookies to page`);

      return true;
    } catch (error) {
      console.error(`❌ Failed to apply cookies: ${error.message}`);
      return false;
    }
  }

  /**
   * Save current page cookies
   * @param {Page} page - Puppeteer page instance
   * @returns {boolean} Success status
   */
  async saveCookiesFromPage(page) {
    try {
      const cookies = await page.cookies();
      return await this.saveSession(cookies);
    } catch (error) {
      console.error(`❌ Failed to save cookies from page: ${error.message}`);
      return false;
    }
  }

  /**
   * Clear saved session
   */
  clearSession() {
    try {
      if (fs.existsSync(this.sessionFilePath)) {
        fs.unlinkSync(this.sessionFilePath);
        console.log(`✅ Session cleared: ${this.sessionFilePath}`);
      }
      this.sessionData = null;
      return true;
    } catch (error) {
      console.error(`❌ Failed to clear session: ${error.message}`);
      return false;
    }
  }

  /**
   * Validate session by checking if we're logged in
   * @param {Page} page - Puppeteer page instance
   * @returns {boolean} True if logged in
   */
  async validateSession(page) {
    try {
      // Skip validation if running in Docker/production (trust the session)
      if (process.env.SLACK_SKIP_SESSION_VALIDATION === 'true') {
        console.log(`⏭️  Skipping session validation (SLACK_SKIP_SESSION_VALIDATION=true)`);
        return true;
      }

      console.log(`🔍 Validating Slack session...`);

      // Navigate to workspace
      await page.goto(this.workspaceUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Wait a bit for potential redirects
      const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
      await wait(2000);

      const currentUrl = page.url();
      console.log(`📍 Current URL: ${currentUrl}`);

      // If we're redirected to signin page, session is invalid
      if (currentUrl.includes('/signin') || currentUrl.includes('/get-started')) {
        console.log(`❌ Session invalid - redirected to sign-in page`);
        return false;
      }

      // Check for workspace UI elements that indicate we're logged in
      const isLoggedIn = await page.evaluate(() => {
        // Look for common Slack workspace UI elements
        const selectors = [
          '[data-qa="workspace-name"]',
          '[data-qa="channel_sidebar"]',
          '.p-workspace__sidebar',
          '.p-client_container'
        ];

        return selectors.some(selector => document.querySelector(selector) !== null);
      });

      if (isLoggedIn) {
        console.log(`✅ Session valid - logged into workspace`);
      } else {
        console.log(`❌ Session invalid - workspace UI not found`);
      }

      return isLoggedIn;
    } catch (error) {
      console.error(`❌ Failed to validate session: ${error.message}`);
      return false;
    }
  }

  /**
   * Get session info for debugging
   * @returns {Object} Session information
   */
  getSessionInfo() {
    if (!this.sessionData) {
      this.loadSession();
    }

    if (!this.sessionData) {
      return {
        exists: false,
        expired: true
      };
    }

    return {
      exists: true,
      workspaceUrl: this.sessionData.workspaceUrl,
      savedAt: this.sessionData.savedAt,
      expiresAt: this.sessionData.expiresAt,
      expired: this.isSessionExpired(),
      cookieCount: this.sessionData.cookies?.length || 0
    };
  }
}
