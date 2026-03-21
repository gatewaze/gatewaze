import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import sharp from 'sharp';
import url from 'url';
import { createClient } from '@supabase/supabase-js';
import { BrowserlessService } from './browserless-service.js';
import { uploadEventImage, updateScreenshotStatus } from './event-image-service.js';
import { supabase } from './supabase-client.js';

const SCREENSHOTS_DIR = path.join(process.cwd(), 'public', 'preview');
const RETRY_LOG_FILE = path.join(process.cwd(), 'navigation-retries.log');

// Ensure screenshots directory exists
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

// Parse command line arguments for event IDs
function parseEventIds() {
  // Check for EVENT_IDS environment variable
  if (process.env.EVENT_IDS) {
    return process.env.EVENT_IDS.split(',').map(id => id.trim());
  }
  
  // Check for command line arguments
  const eventIdsArg = process.argv.find(arg => arg.startsWith('--event-ids='));
  if (eventIdsArg) {
    const idsString = eventIdsArg.replace('--event-ids=', '');
    return idsString.split(',').map(id => id.trim());
  }
  
  return null;
}

// Common cookie consent button selectors
const COOKIE_CONSENT_SELECTORS = [
  // Cookiebot specific - check this first as it's very common
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
  // Generic cookie consent selectors
  'button[id*="accept"]', 'button[class*="accept"]', '[id*="accept-cookies"]', '[class*="accept-cookies"]',
  'button[id*="cookie"][id*="accept"]', 'button[class*="cookie"][class*="accept"]',
  'button[id*="cookie-consent"]', 'button[class*="cookie-consent"]',
  'button[id*="agree"]', 'button[class*="agree"]',
  'button[id*="allow"]', 'button[class*="allow"]',
  'button[id*="consent"]', 'button[class*="consent"]',
  'button[id*="privacy"]', 'button[class*="privacy"]',
  // Specific cookie consent button texts
  'button:has-text("Accept")', 'button:has-text("Accept All")', 'button:has-text("I Accept")', 
  'button:has-text("Allow")', 'button:has-text("Allow All")', 'button:has-text("Allow All Cookies")', 'button:has-text("OK")',
  'button:has-text("Got it")', 'button:has-text("Agree")', 'button:has-text("I Agree")',
  'button:has-text("Close")', 'button:has-text("Continue")',
  // GDPR specific
  '[aria-label="Accept cookies"]', '[aria-label="Accept all cookies"]',
  // Common cookie consent modal IDs and classes
  '[id*="cookie-banner"] button', '[class*="cookie-banner"] button',
  '[id*="cookie-modal"] button', '[class*="cookie-modal"] button',
  '[id*="cookie-notice"] button', '[class*="cookie-notice"] button',
  '[id*="gdpr"] button', '[class*="gdpr"] button',
  '[id*="CookieConsent"] button', '[class*="CookieConsent"] button'
];

// Function to detect if page is showing a Cloudflare challenge
async function isCloudflareChallenge(page) {
  try {
    // Check for common Cloudflare challenge indicators
    const cloudflareIndicators = await page.evaluate(() => {
      // Check page title
      const title = document.title.toLowerCase();
      if (title.includes('just a moment') || title.includes('checking your browser') || title.includes('please wait')) {
        return 'title';
      }
      
      // Check for Cloudflare challenge elements
      const cfSelectors = [
        '.cf-browser-verification',
        '.cf-checking-browser',
        '.cf-challenge-running',
        '#cf-stage',
        '.cf-wrapper',
        '[data-ray]', // Cloudflare Ray ID
        '.challenge-running',
        '.challenge-success'
      ];
      
      for (const selector of cfSelectors) {
        if (document.querySelector(selector)) {
          return selector;
        }
      }
      
      // Check for Cloudflare text content
      const bodyText = document.body.textContent.toLowerCase();
      if (bodyText.includes('checking your browser') || 
          bodyText.includes('cloudflare') && bodyText.includes('please wait') ||
          bodyText.includes('ddos protection') ||
          bodyText.includes('ray id')) {
        return 'text';
      }
      
      // Check for challenge scripts
      const scripts = Array.from(document.scripts);
      for (const script of scripts) {
        if (script.src && script.src.includes('challenges.cloudflare.com')) {
          return 'script';
        }
      }
      
      return false;
    });
    
    return cloudflareIndicators;
  } catch (error) {
    console.log(`  Error checking for Cloudflare challenge: ${error.message}`);
    return false;
  }
}

// Function to wait for Cloudflare challenge to complete
async function waitForCloudflareChallenge(page, maxWaitTime = 45000) {
  console.log(`  Detected Cloudflare challenge, waiting for completion...`);
  
  const startTime = Date.now();
  let lastCheck = '';
  
  while (Date.now() - startTime < maxWaitTime) {
    try {
      const challengeStatus = await isCloudflareChallenge(page);
      
      if (!challengeStatus) {
        console.log(`  Cloudflare challenge completed after ${Date.now() - startTime}ms`);
        // Wait a bit more to ensure page fully loads after challenge
        await new Promise(resolve => setTimeout(resolve, 3000));
        return true;
      }
      
      if (challengeStatus !== lastCheck) {
        console.log(`  Still waiting for Cloudflare challenge (${challengeStatus})...`);
        lastCheck = challengeStatus;
      }
      
      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (error) {
      console.log(`  Error while waiting for Cloudflare challenge: ${error.message}`);
      break;
    }
  }
  
  console.log(`  Cloudflare challenge wait timeout after ${maxWaitTime}ms`);
  return false;
}

// Enhanced stealth measures to avoid bot detection
async function setupStealthMode(page) {
  try {
    // Remove webdriver property
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });
    
    // Override plugins
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
    });
    
    // Override languages
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
    });
    
    // Override permissions
    await page.evaluateOnNewDocument(() => {
      const originalQuery = window.navigator.permissions.query;
      return window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
    });
    
    // Override chrome runtime
    await page.evaluateOnNewDocument(() => {
      window.chrome = {
        runtime: {},
      };
    });
    
    // Set realistic viewport and user agent
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Set extra headers to appear more human-like
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Sec-Ch-Ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    });
    
    console.log(`  Applied stealth mode configurations`);
  } catch (error) {
    console.log(`  Error setting up stealth mode: ${error.message}`);
  }
}

