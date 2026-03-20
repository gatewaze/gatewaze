// Simple locale utilities for English-only setup

export const locale = 'en';
export const isRtl = false;
export const direction = 'ltr';

// Set document direction to LTR
if (typeof document !== 'undefined') {
  document.documentElement.dir = 'ltr';
}