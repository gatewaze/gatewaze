import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { SlackSessionManager } from '../lib/slack-session-manager.js';

// Use stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * SlackInvitationManager - Automates Slack workspace invitations
 * Reuses authenticated sessions to invite users without needing to re-login
 */
export class SlackInvitationManager {
  constructor(config = {}) {
    this.workspaceUrl = config.workspaceUrl || process.env.SLACK_WORKSPACE_URL;
    this.adminEmail = config.adminEmail || process.env.SLACK_ADMIN_EMAIL;
    this.adminPassword = config.adminPassword || process.env.SLACK_ADMIN_PASSWORD;
    this.headless = config.headless !== undefined ? config.headless : true;
    this.sessionManager = new SlackSessionManager(this.workspaceUrl, config.sessionFilePath);

    this.browser = null;
    this.page = null;
    this.isAuthenticated = false;
  }

  /**
   * Helper to wait for a specified time
   * @param {number} ms - Milliseconds to wait
   */
  async wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Initialize browser and page
   */
  async initialize() {
    console.log(`🚀 Initializing Slack Invitation Manager...`);
    console.log(`🏢 Workspace: ${this.workspaceUrl}`);

    const browserOptions = {
      headless: this.headless,
      defaultViewport: { width: 1440, height: 900 },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1440,900',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--single-process',
        '--disable-crash-reporter',
        '--disable-breakpad',
        '--no-zygote'
      ],
      ignoreHTTPSErrors: true,
      timeout: 120000
    };

