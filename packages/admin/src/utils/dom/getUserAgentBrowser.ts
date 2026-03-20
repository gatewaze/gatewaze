import invariant from "tiny-invariant";

export type BrowserName =
  | "Chrome for iOS"
  | "Edge"
  | "Silk"
  | "Chrome"
  | "Firefox"
  | "AOSP"
  | "IE"
  | "Safari"
  | "WebKit"
  | null;

/**
 * Detects the browser based on the user agent string.
 *
 * @param navigatorObj - The Navigator object. Defaults to window.navigator when available.
 * @returns The detected browser name or null if no known browser is detected.
 */
export function getUserAgentBrowser(
  navigatorObj: Navigator | undefined = typeof window !== "undefined" ? window.navigator : undefined
): BrowserName {
  invariant(navigatorObj, "navigator is required");

  const { userAgent: ua, vendor } = navigatorObj;
  const android = /(android)/i.test(ua);

  switch (true) {
    case /CriOS/.test(ua):
      return "Chrome for iOS";
    case /Edg\//.test(ua):
      return "Edge";
    case android && /Silk\//.test(ua):
      return "Silk";
    case /Chrome/.test(ua) && /Google Inc/.test(vendor):
      return "Chrome";
    case /Firefox\/\d+\.\d+$/.test(ua):
      return "Firefox";
    case android:
      return "AOSP";
    case /MSIE|Trident/.test(ua):
      return "IE";
    case /Safari/.test(ua) && /Apple Computer/.test(ua):
      return "Safari";
    case /AppleWebKit/.test(ua):
      return "WebKit";
    default:
      return null;
  }
}
