import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'
import OpenAI from 'openai'
import { calculateDistance, getCityCoordinates } from '@/lib/location'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const openaiApiKey = process.env.OPENAI_API_KEY || ''

interface SearchRequest {
  query: string
  brandId: string
  contentTypes?: string[] // e.g. ['events', 'blog'] — defaults to all
  userLocation?: {
    lat: number
    lng: number
  }
  sessionId?: string
}

export interface UniversalSearchResult {
  content_type: 'event' | 'blog'
  id: string
  slug: string
  title: string
  relevance_score: number
  match_reason: string
  is_upcoming?: boolean
  // Backward compat: old useEventSearch expects event_id
  event_id?: string
  // Extra fields for display
  image_url?: string | null
  subtitle?: string | null
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
    const { query, brandId, contentTypes, userLocation, sessionId } = body

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
    const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0] ||
                      req.headers.get('x-real-ip') ||
                      'unknown'

    const searchEvents = !contentTypes || contentTypes.includes('events')
    const searchBlog = !contentTypes || contentTypes.includes('blog')

    const queryLower = query.toLowerCase().trim()
    const searchPattern = `%${queryLower}%`
    const wordRoot = queryLower.replace(/(s|ic|ing|ed|tion|ive)$/i, '')
    const stemPattern = `%${wordRoot}%`

    // Generate embedding for semantic search
    const openai = new OpenAI({ apiKey: openaiApiKey })
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })
    const queryEmbedding = embeddingResponse.data[0].embedding
    const embeddingString = `[${queryEmbedding.join(',')}]`

    const allResults: UniversalSearchResult[] = []

    // ── Event search ──────────────────────────────────────────────────
    if (searchEvents) {
      const eventResults = await searchEventsContent(
        supabase, queryLower, searchPattern, stemPattern, embeddingString, now, userLocation
      )
      allResults.push(...eventResults)
    }

    // ── Blog search ───────────────────────────────────────────────────
    if (searchBlog) {
      const blogResults = await searchBlogContent(
        supabase, queryLower, searchPattern, stemPattern, embeddingString
      )
      allResults.push(...blogResults)
    }

    // Sort by score descending
    allResults.sort((a, b) => b.relevance_score - a.relevance_score)

    const topResults = allResults.slice(0, 20)

    const eventCount = topResults.filter(r => r.content_type === 'event').length
    const blogCount = topResults.filter(r => r.content_type === 'blog').length
    const parts: string[] = []
    if (eventCount > 0) parts.push(`${eventCount} event${eventCount !== 1 ? 's' : ''}`)
    if (blogCount > 0) parts.push(`${blogCount} post${blogCount !== 1 ? 's' : ''}`)
    const summary = parts.length > 0
      ? `Found ${parts.join(' and ')}`
      : 'No results found. Try different keywords.'

    // Log search (fire-and-forget)
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

    return NextResponse.json({ results: topResults, summary })
  } catch (error) {
    console.error('AI search error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown error' }, { status: 500 })
  }
}

// ── Event search logic (extracted from previous implementation) ─────────

