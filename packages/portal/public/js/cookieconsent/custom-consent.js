/**
 * Custom Cookie Consent Manager for Gatewaze
 * Self-hosted, GDPR compliant, RudderStack integrated
 */

class GatewazeCookieConsent {
  constructor() {
    this.consentGiven = true; // Default to true (implicit consent)
    this.consentDenied = false;
    this.categories = {
      necessary: true, // Always true
      analytics: true, // Default to true (implicit consent)
      marketing: true, // Default to true (implicit consent)
      functional: true // Default to true (implicit consent)
    };

    // Detect brand and set colors/fonts
    this.brand = document.documentElement.dataset.brand || 'gatewaze';
    this.colors = this.getBrandColors();
    this.fontStack = this.getFontStack();

    this.storageKey = 'gatewaze-consent';
    this.scrollTimeout = null;
    this.hasScrolled = false;
    this.scrollStartTime = null;
    this.init();
  }

  getBrandColors() {
    // Check for event-specific primary color first (set by event detail page)
    const eventPrimaryColor = document.documentElement.dataset.eventPrimaryColor;
    if (eventPrimaryColor) {
      const hoverColor = this.darkenColor(eventPrimaryColor, 10);
      return {
        primary: eventPrimaryColor,
        primaryHover: hoverColor
      };
    }

    // Read primary color from database-driven brand config injected by the server
    const brandConfigEl = document.getElementById('__brand_config__');
    if (brandConfigEl) {
      try {
        const brandConfig = JSON.parse(brandConfigEl.textContent);
        if (brandConfig.primaryColor) {
          return {
            primary: brandConfig.primaryColor,
            primaryHover: this.darkenColor(brandConfig.primaryColor, 10)
          };
        }
      } catch (e) {
        // Fall through to hardcoded defaults
      }
    }

    const brandColors = {
      gatewaze: {
        primary: '#20dd20',
        primaryHover: '#1bc41b'
      },
    };
    return brandColors[this.brand] || brandColors.gatewaze;
  }

  getFontStack() {
    const fallback = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
    try {
      const brandConfigEl = document.getElementById('__brand_config__');
      if (brandConfigEl) {
        const brandConfig = JSON.parse(brandConfigEl.textContent);
        const fonts = [];
        if (brandConfig.fontHeading) fonts.push(`'${brandConfig.fontHeading}'`);
        if (brandConfig.fontBody && brandConfig.fontBody !== brandConfig.fontHeading) fonts.push(`'${brandConfig.fontBody}'`);
        if (fonts.length) return fonts.join(', ') + ', ' + fallback;
      }
    } catch (e) {
      // Fall through to default
    }
    return fallback;
  }

