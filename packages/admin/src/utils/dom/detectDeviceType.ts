import invariant from "tiny-invariant";

export type DeviceType =
  | 'tablet'
  | 'phone'
  | 'desktop'
  | 'watch'
  | 'vision'
  | 'ereader'
  | 'smarttv'
  | 'console'
  | 'laptop'
  | 'vr'
  | 'iot'
  | 'unknown';

interface DevicePattern {
  type: DeviceType;
  pattern: RegExp;
}

/**
 * Detects the type of device based on the user agent string.
 *
 * @param nav - The Navigator object from the browser. Defaults to window.navigator if available.
 * @returns The type of the device.
 */
export function detectDeviceType(
  nav: Navigator | undefined = typeof window !== 'undefined' ? window.navigator : undefined
): DeviceType {
  invariant(nav, 'navigator is not defined');

  const { userAgent: ua } = nav;

  const devicePatterns: DevicePattern[] = [
    { type: 'tablet', pattern: /(tablet|iPad|Nexus 9)/i },
    { type: 'phone', pattern: /(mobi|iphone|ipod|android.*mobile)/i },
    { type: 'watch', pattern: /(watch|applewatch|android wear|Wear OS)/i },
    { type: 'vision', pattern: /(visionOS|Vision Pro|apple vision)/i },
    { type: 'ereader', pattern: /(kindle|kobo|book)/i },
    { type: 'smarttv', pattern: /(smarttv|googletv|apple tv|roku|samsungtv|tizen|webos)/i },
    { type: 'console', pattern: /(playstation|xbox|nintendo|switch)/i },
    { type: 'laptop', pattern: /(laptop|notebook)/i },
    { type: 'vr', pattern: /(oculus|htc vive|vr|virtual reality)/i },
    { type: 'iot', pattern: /(smart home|alexa|google home|iot)/i },
    { type: 'desktop', pattern: /(windows|macintosh|linux|x11)/i },
  ];

  for (const { type, pattern } of devicePatterns) {
    if (pattern.test(ua)) {
      return type;
    }
  }

  return 'unknown';
}