async function searchEventsContent(
  supabase: SupabaseClient,
  queryLower: string,
  searchPattern: string,
  stemPattern: string,
  embeddingString: string,
  now: Date,
  userLocation?: { lat: number; lng: number },
): Promise<UniversalSearchResult[]> {
  // Keyword search
  const { data: keywordMatches } = await supabase
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

  // Embedding text keyword search
  const { data: embeddingTextMatches } = await supabase
    .from('events_embeddings')
    .select('event_id')
    .or(`description_text.ilike.${searchPattern},description_text.ilike.${stemPattern}`)
    .limit(50)

  const keywordMatchIds = new Set([
    ...(keywordMatches || []).map((e: { id: string }) => e.id),
    ...(embeddingTextMatches || []).map((e: { event_id: string }) => e.event_id),
  ])

  // Vector search
  const { data: similarEvents } = await supabase.rpc('events_search_similar', {
    query_embedding: embeddingString,
    match_threshold: 0.25,
    match_count: 30,
  })

  const vectorMatchMap = new Map<string, number>()
  if (similarEvents) {
    for (const e of similarEvents) {
      vectorMatchMap.set(e.event_id, e.similarity)
    }
  }

  const allEventIds = new Set<string>([
    ...(keywordMatches || []).map((e: { id: string }) => e.id),
    ...(similarEvents || []).map((e: { event_id: string }) => e.event_id),
  ])

  if (allEventIds.size === 0) return []

  const { data: events } = await supabase
    .from('events')
    .select(`
      id, event_id, event_slug, event_title, event_start, event_end,
      event_city, event_region, event_country_code, event_topics, listing_intro,
      event_logo, screenshot_url
    `)
    .in('id', Array.from(allEventIds))
    .eq('is_live_in_production', true)

  // Popularity scores
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

  const results: UniversalSearchResult[] = []

  for (const event of events || []) {
    const isUpcoming = new Date(event.event_start) >= now
    const isKeywordMatch = keywordMatchIds.has(event.id)
    const vectorSimilarity = vectorMatchMap.get(event.id) || 0

    let score = 0
    if (event.event_title?.toLowerCase().includes(queryLower)) {
      score += 40
    } else if (isKeywordMatch) {
      score += 25
    }
    score += Math.round(vectorSimilarity * 35)
    if (isUpcoming) score += 15

    if (userLocation && event.event_city) {
      const eventCoords = getCityCoordinates(event.event_city)
      if (eventCoords) {
        const distanceKm = calculateDistance(userLocation.lat, userLocation.lng, eventCoords[0], eventCoords[1])
        if (distanceKm < 50) score += 10
        else if (distanceKm < 200) score += 6
        else if (distanceKm < 500) score += 3
      }
    }

    const popularity = popularityScores.get(event.event_id)
    if (popularity) {
      if (popularity.registration_count >= 100) score += 6
      else if (popularity.registration_count >= 50) score += 4
      else if (popularity.registration_count >= 20) score += 3
      else if (popularity.registration_count >= 5) score += 1

      if (popularity.featured_speaker_count >= 5) score += 4
      else if (popularity.featured_speaker_count >= 3) score += 3
      else if (popularity.featured_speaker_count >= 1) score += 1
    }

    // Match reason
    const topics = event.event_topics || []
    let matchReason = ''
    if (event.event_title?.toLowerCase().includes(queryLower)) {
      matchReason = `Title contains "${queryLower}"`
    } else if (topics.some((t: string) => t.toLowerCase().includes(queryLower))) {
      const matchedTopic = topics.find((t: string) => t.toLowerCase().includes(queryLower))
      matchReason = `Topic: ${matchedTopic}`
    } else if (event.event_city?.toLowerCase().includes(queryLower)) {
      matchReason = `Located in ${event.event_city}`
    } else if (isKeywordMatch) {
      matchReason = `Description matches "${queryLower}"`
    } else if (vectorSimilarity > 0.6) {
      matchReason = 'Highly relevant to your search'
    } else if (vectorSimilarity > 0.4) {
      matchReason = 'Related to your search'
    } else {
      matchReason = 'May be relevant'
    }

    // Subtitle: date + location
    const datePart = event.event_start
      ? new Date(event.event_start).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null
    const subtitle = [datePart, event.event_city].filter(Boolean).join(' · ')

    results.push({
      content_type: 'event',
      id: event.event_id,
      event_id: event.event_id, // backward compat with useEventSearch
      slug: event.event_slug || event.event_id,
      title: event.event_title,
      relevance_score: Math.min(score, 100),
      match_reason: matchReason,
      is_upcoming: isUpcoming,
      image_url: event.event_logo || event.screenshot_url,
      subtitle: subtitle || null,
    })
  }

  return results
}

