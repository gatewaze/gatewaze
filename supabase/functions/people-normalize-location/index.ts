import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

/**
 * Normalize Member Location Edge Function
 *
 * This function handles async location normalization for people:
 * 1. Geocoding: city/country -> lat,lng (via OpenStreetMap Nominatim)
 * 2. Reverse geocoding: lat,lng -> city/country (via OpenStreetMap Nominatim)
 * 3. IP geolocation fallback: IP address -> city/state/country/lat,lng (via ip-api.com)
 *
 * Called by the queue_location_normalization() database trigger.
 *
 * Rate limits:
 * - Nominatim: 1 request per second (we add 1100ms delay)
 * - ip-api.com: 45 requests per minute (no delay needed for single requests)
 */

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NormalizationRequest {
  customer_id: number
  email: string
  city?: string | null
  state?: string | null
  country?: string | null
  country_code?: string | null
  location?: string | null
  ip?: string | null
  address?: string | null
}

interface LocationData {
  city?: string
  state?: string
  country?: string
  country_code?: string
  continent?: string
  location?: string
  timezone?: string
}

interface CountryLookup {
  code: string
  name: string
  continent: string
}

/**
 * Geocode city/country to lat,lng using OpenStreetMap Nominatim API
 * Returns location string in format "latitude,longitude" or null if not found
 */
async function geocodeLocation(city: string, country: string, state?: string): Promise<string | null> {
  try {
    // Build query params - include state if available for better accuracy
    let url = `https://nominatim.openstreetmap.org/search?format=json&limit=1`

    if (city) {
      url += `&city=${encodeURIComponent(city)}`
    }
    if (country) {
      url += `&country=${encodeURIComponent(country)}`
    }
    if (state) {
      url += `&state=${encodeURIComponent(state)}`
    }

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'GatewazeAdmin/1.0 (contact@gatewaze.com)'
      }
    })

    if (!response.ok) {
      console.error(`Geocoding API error: ${response.status} ${response.statusText}`)
      return null
    }

    const data = await response.json()

    if (data && data.length > 0) {
      const { lat, lon } = data[0]
      return `${lat},${lon}`
    }

    return null
  } catch (error) {
    console.error('Geocoding error:', error)
    return null
  }
}

/**
 * Reverse geocode lat,lng to location details using OpenStreetMap Nominatim API
 */
async function reverseGeocode(lat: number, lng: number): Promise<LocationData | null> {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'GatewazeAdmin/1.0 (contact@gatewaze.com)'
      }
    })

    if (!response.ok) {
      console.error(`Reverse geocoding API error: ${response.status} ${response.statusText}`)
      return null
    }

    const data = await response.json()
    const address = data.address || {}

    // Extract city name (try multiple fields in order of preference)
    const city = address.city ||
                 address.town ||
                 address.village ||
                 address.municipality ||
                 address.county ||
                 undefined

    const countryCode = (address.country_code || '').toUpperCase()

    return {
      city,
      state: address.state,
      country: address.country,
      country_code: countryCode || undefined,
    }
  } catch (error) {
    console.error('Reverse geocoding error:', error)
    return null
  }
}

/**
 * IP geolocation using ip-api.com (free, no API key required)
 * Returns location data from IP address
 *
 * Response format:
 * {
 *   "city": "San Francisco",
 *   "region": "California",
 *   "regionName": "California",
 *   "country": "United States",
 *   "countryCode": "US",
 *   "lat": 37.7749,
 *   "lon": -122.4194,
 *   "timezone": "America/Los_Angeles"
 * }
 */
