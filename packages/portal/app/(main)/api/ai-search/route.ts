import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { calculateDistance, getCityCoordinates } from '@/lib/location'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const openaiApiKey = process.env.OPENAI_API_KEY || ''

interface SearchRequest {
  query: string
  brandId: string
  userLocation?: {
    lat: number
    lng: number
  }
  sessionId?: string
}

interface AISearchResult {
  event_id: string
  relevance_score: number
  match_reason: string
  is_upcoming: boolean
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
interface AISearchResponse {
  results: AISearchResult[]
  summary?: string
}

interface PopularityScore {
  event_id: string
  registration_count: number
  series_avg_registrations: number
  featured_speaker_count: number
  speaker_prominence_score: number
}

export async function POST(req: NextRequest) {
  try {
    const body: SearchRequest = await req.json()
    const { query, brandId, userLocation, sessionId } = body

    if (!query || !brandId) {
      return NextResponse.json({ error: 'Query and brandId are required' }, { status: 400 })
    }

    if (!openaiApiKey) {
      return NextResponse.json({ error: 'OPENAI_API_KEY not configured' }, { status: 500 })
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const now = new Date()

    // Get IP address from request headers for logging
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0] ||
                      req.headers.get('x-real-ip') ||
                      'unknown'

    // Step 1: Do keyword search first (exact/partial matches in title, topics, description)
    // This ensures we catch direct matches that semantic search might miss
    const queryLower = query.toLowerCase().trim()
    const searchPattern = `%${queryLower}%`

    // Also create word stem patterns for common variations (agents -> agent, agentic)
    const wordRoot = queryLower.replace(/(s|ic|ing|ed|tion|ive)$/i, '')
    const stemPattern = `%${wordRoot}%`

    // Search title, intro, description, and page content for keyword matches
    const { data: keywordMatches, error: keywordError } = await supabase
      .from('events')
      .select('id, event_id')
      .eq('is_live_in_production', true)
      .or(
        `event_title.ilike.${searchPattern},event_title.ilike.${stemPattern},` +
        `listing_intro.ilike.${searchPattern},listing_intro.ilike.${stemPattern},` +
        `event_description.ilike.${searchPattern},event_description.ilike.${stemPattern},` +
        `page_content.ilike.${searchPattern},page_content.ilike.${stemPattern},` +
        `luma_processed_html.ilike.${searchPattern},luma_processed_html.ilike.${stemPattern}`
      )
      .limit(50)

    if (keywordError) {
      console.error('Keyword search error:', keywordError)
    }

    // Also search the event_embeddings.description_text which contains all combined content
    // (includes extracted text from luma_page_data, meetup_page_data, fetched page content, etc.)
    const { data: embeddingTextMatches, error: embeddingSearchError } = await supabase
      .from('events_embeddings')
      .select('event_id')
      .or(`description_text.ilike.${searchPattern},description_text.ilike.${stemPattern}`)
      .limit(50)

    if (embeddingSearchError) {
      console.error('Embedding text search error:', embeddingSearchError)
    }

    // Combine both keyword match sources
    const keywordMatchIds = new Set([
      ...(keywordMatches || []).map((e: { id: string }) => e.id),
      ...(embeddingTextMatches || []).map((e: { event_id: string }) => e.event_id),
    ])

    // Step 2: Generate embedding for semantic search
    const openai = new OpenAI({ apiKey: openaiApiKey })

    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })

    const queryEmbedding = embeddingResponse.data[0].embedding

    // Step 3: Search for similar events using vector similarity
    // Convert embedding array to string format for pgvector RPC
    const embeddingString = `[${queryEmbedding.join(',')}]`

    const { data: similarEvents, error: searchError } = await supabase.rpc('events_search_similar', {
      query_embedding: embeddingString,
      match_threshold: 0.25, // Lower threshold for semantic matches
      match_count: 30,
    })

    if (searchError) {
      console.error('Vector search error:', searchError)
      // Don't fail if vector search fails - we still have keyword matches
    }

    // Combine keyword matches and vector matches
    const vectorMatchMap = new Map<string, number>()
    if (similarEvents) {
      for (const e of similarEvents) {
        vectorMatchMap.set(e.event_id, e.similarity)
      }
    }

    // Collect all unique event IDs
    const allEventIds = new Set<string>([
      ...(keywordMatches || []).map((e: { id: string }) => e.id),
      ...(similarEvents || []).map((e: { event_id: string }) => e.event_id),
    ])

    if (allEventIds.size === 0) {
      return NextResponse.json({
        results: [],
        summary: 'No matching events found. Try different keywords.',
      })
    }

    // Step 4: Fetch full event details for all matched events
    const eventIds = Array.from(allEventIds)

    const { data: events, error: eventsError } = await supabase
      .from('events')
      .select(
        `
        id,
        event_id,
        event_slug,
        event_title,
        event_start,
        event_end,
        event_city,
        event_region,
        event_country_code,
        event_topics,
        listing_intro
      `
      )
      .in('id', eventIds)
      .eq('is_live_in_production', true)

    if (eventsError) {
      return NextResponse.json({ error: `Failed to fetch events: ${eventsError.message}` }, { status: 500 })
    }