  darkenColor(hex, percent) {
    // Remove # if present
    hex = hex.replace('#', '');

    // Parse hex to RGB
    let r = parseInt(hex.substring(0, 2), 16);
    let g = parseInt(hex.substring(2, 4), 16);
    let b = parseInt(hex.substring(4, 6), 16);

    // Darken by percentage
    r = Math.max(0, Math.floor(r * (100 - percent) / 100));
    g = Math.max(0, Math.floor(g * (100 - percent) / 100));
    b = Math.max(0, Math.floor(b * (100 - percent) / 100));

    // Convert back to hex
    return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  init() {
    // Load existing consent
    this.loadConsent();
    
    // Check if user has made an explicit choice before
    const hasExplicitChoice = localStorage.getItem(this.storageKey);
    
    if (!hasExplicitChoice) {
      // No previous choice - show banner immediately and initialize services
      this.initializeServices();
      this.showBanner();
    } else {
      // User has made an explicit choice before - show icon and initialize
      this.initializeServices();
      this.showPreferencesIcon();
    }
  }

  loadConsent() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const consent = JSON.parse(stored);
        this.consentGiven = consent.consentGiven || false;
        this.consentDenied = consent.consentDenied || false;
        this.categories = { ...this.categories, ...consent.categories };

      }
    } catch (error) {
      console.error('Error loading consent:', error);
    }
  }

  saveConsent() {
    try {
      const consent = {
        consentGiven: this.consentGiven,
        consentDenied: this.consentDenied,
        categories: this.categories,
        timestamp: Date.now(),
        version: '1.0'
      };
      localStorage.setItem(this.storageKey, JSON.stringify(consent));
    } catch (error) {
      console.error('Error saving consent:', error);
    }
  }



  showBanner() {
    // Check if bottom navigation is present and visible for positioning
    const hasBottomNav = document.querySelector('.fixed.bottom-0');
    const isMobile = window.innerWidth <= 768;
    
    // On mobile, only position above nav if navigation is actually showing
    // On desktop, always use the navigation-aware positioning
    let bottomPosition;
    if (isMobile) {
      // On mobile, check if nav is visible (not hidden by display or visibility)
      const navVisible = hasBottomNav && 
        window.getComputedStyle(hasBottomNav).display !== 'none' && 
        window.getComputedStyle(hasBottomNav).visibility !== 'hidden';
      bottomPosition = navVisible ? '100px' : '20px';
    } else {
      // On desktop, use nav-aware positioning if nav exists
      bottomPosition = hasBottomNav ? '100px' : '20px';
    }

    // Create small bottom-left banner with glass effect
    const bannerHTML = `
      <div id="cookie-consent-banner" style="
        position: fixed;
        bottom: ${bottomPosition};
        left: 20px;
        max-width: 350px;
        background: rgba(255, 255, 255, 0.7);
        backdrop-filter: blur(24px);
        border: 1px solid rgba(255, 255, 255, 0.15);
        color: #1f2937;
        padding: 20px;
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
        z-index: 9999;
        font-family: ${this.fontStack};
        font-size: 14px;
        line-height: 1.5;
        opacity: 0;
        transform: translateY(20px);
        animation: fadeInUp 0.3s ease forwards;
      ">
        <div style="margin-bottom: 15px;">
          <p style="margin: 0; color: #1f2937; font-weight: 500;">
            We use cookies to enhance your user experience and provide personalized content.
            <a href="#" id="view-cookie-policy" style="color: ${this.colors.primary}; text-decoration: underline;">Cookie Policy.</a>
          </p>
        </div>

        <div style="display: flex; gap: 8px; flex-direction: row;">
          <button id="accept-all-cookies" style="
            background: ${this.colors.primary};
            color: white;
            border: none;
            padding: 10px 8px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 14px;
            transition: all 0.2s ease;
            flex: 1;
            white-space: nowrap;
            text-transform: none;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          ">Accept all</button>

          <button id="reject-all-cookies" style="
            background: white;
            color: ${this.colors.primary};
            border: 2px solid ${this.colors.primary};
            padding: 10px 8px;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            font-size: 13px;
            transition: all 0.2s ease;
            flex: 1;
            white-space: nowrap;
            text-transform: none;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
          ">Reject non-essential</button>
        </div>
      </div>
    `;

    // Add banner to page
    document.body.insertAdjacentHTML('beforeend', bannerHTML);
    
    // Set up dynamic positioning based on navigation visibility
    this.setupDynamicPositioning();
    
    // Add animation styles and responsive styles for the banner
    if (!document.getElementById('cookie-banner-styles')) {
      const styles = document.createElement('style');
      styles.id = 'cookie-banner-styles';
      styles.textContent = `
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @media (max-width: 768px) {
          #cookie-consent-banner {
            left: 10px !important;
            right: 10px !important;
            max-width: none !important;
          }
        }
        
        @media (max-width: 480px) {
          #cookie-consent-banner {
            left: 8px !important;
            right: 8px !important;
            padding: 16px !important;
            font-size: 13px !important;
          }
        }
      `;
      document.head.appendChild(styles);
    }
    
    // Add event listeners
    this.addEventListeners();
  }

  setupDynamicPositioning() {
    const banner = document.getElementById('cookie-consent-banner');
    if (!banner) return;

    const updateBannerPosition = () => {
      const hasBottomNav = document.querySelector('.fixed.bottom-0');
      const isMobile = window.innerWidth <= 768;
      
      let newBottomPosition;
      if (isMobile) {
        // On mobile, check if nav is visible
        const navVisible = hasBottomNav && 
          window.getComputedStyle(hasBottomNav).display !== 'none' && 
          window.getComputedStyle(hasBottomNav).visibility !== 'hidden';
        newBottomPosition = navVisible ? '100px' : '20px';
      } else {
        // On desktop, use nav-aware positioning if nav exists
        newBottomPosition = hasBottomNav ? '100px' : '20px';
      }
      
      banner.style.bottom = newBottomPosition;
    };

    // Initial position update
    updateBannerPosition();

    // Watch for DOM changes that might affect navigation visibility
    const observer = new MutationObserver(() => {
      updateBannerPosition();
    });

    // Observe changes to the body and any existing navigation
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    });

    // Also listen for resize events in case screen size changes
    window.addEventListener('resize', updateBannerPosition);

    // Store cleanup function for later
    this.positionObserver = observer;
    this.positionUpdateHandler = updateBannerPosition;
  }

  addEventListeners() {
    const acceptAllBtn = document.getElementById('accept-all-cookies');
    const rejectAllBtn = document.getElementById('reject-all-cookies');
    const viewPolicyBtn = document.getElementById('view-cookie-policy');

    if (acceptAllBtn) {
      acceptAllBtn.addEventListener('click', () => this.acceptAll());
    }

    if (rejectAllBtn) {
      rejectAllBtn.addEventListener('click', () => this.rejectAll());
    }

    if (viewPolicyBtn) {
      viewPolicyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.showCookiePolicy();
      });
    }

    // Add hover effects for Accept All button (brand primary)
    if (acceptAllBtn) {
      acceptAllBtn.addEventListener('mouseenter', () => {
        acceptAllBtn.style.background = this.colors.primaryHover;
        acceptAllBtn.style.transform = 'translateY(-1px)';
      });
      acceptAllBtn.addEventListener('mouseleave', () => {
        acceptAllBtn.style.background = this.colors.primary;
        acceptAllBtn.style.transform = 'translateY(0)';
      });
    }

    // Add hover effects for Reject button (solid white with primary border)
    if (rejectAllBtn) {
      rejectAllBtn.addEventListener('mouseenter', () => {
        rejectAllBtn.style.background = '#f9fafb';
        rejectAllBtn.style.borderColor = this.colors.primaryHover;
        rejectAllBtn.style.transform = 'translateY(-1px)';
        rejectAllBtn.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
      });
      rejectAllBtn.addEventListener('mouseleave', () => {
        rejectAllBtn.style.background = 'white';
        rejectAllBtn.style.borderColor = this.colors.primary;
        rejectAllBtn.style.transform = 'translateY(0)';
        rejectAllBtn.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
      });
    }

    // Add hover effect for Cookie Policy link
    if (viewPolicyBtn) {
      viewPolicyBtn.addEventListener('mouseenter', () => {
        viewPolicyBtn.style.color = this.colors.primaryHover;
      });
      viewPolicyBtn.addEventListener('mouseleave', () => {
        viewPolicyBtn.style.color = this.colors.primary;
      });
    }
  }

  addDetailedEventListeners() {
    const saveDetailedBtn = document.getElementById('save-detailed-preferences');
    const acceptAllDetailedBtn = document.getElementById('accept-all-detailed');
    const rejectAllDetailedBtn = document.getElementById('reject-all-detailed');
    const viewPolicyBtn = document.getElementById('view-cookie-policy');

    if (saveDetailedBtn) {
      saveDetailedBtn.addEventListener('click', () => this.saveDetailedPreferences());
    }

    if (acceptAllDetailedBtn) {
      acceptAllDetailedBtn.addEventListener('click', () => this.acceptAll());
    }

    if (rejectAllDetailedBtn) {
      rejectAllDetailedBtn.addEventListener('click', () => this.rejectAll());
    }

    if (viewPolicyBtn) {
      viewPolicyBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.showCookiePolicy();
      });
    }

    // Add hover effects
    [saveDetailedBtn, acceptAllDetailedBtn, rejectAllDetailedBtn].forEach(btn => {
      if (btn) {
        btn.addEventListener('mouseenter', () => {
          btn.style.transform = 'translateY(-1px)';
          btn.style.transition = 'all 0.2s ease';
        });
        btn.addEventListener('mouseleave', () => {
          btn.style.transform = 'translateY(0)';
        });
      }
    });
  }

  acceptAll() {
    this.consentGiven = true;
    this.consentDenied = false;
    this.categories = {
      necessary: true,
      analytics: true,
      marketing: true,
      functional: true
    };
    
    this.saveConsent();
    this.hideBanner();
    this.initializeServices();
    

  }

  saveDetailedPreferences() {
    const analyticsCheckbox = document.getElementById('analytics-consent-detailed');
    const marketingCheckbox = document.getElementById('marketing-consent-detailed');
    const functionalCheckbox = document.getElementById('functional-consent-detailed');
    
    this.consentGiven = true;
    this.consentDenied = false;
    this.categories = {
      necessary: true,
      analytics: analyticsCheckbox ? analyticsCheckbox.checked : false,
      marketing: marketingCheckbox ? marketingCheckbox.checked : false,
      functional: functionalCheckbox ? functionalCheckbox.checked : false
    };
    
    this.saveConsent();
    this.hideBanner();
    this.initializeServices();
    

  }

  rejectAll() {
    this.consentGiven = false;
    this.consentDenied = true;
    this.categories = {
      necessary: true, // Always keep necessary cookies
      analytics: false,
      marketing: false,
      functional: false
    };
    
    this.saveConsent();
    this.hideBanner();
    this.initializeServices();
    

  }

  hideBanner() {
    const banner = document.getElementById('cookie-consent-banner');
    if (banner) {
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(20px)';
      banner.style.transition = 'all 0.3s ease';
      
      // Clean up observers and event listeners
      if (this.positionObserver) {
        this.positionObserver.disconnect();
        this.positionObserver = null;
      }
      if (this.positionUpdateHandler) {
        window.removeEventListener('resize', this.positionUpdateHandler);
        this.positionUpdateHandler = null;
      }
      
      setTimeout(() => {
        banner.remove();
        
        // Always show icon after banner is hidden (if user has made a choice)
        const hasChoice = localStorage.getItem(this.storageKey);
        
        if (hasChoice) {
          setTimeout(() => {
            this.showPreferencesIcon();
          }, 200);
        }
      }, 300);
    }
  }

  initializeServices() {
    // Initialize RudderStack consent management
    if (window.initializeConsentManagement) {
      const status = this.consentGiven ? 'allow' : 'deny';
      window.initializeConsentManagement({ 
        allow: this.consentGiven, 
        deny: this.consentDenied,
        dismiss: false 
      });
    }

    // Update RudderStack consent
    if (window.updateConsentStatus) {
      const status = this.consentGiven ? 'allow' : 'deny';
      window.updateConsentStatus({ 
        allow: this.consentGiven, 
        deny: this.consentDenied,
        dismiss: false 
      });
    }

    // Fire custom events
    const consentEvent = new CustomEvent('cookieConsentChanged', {
      detail: {
        consentGiven: this.consentGiven,
        consentDenied: this.consentDenied,
        categories: this.categories
      }
    });
    document.dispatchEvent(consentEvent);
  }

  // Public API methods
  hasConsent(category = 'analytics') {
    return this.categories[category] || false;
  }

  getConsentStatus() {
    return {
      consentGiven: this.consentGiven,
      consentDenied: this.consentDenied,
      categories: { ...this.categories }
    };
  }

  showPreferences() {
    if (!document.getElementById('cookie-consent-banner')) {
      this.showDetailedBanner();
    }
  }

  showDetailedBanner() {
    // Create detailed banner with granular controls
    const bannerHTML = `
      <div id="cookie-consent-banner" style="
        position: fixed;
        bottom: 20px;
        right: 20px;
        max-width: 450px;
        background: #1f2937;
        color: #ffffff;
        padding: 25px;
        border-radius: 8px;
        box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
        z-index: 9999;
        font-family: ${this.fontStack};
        font-size: 14px;
        line-height: 1.5;
      ">
        <div style="margin-bottom: 15px;">
          <strong style="display: block; margin-bottom: 8px; font-size: 16px;">🍪 Cookie Preferences</strong>
          <p style="margin: 0; color: #d1d5db;">
            Manage your cookie preferences. You can enable or disable different types of cookies below.
          </p>
        </div>
        
        <div style="margin-bottom: 20px;">
          <div style="margin-bottom: 12px; padding: 10px; background: #374151; border-radius: 4px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="checkbox" checked disabled style="margin-right: 10px; cursor: not-allowed;">
              <div>
                <div><strong>Necessary Cookies</strong></div>
                <div style="font-size: 12px; color: #9ca3af; margin-top: 2px;">Required for basic website functionality</div>
              </div>
            </label>
          </div>
          
          <div style="margin-bottom: 12px; padding: 10px; background: #374151; border-radius: 4px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="checkbox" id="analytics-consent-detailed" ${this.categories.analytics ? 'checked' : ''} style="margin-right: 10px;">
              <div>
                <div><strong>Analytics Cookies</strong></div>
                <div style="font-size: 12px; color: #9ca3af; margin-top: 2px;">Help us improve our service by analyzing usage</div>
              </div>
            </label>
          </div>
          
          <div style="margin-bottom: 12px; padding: 10px; background: #374151; border-radius: 4px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="checkbox" id="marketing-consent-detailed" ${this.categories.marketing ? 'checked' : ''} style="margin-right: 10px;">
              <div>
                <div><strong>Marketing Cookies</strong></div>
                <div style="font-size: 12px; color: #9ca3af; margin-top: 2px;">Used for advertising and campaign tracking</div>
              </div>
            </label>
          </div>
          
          <div style="margin-bottom: 12px; padding: 10px; background: #374151; border-radius: 4px;">
            <label style="display: flex; align-items: center; cursor: pointer;">
              <input type="checkbox" id="functional-consent-detailed" ${this.categories.functional ? 'checked' : ''} style="margin-right: 10px;">
              <div>
                <div><strong>Functional Cookies</strong></div>
                <div style="font-size: 12px; color: #9ca3af; margin-top: 2px;">Enable enhanced features and personalization</div>
              </div>
            </label>
          </div>
        </div>
        
        <div style="display: flex; gap: 10px; flex-wrap: wrap;">
          <button id="save-detailed-preferences" style="
            background: #3b82f6;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
            flex: 1;
            min-width: 120px;
          ">Save Preferences</button>
          
          <button id="accept-all-detailed" style="
            background: #10b981;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
            flex: 1;
            min-width: 120px;
          ">Accept All</button>
          
          <button id="reject-all-detailed" style="
            background: #6b7280;
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 500;
            width: 100%;
            margin-top: 5px;
          ">Reject All</button>
        </div>
        
        <div style="margin-top: 15px; font-size: 12px; color: #9ca3af; text-align: center;">
          <a href="/privacy" style="color: #60a5fa; text-decoration: none;">Privacy Policy</a>
          <span style="margin: 0 10px;">•</span>
          <a href="/cookie-policy" style="color: #60a5fa; text-decoration: none;">Cookie Policy</a>
        </div>
      </div>
    `;

    // Add banner to page
    document.body.insertAdjacentHTML('beforeend', bannerHTML);
    
    // Add event listeners for detailed banner
    this.addDetailedEventListeners();
  }

  showPreferencesIcon() {
    // Don't show icon if banner is already visible
    if (document.getElementById('cookie-consent-banner')) {
      return;
    }

    // Check if icon already exists but is hidden
    const existingIcon = document.getElementById('cookie-preferences-icon');
    if (existingIcon) {
      existingIcon.style.display = 'flex';
      return;
    }

    // Check if bottom navigation is present and screen size for positioning
    const hasBottomNav = document.querySelector('.fixed.bottom-0');
    const isMobile = window.innerWidth <= 768;
    
    // Calculate proper position above navigation bar
    // Navigation has: py-4 (32px) + button height (~40px) + border (2px) = ~74px
    // Add 20px spacing above nav = 94px from bottom
    let bottomPosition, leftPosition;
    
    if (hasBottomNav) {
      bottomPosition = '100px'; // Above navigation with spacing
      leftPosition = isMobile ? '0px' : '15px'; // Attached to left edge on mobile
    } else {
      bottomPosition = '20px';
      leftPosition = '15px';
    }
    


    const iconHTML = `
      <div id="cookie-preferences-icon" style="
        position: fixed;
        bottom: ${bottomPosition};
        left: ${leftPosition};
        width: 32px;
        height: 32px;
        background: #1e2837;
        border-radius: ${isMobile ? '0 8px 8px 0' : '8px'};
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 9998;
        box-shadow: none;
        transition: all 0.3s ease;
        border: 2px solid rgba(255, 255, 255, 0.1);
        opacity: 0.8;
        backdrop-filter: blur(4px);
      " title="Cookie Preferences">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style="color: #ffffff;">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" fill="currentColor"/>
          <circle cx="9" cy="9" r="1" fill="currentColor"/>
          <circle cx="15" cy="9" r="1" fill="currentColor"/>
          <circle cx="12" cy="15" r="1" fill="currentColor"/>
        </svg>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', iconHTML);

    const icon = document.getElementById('cookie-preferences-icon');
    
    // Add click handler - opens simple banner, not detailed preferences
    icon.addEventListener('click', () => {
      this.showBanner();
      // Hide the icon when banner is shown
      icon.style.display = 'none';
    });

    // Add hover effects
    icon.addEventListener('mouseenter', () => {
      icon.style.transform = 'scale(1.05)';
      icon.style.boxShadow = '0 2px 8px rgba(30, 40, 55, 0.3), 0 1px 3px rgba(0, 0, 0, 0.1)';
      icon.style.background = '#2a3441';
      icon.style.opacity = '1';
    });

    icon.addEventListener('mouseleave', () => {
      icon.style.transform = 'scale(1)';
      icon.style.boxShadow = 'none';
      icon.style.background = '#1e2837';
      icon.style.opacity = '0.8';
    });

    // Add responsive styles for mobile
    if (!document.getElementById('cookie-icon-mobile-styles')) {
      const mobileStyles = document.createElement('style');
      mobileStyles.id = 'cookie-icon-mobile-styles';
      mobileStyles.textContent = `
        @media (max-width: 768px) {
          #cookie-preferences-icon {
            left: 0px !important;
            border-radius: 0 8px 8px 0 !important;
            bottom: 100px !important;
          }
        }
        
        @media (min-width: 769px) {
          #cookie-preferences-icon {
            left: 15px !important;
            border-radius: 8px !important;
          }
        }
      `;
      document.head.appendChild(mobileStyles);
    }


  }

  hidePreferencesIcon() {
    const icon = document.getElementById('cookie-preferences-icon');
    if (icon) {
      icon.remove();
    }
  }

  revokeConsent() {
    localStorage.removeItem(this.storageKey);
    this.consentGiven = false;
    this.consentDenied = false;
    this.categories = {
      necessary: true,
      analytics: false,
      marketing: false,
      functional: false
    };
    this.showBanner();
  }

  showCookiePolicy() {
    // Navigate to local cookie policy page
    window.location.href = '/cookie-policy';
  }

  displayPolicyModal(policyHTML) {
    // Create a modal to show the policy (matching app modal styling)
    const modal = document.createElement('div');
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.5);
      z-index: 10000;
      overflow-y: auto;
    `;
    
    const container = document.createElement('div');
    container.style.cssText = `
      display: flex;
      min-height: 100%;
      align-items: flex-start;
      justify-content: center;
      padding: 16px;
      text-align: left;
      max-width: 1024px;
      margin: 0 auto;
      position: relative;
    `;
    
    const content = document.createElement('div');
    content.style.cssText = `
      background: white;
      border-radius: 8px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
      width: 100%;
      max-height: 90vh;
      overflow-y: auto;
      position: relative;
    `;
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" style="width: 24px; height: 24px;" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    `;
    closeBtn.style.cssText = `
      position: absolute;
      top: 16px;
      right: 16px;
      z-index: 10;
      color: #6b7280;
      background: none;
      border: none;
      cursor: pointer;
      transition: color 0.2s ease;
      padding: 4px;
      border-radius: 4px;
    `;
    
    // Add hover effect for close button
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.color = '#374151';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.color = '#6b7280';
    });
    
    closeBtn.onclick = () => {
      modal.remove();
      document.body.style.overflow = 'unset';
      // Show preferences icon if banner is not visible
      if (!document.getElementById('cookie-consent-banner')) {
        setTimeout(() => this.showPreferencesIcon(), 100);
      }
    };
    
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.remove();
        document.body.style.overflow = 'unset';
        // Show preferences icon if banner is not visible
        if (!document.getElementById('cookie-consent-banner')) {
          setTimeout(() => this.showPreferencesIcon(), 100);
        }
      }
    };
    
    // Add proper padding to the policy content
    const contentWrapper = document.createElement('div');
    contentWrapper.style.cssText = `
      padding: 24px;
      padding-top: 48px;
    `;
    contentWrapper.innerHTML = policyHTML;

    // Inject brand-specific color overrides
    const brandColorOverrides = document.createElement('style');
    brandColorOverrides.textContent = `
      .header { border-bottom-color: ${this.colors.primary} !important; }
      .header h1 { color: ${this.colors.primary} !important; }
      .category-title { border-left-color: ${this.colors.primary} !important; }
      .category-description { border-left-color: ${this.colors.primary} !important; }
      .stat-number { color: ${this.colors.primary} !important; }
      a { color: ${this.colors.primary} !important; }
      a:hover { color: ${this.colors.primaryHover} !important; }
    `;
    contentWrapper.prepend(brandColorOverrides);

    content.appendChild(closeBtn);
    content.appendChild(contentWrapper);
    container.appendChild(content);
    modal.appendChild(container);
    document.body.appendChild(modal);
    
    // Prevent body scroll when modal is open
    document.body.style.overflow = 'hidden';
  }


}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.gatewazeConsent = new GatewazeCookieConsent();
  });
} else {
  window.gatewazeConsent = new GatewazeCookieConsent();
}

// Make it globally available
window.GatewazeCookieConsent = GatewazeCookieConsent;