async function geolocateIp(ip: string): Promise<LocationData | null> {
  try {
    // ip-api.com free tier - returns JSON with location data
    // Note: HTTPS requires paid tier, but we use HTTP for free tier
    // For production with sensitive data, consider using a paid service
    const url = `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,city,region,regionName,country,countryCode,lat,lon,timezone`

    const response = await fetch(url)

    if (!response.ok) {
      console.error(`IP geolocation API error: ${response.status} ${response.statusText}`)
      return null
    }

    const data = await response.json()

    if (data.status === 'fail') {
      console.error(`IP geolocation failed: ${data.message}`)
      return null
    }

    return {
      city: data.city || undefined,
      state: data.regionName || data.region || undefined,
      country: data.country || undefined,
      country_code: data.countryCode || undefined,
      location: data.lat && data.lon ? `${data.lat},${data.lon}` : undefined,
      timezone: data.timezone || undefined,
    }
  } catch (error) {
    console.error('IP geolocation error:', error)
    return null
  }
}

/**
 * Look up continent from country_code using the database lookup table
 */
async function getContinent(countryCode: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('country_lookup')
      .select('continent')
      .eq('code', countryCode.toUpperCase())
      .maybeSingle()

    if (error || !data) {
      return null
    }

    return data.continent
  } catch (error) {
    console.error('Continent lookup error:', error)
    return null
  }
}

/**
 * Look up country name from country_code using the database lookup table
 */
async function getCountryName(countryCode: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('country_lookup')
      .select('name')
      .eq('code', countryCode.toUpperCase())
      .maybeSingle()

    if (error || !data) {
      return null
    }

    return data.name
  } catch (error) {
    console.error('Country name lookup error:', error)
    return null
  }
}

/**
 * Sleep helper for rate limiting
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Main normalization logic
 */
async function normalizeLocation(request: NormalizationRequest): Promise<LocationData> {
  const result: LocationData = {}
  let nominatimCalled = false

  // Extract current values
  const { city, state, country, country_code, location, ip } = request

  console.log('Starting location normalization:', {
    customer_id: request.customer_id,
    email: request.email,
    hasCity: !!city,
    hasState: !!state,
    hasCountry: !!country,
    hasCountryCode: !!country_code,
    hasLocation: !!location,
    hasIp: !!ip,
  })

  // =========================================================================
  // CASE 1: Have city/country but no location -> Geocode
  // =========================================================================
  if ((city || country) && !location) {
    console.log('Case 1: Geocoding city/country to location')

    // Use country name if available, otherwise try to get it from country_code
    let countryForGeocode = country
    if (!countryForGeocode && country_code) {
      countryForGeocode = await getCountryName(country_code) || undefined
    }

    if (city || countryForGeocode) {
      const geocodedLocation = await geocodeLocation(
        city || '',
        countryForGeocode || '',
        state || undefined
      )

      if (geocodedLocation) {
        result.location = geocodedLocation
        console.log(`Geocoded location: ${geocodedLocation}`)
      }
      nominatimCalled = true
    }
  }

  // =========================================================================
  // CASE 2: Have location but no city/country -> Reverse geocode
  // =========================================================================
  if (location && (!city || !country)) {
    console.log('Case 2: Reverse geocoding location to city/country')

    // Wait for rate limit if we already called Nominatim
    if (nominatimCalled) {
      await sleep(1100)
    }

    // Parse lat,lng from location string
    const [latStr, lngStr] = location.split(',')
    const lat = parseFloat(latStr)
    const lng = parseFloat(lngStr)

    if (!isNaN(lat) && !isNaN(lng)) {
      const reverseResult = await reverseGeocode(lat, lng)

      if (reverseResult) {
        if (!city && reverseResult.city) {
          result.city = reverseResult.city
        }
        if (!state && reverseResult.state) {
          result.state = reverseResult.state
        }
        if (!country && reverseResult.country) {
          result.country = reverseResult.country
        }
        if (!country_code && reverseResult.country_code) {
          result.country_code = reverseResult.country_code
        }

        console.log('Reverse geocoded:', reverseResult)
      }
      nominatimCalled = true
    }
  }

  // =========================================================================
  // CASE 3: Have IP but missing location data -> IP geolocation fallback
  // =========================================================================
  if (ip && (!city || !country || !location)) {
    console.log('Case 3: IP geolocation fallback')

    const ipResult = await geolocateIp(ip)

    if (ipResult) {
      // Only fill in missing fields (don't overwrite existing data)
      if (!city && !result.city && ipResult.city) {
        result.city = ipResult.city
      }
      if (!state && !result.state && ipResult.state) {
        result.state = ipResult.state
      }
      if (!country && !result.country && ipResult.country) {
        result.country = ipResult.country
      }
      if (!country_code && !result.country_code && ipResult.country_code) {
        result.country_code = ipResult.country_code
      }
      if (!location && !result.location && ipResult.location) {
        result.location = ipResult.location
      }
      if (ipResult.timezone) {
        result.timezone = ipResult.timezone
      }

      console.log('IP geolocation result:', ipResult)
    }
  }

  // =========================================================================
  // Derive continent from country_code if we have it
  // =========================================================================
  const finalCountryCode = result.country_code || country_code
  if (finalCountryCode) {
    const continent = await getContinent(finalCountryCode)
    if (continent) {
      result.continent = continent
    }
  }

  // =========================================================================
  // If country is a 2-letter code, convert to full name
  // =========================================================================
  const finalCountry = result.country || country
  if (finalCountry && finalCountry.length === 2) {
    const fullName = await getCountryName(finalCountry)
    if (fullName) {
      result.country = fullName
      // Also set country_code if not already set
      if (!result.country_code && !country_code) {
        result.country_code = finalCountry.toUpperCase()
      }
    }
  }

  console.log('Final normalization result:', result)
  return result
}

