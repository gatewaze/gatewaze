import invariant from "tiny-invariant";

interface OSPattern {
  name: string;
  pattern: RegExp;
}

/**
 * Detects the operating system based on the user agent string.
 *
 * @param navigatorObj - The Navigator object from the browser. Defaults to window.navigator when available.
 * @returns The name of the operating system, or 'unknown' if not detected.
 */
export function getUserAgentOS(
  navigatorObj: Navigator | undefined = typeof window !== "undefined" ? window.navigator : undefined
): string {
  invariant(navigatorObj, "navigator is required");

  const { userAgent: ua, platform } = navigatorObj;

  // Define the mapping of OS patterns
  const osPatterns: OSPattern[] = [
    { name: "Android", pattern: /Android/i },
    { name: "iOS", pattern: /iPhone|iPad|iPod/i },
    { name: "Windows", pattern: /Win/i },
    { name: "Mac", pattern: /Mac/i },
    { name: "Chrome OS", pattern: /CrOS/i },
    { name: "Linux", pattern: /Linux/i },
    { name: "HarmonyOS", pattern: /HUAWEI/i }, // HarmonyOS is often identified by Huawei devices
    { name: "Ubuntu", pattern: /Ubuntu/i },
    { name: "Debian", pattern: /Debian/i },
    { name: "Fedora", pattern: /Fedora/i },
    { name: "OpenSUSE", pattern: /openSUSE/i },
    { name: "CentOS", pattern: /CentOS/i },
    { name: "Red Hat", pattern: /Red Hat/i },
    { name: "BSD", pattern: /BSD/i },
    { name: "AIX", pattern: /AIX/i },
    { name: "Solaris", pattern: /Solaris|SunOS/i },
    { name: "Windows Phone", pattern: /Windows Phone/i },
    { name: "BlackBerry", pattern: /BlackBerry|BB/i },
    { name: "Symbian", pattern: /Symbian/i },
    { name: "Tizen", pattern: /Tizen/i },
    { name: "Firefox OS", pattern: /Firefox OS/i },
    { name: "WebOS", pattern: /webOS/i },
    { name: "KaiOS", pattern: /KaiOS/i },
  ];

  // Check for matches in the user agent or platform
  for (const { name, pattern } of osPatterns) {
    if (pattern.test(ua) || pattern.test(platform)) {
      return name;
    }
  }

  // Default fallback if no match is found
  return "unknown";
}
