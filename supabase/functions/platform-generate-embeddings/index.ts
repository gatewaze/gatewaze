import "jsr:@supabase/functions-js/edge-runtime.d.ts"
import { createClient } from "jsr:@supabase/supabase-js@2"
import OpenAI from "https://esm.sh/openai@4.28.0"

/**
 * Strip HTML tags and clean up text for embedding
 */
function stripHtml(html: string): string {
  if (!html) return ''
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')   // Remove styles
    .replace(/<[^>]+>/g, ' ')                          // Remove HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')                              // Collapse whitespace
    .trim()
}

/**
 * Fetch and extract text content from a URL
 */
async function fetchPageContent(url: string): Promise<string> {
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 10000) // 10 second timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; EventEmbeddingBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      console.log(`Failed to fetch ${url}: ${response.status}`)
      return ''
    }

    const html = await response.text()

    // Extract main content - try to find article/main content areas
    let content = html

    // Try to extract __NEXT_DATA__ for Luma pages
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([^<]+)<\/script>/)
    if (nextDataMatch) {
      try {
        const nextData = JSON.parse(nextDataMatch[1])
        const eventData = nextData?.props?.pageProps?.initialData?.data?.event
        if (eventData) {
          const parts = [
            eventData.name,
            eventData.description,
            eventData.description_md,
            eventData.geo_address_info?.city,
            eventData.geo_address_info?.country,
          ].filter(Boolean)
          if (parts.length > 0) {
            return parts.join(' ')
          }
        }
      } catch {
        // Ignore JSON parse errors
      }
    }

    // Try to extract main content area
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i) ||
                      html.match(/<article[^>]*>([\s\S]*?)<\/article>/i) ||
                      html.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i)

    if (mainMatch) {
      content = mainMatch[1]
    }

    return stripHtml(content).substring(0, 5000) // Limit to 5000 chars
  } catch (error) {
    console.log(`Error fetching ${url}: ${error.message}`)
    return ''
  }
}

/**
 * Extract speaker names from luma_page_data or event_speakers
 */
function extractSpeakers(lumaPageData: any, speakers: any[]): string[] {
  const speakerNames: string[] = []

  // From luma_page_data
  if (lumaPageData?.pageProps?.initialData?.data) {
    const data = lumaPageData.pageProps.initialData.data

    // Hosts
    if (data.hosts && Array.isArray(data.hosts)) {
      for (const host of data.hosts) {
        if (host.name) speakerNames.push(host.name)
      }
    }

    // Featured guests
    if (data.featured_guests && Array.isArray(data.featured_guests)) {
      for (const guest of data.featured_guests) {
        if (guest.name) speakerNames.push(guest.name)
      }
    }
  }

  // From event_speakers table
  if (speakers && Array.isArray(speakers)) {
    for (const speaker of speakers) {
      const name = speaker.full_name ||
                   `${speaker.first_name || ''} ${speaker.last_name || ''}`.trim()
      if (name) speakerNames.push(name)
      if (speaker.company) speakerNames.push(speaker.company)
      if (speaker.job_title) speakerNames.push(speaker.job_title)
    }
  }

  return [...new Set(speakerNames)] // Deduplicate
}

