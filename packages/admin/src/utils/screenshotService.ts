import { getApiBaseUrl } from '@/config/brands';

export interface ScreenshotServiceResponse {
  success: boolean;
  message: string;
  error?: string;
  output?: string;
}

export interface ScreenshotStreamCallback {
  onProgress: (line: string) => void;
  onComplete: (result: ScreenshotServiceResponse) => void;
  onError: (error: string) => void;
}

export class ScreenshotService {
  private static _serviceAvailable: boolean | null = null;
  private static _lastCheck = 0;

  private static getApiBase() {
    const baseUrl = getApiBaseUrl();
    // Remove /api suffix if present since we'll add /screenshots
    const cleanBaseUrl = baseUrl.endsWith('/api')
      ? baseUrl.slice(0, -4)
      : baseUrl;
    return `${cleanBaseUrl}/api/screenshots`;
  }

  /** Quick health check — cached for 60s to avoid repeated failing requests */
  private static async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this._serviceAvailable !== null && now - this._lastCheck < 60_000) {
      return this._serviceAvailable;
    }
    try {
      const res = await fetch(`${this.getApiBase()}/health`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      this._serviceAvailable = res.ok && data.queueAvailable === true;
    } catch {
      this._serviceAvailable = false;
    }
    this._lastCheck = now;
    return this._serviceAvailable;
  }

  static async generateScreenshot(eventId: string): Promise<ScreenshotServiceResponse> {
    // Skip if screenshot service / Redis queue is unavailable
    if (!(await this.isAvailable())) {
      return { success: false, message: 'Screenshot service not available', error: 'Queue not available' };
    }

    try {
      const apiUrl = `${this.getApiBase()}/generate`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventIds: [eventId],
          type: 'single'
        }),
      }).catch(err => {
        // If API is not available, fail silently
        console.warn('Screenshot API not available:', err.message);
        return null;
      });

      if (!response) {
        return {
          success: false,
          message: 'Screenshot API not available',
          error: 'API service is not running'
        };
      }


      // Handle non-JSON responses (like 500 errors from the server)
      const contentType = response.headers.get('content-type');
      let result;

      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        // If it's not JSON, get the text response
        const textResponse = await response.text();
        throw new Error(`Server error: ${response.status} ${response.statusText}. Response: ${textResponse.substring(0, 200)}`);
      }

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
      }


      return {
        success: true,
        message: `Screenshot generated successfully for event ${eventId}`,
        output: result.output || '',
      };

    } catch (error) {

      // Check if it's a network error
      if (error.name === 'TypeError' && (error instanceof Error ? error.message : String(error)).includes('fetch')) {
        return {
          success: false,
          message: `Cannot connect to screenshot API server. Make sure it's running on port 3002.`,
          error: 'API server not reachable',
        };
      }

      return {
        success: false,
        message: `Screenshot generation failed for event ${eventId}`,
        error: (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  static async generateScreenshotWithBrowserless(eventId: string): Promise<ScreenshotServiceResponse> {
    try {
      const apiUrl = `${this.getApiBase()}/generate`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventIds: [eventId],
          type: 'single',
          forceBrowserless: true
        }),
      });


      // Handle non-JSON responses (like 500 errors from the server)
      const contentType = response.headers.get('content-type');
      let result;

      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        // If it's not JSON, get the text response
        const textResponse = await response.text();
        throw new Error(`Server error: ${response.status} ${response.statusText}. Response: ${textResponse.substring(0, 200)}`);
      }

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
      }


      return {
        success: true,
        message: `BrowserLess.io screenshot generated successfully for event ${eventId}`,
        output: result.output || '',
      };

    } catch (error) {

      // Check if it's a network error
      if (error.name === 'TypeError' && (error instanceof Error ? error.message : String(error)).includes('fetch')) {
        return {
          success: false,
          message: `Cannot connect to screenshot API server. Make sure it's running on port 3002.`,
          error: 'API server not reachable',
        };
      }

      return {
        success: false,
        message: `Forced BrowserLess.io screenshot generation failed for event ${eventId}`,
        error: (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  static async generateMultipleScreenshots(eventIds: string[]): Promise<ScreenshotServiceResponse> {
    try {

      const response = await fetch(`${this.getApiBase()}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventIds,
          type: 'multiple'
        }),
      });

      const contentType = response.headers.get('content-type');
      let result;

      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const textResponse = await response.text();
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
      }


      return {
        success: true,
        message: `Screenshots generated successfully for ${eventIds.length} events`,
      };

    } catch (error) {

      if (error.name === 'TypeError' && (error instanceof Error ? error.message : String(error)).includes('fetch')) {
        return {
          success: false,
          message: `Cannot connect to screenshot API server. Make sure it's running on port 3002.`,
          error: 'API server not reachable',
        };
      }

      return {
        success: false,
        message: `Screenshot generation failed for ${eventIds.length} events`,
        error: (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  static async generateAllScreenshots(): Promise<ScreenshotServiceResponse> {
    try {

      const response = await fetch(`${this.getApiBase()}/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventIds: [],
          type: 'all'
        }),
      });

      const contentType = response.headers.get('content-type');
      let result;

      if (contentType && contentType.includes('application/json')) {
        result = await response.json();
      } else {
        const textResponse = await response.text();
        throw new Error(`Server error: ${response.status} ${response.statusText}`);
      }

      if (!response.ok) {
        throw new Error(result.error || `HTTP ${response.status}: ${response.statusText}`);
      }


      return {
        success: true,
        message: 'Screenshots generated successfully for all events',
      };

    } catch (error) {

      if (error.name === 'TypeError' && (error instanceof Error ? error.message : String(error)).includes('fetch')) {
        return {
          success: false,
          message: `Cannot connect to screenshot API server. Make sure it's running on port 3002.`,
          error: 'API server not reachable',
        };
      }

      return {
        success: false,
        message: 'Screenshot generation failed for all events',
        error: (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  // Streaming methods for real-time output using Server-Sent Events
  static async generateScreenshotWithStream(
    eventId: string,
    callback: ScreenshotStreamCallback,
    options: { forceRegenerate?: boolean } = {}
  ): Promise<void> {
    try {
      callback.onProgress(`Connecting to screenshot service...`);

      const response = await fetch(`${this.getApiBase()}/generate-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventIds: [eventId],
          type: 'single',
          forceRegenerate: options.forceRegenerate ?? true, // Default to force regenerate
        }),
      });

      if (!response.ok) {
        callback.onError(`HTTP ${response.status}: ${response.statusText}`);
        return;
      }

      if (!response.body) {
        callback.onError('Response body is null');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';
      let messageCount = 0;

      console.log('Frontend SSE: Starting to read stream...');

      try {
        while (true) {
          console.log('Frontend SSE: About to read from stream...');
          const { done, value } = await reader.read();

          if (done) {
            console.log('Frontend SSE: Stream ended (done=true)');
            break;
          }

          const chunk = decoder.decode(value, { stream: true });
          console.log('Frontend SSE: Received chunk of length:', chunk.length);
          console.log('Frontend SSE: Chunk content:', JSON.stringify(chunk.substring(0, 200) + (chunk.length > 200 ? '...' : '')));

          buffer += chunk;
          const lines = buffer.split('\n');
          console.log('Frontend SSE: Processing', lines.length - 1, 'complete lines');

          // Process complete lines
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            messageCount++;
            console.log(`Frontend SSE: Processing line ${messageCount}:`, JSON.stringify(line));

            if (line.startsWith('event:')) {
              currentEventType = line.substring(6).trim();
              console.log('Frontend SSE: Event type:', currentEventType);
            } else if (line.startsWith('data:')) {
              try {
                const data = JSON.parse(line.substring(5).trim());
                console.log('Frontend SSE: Parsed data:', data);

                if (currentEventType === 'progress' || data.line) {
                  console.log('Frontend SSE: Calling onProgress with:', data.line || data.message);
                  callback.onProgress(data.line || data.message || 'Processing...');
                } else if (currentEventType === 'complete' || data.success !== undefined) {
                  console.log('Frontend SSE: Calling onComplete, returning...');
                  callback.onComplete({
                    success: data.success,
                    message: data.message,
                    error: data.error
                  });
                  return;
                } else if (currentEventType === 'error' || data.error) {
                  console.log('Frontend SSE: Calling onError, returning...');
                  callback.onError(data.error || data.message || 'Unknown error');
                  return;
                }
              } catch (parseError) {
                console.log('Frontend SSE: JSON parse error:', parseError);
                const text = line.substring(5).trim();
                if (text) {
                  console.log('Frontend SSE: Using as plain text:', text);
                  callback.onProgress(text);
                }
              }
            } else {
              console.log('Frontend SSE: Unrecognized line format:', line);
            }
          }

          // Keep the incomplete line in buffer
          buffer = lines[lines.length - 1];
          console.log('Frontend SSE: Buffer after processing:', JSON.stringify(buffer));
        }
      } catch (error) {
        console.error('Frontend SSE: Error in read loop:', error);
        throw error;
      } finally {
        console.log('Frontend SSE: Releasing reader lock...');
        reader.releaseLock();
        console.log('Frontend SSE: Stream processing complete. Total messages processed:', messageCount);
      }

    } catch (error) {
      console.error('Streaming error:', error);
      callback.onError((error instanceof Error ? error.message : String(error)) || 'Streaming connection failed');
    }
  }

  static async generateScreenshotWithBrowserlessStream(
    eventId: string,
    callback: ScreenshotStreamCallback,
    options: { forceRegenerate?: boolean } = {}
  ): Promise<void> {
    try {
      callback.onProgress(`🌐 Connecting to BrowserLess.io screenshot service...`);

      const response = await fetch(`${this.getApiBase()}/generate-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventIds: [eventId],
          type: 'single',
          forceBrowserless: true,
          forceRegenerate: options.forceRegenerate ?? true, // Default to force regenerate
        }),
      });

      if (!response.ok) {
        callback.onError(`HTTP ${response.status}: ${response.statusText}`);
        return;
      }

      if (!response.body) {
        callback.onError('Response body is null');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          let currentEventType = '';

          // Process complete lines
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();

            if (line.startsWith('event:')) {
              // Extract event type
              currentEventType = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
              // Parse data with current event type context
              try {
                const data = JSON.parse(line.substring(5).trim());

                if (currentEventType === 'progress' || data.line) {
                  callback.onProgress(data.line || data.message || 'Processing with BrowserLess.io...');
                } else if (currentEventType === 'complete' || data.success !== undefined) {
                  callback.onComplete({
                    success: data.success,
                    message: data.message,
                    error: data.error
                  });
                  return;
                } else if (currentEventType === 'error' || data.error) {
                  callback.onError(data.error || data.message || 'Unknown BrowserLess.io error');
                  return;
                }
              } catch (parseError) {
                // If it's not JSON, treat as plain text
                const text = line.substring(5).trim();
                if (text) {
                  callback.onProgress(text);
                }
              }
            }
          }

          // Keep the incomplete line in buffer
          buffer = lines[lines.length - 1];
        }
      } finally {
        reader.releaseLock();
      }

    } catch (error) {
      console.error('BrowserLess.io streaming error:', error);
      callback.onError((error instanceof Error ? error.message : String(error)) || 'BrowserLess.io streaming connection failed');
    }
  }

  static async generateMultipleScreenshotsWithStream(
    eventIds: string[],
    callback: ScreenshotStreamCallback,
    options: { forceRegenerate?: boolean } = {}
  ): Promise<void> {
    try {
      callback.onProgress(`Connecting to screenshot service for ${eventIds.length} events...`);

      const response = await fetch(`${this.getApiBase()}/generate-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventIds,
          type: 'multiple',
          forceRegenerate: options.forceRegenerate ?? true, // Default to force regenerate
        }),
      });

      if (!response.ok) {
        callback.onError(`HTTP ${response.status}: ${response.statusText}`);
        return;
      }

      if (!response.body) {
        callback.onError('Response body is null');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          // Process complete lines
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();

            if (line.startsWith('event:')) {
              // Extract event type
              currentEventType = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
              // Parse data with current event type context
              try {
                const data = JSON.parse(line.substring(5).trim());

                if (currentEventType === 'progress' || data.line) {
                  callback.onProgress(data.line || data.message || 'Processing...');
                } else if (currentEventType === 'complete' || data.success !== undefined) {
                  callback.onComplete({
                    success: data.success,
                    message: data.message,
                    error: data.error
                  });
                  return;
                } else if (currentEventType === 'error' || data.error) {
                  callback.onError(data.error || data.message || 'Unknown error');
                  return;
                }
              } catch (parseError) {
                // If it's not JSON, treat as plain text
                const text = line.substring(5).trim();
                if (text) {
                  callback.onProgress(text);
                }
              }
            }
          }

          // Keep the incomplete line in buffer
          buffer = lines[lines.length - 1];
        }
      } finally {
        reader.releaseLock();
      }

    } catch (error) {
      console.error('Streaming error:', error);
      callback.onError((error instanceof Error ? error.message : String(error)) || 'Streaming connection failed');
    }
  }

  static async generateAllScreenshotsWithStream(
    callback: ScreenshotStreamCallback,
    options: { forceRegenerate?: boolean } = {}
  ): Promise<void> {
    try {
      callback.onProgress('Connecting to screenshot service for all events...');

      const response = await fetch(`${this.getApiBase()}/generate-stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          eventIds: [],
          type: 'all',
          forceRegenerate: options.forceRegenerate ?? false, // Default to NOT force regenerate for bulk operations
        }),
      });

      if (!response.ok) {
        callback.onError(`HTTP ${response.status}: ${response.statusText}`);
        return;
      }

      if (!response.body) {
        callback.onError('Response body is null');
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let currentEventType = '';

      try {
        while (true) {
          const { done, value } = await reader.read();

          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');

          // Process complete lines
          for (let i = 0; i < lines.length - 1; i++) {
            const line = lines[i].trim();

            if (line.startsWith('event:')) {
              // Extract event type
              currentEventType = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
              // Parse data with current event type context
              try {
                const data = JSON.parse(line.substring(5).trim());

                if (currentEventType === 'progress' || data.line) {
                  callback.onProgress(data.line || data.message || 'Processing...');
                } else if (currentEventType === 'complete' || data.success !== undefined) {
                  callback.onComplete({
                    success: data.success,
                    message: data.message,
                    error: data.error
                  });
                  return;
                } else if (currentEventType === 'error' || data.error) {
                  callback.onError(data.error || data.message || 'Unknown error');
                  return;
                }
              } catch (parseError) {
                // If it's not JSON, treat as plain text
                const text = line.substring(5).trim();
                if (text) {
                  callback.onProgress(text);
                }
              }
            }
          }

          // Keep the incomplete line in buffer
          buffer = lines[lines.length - 1];
        }
      } finally {
        reader.releaseLock();
      }

    } catch (error) {
      console.error('Streaming error:', error);
      callback.onError((error instanceof Error ? error.message : String(error)) || 'Streaming connection failed');
    }
  }

}