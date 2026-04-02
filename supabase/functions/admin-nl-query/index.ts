import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://deno.land/x/openai@v4.24.0/mod.ts'

// Database schema context for RAG
const DATABASE_SCHEMA = `
# Available Tables

## people (Members Dashboard)
- id (bigint): Primary key
- cio_id (text): Customer.io ID (CIO identifier)
- email (text): Email address
- attributes (jsonb): Contains: first_name, last_name, company, job_title, city, state, country, linkedin_url, continent, location, etc.
- auth_user_id (uuid): Reference to auth user (if authenticated)
- created_at (timestamptz): When person was created
- has_gravatar (boolean): Has gravatar avatar stored
- avatar_source (text): Avatar source type ('uploaded', 'linkedin', 'gravatar', null)
- avatar_storage_path (text): Path to stored avatar in Supabase storage

## events (Multiple Dashboards: Discounts, Competitions, Offers)
- id (uuid): Primary key
- event_id (text): Short event ID
- event_title (text): Event name
- event_city (text): Event city
- event_country_code (text): Country code
- event_start (timestamptz): Start date/time
- event_end (timestamptz): End date/time
- event_topics (text[]): Array of topics
- event_type (text): Event type
- offer_slug (text): URL slug for the offer
- offer_close_date (timestamptz): When the offer/discount closes
- account_id (uuid): Organizing account
- status (text): complete/incomplete/draft
- is_live_in_production (boolean): Published status

## event_registrations
- id (uuid): Primary key
- event_id (uuid): Reference to events.id
- customer_id (bigint): Reference to people.id
- registration_status (text): Status
- registered_at (timestamptz): Registration timestamp

## discount_codes (Discounts Dashboard)
- id (text): Primary key
- code (text): The discount code string
- event_id (text): Reference to events.event_id
- issued (boolean): Whether code has been issued to a customer
- issued_to (text): Email of customer who received the code
- issued_at (timestamptz): When code was issued
- registered (boolean): Whether customer registered for event
- registered_at (timestamptz): When customer registered
- attended (boolean): Whether customer attended event
- attended_at (timestamptz): When customer attended
- created_at (timestamptz): When code was created

## discount_interactions (Discounts Dashboard)
- customer_cio_id (text): Customer.io ID who interacted
- offer_id (text): Discount offer slug
- offer_status (text): 'accepted' = customer claimed the discount
- timestamp (timestamptz): When interaction occurred

## offer_interactions (Offers Dashboard)
- customer_cio_id (text): Customer.io ID who interacted
- offer_id (text): Generic offer slug
- offer_status (text): 'accepted' = customer accepted offer
- offer_referrer (text): Referrer URL
- timestamp (timestamptz): When interaction occurred
- account_id (uuid): Associated account (nullable)

## customer_segments (Segment Mappings Dashboard)
- id (bigint): Primary key
- cio_segment_id (integer): Customer.io segment ID
- name (text): Segment name from Customer.io
- description (text): Segment description
- type (text): Segment type
- created_at (timestamptz): When segment was created
- last_synced_at (timestamptz): Last sync with Customer.io

## segment_mappings (Segment Mappings Dashboard)
- id (bigint): Primary key
- segment_id (integer): References customer_segments(cio_segment_id)
- segment_type (text): 'competition', 'discount', 'offer', or 'admin'
- auto_detected_type (text): Auto-detected type from segment name
- offer_id (text): Competition/discount/offer slug (e.g., 'win-kubecon-2024')
- account_id (uuid): Associated account (for offers only)
- sync (boolean): Whether this mapping is actively syncing
- notes (text): Admin notes about the mapping
- created_at (timestamptz): When mapping was created

## customer_segment_memberships (Competitions & Offers tracking)
- id (bigint): Primary key
- customer_cio_id (text): Customer.io ID
- segment_id (integer): References customer_segments(cio_segment_id)
- joined_at (timestamptz): When customer joined the segment
- last_verified_at (timestamptz): Last verification timestamp

## competition_winners
- id (integer): Primary key
- email (varchar): Winner email
- event_id (varchar): Event ID they won tickets to
- status (varchar): 'notified', 'accepted', 'declined', 'not_replied'
- created_at (timestamptz): When winner was selected
- notified_at (timestamptz): When winner was notified

# Data Model Architecture (HYBRID TRACKING MODE)

IMPORTANT: The system uses HYBRID TRACKING for competitions and offers:

## Competition Entries (Competitions Dashboard)
- Source of Truth: Customer.io segments via segment_mappings + customer_segment_memberships
- Process:
  1. Find competition segment: SELECT segment_id FROM segment_mappings WHERE offer_id = 'win-kubecon-2024' AND segment_type = 'competition'
  2. Count entries: SELECT COUNT(*) FROM customer_segment_memberships WHERE segment_id = <segment_id>
  3. Get entrants: JOIN customer_segment_memberships -> people via cio_id

## Discount Claimants (Discounts Dashboard)
- Source: discount_interactions table
- Process:
  1. Count claimants: SELECT COUNT(DISTINCT customer_cio_id) FROM discount_interactions WHERE offer_id = <slug> AND offer_status = 'accepted'
  2. Count codes: SELECT COUNT(*) FROM discount_codes WHERE event_id = <event_id> AND issued = true
  3. Available codes: total - issued

## Generic Offers (Offers Dashboard)
- Source: offer_interactions table
- Process:
  1. Get offer summary: SELECT offer_id, COUNT(DISTINCT customer_cio_id) as accepted_count FROM offer_interactions WHERE offer_status = 'accepted' GROUP BY offer_id
  2. Filter by account: WHERE account_id = <account_id>

## Segment Mappings (Segment Mappings Dashboard)
- Shows all Customer.io segments with their categorization
- Tracks which segments should sync (sync = true)
- Links segments to specific competitions/discounts/offers via offer_id

# Query Examples

## Members Dashboard Queries

Q: "How many people are in San Francisco?"
A: SELECT COUNT(*) as count FROM people WHERE attributes->>'city' ILIKE '%San Francisco%';

Q: "Where do most of our users live?"
A: SELECT attributes->>'city' as city, COUNT(*) as count FROM people
   WHERE attributes->>'city' IS NOT NULL AND attributes->>'city' != ''
   GROUP BY attributes->>'city'
   ORDER BY count DESC LIMIT 10;

Q: "Which companies have the most members?"
A: SELECT attributes->>'company' as company, COUNT(*) as count FROM people
   WHERE attributes->>'company' IS NOT NULL AND attributes->>'company' != ''
   GROUP BY attributes->>'company'
   ORDER BY count DESC LIMIT 10;

Q: "How many members have LinkedIn profiles?"
A: SELECT COUNT(*) as count FROM people
   WHERE attributes->>'linkedin_url' IS NOT NULL AND attributes->>'linkedin_url' != '';

Q: "How many members have avatars?"
A: SELECT COUNT(*) as count FROM people WHERE avatar_storage_path IS NOT NULL;

## Competitions Dashboard Queries

Q: "Which competition has had the most entries?"
A: SELECT sm.offer_id, COUNT(csm.id) as entry_count
   FROM segment_mappings sm
   JOIN customer_segment_memberships csm ON sm.segment_id = csm.segment_id
   WHERE sm.segment_type = 'competition' AND sm.sync = true
   GROUP BY sm.offer_id
   ORDER BY entry_count DESC LIMIT 1;

Q: "How many entries does win-kubecon-2024 have?"
A: SELECT COUNT(csm.id) as entry_count
   FROM segment_mappings sm
   JOIN customer_segment_memberships csm ON sm.segment_id = csm.segment_id
   WHERE sm.offer_id = 'win-kubecon-2024' AND sm.segment_type = 'competition';

Q: "Which member has entered the most competitions?"
A: SELECT csm.customer_cio_id, COUNT(DISTINCT sm.offer_id) as competition_count
   FROM customer_segment_memberships csm
   JOIN segment_mappings sm ON csm.segment_id = sm.segment_id
   WHERE sm.segment_type = 'competition' AND sm.sync = true
   GROUP BY csm.customer_cio_id
   ORDER BY competition_count DESC LIMIT 1;

Q: "How many competition winners haven't responded yet?"
A: SELECT COUNT(*) as count FROM competition_winners WHERE status = 'notified';

## Discounts Dashboard Queries

Q: "Which discount has been claimed the most?"
A: SELECT offer_id, COUNT(DISTINCT customer_cio_id) as claimant_count
   FROM discount_interactions
   WHERE offer_status = 'accepted'
   GROUP BY offer_id
   ORDER BY claimant_count DESC LIMIT 1;

Q: "How many discount codes are available for event-123?"
A: SELECT
     COUNT(*) FILTER (WHERE NOT issued) as available_codes,
     COUNT(*) FILTER (WHERE issued) as claimed_codes,
     COUNT(*) as total_codes
   FROM discount_codes
   WHERE event_id = 'event-123';

Q: "How many people registered using discount codes for event-123?"
A: SELECT COUNT(*) as registered_count FROM discount_codes
   WHERE event_id = 'event-123' AND registered = true;

Q: "How many people attended using discount codes for event-123?"
A: SELECT COUNT(*) as attended_count FROM discount_codes
   WHERE event_id = 'event-123' AND attended = true;

## Offers Dashboard Queries

Q: "Which offer has the most acceptances?"
A: SELECT offer_id, COUNT(DISTINCT customer_cio_id) as accepted_count
   FROM offer_interactions
   WHERE offer_status = 'accepted'
   GROUP BY offer_id
   ORDER BY accepted_count DESC LIMIT 1;

Q: "How many offers are there in total?"
A: SELECT COUNT(DISTINCT offer_id) as total_offers FROM offer_interactions;

## Segment Mappings Dashboard Queries

Q: "How many competition segments are actively syncing?"
A: SELECT COUNT(*) as count FROM segment_mappings
   WHERE segment_type = 'competition' AND sync = true;

Q: "Which segments are not mapped yet?"
A: SELECT cs.name, cs.cio_segment_id
   FROM customer_segments cs
   LEFT JOIN segment_mappings sm ON cs.cio_segment_id = sm.segment_id
   WHERE sm.id IS NULL;

Q: "How many members are in each segment type?"
A: SELECT sm.segment_type, COUNT(DISTINCT csm.customer_cio_id) as member_count
   FROM segment_mappings sm
   JOIN customer_segment_memberships csm ON sm.segment_id = csm.segment_id
   WHERE sm.sync = true
   GROUP BY sm.segment_type;

## Events & Registrations Queries

Q: "Which events have the most registrations?"
A: SELECT e.event_title, e.event_city, COUNT(er.id) as registrations
   FROM events e
   LEFT JOIN event_registrations er ON e.id = er.event_id
   GROUP BY e.id, e.event_title, e.event_city
   ORDER BY registrations DESC LIMIT 10;

Q: "How many events are in December 2024?"
A: SELECT COUNT(*) as count FROM events
   WHERE event_start >= '2024-12-01' AND event_start < '2025-01-01';

Q: "Which events are closing soon?"
A: SELECT event_title, offer_close_date
   FROM events
   WHERE offer_close_date > NOW() AND offer_close_date < NOW() + INTERVAL '7 days'
   ORDER BY offer_close_date ASC;

## Geographic Queries (Metro Areas)

Q: "How many members are in San Francisco and surrounding area?"
A: SELECT COUNT(*) as count FROM people
   WHERE attributes->>'city' ILIKE ANY(ARRAY['%San Francisco%', '%Oakland%', '%Berkeley%', '%San Jose%', '%Palo Alto%', '%Daly City%', '%South San Francisco%']);

Q: "How many members are in New York and surrounding area?"
A: SELECT COUNT(*) as count FROM people
   WHERE attributes->>'city' ILIKE ANY(ARRAY['%New York%', '%Brooklyn%', '%Queens%', '%Bronx%', '%Manhattan%', '%Jersey City%', '%Newark%']);

IMPORTANT: When users ask about a city "and surrounding area" or "metro area":
- Use your knowledge of geography to include ALL major cities in that metropolitan area
- Use the ILIKE ANY(ARRAY[...]) pattern with wildcards for multiple city matches
- Include suburbs, boroughs, and nearby cities within ~30 miles
- We do NOT have latitude/longitude data, so you must use city name matching
`