    // Use PUPPETEER_EXECUTABLE_PATH if set (Docker)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      console.log(`Using Chrome at: ${process.env.PUPPETEER_EXECUTABLE_PATH}`);
      browserOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    } else if (process.platform === 'darwin') {
      // On macOS, use system Chrome if available
      const macOSChromePaths = [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
      ];

      for (const chromePath of macOSChromePaths) {
        if (fs.existsSync(chromePath)) {
          console.log(`Using Chrome at: ${chromePath}`);
          browserOptions.executablePath = chromePath;
          break;
        }
      }
    }

    try {
      this.browser = await puppeteer.launch(browserOptions);
      console.log(`✅ Browser launched successfully`);

      this.page = await this.browser.newPage();
      console.log(`✅ New page created`);
    } catch (launchError) {
      console.error(`❌ Browser initialization failed: ${launchError.message}`);
      if (this.browser) {
        await this.browser.close().catch(() => {});
      }
      throw launchError;
    }

    // Set a more recent user agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    // Hide automation indicators
    await this.page.evaluateOnNewDocument(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });

      // Override the plugins to make it look real
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Override languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Chrome runtime
      window.chrome = {
        runtime: {},
      };

      // Permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });

    console.log(`✅ Slack Invitation Manager initialized`);
  }

  /**
   * Ensure we're authenticated (try session first, then login)
   */
  async ensureAuthenticated() {
    if (this.isAuthenticated) {
      console.log(`✅ Already authenticated`);
      return true;
    }

    // Try to use saved session first
    const sessionApplied = await this.sessionManager.applyCookiesToPage(this.page);

    if (sessionApplied) {
      // Validate the session works
      const isValid = await this.sessionManager.validateSession(this.page);

      if (isValid) {
        this.isAuthenticated = true;
        console.log(`✅ Using saved session - already authenticated`);
        return true;
      } else {
        console.log(`⚠️  Saved session invalid, clearing and logging in...`);
        this.sessionManager.clearSession();
      }
    }

    // If no valid session, perform login
    return await this.login();
  }

  /**
   * Login to Slack workspace
   */
  async login() {
    console.log(`🔐 Logging into Slack workspace...`);

    try {
      // Navigate to signin page
      const signinUrl = `${this.workspaceUrl}/signin`;
      console.log(`📍 Navigating to: ${signinUrl}`);
      await this.page.goto(signinUrl, { waitUntil: 'networkidle2', timeout: 30000 });

      // Step 1: Enter email
      await this.page.waitForSelector('input[type="email"], input[name="email"]', { timeout: 10000 });
      console.log(`📧 Entering email: ${this.adminEmail}`);
      await this.page.type('input[type="email"], input[name="email"]', this.adminEmail, { delay: 100 });

      // Check for reCAPTCHA and handle it
      console.log(`🤖 Checking for reCAPTCHA...`);
      await this.wait(1000);

      // Look for reCAPTCHA iframe
      const recaptchaFrame = await this.page.frames().find(frame =>
        frame.url().includes('google.com/recaptcha')
      );

      if (recaptchaFrame) {
        console.log(`✅ Found reCAPTCHA, attempting to solve...`);
        try {
          // Click the reCAPTCHA checkbox
          const checkbox = await recaptchaFrame.$('.recaptcha-checkbox-border');
          if (checkbox) {
            await checkbox.click();
            console.log(`✅ Clicked reCAPTCHA checkbox`);
            await this.wait(3000); // Wait for validation
          }
        } catch (e) {
          console.log(`⚠️  Could not interact with reCAPTCHA: ${e.message}`);
        }
      }

      // Press Enter to submit email
      console.log(`🖱️  Submitting email (pressing Enter)`);
      await Promise.all([
        this.page.keyboard.press('Enter'),
        this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {
          // Navigation might not happen if there's an error, continue anyway
        })
      ]);

      // Wait a bit for the page to settle
      await this.wait(2000);

      // Step 2: Enter password
      console.log(`🔑 Looking for password field...`);

      // Check if we're on the password page or if password field appeared
      const passwordVisible = await this.page.$('input[type="password"], input[name="password"]');

      if (!passwordVisible) {
        // Take a screenshot to debug
        await this.takeScreenshot('no-password-field');
        throw new Error('Password field not found after submitting email');
      }

      console.log(`🔑 Entering password`);
      await this.page.type('input[type="password"], input[name="password"]', this.adminPassword, { delay: 100 });

      // Click sign in button
      console.log(`🖱️  Clicking sign in button`);
      await this.page.click('button[type="submit"], button[data-qa="signin_submit_button"]');

      // Wait for navigation
      await this.page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 });

      // Verify we're logged in
      await this.wait(3000);
      const currentUrl = this.page.url();
      console.log(`📍 Current URL after login: ${currentUrl}`);

      if (currentUrl.includes('/signin') || currentUrl.includes('/get-started')) {
        throw new Error('Login failed - still on signin page');
      }

      // Save session for future use
      await this.sessionManager.saveCookiesFromPage(this.page);

      this.isAuthenticated = true;
      console.log(`✅ Successfully logged in and saved session`);
      return true;

    } catch (error) {
      console.error(`❌ Login failed: ${error.message}`);
      await this.takeScreenshot('login-failed');
      throw error;
    }
  }

  /**
   * Invite a user to the Slack workspace
   * @param {string} email - Email address to invite
   * @returns {Object} Result object with success status and message
   */
  async inviteUser(email) {
    console.log(`\n📨 Inviting user: ${email}`);

    try {
      // Ensure we're authenticated
      await this.ensureAuthenticated();

      // Navigate to Slack app (not admin page) - works for regular members
      // Extract team ID from workspace URL if needed, or use direct client URL
      const teamId = 'TXXXXXXXXX'; // Your Slack workspace team ID
      const appUrl = `https://app.slack.com/client/${teamId}`;
      console.log(`📍 Navigating to Slack app: ${appUrl}`);

      try {
        await this.page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (navError) {
        console.log(`⚠️  Navigation timeout/error, checking if page loaded anyway...`);
        // Sometimes the page loads but doesn't finish all network requests
      }

      // Wait for Slack app to fully load - it's a heavy SPA
      console.log(`⏳ Waiting for Slack app to fully load...`);
      await this.wait(5000);

      // Try to wait for a Slack-specific element to confirm the app is ready
      try {
        await this.page.waitForSelector('[data-qa="workspace_actions_button"], button.p-ia4_home_header_menu__button, [data-qa="channel_sidebar"]', {
          timeout: 15000
        });
        console.log(`✅ Slack app loaded - found UI element`);
      } catch (e) {
        console.log(`⚠️  Could not find Slack UI element, continuing anyway...`);
      }

      // Additional wait for any animations/rendering
      await this.wait(2000);

      // Click on the workspace dropdown menu with retry logic
      console.log(`🔍 Looking for workspace actions button...`);
      const workspaceMenuSelectors = [
        'button[data-qa="workspace_actions_button"]',
        'button.p-ia4_home_header_menu__button',
        'button[aria-label*="actions"]',
        'button[aria-haspopup="menu"]'
      ];

      let menuOpened = false;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries && !menuOpened; attempt++) {
        console.log(`🔄 Attempt ${attempt}/${maxRetries} to find workspace menu button...`);

        for (const selector of workspaceMenuSelectors) {
          try {
            const button = await this.page.$(selector);
            if (button) {
              const isVisible = await button.evaluate(el => el.offsetParent !== null);
              if (isVisible) {
                console.log(`✅ Found workspace menu button: ${selector}`);
                await button.click();
                menuOpened = true;
                await this.wait(1500); // Wait for menu animation
                break;
              }
            }
          } catch (e) {
            // Try next selector
          }
        }

        if (!menuOpened) {
          // Try text-based search as fallback
          console.log(`⚠️  Trying text-based button search...`);
          const clicked = await this.page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const menuButton = buttons.find(btn => {
              const isVisible = btn.offsetParent !== null;
              const hasMenuIndicator = btn.className.includes('workspace') ||
                btn.className.includes('header_menu') ||
                (btn.getAttribute('aria-label') || '').toLowerCase().includes('actions') ||
                btn.getAttribute('aria-haspopup') === 'menu';
              return isVisible && hasMenuIndicator;
            });
            if (menuButton) {
              menuButton.click();
              return true;
            }
            return false;
          });

          if (clicked) {
            menuOpened = true;
            await this.wait(1500);
          } else if (attempt < maxRetries) {
            console.log(`⏳ Waiting before retry...`);
            await this.wait(3000);
          }
        }
      }

      if (!menuOpened) {
        await this.takeScreenshot(`no-workspace-menu-${email.replace(/[^a-z0-9]/gi, '-')}`);
        throw new Error('Could not find or click workspace menu button after multiple attempts');
      }

      // Wait for menu to be visible and populated
      console.log(`⏳ Waiting for menu to appear...`);
      await this.wait(1000);

      // Click "Invite people to [workspace]" option from menu with retry
      console.log(`🔍 Looking for "Invite people" menu item...`);

      let inviteMenuItemFound = false;
      for (let attempt = 1; attempt <= 3 && !inviteMenuItemFound; attempt++) {
        inviteMenuItemFound = await this.page.evaluate(() => {
          // Look for menu items in various places Slack might render them
          const menuItems = Array.from(document.querySelectorAll(
            '[role="menuitem"], [role="option"], .c-menu_item__button, .c-menu__item, button'
          ));
          const inviteItem = menuItems.find(item => {
            const text = item.textContent.toLowerCase();
            return text.includes('invite people') || text.includes('invite to');
          });
          if (inviteItem) {
            inviteItem.click();
            return true;
          }
          return false;
        });

        if (!inviteMenuItemFound && attempt < 3) {
          console.log(`⏳ Menu item not found, waiting and retrying...`);
          await this.wait(1000);
        }
      }

      if (!inviteMenuItemFound) {
        await this.takeScreenshot(`no-invite-menu-item-${email.replace(/[^a-z0-9]/gi, '-')}`);
        throw new Error('Could not find "Invite people" menu item');
      }

      console.log(`✅ Clicked "Invite people" menu item`);
      await this.wait(4000); // Wait for modal to appear

      // Look for email input field inside the modal/form (not the search box)
      // Wait for the modal to be fully loaded
      console.log(`⏳ Waiting for invitation modal to load...`);
      await this.wait(5000); // Increased wait time for modal to fully render

      // Take screenshot to debug
      await this.takeScreenshot(`after-clicking-invite-button-${email.replace(/[^a-z0-9]/gi, '-')}`);

      console.log(`🔍 Looking for email input field in invitation form...`);

      // Try to find the email input using JavaScript to be more precise
      // Slack uses contenteditable divs instead of input fields
      const emailInputInfo = await this.page.evaluate(() => {
        // Find all possible email inputs: traditional inputs, textareas, and contenteditable divs
        const emailInputs = Array.from(document.querySelectorAll('input[type="email"]'));
        const textareas = Array.from(document.querySelectorAll('textarea'));
        const contentEditables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        const allInputs = [...emailInputs, ...textareas, ...contentEditables];

        console.log('Found inputs:', allInputs.length, 'breakdown:', {
          email: emailInputs.length,
          textarea: textareas.length,
          contenteditable: contentEditables.length
        });

        // Log info about each input
        const inputInfo = allInputs.map((input, idx) => ({
          index: idx,
          tag: input.tagName,
          type: input.type || 'contenteditable',
          name: input.name,
          placeholder: input.getAttribute('aria-placeholder') || input.placeholder,
          ariaLabel: input.getAttribute('aria-label'),
          visible: input.offsetParent !== null,
          hasParentForm: !!input.closest('form'),
          hasParentDialog: !!input.closest('[role="dialog"]'),
          hasParentModal: !!input.closest('.modal, [class*="modal"]'),
          className: input.className,
          contenteditable: input.getAttribute('contenteditable')
        }));

        // Try to find the right input
        // Priority 1: contenteditable div with email-related aria-label or placeholder
        for (let i = 0; i < allInputs.length; i++) {
          const input = allInputs[i];
          const isVisible = input.offsetParent !== null;
          const ariaLabel = input.getAttribute('aria-label') || '';
          const ariaPlaceholder = input.getAttribute('aria-placeholder') || '';
          const isEmailField = ariaLabel.toLowerCase().includes('email') ||
                               ariaLabel.toLowerCase().includes('invite') ||
                               ariaPlaceholder.toLowerCase().includes('email') ||
                               ariaPlaceholder.toLowerCase().includes('example.com');

          if (isVisible && input.getAttribute('contenteditable') === 'true' && isEmailField) {
            input.setAttribute('data-invite-email-field', 'true');
            return { found: true, inputInfo, selectedIndex: i, type: 'contenteditable' };
          }
        }

        // Priority 2: any visible contenteditable
        for (let i = 0; i < allInputs.length; i++) {
          const input = allInputs[i];
          if (input.offsetParent !== null && input.getAttribute('contenteditable') === 'true') {
            input.setAttribute('data-invite-email-field', 'true');
            return { found: true, inputInfo, selectedIndex: i, type: 'contenteditable' };
          }
        }

        // Priority 3: traditional inputs (fallback)
        for (let i = 0; i < allInputs.length; i++) {
          const input = allInputs[i];
          const isVisible = input.offsetParent !== null;
          const isSearchBox = input.placeholder?.toLowerCase().includes('search') ||
                             input.placeholder?.toLowerCase().includes('filter');

          if (isVisible && !isSearchBox) {
            input.setAttribute('data-invite-email-field', 'true');
            return { found: true, inputInfo, selectedIndex: i, type: 'input' };
          }
        }

        return { found: false, inputInfo, selectedIndex: -1, type: null };
      });

      console.log(`📊 Found ${emailInputInfo.inputInfo.length} inputs:`, JSON.stringify(emailInputInfo.inputInfo, null, 2));
      console.log(`✅ Selected input index: ${emailInputInfo.selectedIndex}`);

      if (!emailInputInfo.found) {
        await this.takeScreenshot(`no-email-field-${email.replace(/[^a-z0-9]/gi, '-')}`);
        throw new Error('Could not find email input field in invitation form');
      }

      // Now interact with the marked input
      const emailInput = '[data-invite-email-field="true"]';
      await this.page.waitForSelector(emailInput, { timeout: 3000 });
      console.log(`✅ Found email input field in invitation form (type: ${emailInputInfo.type})`);

      // Handle contenteditable divs differently than regular inputs
      if (emailInputInfo.type === 'contenteditable') {
        console.log(`📧 Typing email into contenteditable div using page.type(): ${email}`);

        // Click to focus first
        await this.page.click(emailInput);
        await this.wait(200);

        // Clear the field completely using keyboard
        await this.page.keyboard.down('Control');
        await this.page.keyboard.press('a');
        await this.page.keyboard.up('Control');
        await this.page.keyboard.press('Backspace');
        await this.wait(200);

        // Type the email address
        await this.page.type(emailInput, email, { delay: 50 });

        // Wait for Slack's validation
        await this.wait(1000);

        // Verify the text was inserted
        const actualText = await this.page.evaluate((selector) => {
          const element = document.querySelector(selector);
          return element ? element.textContent.trim() : '';
        }, emailInput);

        console.log(`✅ Typed email, field now contains: "${actualText}"`);

        if (!actualText || !actualText.includes(email.split('@')[0])) {
          console.log(`⚠️  Email not properly inserted. Expected part of: "${email}", Got: "${actualText}"`);
          await this.takeScreenshot(`email-not-inserted-${email.replace(/[^a-z0-9]/gi, '-')}`);
        }

        // Press Tab to trigger validation and convert email to chip
        console.log(`↹ Pressing Tab to trigger email validation and chip creation`);
        await this.page.keyboard.press('Tab');

        // Wait longer for chip to be created
        await this.wait(2000);

        // Wait for Slack to process and create the email chip
        await this.wait(3000);

        // Verify that an email chip/token was created
        const chipCreated = await this.page.evaluate(() => {
          // Look for chip/token elements that Slack creates - try multiple selectors
          const chipSelectors = [
            '[data-qa="invite_chip"]',
            '.c-multi_select_chip',
            '[role="button"][class*="chip"]',
            '.c-button-unstyled[role="button"]',
            '[class*="multi_select"][class*="button"]',
            'button[class*="token"]',
            'span[class*="token"]',
            'div[role="button"][class*="multi"]'
          ];

          let chips = [];
          for (const selector of chipSelectors) {
            const found = document.querySelectorAll(selector);
            if (found.length > 0) {
              chips = found;
              break;
            }
          }

          const chipText = Array.from(chips).map(chip => chip.textContent.trim());

          // Also check if the contenteditable div is now empty (email moved to chip)
          const emailInput = document.querySelector('[data-invite-email-field="true"]');
          const inputText = emailInput ? emailInput.textContent.trim() : '';

          // Look at the parent container to see all child elements
          const parentContainer = emailInput ? emailInput.parentElement : null;
          const siblings = parentContainer ? Array.from(parentContainer.children).map(el => ({
            tag: el.tagName,
            className: el.className,
            role: el.getAttribute('role'),
            text: el.textContent.trim().substring(0, 50)
          })) : [];

          return {
            chipsFound: chips.length,
            chipTexts: chipText,
            inputNowEmpty: inputText === '' || inputText === 'name@example.com',
            inputText: inputText,
            siblings: siblings
          };
        });

        console.log(`🔍 Email chip status:`, JSON.stringify(chipCreated, null, 2));

        if (chipCreated.chipsFound === 0) {
          console.log(`⚠️  No email chip created - the email may not have been accepted`);
          await this.takeScreenshot(`no-chip-created-${email.replace(/[^a-z0-9]/gi, '-')}`);

          // If chip wasn't created, throw an error so we can debug
          throw new Error(`Email chip was not created after pressing Space. Email may be invalid or UI changed.`);
        } else {
          console.log(`✅ Email chip created successfully (${chipCreated.chipsFound} chip(s)): ${chipCreated.chipTexts.join(', ')}`);
        }
      } else {
        // Traditional input/textarea
        await this.page.click(emailInput, { clickCount: 3 }); // Select all
        await this.page.keyboard.press('Backspace');
        console.log(`📧 Entering email: ${email}`);
        await this.page.type(emailInput, email, { delay: 100 });
      }

      // Look for submit/send button
      const submitSelectors = [
        'button[type="submit"]',
        'button:has-text("Send")',
        'button:has-text("Invite")',
        'button:has-text("Send Invitations")',
        'button:has-text("Send invitations")',
        'button[data-qa="invite_submit_button"]',
        'button[data-qa="send_invites_button"]',
        'button.c-button--primary',
        'button[class*="primary"]'
      ];

      let submitButton = null;
      for (const selector of submitSelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            submitButton = selector;
            console.log(`✅ Found submit button: ${selector}`);
            break;
          }
        } catch (e) {
          // Try next selector
        }
      }

      // Try finding by text content as fallback
      if (!submitButton) {
        try {
          console.log(`🔍 Trying to find submit button by text content...`);
          const buttonExists = await this.page.evaluate(() => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const submitBtn = buttons.find(btn =>
              btn.textContent.toLowerCase().includes('send') ||
              btn.textContent.toLowerCase().includes('invite')
            );
            return !!submitBtn;
          });

          if (buttonExists) {
            submitButton = 'text-based-selector';
            console.log(`✅ Found submit button via text search`);
          }
        } catch (e) {
          console.log(`⚠️  Text search failed: ${e.message}`);
        }
      }

      if (!submitButton) {
        throw new Error('Could not find submit button on invite page');
      }

      // Wait for the submit button to become enabled
      // Slack disables the button until validation passes
      console.log(`⏳ Waiting for submit button to become enabled...`);
      try {
        await this.page.waitForFunction(
          () => {
            const buttons = Array.from(document.querySelectorAll('button'));
            const sendBtn = buttons.find(btn =>
              (btn.textContent.toLowerCase().includes('send') ||
               btn.textContent.toLowerCase().includes('invite')) &&
              btn.getAttribute('aria-label')?.toLowerCase().includes('send')
            );
            return sendBtn && sendBtn.getAttribute('aria-disabled') !== 'true' &&
                   !sendBtn.classList.contains('c-button--disabled');
          },
          { timeout: 5000 }
        );
        console.log(`✅ Submit button is now enabled`);
      } catch (e) {
        console.log(`⚠️  Button didn't become enabled, attempting anyway: ${e.message}`);
      }

      // Take screenshot before submitting
      await this.takeScreenshot(`before-invite-${email.replace(/[^a-z0-9]/gi, '-')}`);

      // Find the exact Send button - it might be outside the modal in a footer/actions area
      console.log(`🔍 Finding the exact Send button...`);
      const sendButtonInfo = await this.page.evaluate(() => {
        // Search ALL primary Send buttons on the page (they should be rare)
        const allButtons = Array.from(document.querySelectorAll('button'));
        const buttons = allButtons.filter(btn => btn.offsetParent !== null); // Only visible buttons

        // Log all visible buttons for debugging (limit to first 20 to avoid clutter)
        const buttonDetails = buttons.slice(0, 20).map(btn => ({
          text: btn.textContent.trim().substring(0, 50),
          ariaLabel: btn.getAttribute('aria-label'),
          classes: btn.className.substring(0, 80),
          disabled: btn.getAttribute('aria-disabled') === 'true' || btn.disabled,
          isPrimary: btn.classList.contains('c-button--primary')
        }));
        console.log('Visible buttons on page:', JSON.stringify(buttonDetails, null, 2));

        // Look for primary "Send" button in modal (not "Resend")
        const sendBtn = buttons.find(btn => {
          const text = btn.textContent.toLowerCase().trim();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          const isPrimary = btn.classList.contains('c-button--primary');

          // Must be primary button with text "send" (but not "resend")
          return isPrimary &&
                 (text === 'send' || ariaLabel === 'send') &&
                 !text.includes('resend') && !ariaLabel.includes('resend');
        });

        if (sendBtn) {
          // Mark it for Puppeteer to find
          sendBtn.setAttribute('data-slack-send-button', 'true');

          return {
            found: true,
            text: sendBtn.textContent.trim(),
            ariaLabel: sendBtn.getAttribute('aria-label'),
            disabled: sendBtn.getAttribute('aria-disabled') === 'true' ||
                     sendBtn.disabled ||
                     sendBtn.classList.contains('c-button--disabled'),
            classes: sendBtn.className
          };
        }

        // Fallback: any primary button with "send" in text/aria-label
        const sendBtnFallback = buttons.find(btn => {
          const text = btn.textContent.toLowerCase();
          const ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
          const isPrimary = btn.classList.contains('c-button--primary');

          return isPrimary && (text.includes('send') || ariaLabel.includes('send'));
        });

        if (sendBtnFallback) {
          sendBtnFallback.setAttribute('data-slack-send-button', 'true');

          return {
            found: true,
            text: sendBtnFallback.textContent.trim(),
            ariaLabel: sendBtnFallback.getAttribute('aria-label'),
            disabled: sendBtnFallback.getAttribute('aria-disabled') === 'true' ||
                     sendBtnFallback.disabled ||
                     sendBtnFallback.classList.contains('c-button--disabled'),
            classes: sendBtnFallback.className
          };
        }

        return { found: false, error: 'Send button not found in modal', buttonsFound: buttons.length, buttonDetails };
      });

      console.log(`📊 Send button info:`, JSON.stringify(sendButtonInfo, null, 2));

      if (!sendButtonInfo.found) {
        throw new Error('Could not find Send button');
      }

      if (sendButtonInfo.disabled) {
        console.log(`⚠️  Warning: Send button appears to be disabled`);
      }

      // Try Puppeteer's native click first (more reliable)
      console.log(`🖱️  Clicking submit button using Puppeteer click`);
      try {
        const buttonElement = await this.page.$('[data-slack-send-button="true"]');
        if (buttonElement) {
          await buttonElement.click();
          console.log(`✅ Puppeteer click executed`);
        } else {
          throw new Error('Button element not found');
        }
      } catch (clickError) {
        console.log(`⚠️  Puppeteer click failed: ${clickError.message}`);
        console.log(`🔄 Trying JavaScript click as fallback...`);

        // Fallback to JavaScript click
        await this.page.evaluate(() => {
          const btn = document.querySelector('[data-slack-send-button="true"]');
          if (btn) {
            btn.click();
          }
        });
        console.log(`✅ JavaScript click executed`);
      }

      // Wait for Slack to process the invitation
      // Slack shows a confirmation modal with "You've invited X person(s)"
      console.log(`⏳ Waiting for invitation confirmation...`);

      // Wait for either success confirmation or error message
      try {
        await Promise.race([
          // Wait for success confirmation message
          this.page.waitForFunction(
            () => {
              const content = document.body.textContent || '';
              return content.includes("You've invited") ||
                     content.includes("Expires in");
            },
            { timeout: 10000 }
          ),
          // Or wait for error message
          this.page.waitForFunction(
            () => {
              const content = document.body.textContent || '';
              return content.includes('already been invited') ||
                     content.includes('already a member') ||
                     content.includes('invalid email') ||
                     content.includes('not a valid') ||
                     content.includes('error') ||
                     content.includes('couldn\'t invite');
            },
            { timeout: 10000 }
          )
        ]);

        console.log(`✅ Invitation response received`);
      } catch (e) {
        console.log(`⚠️  Timeout waiting for response: ${e.message}`);
      }

      // Give it a moment to fully render
      await this.wait(1500);

      // Check for success/error messages
      const pageContent = await this.page.content();
      const pageText = await this.page.evaluate(() => document.body.textContent || '');

      // Take screenshot for debugging
      await this.takeScreenshot(`after-invite-${email.replace(/[^a-z0-9]/gi, '-')}`);

      // Determine the result based on page content
      let result;

      // Check for Slack's success confirmation message first
      if (pageText.includes("You've invited") || pageText.includes("Expires in")) {
        console.log(`✅ Invitation sent successfully - confirmation message detected`);

        // Extract details from the confirmation if possible
        const inviteMatch = pageText.match(/You've invited (\d+) person/);
        const expiresMatch = pageText.match(/Expires in (\d+) day/);

        result = {
          success: true,
          message: 'Invitation sent successfully',
          details: {
            peopleInvited: inviteMatch ? parseInt(inviteMatch[1]) : 1,
            expiresInDays: expiresMatch ? parseInt(expiresMatch[1]) : null
          }
        };
      }
      // Check for common error messages
      else if (
        pageText.includes('already been invited') ||
        pageText.includes('already a member') ||
        pageText.includes('is already in')
      ) {
        console.log(`⚠️  User already invited or is a member`);
        await this.takeScreenshot(`after-invite-already-member-${email.replace(/[^a-z0-9]/gi, '-')}`);
        result = {
          success: false,
          alreadyInvited: true,
          message: 'User already invited or is a member'
        };
      }
      else if (
        pageText.includes('invalid email') ||
        pageText.includes('not a valid') ||
        pageText.includes('couldn\'t invite')
      ) {
        console.log(`❌ Invalid email address or invitation failed`);
        await this.takeScreenshot(`after-invite-invalid-${email.replace(/[^a-z0-9]/gi, '-')}`);
        result = {
          success: false,
          message: 'Invalid email address or invitation failed'
        };
      }
      // Check for other success indicators
      else if (
        pageText.includes('invitation sent') ||
        pageText.includes('invite sent') ||
        pageText.includes('successfully invited')
      ) {
        console.log(`✅ Invitation sent successfully (generic success message)`);
        result = {
          success: true,
          message: 'Invitation sent successfully'
        };
      }
      else {
        // If we get here, status is unclear - log what we see for debugging
        console.log(`⚠️  Unclear invitation status`);
        console.log(`📋 Page text excerpt: ${pageText.substring(0, 300)}...`);

        result = {
          success: false,
          message: 'Invitation status unclear - no confirmation message found'
        };
      }

      // Reset page state before returning to ensure clean state for next invitation
      await this.resetPageState();
      return result;

    } catch (error) {
      console.error(`❌ Failed to invite user: ${error.message}`);
      await this.takeScreenshot(`error-invite-${email.replace(/[^a-z0-9]/gi, '-')}`);

      // Reset page state before returning to ensure clean state for next invitation
      await this.resetPageState();

      return {
        success: false,
        message: error.message
      };
    }
  }

  /**
   * Invite multiple users (batch processing)
   * @param {Array<string>} emails - Array of email addresses
   * @param {number} delayMs - Delay between invitations (default 2000ms)
   * @returns {Array<Object>} Array of results
   */
  async inviteUsers(emails, delayMs = 2000) {
    console.log(`\n📨 Inviting ${emails.length} users...`);

    const results = [];

    for (const email of emails) {
      const result = await this.inviteUser(email);
      results.push({ email, ...result });

      // Delay between invitations to avoid rate limiting
      if (emails.indexOf(email) < emails.length - 1) {
        console.log(`⏱️  Waiting ${delayMs}ms before next invitation...`);
        await this.wait(delayMs);
      }
    }

    return results;
  }

  /**
   * Take a screenshot for debugging
   * @param {string} name - Screenshot name
   */
  async takeScreenshot(name) {
    try {
      const screenshotDir = path.join(__dirname, '../data/screenshots');
      if (!fs.existsSync(screenshotDir)) {
        fs.mkdirSync(screenshotDir, { recursive: true });
      }

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${name}-${timestamp}.png`;
      const filepath = path.join(screenshotDir, filename);

      await this.page.screenshot({ path: filepath, fullPage: true });
      console.log(`📸 Screenshot saved: ${filepath}`);
    } catch (error) {
      console.error(`⚠️  Failed to take screenshot: ${error.message}`);
    }
  }

/**
   * Reset page state after an invitation to ensure clean state for next one
   * Closes any open modals and navigates to a blank page
   */
  async resetPageState() {
    try {
      console.log(`🔄 Resetting page state for next invitation...`);

      // Press Escape multiple times to close any open modals/dialogs
      await this.page.keyboard.press('Escape');
      await this.wait(500);
      await this.page.keyboard.press('Escape');
      await this.wait(500);

      // Navigate to about:blank to fully reset the page state
      // This ensures the next navigation to Slack will be a fresh load
      await this.page.goto('about:blank', { timeout: 5000 });
      await this.wait(500);

      console.log(`✅ Page state reset complete`);
    } catch (error) {
      console.log(`⚠️  Error resetting page state: ${error.message}`);
      // Non-fatal - continue anyway
    }
  }

  /**
   * Cleanup browser resources
   */
  async cleanup() {
    console.log(`🧹 Cleaning up...`);

    if (this.page) {
      await this.page.close();
      this.page = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    this.isAuthenticated = false;
    console.log(`✅ Cleanup complete`);
  }

  /**
   * Get session info
   */
  getSessionInfo() {
    return this.sessionManager.getSessionInfo();
  }
}