// ── Blog search logic ───────────────────────────────────────────────────

async function searchBlogContent(
  supabase: SupabaseClient,
  queryLower: string,
  searchPattern: string,
  stemPattern: string,
  embeddingString: string,
): Promise<UniversalSearchResult[]> {
  // Keyword search on blog_posts
  const { data: keywordMatches } = await supabase
    .from('blog_posts')
    .select('id, title, slug, excerpt, featured_image, published_at, reading_time')
    .eq('status', 'published')
    .eq('visibility', 'public')
    .or(
      `title.ilike.${searchPattern},title.ilike.${stemPattern},` +
      `excerpt.ilike.${searchPattern},excerpt.ilike.${stemPattern},` +
      `content.ilike.${searchPattern},content.ilike.${stemPattern}`
    )
    .limit(30)

  const keywordMatchIds = new Set((keywordMatches || []).map((p: { id: string }) => p.id))

  // Vector search (if blog_embeddings table + RPC exist)
  let vectorMatchMap = new Map<string, number>()
  try {
    const { data: similarPosts } = await supabase.rpc('blog_search_similar', {
      query_embedding: embeddingString,
      match_threshold: 0.25,
      match_count: 20,
    })
    if (similarPosts) {
      for (const p of similarPosts) {
        vectorMatchMap.set(p.post_id, p.similarity)
      }
    }
  } catch {
    // blog_search_similar RPC may not exist yet — fall back to keyword only
  }

  // Collect all matched post IDs
  const allPostIds = new Set<string>([
    ...keywordMatchIds,
    ...vectorMatchMap.keys(),
  ])

  if (allPostIds.size === 0) return []

  // Fetch full post data for any that came from vector search but not keyword
  const missingIds = [...allPostIds].filter(id => !keywordMatchIds.has(id))
  let allPosts = [...(keywordMatches || [])]

  if (missingIds.length > 0) {
    const { data: extraPosts } = await supabase
      .from('blog_posts')
      .select('id, title, slug, excerpt, featured_image, published_at, reading_time')
      .in('id', missingIds)
      .eq('status', 'published')
      .eq('visibility', 'public')

    if (extraPosts) allPosts.push(...extraPosts)
  }

  const results: UniversalSearchResult[] = []

  for (const post of allPosts) {
    const isKeywordMatch = keywordMatchIds.has(post.id)
    const vectorSimilarity = vectorMatchMap.get(post.id) || 0

    let score = 0
    if (post.title?.toLowerCase().includes(queryLower)) {
      score += 40
    } else if (isKeywordMatch) {
      score += 25
    }
    score += Math.round(vectorSimilarity * 35)

    // Recency boost: posts published in last 30 days get +5
    if (post.published_at) {
      const daysAgo = (Date.now() - new Date(post.published_at).getTime()) / (1000 * 60 * 60 * 24)
      if (daysAgo < 30) score += 5
      else if (daysAgo < 90) score += 2
    }

    let matchReason = ''
    if (post.title?.toLowerCase().includes(queryLower)) {
      matchReason = `Title contains "${queryLower}"`
    } else if (isKeywordMatch) {
      matchReason = `Content matches "${queryLower}"`
    } else if (vectorSimilarity > 0.6) {
      matchReason = 'Highly relevant to your search'
    } else if (vectorSimilarity > 0.4) {
      matchReason = 'Related to your search'
    } else {
      matchReason = 'May be relevant'
    }

    const datePart = post.published_at
      ? new Date(post.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : null
    const readTime = post.reading_time ? `${post.reading_time} min read` : null
    const subtitle = [datePart, readTime].filter(Boolean).join(' · ')

    results.push({
      content_type: 'blog',
      id: post.id,
      slug: post.slug,
      title: post.title,
      relevance_score: Math.min(score, 100),
      match_reason: matchReason,
      image_url: post.featured_image || null,
      subtitle: subtitle || null,
    })
  }

  return results
}
