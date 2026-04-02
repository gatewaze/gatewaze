/**
 * Color utility functions for contrast checking and accessibility
 * Based on WCAG 2.1 guidelines
 */

/**
 * Convert hex color to RGB values
 */
export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Remove # if present
  const cleanHex = hex.replace('#', '');

  if (!/^[0-9A-Fa-f]{6}$/.test(cleanHex)) {
    return null;
  }

  return {
    r: parseInt(cleanHex.substring(0, 2), 16),
    g: parseInt(cleanHex.substring(2, 4), 16),
    b: parseInt(cleanHex.substring(4, 6), 16),
  };
}

/**
 * Calculate relative luminance of a color
 * Based on WCAG 2.1 formula: https://www.w3.org/WAI/WCAG21/Techniques/general/G17
 */
export function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;

  const { r, g, b } = rgb;

  // Convert to sRGB
  const sR = r / 255;
  const sG = g / 255;
  const sB = b / 255;

  // Apply gamma correction
  const R = sR <= 0.03928 ? sR / 12.92 : Math.pow((sR + 0.055) / 1.055, 2.4);
  const G = sG <= 0.03928 ? sG / 12.92 : Math.pow((sG + 0.055) / 1.055, 2.4);
  const B = sB <= 0.03928 ? sB / 12.92 : Math.pow((sB + 0.055) / 1.055, 2.4);

  // Calculate luminance
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

/**
 * Calculate contrast ratio between two colors
 * Returns a value between 1 and 21
 */
export function getContrastRatio(color1: string, color2: string): number {
  const L1 = getLuminance(color1);
  const L2 = getLuminance(color2);

  const lighter = Math.max(L1, L2);
  const darker = Math.min(L1, L2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if text color has sufficient contrast against background
 * Returns contrast level: 'AAA' (7:1+), 'AA' (4.5:1+), 'AA-large' (3:1+), or 'fail'
 */
export function getContrastLevel(
  textColor: string,
  backgroundColor: string
): 'AAA' | 'AA' | 'AA-large' | 'fail' {
  const ratio = getContrastRatio(textColor, backgroundColor);

  if (ratio >= 7) return 'AAA';
  if (ratio >= 4.5) return 'AA';
  if (ratio >= 3) return 'AA-large';
  return 'fail';
}

/**
 * Check contrast of white text against a background color
 */
export function checkWhiteTextContrast(backgroundColor: string): {
  ratio: number;
  level: 'AAA' | 'AA' | 'AA-large' | 'fail';
  passes: boolean;
  warning: string | null;
} {
  const ratio = getContrastRatio('#ffffff', backgroundColor);
  const level = getContrastLevel('#ffffff', backgroundColor);
  const passes = level !== 'fail';

  let warning: string | null = null;
  if (level === 'fail') {
    warning = `Low contrast (${ratio.toFixed(1)}:1). White text may be hard to read. WCAG requires at least 4.5:1 for normal text.`;
  } else if (level === 'AA-large') {
    warning = `Marginal contrast (${ratio.toFixed(1)}:1). White text is only readable at large sizes (18px+ or 14px+ bold).`;
  }

  return { ratio, level, passes, warning };
}

/**
 * Analyze gradient colors for the event portal
 * Returns warnings for any contrast issues
 */
export function analyzeGradientColors(
  color1: string | null | undefined,
  color2: string | null | undefined,
  color3: string | null | undefined,
  defaultColor1 = '#ca2b7f',
  defaultColor2 = '#4086c6',
  defaultColor3 = '#1e2837'
): {
  warnings: string[];
  color1Contrast: ReturnType<typeof checkWhiteTextContrast> | null;
  color2Contrast: ReturnType<typeof checkWhiteTextContrast> | null;
  buttonContrast: ReturnType<typeof checkWhiteTextContrast> | null;
} {
  const warnings: string[] = [];

  const effectiveColor1 = color1 || defaultColor1;
  const effectiveColor2 = color2 || defaultColor2;

  // Check white text against primary color (used for titles, text on gradient)
  const color1Contrast = checkWhiteTextContrast(effectiveColor1);
  if (color1Contrast.warning) {
    warnings.push(`Primary color: ${color1Contrast.warning}`);
  }

  // Check white text against secondary color
  const color2Contrast = checkWhiteTextContrast(effectiveColor2);
  if (color2Contrast.warning) {
    warnings.push(`Secondary color: ${color2Contrast.warning}`);
  }

  // The primary color is also used for buttons, so check that too
  const buttonContrast = color1Contrast;
  if (buttonContrast.level === 'fail') {
    warnings.push(
      'The Register button may be hard to read. Consider using a darker primary color.'
    );
  }

  return {
    warnings,
    color1Contrast,
    color2Contrast,
    buttonContrast,
  };
}

/**
 * Suggest a better color if contrast is too low
 * Darkens the color to improve contrast with white text
 */
export function suggestBetterColor(hex: string, targetRatio = 4.5): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;

  let { r, g, b } = rgb;
  let currentRatio = getContrastRatio('#ffffff', hex);

  // If already good, return as-is
  if (currentRatio >= targetRatio) return hex;

  // Darken the color iteratively until we hit target ratio
  while (currentRatio < targetRatio && (r > 0 || g > 0 || b > 0)) {
    r = Math.max(0, r - 5);
    g = Math.max(0, g - 5);
    b = Math.max(0, b - 5);

    const newHex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
    currentRatio = getContrastRatio('#ffffff', newHex);

    if (currentRatio >= targetRatio) {
      return newHex;
    }
  }

  return hex;
}