serve(async (req) => {
  try {
    // Handle CORS
    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } })
    }

    // Initialize Supabase admin client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Initialize OpenAI
    const openai = new OpenAI({
      apiKey: Deno.env.get('OPENAI_API_KEY'),
    })

    // Parse request
    const { query, model = 'gpt-3.5-turbo', conversationHistory = [] } = await req.json()

    console.log('Received query:', query)
    console.log('Using model:', model)

    // Step 0: Determine query type (analytical SQL vs semantic search)
    const queryTypePrompt = `Analyze this question and determine if it requires:
A) Analytical SQL query (counts, aggregations, filtering by exact fields)
B) Semantic search (finding similar profiles, similar events, matching by meaning/description)

Question: "${query}"

Examples of SQL queries:
- "How many members in San Francisco?"
- "Which companies have the most members?"
- "What events are happening in December?"

Examples of semantic search:
- "Find members with backgrounds similar to John Doe"
- "Show me events about AI and machine learning"
- "Find people who work in data science"

Respond with ONLY "SQL" or "SEMANTIC"`

    const queryTypeCompletion = await openai.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: queryTypePrompt }],
      temperature: 0.1,
    })

    const queryType = queryTypeCompletion.choices[0].message.content.trim().toUpperCase()
    console.log('Query type detected:', queryType)

    // Handle semantic search
    if (queryType === 'SEMANTIC') {
      return await handleSemanticSearch(query, model, openai, supabaseClient)
    }

    // Step 1: Generate SQL using GPT-4
    const sqlSystemPrompt = `You are a PostgreSQL expert. Convert natural language questions to SQL queries.

${DATABASE_SCHEMA}

CRITICAL RULES:
1. ONLY return the SQL query, nothing else. No explanations, no markdown, no formatting.
2. Use ONLY SELECT statements (read-only)
3. For person attributes in JSONB, use: attributes->>'field_name'
4. Use ILIKE for case-insensitive text matching with wildcards: ILIKE '%value%'
5. Always include LIMIT clause (max 100 rows unless aggregating)
6. For counts, use COUNT(*) and alias as 'count'
7. For groupings, always ORDER BY count DESC
8. Always filter out NULL and empty strings in WHERE clauses for JSONB fields
9. When joining tables, use proper LEFT/INNER JOIN syntax

Example output format (ONLY the SQL):
SELECT COUNT(*) as count FROM people WHERE attributes->>'city' ILIKE '%San Francisco%';`

    const sqlCompletion = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: sqlSystemPrompt },
        { role: 'user', content: query }
      ],
      temperature: 0.1,
    })

    let sqlQuery = sqlCompletion.choices[0].message.content.trim()

    // Clean up SQL query (remove markdown code blocks if present)
    sqlQuery = sqlQuery.replace(/```sql\n?/g, '').replace(/```\n?/g, '').trim()

    // Remove trailing semicolon if present (PostgreSQL functions don't accept it in EXECUTE)
    sqlQuery = sqlQuery.replace(/;+\s*$/g, '')

    console.log('Generated SQL:', sqlQuery)

    // Step 2: Validate SQL (basic safety checks)
    const lowerQuery = sqlQuery.toLowerCase()
    if (
      lowerQuery.includes('drop') ||
      lowerQuery.includes('delete') ||
      lowerQuery.includes('update') ||
      lowerQuery.includes('insert') ||
      lowerQuery.includes('alter') ||
      lowerQuery.includes('truncate') ||
      lowerQuery.includes('grant') ||
      lowerQuery.includes('revoke')
    ) {
      throw new Error('Only SELECT queries are allowed')
    }

    // Step 3: Execute SQL with read-only role
    let queryResults: any
    let finalSql = sqlQuery

    try {
      const { data, error } = await supabaseClient.rpc('execute_readonly_query', {
        query_text: sqlQuery
      })

      if (error) throw error
      queryResults = data
      console.log('Query results:', queryResults)

    } catch (error) {
      console.log('Query failed, attempting self-correction:', error.message)

      // Self-correction: Try to fix the query
      const correctionPrompt = `The following SQL query failed with this error:
Error: ${error.message}

Original query:
${sqlQuery}

Please fix the query and return ONLY the corrected SQL query with no explanation.`

      const correctionCompletion = await openai.chat.completions.create({
        model: model,
        messages: [
          { role: 'system', content: sqlSystemPrompt },
          { role: 'user', content: correctionPrompt }
        ],
        temperature: 0.1,
      })

      let correctedQuery = correctionCompletion.choices[0].message.content.trim()
      correctedQuery = correctedQuery.replace(/```sql\n?/g, '').replace(/```\n?/g, '').trim()

      // Remove trailing semicolon from corrected query too
      correctedQuery = correctedQuery.replace(/;+\s*$/g, '')

      console.log('Corrected SQL:', correctedQuery)

      // Try again with corrected query
      const { data: correctedData, error: correctedError } = await supabaseClient.rpc('execute_readonly_query', {
        query_text: correctedQuery
      })

      if (correctedError) {
        throw new Error(`Query failed after correction: ${correctedError.message}`)
      }

      queryResults = correctedData
      finalSql = correctedQuery
      console.log('Corrected query results:', queryResults)
    }

    // Step 4: Generate natural language answer from results
    const answerSystemPrompt = `You are a helpful data assistant. You have just executed a SQL query and received results.
Your job is to answer the user's question in natural, conversational language based on the query results.

Rules:
1. Be conversational and friendly
2. Include specific numbers and data points from the results
3. If results are empty, say so clearly
4. For lists, summarize the top items
5. Keep answers concise but informative
6. If showing a list, format it nicely with line breaks
7. IMPORTANT: If the query searched multiple cities (metro area query), LIST which cities were included in the search

Examples:
Q: "How many people in San Francisco?"
Results: [{"count": 127}]
A: "There are 127 people in San Francisco."

Q: "How many people in New York and surrounding area?"
SQL: SELECT COUNT(*) FROM people WHERE city ILIKE ANY(ARRAY['%New York%', '%Brooklyn%', '%Queens%', '%Jersey City%'])
Results: [{"count": 450}]
A: "There are 450 members in the New York metro area. This includes: New York, Brooklyn, Queens, and Jersey City."

Q: "Where do most users live?"
Results: [{"city": "San Francisco", "count": 127}, {"city": "New York", "count": 89}]
A: "The biggest concentration of users is in San Francisco with 127 members, followed by New York with 89 members."

Q: "Which events have the most registrations?"
Results: [{"event_title": "AI Summit 2024", "registrations": 450}, {"event_title": "DevCon", "registrations": 320}]
A: "AI Summit 2024 has the most registrations with 450 people signed up. DevCon comes in second with 320 registrations."`

    const answerCompletion = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: 'system', content: answerSystemPrompt },
        { role: 'user', content: `User question: "${query}"\n\nSQL query executed: ${finalSql}\n\nQuery results: ${JSON.stringify(queryResults, null, 2)}\n\nProvide a natural language answer. If the SQL query searched multiple cities, list which cities were included.` }
      ],
      temperature: 0.7, // Higher temperature for more natural responses
    })

    const naturalLanguageAnswer = answerCompletion.choices[0].message.content.trim()

    console.log('Natural language answer:', naturalLanguageAnswer)

    // Return response
    return new Response(
      JSON.stringify({
        answer: naturalLanguageAnswer,
        sql: finalSql,
        data: queryResults,
        rowCount: Array.isArray(queryResults) ? queryResults.length : 0
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({
        error: error.message,
        answer: `I encountered an error: ${error.message}. Please try rephrasing your question.`
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
})

// Semantic search handler
async function handleSemanticSearch(query: string, model: string, openai: any, supabaseClient: any) {
  try {
    // Generate embedding for the search query
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query,
    })

    const queryEmbedding = embeddingResponse.data[0].embedding

    // Determine if searching for people or events
    const targetPrompt = `What is this question asking for?
Question: "${query}"

Respond with ONLY "PEOPLE" if asking about members/people/profiles.
Respond with ONLY "EVENTS" if asking about events/conferences/meetups.`

    const targetCompletion = await openai.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: targetPrompt }],
      temperature: 0.1,
    })

    const searchTarget = targetCompletion.choices[0].message.content.trim().toUpperCase()
    console.log('Search target:', searchTarget)

    let results: any
    let searchType: string

    if (searchTarget === 'PEOPLE') {
      // Search similar people
      const { data, error } = await supabaseClient.rpc('search_similar_customers', {
        query_embedding: queryEmbedding,
        match_threshold: 0.5,
        match_count: 10
      })

      if (error) throw error
      results = data
      searchType = 'people'
    } else {
      // Search similar events
      const { data, error } = await supabaseClient.rpc('search_similar_events', {
        query_embedding: queryEmbedding,
        match_threshold: 0.5,
        match_count: 10
      })

      if (error) throw error
      results = data
      searchType = 'events'
    }

    // Generate natural language answer
    const answerPrompt = `Based on this semantic search for ${searchType}, provide a helpful natural language response.

Question: "${query}"
Results: ${JSON.stringify(results, null, 2)}

Format your response naturally, mentioning the top matches and their similarity scores (as percentages).`

    const answerCompletion = await openai.chat.completions.create({
      model: model,
      messages: [{ role: 'user', content: answerPrompt }],
      temperature: 0.7,
    })

    const answer = answerCompletion.choices[0].message.content.trim()

    return new Response(
      JSON.stringify({
        answer,
        searchType: 'semantic',
        target: searchType,
        data: results,
        rowCount: results.length
      }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  } catch (error) {
    console.error('Semantic search error:', error)
    return new Response(
      JSON.stringify({
        error: error.message,
        answer: `I encountered an error performing semantic search: ${error.message}`
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        }
      }
    )
  }
}