Deno.serve(async (req) => {
  try {
    // Handle CORS
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    }

    // Validate required environment variables
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiApiKey) {
      console.error('OPENAI_API_KEY is not configured')
      return new Response(
        JSON.stringify({ error: 'OPENAI_API_KEY is not configured in edge function secrets' }),
        { status: 500, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
      )
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    const openai = new OpenAI({
      apiKey: openaiApiKey,
    })

    const { customer_ids, event_ids, batch_size = 100 } = await req.json()

    let results = {
      people_processed: 0,
      events_processed: 0,
      errors: []
    }

    // Process person embeddings
    if (customer_ids && customer_ids.length > 0) {
      console.log(`Generating embeddings for ${customer_ids.length} people`)

      for (let i = 0; i < customer_ids.length; i += batch_size) {
        const batch = customer_ids.slice(i, i + batch_size)

        // Fetch person data
        const { data: people, error: fetchError } = await supabaseClient
          .from('people')
          .select('id, email, attributes')
          .in('id', batch)

        if (fetchError) throw fetchError

        // Generate profile text and embeddings for each person
        for (const person of people) {
          try {
            // Build profile text from attributes
            const attrs = person.attributes || {}
            const profileParts = [
              attrs.first_name,
              attrs.last_name,
              attrs.job_title,
              attrs.company,
              attrs.city,
              attrs.state,
              attrs.country,
              attrs.bio || attrs.description
            ].filter(Boolean)

            const profileText = profileParts.join(' ')

            if (!profileText) {
              console.log(`Skipping person ${person.id} - no profile data`)
              continue
            }

            // Generate embedding
            const embeddingResponse = await openai.embeddings.create({
              model: 'text-embedding-3-small',
              input: profileText,
            })

            const embedding = embeddingResponse.data[0].embedding

            // Store embedding - pass array directly, Supabase JS handles pgvector conversion
            const { error: upsertError } = await supabaseClient
              .from('people_embeddings')
              .upsert({
                person_id: person.id,
                profile_text: profileText,
                embedding: embedding,
                model_version: 'text-embedding-3-small',
                updated_at: new Date().toISOString()
              }, { onConflict: 'person_id' })

            if (upsertError) throw upsertError

            results.people_processed++
          } catch (error) {
            results.errors.push(`Person ${person.id}: ${error.message}`)
          }
        }
      }
    }

    // Process event embeddings
    if (event_ids && event_ids.length > 0) {
      console.log(`Generating embeddings for ${event_ids.length} events`)

      for (let i = 0; i < event_ids.length; i += batch_size) {
        const batch = event_ids.slice(i, i + batch_size)

        // Fetch comprehensive event data
        const { data: events, error: fetchError } = await supabaseClient
          .from('events')
          .select(`
            id,
            event_id,
            event_title,
            listing_intro,
            event_description,
            event_type,
            event_city,
            event_region,
            event_country_code,
            event_topics,
            venue_address,
            account,
            event_link,
            page_content,
            luma_page_data,
            meetup_page_data,
            luma_processed_html,
            offer_ticket_details
          `)
          .in('id', batch)

        if (fetchError) {
          console.error(`Error fetching events:`, fetchError)
          throw fetchError
        }

        console.log(`Fetched ${events?.length || 0} events from batch of ${batch.length}`)

        if (!events || events.length === 0) {
          console.log(`No events found for batch: ${batch.slice(0, 3).join(', ')}...`)
          continue
        }

        // Also fetch speakers for these events
        const { data: allSpeakers } = await supabaseClient
          .from('events_speakers_with_details')
          .select('event_uuid, full_name, first_name, last_name, company, job_title, speaker_topic')
          .in('event_uuid', batch)
          .eq('status', 'approved')

        // Group speakers by event
        const speakersByEvent = new Map<string, any[]>()
        if (allSpeakers) {
          for (const speaker of allSpeakers) {
            const eventId = speaker.event_uuid
            if (!speakersByEvent.has(eventId)) {
              speakersByEvent.set(eventId, [])
            }
            speakersByEvent.get(eventId)!.push(speaker)
          }
        }

        // Generate description text and embeddings for each event
        for (const event of events) {
          try {
            const speakers = speakersByEvent.get(event.id) || []

            // Start with core event information
            const descParts: string[] = []

            // Title (most important)
            if (event.event_title) {
              descParts.push(event.event_title)
            }

            // Type and format
            if (event.event_type) {
              descParts.push(event.event_type)
            }

            // Location
            const locationParts = [
              event.venue_address,
              event.event_city,
              event.event_region,
              event.event_country_code
            ].filter(Boolean)
            if (locationParts.length > 0) {
              descParts.push(locationParts.join(', '))
            }

            // Organizer/Account
            if (event.account) {
              descParts.push(`Organized by ${event.account}`)
            }

            // Topics/Tags
            if (Array.isArray(event.event_topics) && event.event_topics.length > 0) {
              descParts.push(`Topics: ${event.event_topics.join(', ')}`)
            }

            // Intro/Summary
            if (event.listing_intro) {
              descParts.push(event.listing_intro)
            }

            // Full description
            if (event.event_description) {
              descParts.push(stripHtml(event.event_description))
            }

            // Ticket details (may contain relevant info)
            if (event.offer_ticket_details) {
              descParts.push(stripHtml(event.offer_ticket_details))
            }

            // Speakers and their info
            const speakerNames = extractSpeakers(event.luma_page_data, speakers)
            if (speakerNames.length > 0) {
              descParts.push(`Speakers: ${speakerNames.join(', ')}`)
            }

            // Speaker topics
            const speakerTopics = speakers
              .map(s => s.speaker_topic)
              .filter(Boolean)
            if (speakerTopics.length > 0) {
              descParts.push(`Speaker topics: ${speakerTopics.join(', ')}`)
            }

            // Page content (already scraped)
            if (event.page_content) {
              const cleanContent = stripHtml(event.page_content)
              if (cleanContent.length > 100) {
                descParts.push(cleanContent.substring(0, 2000))
              }
            }

            // Processed HTML from Luma
            if (event.luma_processed_html && !event.page_content) {
              const cleanContent = stripHtml(event.luma_processed_html)
              if (cleanContent.length > 100) {
                descParts.push(cleanContent.substring(0, 2000))
              }
            }

            // Always fetch fresh content from event_link URL
            // Content may have changed even if URL is the same
            let fetchedContent = ''
            if (event.event_link) {
              console.log(`Fetching content from ${event.event_link}`)
              fetchedContent = await fetchPageContent(event.event_link)
              if (fetchedContent.length > 50) {
                descParts.push(fetchedContent)
              }
            }

            // Generate page_content if event lacks content sources
            // Only generate if: no page_content, no luma_processed_html, no meetup_page_data
            // This gives app fallback content for display
            const hasExistingContent = event.page_content || event.luma_processed_html || event.meetup_page_data
            if (!hasExistingContent && fetchedContent.length > 100) {
              console.log(`Generating page_content for event ${event.event_id} (no existing sources)`)
              const { error: updateError } = await supabaseClient
                .from('events')
                .update({
                  page_content: fetchedContent.substring(0, 10000), // Limit size
                  page_content_source: 'generated'
                })
                .eq('id', event.id)

              if (updateError) {
                console.log(`Warning: Failed to update page_content for ${event.event_id}: ${updateError.message}`)
              } else {
                console.log(`Updated page_content for event ${event.event_id}`)
              }
            }

            // Extract content from Meetup page data
            if (event.meetup_page_data) {
              try {
                const meetupData = typeof event.meetup_page_data === 'string'
                  ? JSON.parse(event.meetup_page_data)
                  : event.meetup_page_data
                if (meetupData.description) {
                  descParts.push(stripHtml(meetupData.description))
                }
                if (meetupData.group?.name) {
                  descParts.push(`Group: ${meetupData.group.name}`)
                }
              } catch {
                // Ignore parse errors
              }
            }

            // Combine all parts
            let descriptionText = descParts.filter(Boolean).join(' ')

            // Truncate to reasonable size for embedding (max ~8000 tokens ≈ 32000 chars)
            if (descriptionText.length > 15000) {
              descriptionText = descriptionText.substring(0, 15000)
            }

            if (!descriptionText || descriptionText.length < 10) {
              console.log(`Skipping event ${event.id} - insufficient content`)
              continue
            }

            console.log(`Event ${event.event_id}: ${descriptionText.length} chars`)

            // Generate embedding
            console.log(`Calling OpenAI for event ${event.event_id}...`)
            const embeddingResponse = await openai.embeddings.create({
              model: 'text-embedding-3-small',
              input: descriptionText,
            })

            const embedding = embeddingResponse.data[0].embedding
            console.log(`Got embedding with ${embedding.length} dimensions`)

            // Store embedding - pass array directly, Supabase JS handles pgvector conversion
            console.log(`Upserting embedding for event ${event.id}...`)
            const { error: upsertError } = await supabaseClient
              .from('events_embeddings')
              .upsert({
                event_id: event.id,
                description_text: descriptionText,
                embedding: embedding,
                model_version: 'text-embedding-3-small-v2', // New version with richer content
                updated_at: new Date().toISOString()
              }, { onConflict: 'event_id' })

            if (upsertError) {
              console.error(`Upsert error for event ${event.id}:`, upsertError)
              throw upsertError
            }

            console.log(`Successfully stored embedding for event ${event.event_id}`)
            results.events_processed++
          } catch (error) {
            const errorDetail = error?.response?.data?.error?.message || error?.message || String(error)
            console.error(`Error processing event ${event.id}:`, errorDetail)
            results.errors.push(`Event ${event.id}: ${errorDetail}`)
          }
        }
      }
    }

    return new Response(
      JSON.stringify(results),
      { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
    )
  }
})
