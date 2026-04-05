import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ValidationResult {
  valid: boolean;
  exists: boolean;
  error?: string;
}

async function handler(req: Request) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();

    if (!url || typeof url !== 'string') {
      return new Response(
        JSON.stringify({ valid: false, exists: false, error: 'URL is required' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Validate LinkedIn URL format
    const linkedInPattern = /^(https?:\/\/)?(www\.)?linkedin\.com\/in\/[\w-]+\/?$/i;
    if (!linkedInPattern.test(url.trim())) {
      return new Response(
        JSON.stringify({ valid: false, exists: false, error: 'Invalid LinkedIn profile URL format' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normalize the URL
    let normalizedUrl = url.trim();
    if (!normalizedUrl.startsWith('http')) {
      normalizedUrl = 'https://' + normalizedUrl;
    }

    // Try to fetch the LinkedIn profile page
    try {
      const response = await fetch(normalizedUrl, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; URLValidator/1.0)',
        },
        redirect: 'follow',
      });

      // Check if it's a 404 or redirected to a not-found page
      if (response.status === 404) {
        return new Response(
          JSON.stringify({ valid: true, exists: false, error: 'This LinkedIn profile does not exist' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check the final URL - if redirected to login or different page, profile may not exist
      const finalUrl = response.url;
      if (finalUrl.includes('/login') || finalUrl.includes('/authwall')) {
        // LinkedIn redirected to login - this could mean the profile exists but is private,
        // or it could mean the profile doesn't exist. We'll be lenient here.
        return new Response(
          JSON.stringify({ valid: true, exists: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // If we got a successful response, the profile exists
      if (response.ok) {
        return new Response(
          JSON.stringify({ valid: true, exists: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // For other status codes, be lenient and assume it might exist
      return new Response(
        JSON.stringify({ valid: true, exists: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (fetchError) {
      // If fetch fails (network error, etc.), be lenient and just validate format
      console.error('LinkedIn fetch error:', fetchError);
      return new Response(
        JSON.stringify({ valid: true, exists: true }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  } catch (error) {
    console.error('Validation error:', error);
    return new Response(
      JSON.stringify({ valid: false, exists: false, error: 'Validation failed' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
}

export default handler;
if (import.meta.main) Deno.serve(handler);
