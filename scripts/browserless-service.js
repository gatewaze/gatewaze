import fetch from 'node-fetch';

export class BrowserlessService {
  static API_KEY = process.env.BROWSERLESS_API_KEY;
  static API_URL = 'https://production-sfo.browserless.io';

  static async generateScreenshot(options) {
    if (!this.API_KEY) {
      return {
        success: false,
        message: 'BrowserLess.io API key not configured',
        error: 'BROWSERLESS_API_KEY environment variable not set'
      };
    }

    try {
      console.log(`  🌐 Using BrowserLess.io fallback for URL: ${options.url}`);

      // BrowserLess.io uses URL parameters for most options
      const params = new URLSearchParams({
        token: this.API_KEY
      });

      // Add options as URL parameters for stealth and blocking
      if (options.fullPage) {
        params.append('fullPage', 'true');
      }

      // Add stealth mode and ad blocking
      params.append('stealth', 'true');
      params.append('blockAds', 'true');

      // Add wait time for cookie banners
      params.append('waitForTimeout', '5000');

      const requestBody = {
        url: options.url
      };

      const response = await fetch(`${this.API_URL}/screenshot?${params.toString()}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`;

        try {
          const errorData = await response.text();
          errorMessage += ` - ${errorData}`;
        } catch (e) {
          // Ignore parsing errors
        }

        return {
          success: false,
          message: `BrowserLess.io API request failed`,
          error: errorMessage
        };
      }

      const screenshotBuffer = await response.buffer();

      if (screenshotBuffer.length === 0) {
        return {
          success: false,
          message: 'BrowserLess.io returned empty screenshot',
          error: 'Empty response from API'
        };
      }

      console.log(`  ✅ BrowserLess.io screenshot generated successfully (${screenshotBuffer.length} bytes)`);

      return {
        success: true,
        data: screenshotBuffer,
        message: 'Screenshot generated successfully using BrowserLess.io'
      };

    } catch (error) {
      console.error('  BrowserLess.io error:', error);

      if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        return {
          success: false,
          message: 'Network error connecting to BrowserLess.io',
          error: 'Failed to connect to BrowserLess.io API'
        };
      }

      return {
        success: false,
        message: 'BrowserLess.io screenshot generation failed',
        error: error.message
      };
    }
  }

  static async testConnection() {
    if (!this.API_KEY) {
      console.log('  ❌ BrowserLess.io API key not configured');
      return false;
    }

    try {
      const response = await fetch(`${this.API_URL}/stats?token=${this.API_KEY}`, {
        method: 'GET',
      });

      if (response.ok) {
        console.log('  ✅ BrowserLess.io connection test successful');
        return true;
      } else {
        console.log(`  ❌ BrowserLess.io connection test failed: ${response.status} ${response.statusText}`);
        return false;
      }
    } catch (error) {
      console.log(`  ❌ BrowserLess.io connection test failed: ${error.message}`);
      return false;
    }
  }

  static isConfigured() {
    return !!this.API_KEY && !!this.API_URL;
  }

  // Utility method to get usage stats
  static async getUsageStats() {
    if (!this.API_KEY) {
      throw new Error('BrowserLess.io API key not configured');
    }

    try {
      const response = await fetch(`${this.API_URL}/stats?token=${this.API_KEY}`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.json();
    } catch (error) {
      console.error('  Failed to get BrowserLess.io usage stats:', error);
      throw error;
    }
  }
}