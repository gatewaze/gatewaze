/**
 * Dynamically set favicon and page title.
 * Sets the static default at boot, then fetches the brand-configured
 * favicon from platform_settings and applies it.
 */
import { getBrandConfig } from '@/config/brands';
import { getSupabase } from '@/lib/supabase';
import { toPublicUrl } from '@gatewaze/shared';

const DEFAULT_FAVICON = '/theme/gatewaze/favicon-96x96.png';
const BUCKET_URL = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/media`;

function setFavicon(href: string) {
  // Remove any existing favicon links
  const existing = document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]');
  existing.forEach(link => link.remove());

  const link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/png';
  link.href = href;
  document.head.appendChild(link);
}

/** Called at boot — sets default favicon, title, then loads configured favicon from DB */
export function setupFavicon() {
  const brandConfig = getBrandConfig();

  // Set static default immediately
  setFavicon(`${DEFAULT_FAVICON}?v=${Date.now()}`);
  document.title = brandConfig.title || 'Admin';

  // Asynchronously fetch the configured favicon from platform_settings
  try {
    const supabase = getSupabase();
    supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'favicon_url')
      .single()
      .then(({ data }) => {
        if (data?.value && data.value.trim() !== '') {
          const resolved = toPublicUrl(data.value, BUCKET_URL);
          if (resolved) setFavicon(resolved);
        }
      });
  } catch {
    // DB not available yet — keep the static default
  }
}

/** Called when the favicon setting changes (e.g. from the Branding settings page) */
export function updateFavicon(faviconUrl: string | null | undefined) {
  const resolved = toPublicUrl(faviconUrl, BUCKET_URL);
  setFavicon(resolved || `${DEFAULT_FAVICON}?v=${Date.now()}`);
}