/**
 * Update person attributes in database
 */
async function updatePersonAttributes(
  personId: number,
  updates: LocationData,
  markCompleted: boolean = true
): Promise<boolean> {
  try {
    // Get current attributes
    const { data: person, error: fetchError } = await supabase
      .from('people')
      .select('attributes')
      .eq('id', personId)
      .single()

    if (fetchError || !person) {
      console.error('Failed to fetch person:', fetchError)
      return false
    }

    // Merge updates into attributes (don't overwrite existing values)
    const currentAttrs = person.attributes || {}
    const mergedAttrs = { ...currentAttrs }

    for (const [key, value] of Object.entries(updates)) {
      // Only update if the field is currently empty/null
      if (value && (!currentAttrs[key] || currentAttrs[key] === '')) {
        mergedAttrs[key] = value
      }
    }

    // Set completion timestamp to prevent trigger loop
    // The database trigger checks this and won't re-queue processing within 24 hours
    if (markCompleted) {
      mergedAttrs._location_normalization_completed_at = new Date().toISOString()
    }

    // Update person
    const { error: updateError } = await supabase
      .from('people')
      .update({
        attributes: mergedAttrs,
        // Don't update updated_at as the trigger will handle that
      })
      .eq('id', personId)

    if (updateError) {
      console.error('Failed to update person:', updateError)
      return false
    }

    console.log(`Updated person ${personId} with:`, updates)
    return true
  } catch (error) {
    console.error('Error updating person:', error)
    return false
  }
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }

  try {
    const request: NormalizationRequest = await req.json()

    // Validate request
    if (!request.customer_id) {
      return new Response(JSON.stringify({ error: 'customer_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    console.log('Received normalization request:', {
      customer_id: request.customer_id,
      email: request.email,
    })

    // Perform normalization
    const updates = await normalizeLocation(request)

    // Always update person to mark normalization as completed (prevents trigger loop)
    // Even if there are no location updates, we need to set _location_normalization_completed_at
    const success = await updatePersonAttributes(request.customer_id, updates)

    if (!success) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Failed to update person attributes',
        updates,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({
      success: true,
      customer_id: request.customer_id,
      updates,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })

  } catch (error: any) {
    console.error('Error processing normalization request:', error)
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Internal server error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