    // Step 4: Fetch popularity scores for weighting (registrations, speakers, series history)
    const eventIdStrings = events?.map((e: { event_id: string }) => e.event_id) || []
    const popularityScores: Map<string, PopularityScore> = new Map()

    if (eventIdStrings.length > 0) {
      const { data: popularityData } = await supabase.rpc('events_get_popularity_scores', {
        event_ids: eventIdStrings,
      })
      if (popularityData) {
        for (const score of popularityData) {
          popularityScores.set(score.event_id, score)
        }
      }
    }

    // Step 5: Build results with comprehensive scoring
    const results: AISearchResult[] = []

    for (const event of events || []) {
      const isUpcoming = new Date(event.event_start) >= now
      const isKeywordMatch = keywordMatchIds.has(event.id)
      const vectorSimilarity = vectorMatchMap.get(event.id) || 0

      // Scoring: Keyword matches get priority, vector adds semantic relevance
      let score = 0

      // Keyword match in title gets huge boost (+40 points)
      if (event.event_title?.toLowerCase().includes(queryLower)) {
        score += 40
      }
      // Keyword match in description (+25 points)
      else if (isKeywordMatch) {
        score += 25
      }

      // Vector similarity score (0-35 points)
      score += Math.round(vectorSimilarity * 35)

      // Boost upcoming events (+15 points)
      if (isUpcoming) {
        score += 15
      }

      // Boost by proximity if user location provided (+0-10 points)
      if (userLocation && event.event_city) {
        const eventCoords = getCityCoordinates(event.event_city)
        if (eventCoords) {
          const distanceKm = calculateDistance(userLocation.lat, userLocation.lng, eventCoords[0], eventCoords[1])
          if (distanceKm < 50) score += 10
          else if (distanceKm < 200) score += 6
          else if (distanceKm < 500) score += 3
        }
      }

      // Popularity-based scoring
      const popularity = popularityScores.get(event.event_id)
      if (popularity) {
        // Registration count boost (+0-6 points)
        if (popularity.registration_count >= 100) score += 6
        else if (popularity.registration_count >= 50) score += 4
        else if (popularity.registration_count >= 20) score += 3
        else if (popularity.registration_count >= 5) score += 1

        // Featured speakers boost (+0-4 points)
        if (popularity.featured_speaker_count >= 5) score += 4
        else if (popularity.featured_speaker_count >= 3) score += 3
        else if (popularity.featured_speaker_count >= 1) score += 1
      }

      // Generate match reason based on what matched
      let matchReason = ''
      const topics = event.event_topics || []

      if (event.event_title?.toLowerCase().includes(queryLower)) {
        matchReason = `Title contains "${query}"`
      } else if (topics.some((t: string) => t.toLowerCase().includes(queryLower))) {
        const matchedTopic = topics.find((t: string) => t.toLowerCase().includes(queryLower))
        matchReason = `Topic: ${matchedTopic}`
      } else if (event.event_city?.toLowerCase().includes(queryLower)) {
        matchReason = `Located in ${event.event_city}`
      } else if (isKeywordMatch) {
        matchReason = `Description matches "${query}"`
      } else if (vectorSimilarity > 0.6) {
        matchReason = 'Highly relevant to your search'
      } else if (vectorSimilarity > 0.4) {
        matchReason = 'Related to your search'
      } else {
        matchReason = 'May be relevant'
      }

      results.push({
        event_id: event.event_id,
        relevance_score: Math.min(score, 100),
        match_reason: matchReason,
        is_upcoming: isUpcoming,
      })
    }

    // Sort by score descending, then by upcoming status
    results.sort((a, b) => {
      if (b.relevance_score !== a.relevance_score) {
        return b.relevance_score - a.relevance_score
      }
      return a.is_upcoming === b.is_upcoming ? 0 : a.is_upcoming ? -1 : 1
    })

    // Limit to top 20 results
    const topResults = results.slice(0, 20)

    const upcomingCount = topResults.filter((r) => r.is_upcoming).length
    const pastCount = topResults.filter((r) => !r.is_upcoming).length

    let summary = ''
    if (topResults.length > 0) {
      summary = `Found ${topResults.length} event${topResults.length !== 1 ? 's' : ''}`
      if (upcomingCount > 0 && pastCount > 0) {
        summary += ` (${upcomingCount} upcoming, ${pastCount} past)`
      } else if (upcomingCount > 0) {
        summary += ` (all upcoming)`
      } else {
        summary += ` (all past)`
      }
    }

    // Log search query for analytics and self-populating pipeline (fire-and-forget)
    Promise.resolve(
      supabase
        .from('platform_search_queries_log')
        .insert({
          query,
          brand_id: brandId,
          user_location: userLocation ? { lat: userLocation.lat, lng: userLocation.lng } : null,
          results_count: topResults.length,
          has_results: topResults.length > 0,
          session_id: sessionId || null,
          ip_address: ipAddress,
        })
    ).catch((err) => console.error('Failed to log search query:', err))

    return NextResponse.json({
      results: topResults,
      summary,
    })
  } catch (error) {
    console.error('AI search error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}
