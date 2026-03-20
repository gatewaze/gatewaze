import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const shortioApiKey = process.env.SHORTIO_API_KEY || ''
const shortioDomain = process.env.SHORTIO_DOMAIN || ''
const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || ''

function stringToSlug(str: string): string {
  let result = str.trim().toLowerCase()
  result = result.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  result = result
    .replace(/[^a-z0-9 -]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
  return result
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const editToken = body.edit_token

    if (!editToken) {
      return NextResponse.json({ success: false, error: 'edit_token is required' }, { status: 400 })
    }

    if (!shortioApiKey) {
      return NextResponse.json({ success: false, error: 'SHORTIO_API_KEY not configured' }, { status: 500 })
    }
    if (!shortioDomain) {
      return NextResponse.json({ success: false, error: 'SHORTIO_DOMAIN not configured' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    // Step 1: Look up the talk by edit_token
    const { data: talk, error: talkError } = await supabase
      .from('events_talks')
      .select('id, event_uuid')
      .eq('edit_token', editToken)
      .maybeSingle()

    if (talkError) {
      return NextResponse.json({ success: false, error: `Failed to look up talk: ${talkError.message}` }, { status: 500 })
    }
    if (!talk) {
      return NextResponse.json({ success: false, error: 'Talk not found or invalid token' }, { status: 404 })
    }

    // Step 2: Get the primary speaker for this talk
    const { data: talkSpeaker, error: talkSpeakerError } = await supabase
      .from('events_talk_speakers')
      .select('speaker_id')
      .eq('talk_id', talk.id)
      .eq('is_primary', true)
      .maybeSingle()

    if (talkSpeakerError || !talkSpeaker) {
      return NextResponse.json({ success: false, error: 'Primary speaker not found' }, { status: 404 })
    }

    const speakerId = talkSpeaker.speaker_id

    // Step 3: Get speaker info
    const { data: speaker, error: speakerError } = await supabase
      .from('events_speakers')
      .select('id, people_profile_id')
      .eq('id', speakerId)
      .single()

    if (speakerError || !speaker) {
      return NextResponse.json({ success: false, error: 'Speaker not found' }, { status: 404 })
    }

    // Step 4: Get speaker name from people_profiles -> people
    let speakerName = 'speaker'
    if (speaker.people_profile_id) {
      const { data: profile } = await supabase
        .from('people_profiles')
        .select('person_id')
        .eq('id', speaker.people_profile_id)
        .single()

      if (profile?.person_id) {
        const { data: person } = await supabase
          .from('people')
          .select('attributes, email')
          .eq('id', profile.person_id)
          .single()

        if (person) {
          const firstName = (person.attributes as Record<string, string>)?.first_name || ''
          const lastName = (person.attributes as Record<string, string>)?.last_name || ''
          speakerName = `${firstName} ${lastName}`.trim() || 'speaker'
        }
      }
    }

    // Step 5: Check for existing tracking link
    const { data: existingRedirect } = await supabase
      .from('redirects')
      .select('short_url, path')
      .eq('source_type', 'speaker')
      .eq('source_id', speakerId)
      .maybeSingle()

    if (existingRedirect) {
      return NextResponse.json({
        success: true,
        short_url: existingRedirect.short_url,
        is_new: false,
      })
    }

    // Step 6: Get event info
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('event_id, event_slug, event_link, event_title, enable_native_registration')
      .eq('id', talk.event_uuid)
      .single()

    if (eventError || !event) {
      return NextResponse.json({ success: false, error: 'Event not found' }, { status: 404 })
    }

    // Step 7: Build the destination URL with UTM params
    const eventIdentifier = event.event_slug || event.event_id
    let destinationUrl: string
    if (event.event_link && !event.enable_native_registration) {
      destinationUrl = event.event_link
    } else if (appUrl) {
      destinationUrl = `${appUrl}/events/${eventIdentifier}/register`
    } else {
      const portalDomain = process.env.NEXT_PUBLIC_PORTAL_DOMAIN || 'events.mlops.community'
      destinationUrl = event.event_link || `https://${portalDomain}/events/${eventIdentifier}/register`
    }

    const url = new URL(destinationUrl)
    url.searchParams.set('utm_source', 'speaker')
    url.searchParams.set('utm_medium', 'direct')
    url.searchParams.set('utm_campaign', speakerId)
    const originalUrl = url.toString()

    // Step 8: Generate unique slug
    const baseSlug = `${event.event_id}-${stringToSlug(speakerName)}`
    let slug = baseSlug
    let suffix = 1

    while (true) {
      const { data: existing } = await supabase
        .from('redirects')
        .select('id')
        .eq('path', slug)
        .eq('domain', shortioDomain)
        .maybeSingle()

      if (!existing) break
      suffix++
      slug = `${baseSlug}-${suffix}`
    }

    // Step 9: Create Short.io link
    const shortioResponse = await fetch('https://api.short.io/links', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: shortioApiKey,
      },
      body: JSON.stringify({
        domain: shortioDomain,
        originalURL: originalUrl,
        path: slug,
        title: `Speaker: ${speakerName} (${event.event_id})`,
      }),
    })

    if (!shortioResponse.ok) {
      const errorText = await shortioResponse.text()

      // If path already exists, try to retrieve it
      if (shortioResponse.status === 409) {
        const expandResponse = await fetch(
          `https://api.short.io/links/expand?domain=${shortioDomain}&path=${slug}`,
          { headers: { Authorization: shortioApiKey } }
        )
        if (expandResponse.ok) {
          const expandData = await expandResponse.json()
          const shortUrl = expandData.secureShortURL || expandData.shortURL || `https://${shortioDomain}/${slug}`

          await supabase.from('redirects').insert({
            shortio_id: String(expandData.id),
            shortio_id_string: String(expandData.idString || expandData.id),
            original_url: originalUrl,
            short_url: shortUrl,
            secure_short_url: expandData.secureShortURL,
            path: slug,
            domain: shortioDomain,
            title: `Speaker: ${speakerName} (${event.event_id})`,
            source_type: 'speaker',
            source_id: speakerId,
          })

          return NextResponse.json({ success: true, short_url: shortUrl, is_new: true })
        }
      }

      return NextResponse.json(
        { success: false, error: `Short.io API error (${shortioResponse.status}): ${errorText}` },
        { status: 500 }
      )
    }

    const shortioData = await shortioResponse.json()
    const shortUrl = shortioData.secureShortURL || shortioData.shortURL || `https://${shortioDomain}/${slug}`

    // Step 10: Store in redirects table
    await supabase.from('redirects').insert({
      shortio_id: String(shortioData.id),
      shortio_id_string: String(shortioData.idString || shortioData.id),
      original_url: originalUrl,
      short_url: shortUrl,
      secure_short_url: shortioData.secureShortURL,
      path: slug,
      domain: shortioDomain,
      title: `Speaker: ${speakerName} (${event.event_id})`,
      source_type: 'speaker',
      source_id: speakerId,
    })

    return NextResponse.json({ success: true, short_url: shortUrl, is_new: true })
  } catch (error) {
    console.error('Speaker tracking link error:', error)
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