// Function to log successful retries
function logRetrySuccess(eventId, eventTitle, originalUrl, retryUrl, retryType) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp} | Event: ${eventId} (${eventTitle}) | Original URL: ${originalUrl} | Successful ${retryType} | Used: ${retryUrl}\n`;
  
  fs.appendFileSync(RETRY_LOG_FILE, logEntry, { flag: 'a' });
  console.log(`  📝 Logged successful ${retryType} to ${RETRY_LOG_FILE}`);
}

// Function to add www prefix to URL if not present
function addWwwToUrl(originalUrl) {
  try {
    const parsedUrl = new URL(originalUrl);
    
    // Only add www if it's not already there and not a subdomain
    if (!parsedUrl.hostname.startsWith('www.') && 
        parsedUrl.hostname.split('.').length === 2) {
      parsedUrl.hostname = 'www.' + parsedUrl.hostname;
      return parsedUrl.toString();
    }
  } catch (error) {
    console.log(`  Error parsing URL ${originalUrl}: ${error.message}`);
  }
  
  return null;
}

async function getEvents() {
  try {
    // Query ALL events directly from Supabase (no limit)
    console.log('Fetching events from Supabase...');

    let allEvents = [];
    let from = 0;
    const pageSize = 1000;
    let hasMore = true;

    while (hasMore) {
      const { data, error } = await supabase
        .from('events')
        .select('*')
        .order('event_start', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        console.error('Error fetching events from Supabase:', error);
        throw error;
      }

      if (!data || data.length === 0) {
        hasMore = false;
      } else {
        allEvents = allEvents.concat(data);
        from += pageSize;
        if (data.length < pageSize) {
          hasMore = false;
        }
      }
    }

    if (allEvents.length === 0) {
      console.warn('No events found in Supabase');
      return [];
    }

    console.log(`✅ Fetched ${allEvents.length} events from Supabase`);
    return allEvents;
  } catch (error) {
    console.error('Error getting events:', error);
    throw error;
  }
}

// Function to check if a file needs regeneration (doesn't exist or is older than 23 hours)
function needsRegeneration(filePath) {
  // If file doesn't exist, it needs to be generated
  if (!fs.existsSync(filePath)) {
    return true;
  }
  
  // Check file age
  const stats = fs.statSync(filePath);
  const fileAge = Date.now() - stats.mtimeMs;
  const hoursOld = fileAge / (1000 * 60 * 60); // Convert to hours
  
  // Return true if file is older than 23 hours
  return hoursOld > 23;
}

// Function to check if an event is in the past
function isEventInPast(eventEnd) {
  if (!eventEnd) return false;
  
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Set to beginning of day
  
  const endDate = new Date(eventEnd);
  endDate.setHours(0, 0, 0, 0); // Set to beginning of day
  
  return endDate < today;
}

// Function to handle cookie consent modals with site-specific handlers
async function handleCookieConsent(page, eventLink) {
  try {
    // Wait a bit for cookie consent to appear, including dynamic banners
    await new Promise(resolve => setTimeout(resolve, 1500)); // Reduced from 3000ms
    
    // For JFrog sites, wait longer and check multiple times as the consent manager loads dynamically
    const siteHostname = new URL(eventLink).hostname;
    if (siteHostname.includes('jfrog.com')) {
      console.log(`  JFrog site detected, waiting longer for consent manager to load...`);
      for (let attempt = 0; attempt < 5; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced from 2000ms
        
        const jfrogBannerPresent = await page.evaluate(() => {
          const jfrogConsent = document.getElementById('consentManagerMainDialog');
          if (jfrogConsent) {
            const style = window.getComputedStyle(jfrogConsent);
            return jfrogConsent.offsetHeight > 0 && jfrogConsent.offsetWidth > 0 && 
                   style.display !== 'none' && style.visibility !== 'hidden';
          }
          return false;
        });
        
        if (jfrogBannerPresent) {
          console.log(`  JFrog consent manager detected on attempt ${attempt + 1}`);
          break;
        }
      }
    }
    
    // First check if there's actually a cookie banner present
    const bannerPresent = await page.evaluate(() => {
      // Check for Cookiebot dialog first
      const cookiebotDialog = document.getElementById('CybotCookiebotDialog');
      if (cookiebotDialog) {
        const style = window.getComputedStyle(cookiebotDialog);
        if (cookiebotDialog.offsetHeight > 0 && cookiebotDialog.offsetWidth > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden') {
          console.log('Cookiebot dialog detected');
          return true;
        }
      }

      // Check for JFrog-specific consent dialog
      const jfrogConsent = document.getElementById('consentManagerMainDialog');
      if (jfrogConsent) {
        const style = window.getComputedStyle(jfrogConsent);
        if (jfrogConsent.offsetHeight > 0 && jfrogConsent.offsetWidth > 0 &&
            style.display !== 'none' && style.visibility !== 'hidden') {
          console.log('JFrog consent manager dialog detected');
          return true;
        }
      }

      // Check for general cookie banners
      const potentialBanners = Array.from(document.querySelectorAll('[class*="cookie"], [class*="consent"], [class*="privacy"], [id*="cookie"], [id*="consent"], [class*="gdpr"], [id*="gdpr"]'));
      const visibleBanners = potentialBanners.filter(banner => {
        const style = window.getComputedStyle(banner);
        return banner.offsetHeight > 0 && banner.offsetWidth > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
      
      if (visibleBanners.length > 0) {
        console.log(`Found ${visibleBanners.length} potential cookie banners`);
        return true;
      }
      
      return false;
    });
    
    if (!bannerPresent) {
      console.log(`  No cookie consent banner detected - stealth mode working effectively`);
      return false;
    }
    
    console.log(`  Cookie consent banner detected, attempting to handle...`);
    
    // Site-specific handlers first
    const hostname = new URL(eventLink).hostname;
    
    // DevOpsCon site handling
    if (hostname.includes('devopscon.io')) {
      try {
        console.log(`  Using site-specific cookie handler for ${hostname}`);
        
        // Try to find the Accept button in the cookie banner
        // First look for the specific elements that might contain "Accept" or similar text
        const acceptSelectors = [
          // Try common text-based buttons on devopscon.io
          'button:has-text("Accept")', 
          'button:has-text("Accept All")',
          'button:has-text("Akzeptieren")',
          'a:has-text("Accept")',
          'div[role="button"]:has-text("Accept")',
          // Try clicking the privacy banner directly
          '#CybotCookiebotDialogBodyButtonAccept',
          '#CookieBoxSaveButton',
          'button[data-testid="uc-accept-all-button"]',
          '.cc-compliance .cc-btn.cc-allow',
          '.privacy-alert .agree-button',
          // Specific to DevOpsCon's implementation
          '.cli-accept-all-btn',
          '.cookie-banner button[type="submit"]',
          '.cookieBar button',
          '.cookie-consent-button',
          'button.accept-cookies'
        ];
        
        for (const selector of acceptSelectors) {
          try {
            const button = await page.$(selector);
            if (button) {
              console.log(`  Found DevOpsCon cookie consent button with selector: ${selector}`);
              await button.click();
              await new Promise(resolve => setTimeout(resolve, 1000));
              return true;
            }
          } catch (e) {
            // Continue to the next selector
          }
        }
        
        // Try to evaluate directly on the page to find and click buttons with specific text content
        const found = await page.evaluate(() => {
          // Look for buttons or elements with text including "accept", "agree", etc.
          const textToFind = ['accept', 'agree', 'allow', 'consent', 'ok', 'got it'];
          const elements = Array.from(document.querySelectorAll('button, .button, [role="button"], a.btn'));
          
          for (const element of elements) {
            const text = element.innerText.toLowerCase();
            if (textToFind.some(t => text.includes(t))) {
              console.log(`Clicking element with text: ${element.innerText}`);
              element.click();
              return true;
            }
          }
          
          // If no specific buttons found, look for cookie-related containers and their buttons
          const cookieContainers = Array.from(document.querySelectorAll(
            '[id*="cookie"], [class*="cookie"], [id*="consent"], [class*="consent"], [id*="privacy"], [class*="privacy"]'
          ));
          
          for (const container of cookieContainers) {
            const buttons = Array.from(container.querySelectorAll('button, .button, a.btn'));
            if (buttons.length > 0) {
              console.log(`Clicking first button in cookie container`);
              buttons[0].click();
              return true;
            }
          }
          
          return false;
        });
        
        if (found) {
          console.log(`  Successfully handled DevOpsCon cookie consent with JS evaluation`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          return true;
        }
      } catch (err) {
        console.log(`  Error in site-specific handler for ${hostname}: ${err.message}`);
      }
    }
    
    // JFrog sites handling (swampUP, artifactory, etc.)
    if (hostname.includes('jfrog.com')) {
      try {
        console.log(`  Using site-specific cookie handler for ${hostname} (JFrog)`);
        
        const jfrogSelectors = [
          // JFrog-specific cookie consent selectors based on actual HTML structure
          '#consentManagerMainDialog .accept-or-reject-all-button-row button:first-child',
          '[id="consentManagerMainDialog"] button:first-child',
          '[role="region"][aria-label="cookie consent banner"] button:first-child',
          '.modal-container .accept-or-reject-all-button-row button:first-child',
          // More specific JFrog patterns
          '.accept-or-reject-all-button-row button',
          '#consentManagerMainDialog button',
          '[aria-label="cookie consent banner"] button',
          // Generic JFrog patterns
          '.modal-container button.button:first-child',
          '.cookie-banner button:first-child',
          '.consent-banner button[class*="accept"]',
          '.privacy-notice .btn-primary',
          // Backup selectors
          'button[onclick*="cookie"][onclick*="accept"]',
          'button[onclick*="consent"][onclick*="accept"]'
        ];
        
        for (const selector of jfrogSelectors) {
          try {
            const button = await page.$(selector);
            if (button) {
              console.log(`  Found JFrog cookie consent button with selector: ${selector}`);
              await button.click();
              await new Promise(resolve => setTimeout(resolve, 800)); // Reduced from 1500ms
              return true;
            }
          } catch (e) {
            // Continue to the next selector
          }
        }
        
        // JFrog-specific JavaScript evaluation approach
        const jfrogFound = await page.evaluate(() => {
          // First, look for the specific JFrog consent manager dialog
          const consentDialog = document.getElementById('consentManagerMainDialog');
          if (consentDialog && consentDialog.offsetHeight > 0 && consentDialog.offsetWidth > 0) {
            // Look for the "Accept All" button specifically
            const acceptAllButtons = Array.from(consentDialog.querySelectorAll('button')).filter(btn => {
              const spanText = btn.querySelector('span')?.innerText || '';
              return spanText.toLowerCase().includes('accept all');
            });
            
            if (acceptAllButtons.length > 0) {
              console.log(`JFrog: Clicking "Accept All" button in consent dialog`);
              acceptAllButtons[0].click();
              return true;
            }
            
            // Fallback: click the first button in the button row
            const buttonRow = consentDialog.querySelector('.accept-or-reject-all-button-row');
            if (buttonRow) {
              const firstButton = buttonRow.querySelector('button');
              if (firstButton) {
                console.log(`JFrog: Clicking first button in consent dialog`);
                firstButton.click();
                return true;
              }
            }
          }
          
          // Look for any elements with cookie consent banner role
          const cookieBanners = Array.from(document.querySelectorAll('[role="region"][aria-label*="cookie"]'));
          for (const banner of cookieBanners) {
            if (banner.offsetHeight > 0 && banner.offsetWidth > 0) {
              const buttons = Array.from(banner.querySelectorAll('button'));
              if (buttons.length > 0) {
                // Look for Accept All button
                const acceptButton = buttons.find(btn => {
                  const btnText = btn.innerText.toLowerCase();
                  const spanText = btn.querySelector('span')?.innerText.toLowerCase() || '';
                  return btnText.includes('accept all') || spanText.includes('accept all');
                }) || buttons[0]; // Fallback to first button
                
                console.log(`JFrog: Clicking consent banner button: "${acceptButton.innerText}"`);
                acceptButton.click();
                return true;
              }
            }
          }
          
          // Final fallback for JFrog sites - look for any Accept All text
          const jfrogKeywords = ['accept all'];
          const allButtons = Array.from(document.querySelectorAll('button, .button'));
          
          for (const button of allButtons) {
            const text = button.innerText.toLowerCase();
            const spanText = button.querySelector('span')?.innerText.toLowerCase() || '';
            
            if (jfrogKeywords.some(keyword => text.includes(keyword) || spanText.includes(keyword))) {
              console.log(`JFrog: Clicking button with "Accept All" text: "${button.innerText}"`);
              button.click();
              return true;
            }
          }
          
          return false;
        });
        
        if (jfrogFound) {
          console.log(`  Successfully handled JFrog cookie consent with JS evaluation`);
          await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced from 2000ms
          
          // Verify the banner is gone
          const bannerStillVisible = await page.evaluate(() => {
            const banners = Array.from(document.querySelectorAll('[class*="cookie"], [class*="consent"], [class*="privacy"], [id*="cookie"], [id*="consent"]'));
            return banners.some(banner => banner.offsetHeight > 0 && banner.offsetWidth > 0);
          });
          
          if (bannerStillVisible) {
            console.log(`  Warning: Cookie banner may still be visible after handling`);
          } else {
            console.log(`  Cookie banner successfully dismissed`);
          }
          
          return true;
        }
      } catch (err) {
        console.log(`  Error in site-specific handler for ${hostname}: ${err.message}`);
      }
    }
    
    // XP Days Benelux handling
    if (hostname.includes('xpdaysbenelux.org') || hostname.includes('xpdays.net')) {
      try {
        console.log(`  Using site-specific cookie handler for ${hostname}`);
        
        const xpDaysSelectors = [
          '#cookie-law-info-bar a[data-cli_action="accept"]',
          '.xpdays-cookie-notice button.accept',
          'button.close-cookie-banner',
          '.cookie-notice-container #cn-accept-cookie',
          '#cookie-notice .cn-button.accept'
        ];
        
        for (const selector of xpDaysSelectors) {
          try {
            const button = await page.$(selector);
            if (button) {
              console.log(`  Found XP Days cookie consent button with selector: ${selector}`);
              await button.click();
              await new Promise(resolve => setTimeout(resolve, 1000));
              return true;
            }
          } catch (e) {
            // Continue to the next selector
          }
        }
      } catch (err) {
        console.log(`  Error in site-specific handler for ${hostname}: ${err.message}`);
      }
    }
    
    // Add more site-specific handlers for other problematic sites
    const problematicSites = [
      { domain: 'nervesconf.us', selectors: ['.cookie-banner button', '.gdpr-banner .accept'] },
      { domain: 'swiftcraft.uk', selectors: ['.cookie-banner .accept-button', '.cookie-notice button'] },
      { domain: 'resco.net', selectors: ['.cookie-popup .accept', '#cookieConsentButton'] },
      { domain: 'kubecon', selectors: ['.cookie-consent__button--accept', '.gdpr-banner__button--accept'] },
      { domain: 'owasp.org', selectors: ['.cookie-consent-banner button.accept', '.cookie-button-accept'] }
    ];
    
    for (const site of problematicSites) {
      if (hostname.includes(site.domain)) {
        console.log(`  Using site-specific cookie handler for ${site.domain}`);
        for (const selector of site.selectors) {
          try {
            const button = await page.$(selector);
            if (button) {
              console.log(`  Found ${site.domain} cookie consent button with selector: ${selector}`);
              await button.click();
              await new Promise(resolve => setTimeout(resolve, 1000));
              return true;
            }
          } catch (e) {
            // Continue to the next selector
          }
        }
      }
    }
    
    // Generic fallback approach - click any visible cookie banner button
    try {
      // Use page.evaluate to find and click any visible cookie-related buttons
      const clickedGeneric = await page.evaluate(() => {
        // Check for Cookiebot first as it's very common
        const cookiebotButton = document.getElementById('CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll');
        if (cookiebotButton) {
          console.log('Clicking Cookiebot "Allow all" button');
          cookiebotButton.click();
          return true;
        }

        // Common cookie banner containers
        const cookieContainers = [
          // Cookiebot dialog
          document.querySelector('#CybotCookiebotDialog'),
          // ID-based selectors
          document.querySelector('#cookie-banner'),
          document.querySelector('#cookie-consent'),
          document.querySelector('#cookie-notice'),
          document.querySelector('#cookie-policy'),
          document.querySelector('#cookieConsent'),
          document.querySelector('#CookieConsentBanner'),
          document.querySelector('#gdpr-banner'),
          document.querySelector('#gdpr-consent'),
          // Class-based selectors
          document.querySelector('.cookie-banner'),
          document.querySelector('.cookie-consent'),
          document.querySelector('.cookie-notice'),
          document.querySelector('.gdpr-banner'),
          document.querySelector('.privacy-banner'),
          document.querySelector('.consent-banner')
        ].filter(container => container !== null); // Remove nulls
        
        for (const container of cookieContainers) {
          // Look for buttons or links with accept-related texts
          const acceptKeywords = ['accept', 'agree', 'allow', 'consent', 'got it', 'ok', 'yes', 'continue'];
          const buttons = Array.from(container.querySelectorAll('button, a, .button, [role="button"]'));
          
          for (const button of buttons) {
            const buttonText = button.innerText.toLowerCase();
            if (acceptKeywords.some(keyword => buttonText.includes(keyword))) {
              button.click();
              return true;
            }
          }
          
          // If no text-matching button found, click the first button as a fallback
          if (buttons.length > 0) {
            buttons[0].click();
            return true;
          }
        }
        
        return false;
      });
      
      if (clickedGeneric) {
        console.log(`  Clicked a button in cookie banner using generic approach`);
        await new Promise(resolve => setTimeout(resolve, 1000));
        return true;
      }
    } catch (e) {
      console.log(`  Generic cookie banner approach failed: ${e.message}`);
    }
    
    // Generic cookie consent selectors as a last resort
    for (const selector of COOKIE_CONSENT_SELECTORS) {
      try {
        // Look for the button without waiting
        const button = await page.$(selector);
        
        if (button) {
          console.log(`  Found cookie consent button with selector: ${selector}`);
          await button.click();
          // Wait a bit after clicking
          await new Promise(resolve => setTimeout(resolve, 500));
          return true;
        }
      } catch (e) {
        // Continue to the next selector
      }
    }
    
    // Final attempt: Try to find and click ANY visible button in cookie-related elements
    try {
      console.log(`  Attempting final fallback cookie consent handling`);
      
      const finalAttempt = await page.evaluate(() => {
        // Get all potentially cookie-related elements
        const elements = Array.from(document.querySelectorAll('*')).filter(el => {
          const className = el.className.toString().toLowerCase();
          const id = el.id.toString().toLowerCase();
          const text = el.textContent.toLowerCase();
          
          return (className.includes('cookie') || className.includes('consent') || className.includes('privacy') || 
                  id.includes('cookie') || id.includes('consent') || id.includes('privacy') ||
                  className.includes('gdpr') || id.includes('gdpr')) &&
                 (text.includes('accept') || text.includes('agree') || text.includes('allow') || text.includes('ok'));
        });
        
        for (const element of elements) {
          const style = window.getComputedStyle(element);
          if (element.offsetHeight > 0 && element.offsetWidth > 0 && 
              style.display !== 'none' && style.visibility !== 'hidden') {
            
            // Look for clickable elements (buttons, links, etc.)
            const clickables = Array.from(element.querySelectorAll('button, a, [role="button"], [onclick], .btn, .button'));
            if (clickables.length > 0) {
              console.log(`Final attempt: Clicking button in cookie element`);
              clickables[0].click();
              return true;
            }
            
            // If the element itself looks clickable
            if (element.tagName === 'BUTTON' || element.getAttribute('role') === 'button' || element.onclick) {
              console.log(`Final attempt: Clicking cookie element directly`);
              element.click();
              return true;
            }
          }
        }
        
        return false;
      });
      
      if (finalAttempt) {
        console.log(`  Final attempt succeeded`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Reduced from 2000ms
        
        // Final verification
        const stillVisible = await page.evaluate(() => {
          const banners = Array.from(document.querySelectorAll('[class*="cookie"], [class*="consent"], [class*="privacy"], [id*="cookie"], [id*="consent"]'));
          return banners.some(banner => {
            const style = window.getComputedStyle(banner);
            return banner.offsetHeight > 0 && banner.offsetWidth > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          });
        });
        
        if (stillVisible) {
          console.log(`  Warning: Cookie banner still visible after all attempts`);
        } else {
          console.log(`  Cookie banner successfully dismissed`);
        }
        
        return true;
      }
    } catch (e) {
      console.log(`  Final attempt failed: ${e.message}`);
    }
    
    // If we got here, no known cookie consent was found or handled
    console.log(`  All cookie consent handling attempts failed`);
    return false;
  } catch (error) {
    console.log('  Error handling cookie consent, continuing anyway:', error.message);
    return false;
  }
}

// Function to navigate to a page with retries and Cloudflare handling
async function navigateWithRetries(page, eventId, eventTitle, eventLink) {
  // Helper function to handle navigation and Cloudflare detection
  async function attemptNavigation(url, retryType = 'primary') {
    console.log(`  Attempting ${retryType} navigation to ${url}`);
    
    await page.goto(url, { 
      waitUntil: 'networkidle2', 
      timeout: 60000 
    });
    
    let cloudflareHandled = false;
    
    // Check for Cloudflare challenge immediately after navigation
    const challengeDetected = await isCloudflareChallenge(page);
    if (challengeDetected) {
      console.log(`  Cloudflare challenge detected (${challengeDetected})`);
      const challengeComplete = await waitForCloudflareChallenge(page);
      if (!challengeComplete) {
        throw new Error('Cloudflare challenge timeout');
      }
      cloudflareHandled = true;
    }
    
    // After initial page load, wait a bit to see if cookie banners appear
    const hostname = new URL(url).hostname;
    
    // Longer wait for known slow-loading sites
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // Scroll down and back up to ensure all elements load
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await new Promise(resolve => setTimeout(resolve, 2000));
    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });
    
    return { url, cloudflareHandled };
  }
  
  // Try with original URL and HTTP/2 (default)
  try {
    const result = await attemptNavigation(eventLink, 'primary');
    return { success: true, url: result.url, cloudflareHandled: result.cloudflareHandled };
  } catch (err) {
    console.log(`  Primary navigation error for ${eventTitle}: ${err.message}`);
    
    // Retry 1: Try with HTTP/1.1
    try {
      console.log(`  Retrying with HTTP/1.1 for ${eventTitle}`);
      // Set HTTP/1.1 protocol
      const client = await page.target().createCDPSession();
      await client.send('Network.enable');
      await client.send('Network.setProtocolBypassings', {
        protocolBypassings: [{ protocol: 'h2', minTls: 'tls1.2', maxTls: 'tls1.3' }]
      });
      
      const result = await attemptNavigation(eventLink, 'HTTP/1.1');
      logRetrySuccess(eventId, eventTitle, eventLink, eventLink, 'HTTP/1.1 retry');
      return { success: true, url: result.url, retryType: 'http1', cloudflareHandled: result.cloudflareHandled };
    } catch (err2) {
      console.log(`  HTTP/1.1 retry failed for ${eventTitle}: ${err2.message}`);
      
      // Retry 2: Try adding www. if not present
      const wwwUrl = addWwwToUrl(eventLink);
      if (wwwUrl && wwwUrl !== eventLink) {
        try {
          console.log(`  Retrying with www prefix: ${wwwUrl}`);
          // Reset client settings to default
          const client = await page.target().createCDPSession();
          await client.send('Network.enable');
          await client.send('Network.setProtocolBypassings', {
            protocolBypassings: []
          });
          
          const result = await attemptNavigation(wwwUrl, 'www prefix');
          logRetrySuccess(eventId, eventTitle, eventLink, wwwUrl, 'www prefix retry');
          return { success: true, url: result.url, retryType: 'www', cloudflareHandled: result.cloudflareHandled };
        } catch (err3) {
          console.log(`  www prefix retry failed for ${eventTitle}: ${err3.message}`);
          
          // Retry 3: Try with both www. and HTTP/1.1
          try {
            console.log(`  Retrying with www prefix AND HTTP/1.1: ${wwwUrl}`);
            const client = await page.target().createCDPSession();
            await client.send('Network.enable');
            await client.send('Network.setProtocolBypassings', {
              protocolBypassings: [{ protocol: 'h2', minTls: 'tls1.2', maxTls: 'tls1.3' }]
            });
            
            const result = await attemptNavigation(wwwUrl, 'www + HTTP/1.1');
            logRetrySuccess(eventId, eventTitle, eventLink, wwwUrl, 'www prefix + HTTP/1.1 retry');
            return { success: true, url: result.url, retryType: 'www+http1', cloudflareHandled: result.cloudflareHandled };
          } catch (err4) {
            console.log(`  Final retry failed for ${eventTitle}: ${err4.message}`);
            return { success: false };
          }
        }
      } else {
        return { success: false };
      }
    }
  }
}

export async function generateScreenshots(options = {}) {
  // Check for flags - options take precedence over environment variables
  const forceRegenerate = options.forceRegenerate ?? process.env.FORCE_SCREENSHOTS === 'true';
  const onlyMissing = options.onlyMissing ?? process.env.ONLY_MISSING === 'true';
  const specificEventIds = options.eventIds ?? parseEventIds();
  
  const events = await getEvents();
  console.log(`Starting screenshot generation for ${events.length} events...`);
  console.log(`Mode: ${onlyMissing ? 'Only missing screenshots' : (forceRegenerate ? 'Force regenerate all' : 'Normal')}`);
  
  if (specificEventIds) {
    console.log(`Filtering for specific event IDs: ${specificEventIds.join(', ')}`);
  }
  
  // Use a more specific browser path for macOS
  // This can help avoid connection issues
  let browser;

  // Ensure crashpad directory exists for Chrome crash handler (Docker compatibility)
  const crashpadDir = process.env.CRASHPAD_DATABASE_PATH || '/tmp/crashpad';
  if (!fs.existsSync(crashpadDir)) {
    fs.mkdirSync(crashpadDir, { recursive: true });
  }

  try {
    const browserOptions = {
      headless: 'new',
      defaultViewport: {
        width: 1366,
        height: 1024  // Increased height to capture more of the page
      },
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--window-size=1366,1024',  // Match the viewport size
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process,Crashpad',
        '--single-process', // Run in single process mode on servers
        '--no-zygote', // Disable zygote process
        '--disable-breakpad',
        '--disable-crash-reporter',
        '--disable-crashpad',
        `--crash-dumps-dir=${crashpadDir}`,
        `--crashpad-database=${crashpadDir}`,
        '--enable-crashpad=0'
      ],
      ignoreHTTPSErrors: true,
      timeout: 20000
    };
    
    // Use PUPPETEER_EXECUTABLE_PATH if set (for Docker)
    if (process.env.PUPPETEER_EXECUTABLE_PATH) {
      browserOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    browser = await puppeteer.launch(browserOptions);
    console.log("Browser launched successfully");
  } catch (error) {
    console.error("Failed to launch browser:", error);
    throw error;
  }

  let successCount = 0;
  let errorCount = 0;
  let skippedCount = 0;
  let pastEventCount = 0;
  let timeoutCount = 0;
  let existingCount = 0;
  let http1RetryCount = 0;
  let wwwRetryCount = 0;
  let combinedRetryCount = 0;
  let filteredOutCount = 0;
  let cloudflareHandledCount = 0;
  let browserlessSuccessCount = 0;
  
  // Determine how many events to process
  let eventsToProcess;
  
  // If specific event IDs are provided, filter to just those events
  if (specificEventIds && specificEventIds.length > 0) {
    eventsToProcess = events.filter(event =>
      specificEventIds.includes(event.id) || specificEventIds.includes(event.event_id)
    );
    filteredOutCount = events.length - eventsToProcess.length;

    if (eventsToProcess.length === 0) {
      console.error(`Error: None of the specified event IDs were found in the database`);
      console.log(`Available event IDs (UUID): ${events.slice(0, 5).map(e => e.id).join(', ')}... (and ${events.length - 5} more)`);
      console.log(`Available event IDs (short): ${events.slice(0, 5).map(e => e.event_id).join(', ')}... (and ${events.length - 5} more)`);
      await browser.close();
      return;
    }
  } else if (process.env.NODE_ENV === 'test') {
    eventsToProcess = events.slice(0, 2);
  } else if (process.env.MAX_SCREENSHOTS) {
    const max = parseInt(process.env.MAX_SCREENSHOTS, 10);
    eventsToProcess = events.slice(0, max || 10);
  } else {
    eventsToProcess = events;
  }
  
  // Filter out past events (only if not filtering by specific IDs)
  if (!specificEventIds) {
    const futureEvents = eventsToProcess.filter(event => !isEventInPast(event.event_end));
    pastEventCount = eventsToProcess.length - futureEvents.length;
    eventsToProcess = futureEvents;
  }
  
  console.log(`Will process ${eventsToProcess.length} events for this run`);
  if (filteredOutCount) {
    console.log(`Filtered out ${filteredOutCount} events not matching specified IDs`);
  }
  if (pastEventCount) {
    console.log(`Skipped ${pastEventCount} past events`);
  }

  for (let i = 0; i < eventsToProcess.length; i++) {
    const event = eventsToProcess[i];
    const { id, event_id: eventId, event_title: eventTitle, event_link: eventLink, event_end: eventEnd } = event;
    
    if (!eventLink) {
      console.log(`Skipping event ${eventId} (${eventTitle}) - No URL provided`);
      errorCount++;
      continue;
    }
    
    const fullSizeOutputPath = path.join(SCREENSHOTS_DIR, `${eventId}_full.png`);
    const resizedOutputPath = path.join(SCREENSHOTS_DIR, `${eventId}.jpg`); // Changed to jpg
    
    // Skip if screenshot already exists
    if (fs.existsSync(resizedOutputPath)) {
      // In ONLY_MISSING mode, always skip if file exists
      if (onlyMissing) {
        console.log(`Skipping event ${eventId} (${eventTitle}) - Screenshot exists (ONLY_MISSING mode)`);
        existingCount++;
        continue;
      }
      
      // In normal mode, skip if file exists and is less than 23 hours old unless forced
      if (!needsRegeneration(resizedOutputPath) && !forceRegenerate) {
      console.log(`Skipping event ${eventId} (${eventTitle}) - Screenshot exists and is less than 23 hours old`);
      skippedCount++;
      continue;
      }
    }
    
    let page = null;
    try {
      console.log(`[${i+1}/${eventsToProcess.length}] Capturing screenshot for ${eventTitle} (${eventLink})`);

      page = await browser.newPage();

      // Set aggressive timeouts to prevent hanging - max 30 seconds per screenshot
      page.setDefaultTimeout(30000); // 30 seconds per page operation
      page.setDefaultNavigationTimeout(30000); // 30 seconds for navigation

      // Set up stealth mode to avoid bot detection
      await setupStealthMode(page);

      // Try navigation with retries
      const navigationResult = await navigateWithRetries(page, eventId, eventTitle, eventLink);

      if (!navigationResult.success) {
        console.log(`  All navigation attempts failed for ${eventTitle}`);
        throw new Error('Navigation failed - triggering BrowserLess.io fallback');
      }
      
      // Update retry counters
      if (navigationResult.retryType === 'http1') {
        http1RetryCount++;
      } else if (navigationResult.retryType === 'www') {
        wwwRetryCount++;
      } else if (navigationResult.retryType === 'www+http1') {
        combinedRetryCount++;
      }
      
      // Update Cloudflare counter
      if (navigationResult.cloudflareHandled) {
        cloudflareHandledCount++;
      }
      
      // Handle cookie consent if present
      const consentHandled = await handleCookieConsent(page, navigationResult.url).catch(err => {
        console.log(`  Error handling cookie consent: ${err.message}`);
        return false;
      });
      
      if (consentHandled) {
        console.log(`  Cookie consent handled for ${eventTitle}`);
        // Wait a moment after accepting cookies for any UI changes to settle
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Wait a bit for any lazy-loaded content
      const hostname = new URL(navigationResult.url).hostname;
      if (hostname.includes('devopscon.io')) {
        // For devopscon.io, wait longer and perform additional scrolling
        console.log(`  Waiting extra time for devopscon.io content to fully load`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Reduced from 5000ms

        // Scroll down and back up to ensure all elements load
        await page.evaluate(() => {
          window.scrollTo(0, 200); // Scroll just a bit to load top navigation
          setTimeout(() => window.scrollTo(0, 0), 500);
        });
        await new Promise(resolve => setTimeout(resolve, 800)); // Reduced from 1500ms
      } else if (hostname.includes('luma.com') || hostname.includes('lu.ma')) {
        // For Luma pages, wait longer for JavaScript content to render
        console.log(`  Waiting extra time for Luma content to fully load`);
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Wait for specific Luma elements to be visible
        try {
          await page.waitForSelector('h1, .event-title, [class*="title"]', { timeout: 5000 });
          console.log(`  Luma page content detected`);
        } catch (error) {
          console.log(`  Warning: Could not detect Luma page content - ${error.message}`);
        }

        // Small scroll to trigger any lazy loading
        await page.evaluate(() => {
          window.scrollTo(0, 300);
          setTimeout(() => window.scrollTo(0, 0), 1000);
        });
        await new Promise(resolve => setTimeout(resolve, 1500));
      } else {
      await new Promise(resolve => setTimeout(resolve, 800)); // Reduced for faster processing
      }
      
      // Take the full-size screenshot
      const screenshotOptions = {
        path: fullSizeOutputPath,
        fullPage: false,
        omitBackground: false
      };
      
      // Adjust screenshot dimensions based on the site
      if (hostname && hostname.includes('devopscon.io')) {
        screenshotOptions.clip = {
          x: 0,
          y: 0,
          width: 1366,
          height: 1024
        };
      } else {
        screenshotOptions.clip = {
          x: 0,
          y: 0,
          width: 1366,
          height: 1024
        };
      }
      
      await page.screenshot(screenshotOptions);
      
      // Resize the image to 400px width and convert to JPG with 75% quality
      const resizedBuffer = await sharp(fullSizeOutputPath)
        .resize({ width: 400 })
        .jpeg({ quality: 75 })
        .toBuffer();

      // Upload to Supabase Storage
      console.log(`  📤 Uploading screenshot to Supabase...`);
      const uploadResult = await uploadEventImage(resizedBuffer, eventId, 'jpg');

      if (uploadResult.success) {
        console.log(`✅ Screenshot uploaded to Supabase: ${uploadResult.url}`);

        // Update database with Supabase URL
        await updateScreenshotStatus(eventId, true, uploadResult.url);
        successCount++;
      } else {
        console.error(`  ❌ Failed to upload to Supabase: ${uploadResult.error}`);
        // Fallback: save locally and use local path
        await sharp(resizedBuffer).toFile(resizedOutputPath);
        const screenshotUrl = `/preview/${eventId}.jpg`;
        await updateScreenshotStatus(eventId, true, screenshotUrl);
        successCount++;
      }

      // Remove the full-size screenshot to save space
      fs.unlinkSync(fullSizeOutputPath);
    } catch (error) {
      console.error(`❌ Error capturing screenshot for ${eventTitle} (${eventLink}):`, error.message);

      // Try BrowserLess.io as a fallback service
      console.log(`  🔄 Attempting fallback with BrowserLess.io for ${eventTitle}`);

      try {
        const browserlessResult = await BrowserlessService.generateScreenshot({
          url: eventLink,
          width: 1366,
          height: 1024,
          format: 'jpeg',
          quality: 75,
          fullPage: false,
          waitForTimeout: 30000
        });

        if (browserlessResult.success && browserlessResult.data) {
          // Process the screenshot data with Sharp to resize it
          const resizedBuffer = await sharp(browserlessResult.data)
            .resize({ width: 400 })
            .jpeg({ quality: 75 })
            .toBuffer();

          // Upload to Supabase Storage
          console.log(`  📤 Uploading BrowserLess.io screenshot to Supabase...`);
          const uploadResult = await uploadEventImage(resizedBuffer, eventId, 'jpg');

          if (uploadResult.success) {
            console.log(`✅ BrowserLess.io fallback successful - uploaded to Supabase: ${uploadResult.url}`);

            // Update database with Supabase URL
            await updateScreenshotStatus(eventId, true, uploadResult.url);
            successCount++;
            browserlessSuccessCount++;
            continue; // Skip the error handling below
          } else {
            console.error(`  ❌ Failed to upload BrowserLess.io screenshot to Supabase: ${uploadResult.error}`);
            // Fallback: save locally
            await sharp(resizedBuffer).toFile(resizedOutputPath);
            const screenshotUrl = `/preview/${eventId}.jpg`;
            await updateScreenshotStatus(eventId, true, screenshotUrl);
            successCount++;
            browserlessSuccessCount++;
            continue;
          }
        } else {
          console.log(`  ❌ BrowserLess.io fallback failed: ${browserlessResult.message}`);
        }
      } catch (browserlessError) {
        console.error(`  ❌ BrowserLess.io fallback error: ${browserlessError.message}`);
      }

      // If BrowserLess.io also failed, create a placeholder image as final fallback
      console.log(`  📝 Creating placeholder image as final fallback for ${eventId}`);
      try {
        // Create a simple placeholder image (1x1 pixel transparent PNG)
        const placeholderPixel = Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/wcAAwAB/2lXzAAAACV0RVh0' +
          'ZGF0ZTpjcmVhdGUAMjAyMC0wNy0xMFQxMjozOTo1OCswMDowMOQrwawAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjAtMDctMTBUMTI6Mzk6NTgrMDA6MDCVDXQJAA' +
          'AAAAE1JREFUCNdjYGBgZGBgYGQAAY4MDCAMEgOJIzGQGEgMJA4SA4mBxJAYEGaMYYxhjLGYMZYxxjLGOIwxDmOMxxjjMcYExpiAMSZgjIkYYxIA+/kDHD3Dq7' +
          'oAAAAASUVORK5CYII=',
          'base64'
        );
        fs.writeFileSync(resizedOutputPath, placeholderPixel);
        console.log(`  📝 Created placeholder image for ${eventId}`);
      } catch (placeholderError) {
        console.error(`  ❌ Error creating placeholder image: ${placeholderError.message}`);
      }

      errorCount++;

      // Update database to mark screenshot as failed
      await updateScreenshotStatus(eventId, false);

      // If we've had multiple consecutive failures, restart the browser
      if (errorCount > successCount && errorCount % 5 === 0) {
        console.log(`  🔄 Restarting browser after ${errorCount} errors to recover from potential issues...`);
        try {
          await browser.close();
          browser = await puppeteer.launch(browserOptions);
          console.log(`  ✅ Browser restarted successfully`);
        } catch (restartError) {
          console.error(`  ❌ Failed to restart browser: ${restartError.message}`);
        }
      }
    } finally {
      if (page) {
        try {
          await page.close().catch(() => {});
        } catch (e) {
          // Ignore page close errors
        }
      }
    }
    
    // Add a small delay between processing events to avoid overloading
    await new Promise(resolve => setTimeout(resolve, 500)); // Reduced from 1000ms to 500ms
  }
  
  try {
    await browser.close();
  } catch (e) {
    console.error("Error closing browser:", e.message);
  }
  
  console.log(`\nScreenshot generation complete!`);
  console.log(`Successful: ${successCount}`);
  console.log(`  - Puppeteer successful: ${successCount - browserlessSuccessCount}`);
  console.log(`  - BrowserLess.io fallback successful: ${browserlessSuccessCount}`);
  console.log(`Failed: ${errorCount}`);
  console.log(`Skipped (age/force): ${skippedCount}`);
  console.log(`Skipped (existing in ONLY_MISSING mode): ${existingCount}`);
  console.log(`Navigation timeouts: ${timeoutCount}`);
  console.log(`Cloudflare challenges handled: ${cloudflareHandledCount}`);
  console.log(`Successful HTTP/1.1 retries: ${http1RetryCount}`);
  console.log(`Successful www prefix retries: ${wwwRetryCount}`);
  console.log(`Successful combined retries: ${combinedRetryCount}`);
  
  if (specificEventIds) {
    console.log(`Filtered by specified event IDs: ${specificEventIds.length} IDs, ${eventsToProcess.length} events processed`);
  } else {
    console.log(`Past events (not processed): ${pastEventCount}`);
  }
  
  console.log(`Retry log file: ${RETRY_LOG_FILE}`);
  console.log(`Screenshots saved to: ${SCREENSHOTS_DIR}`);
}

// Execute the function only when run directly (not when imported)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  generateScreenshots().catch(console.error);
} 