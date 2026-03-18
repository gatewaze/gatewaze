import { createClient } from '@supabase/supabase-js';

// Lazy initialization of Supabase client
let supabaseInstance = null;

// Extract Supabase project ref from JWT token to construct direct URL
function extractProjectRef(jwt) {
  try {
    const payload = jwt.split('.')[1];
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
    return decoded.ref;
  } catch {
    return null;
  }
}

function getSupabaseClient() {
  if (!supabaseInstance) {
    // Use environment variables for brand-specific database connection
    let supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://data.tech.tickets';

    // Use service role key for server-side operations (has write access)
    // Falls back to anon key if service role not available
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY ||
                        process.env.VITE_SUPABASE_ANON_KEY ||
                        process.env.SUPABASE_ANON_KEY;

    // If using a custom domain (not *.supabase.co), extract project ref from JWT
    // and use direct URL for Docker containers that may not resolve custom domains
    if (!supabaseUrl.includes('supabase.co')) {
      const projectRef = extractProjectRef(supabaseKey);
      if (projectRef) {
        const directUrl = `https://${projectRef}.supabase.co`;
        console.log(`📊 Supabase client: Custom domain detected (${supabaseUrl})`);
        console.log(`📊 Using direct Supabase URL: ${directUrl}`);
        supabaseUrl = directUrl;
      }
    }

    // Log which database we're connecting to (helpful for debugging)
    const keyType = process.env.SUPABASE_SERVICE_ROLE_KEY ? 'service_role' : 'anon';
    console.log(`📊 Supabase client connecting to: ${supabaseUrl} (${keyType})`);

    supabaseInstance = createClient(supabaseUrl, supabaseKey);
  }

  return supabaseInstance;
}

// Export both the getter function and a lazy-evaluated proxy for compatibility
export const supabase = new Proxy({}, {
  get(target, prop) {
    const client = getSupabaseClient();
    return client[prop];
  }
});

// Also export the getter for direct usage
export { getSupabaseClient };