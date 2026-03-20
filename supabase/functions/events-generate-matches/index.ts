import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Registrant {
  registration_id: string
  full_name: string
  job_title: string | null
  company: string | null
  email: string
}

interface MatchPair {
  indexA: number
  indexB: number
  score: number
  reason: string
  preceding_word_a: string
  preceding_word_b: string
}

// Heuristic fallback for preceding word determination
function getPrecedingWord(jobTitle: string | null): string {
  if (!jobTitle) return 'a'
  const t = jobTitle.trim().toLowerCase()
  // 'the' for unique/singular executive titles
  if (/^(ceo|cto|cfo|coo|cmo|cio|ciso|cpo|cro|chief\s|president|founder|co-founder|cofounder|head\s|vp\s|vice\s|director\s|director$)/.test(t)) {
    return 'the'
  }
  // 'an' for titles starting with a vowel sound
  if (/^[aeiou]/i.test(t)) {
    return 'an'
  }
  return 'a'
}

// Normalize company name for comparison — handles case, spaces, punctuation
// "LaunchDarkly" vs "launch darkly" vs "Launch Darkly" all match
function normalizeCompany(company: string | null): string {
  if (!company) return ''
  return company
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '') // strip all non-alphanumeric (spaces, dots, commas, hyphens)
}

function sameCompany(a: Registrant, b: Registrant): boolean {
  const ca = normalizeCompany(a.company)
  const cb = normalizeCompany(b.company)
  return ca !== '' && cb !== '' && ca === cb
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')
    if (!anthropicKey) throw new Error('ANTHROPIC_API_KEY not configured')

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { event_id } = await req.json()
    if (!event_id) {
      return new Response(JSON.stringify({ error: 'event_id is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get the event UUID (needed to look up speakers)
    const { data: eventRow, error: eventUuidError } = await supabase
      .from('events')
      .select('id')
      .eq('event_id', event_id)
      .single()

    if (eventUuidError || !eventRow) throw eventUuidError ?? new Error('Event not found')
    const eventUuid = eventRow.id

    // Fetch confirmed registrants — exclude Sponsor and Staff ticket types
    const { data: registrants, error: fetchError } = await supabase
      .from('events_registrations_with_people')
      .select('id, full_name, email, job_title, company')
      .eq('event_id', event_id)
      .eq('status', 'confirmed')
      .not('ticket_type', 'in', '("Sponsor","Staff")')

    if (fetchError) throw fetchError

    // Fetch confirmed speakers for this event — exclude them from matching
    const { data: speakers } = await supabase
      .from('events_speakers_with_details')
      .select('email')
      .eq('event_uuid', eventUuid)
      .eq('status', 'confirmed')

    const speakerEmails = new Set<string>(
      (speakers ?? []).map((s: any) => s.email?.toLowerCase()).filter(Boolean)
    )
    console.log(`Excluding ${speakerEmails.size} confirmed speakers from matching`)

    if (!registrants || registrants.length < 2) {
      return new Response(JSON.stringify({
        success: true,
        message: 'Not enough confirmed registrants to generate matches',
        pairs_created: 0,
        unmatched_count: registrants?.length ?? 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Clear existing pending matches for this event (preserve confirmed/rejected)
    const { error: deleteError } = await supabase
      .from('events_attendee_matches')
      .delete()
      .eq('event_id', event_id)
      .eq('status', 'pending')

    if (deleteError) throw deleteError

    // Build registrant list for AI (exclude any already confirmed/rejected)
    const { data: existingMatches } = await supabase
      .from('events_attendee_matches')
      .select('registration_a_id, registration_b_id')
      .eq('event_id', event_id)
      .in('status', ['confirmed', 'rejected'])

    const alreadyMatchedIds = new Set<string>()
    for (const m of existingMatches ?? []) {
      alreadyMatchedIds.add(m.registration_a_id)
      alreadyMatchedIds.add(m.registration_b_id)
    }

    // Check if a field has a real value (not empty, N/A, --, not applicable, etc.)
    const isRealValue = (val: string | null | undefined): boolean => {
      if (!val) return false
      const cleaned = val.trim().toLowerCase()
      if (!cleaned) return false
      // Reject if only non-alphanumeric characters (dashes, dots, spaces, etc.)
      if (!/[a-z0-9]/i.test(cleaned)) return false
      // Reject known placeholder values
      if (['n/a', 'na', 'n.a.', 'n.a', 'none', 'null', 'undefined', 'not applicable', 'not available', 'unknown', 'tbd', 'tba', 'test'].includes(cleaned)) return false
      return true
    }

    const available: Registrant[] = registrants
      .filter((r: any) => !alreadyMatchedIds.has(r.id))
      .filter((r: any) => !speakerEmails.has(r.email?.toLowerCase()))
      .filter((r: any) => isRealValue(r.full_name) && isRealValue(r.job_title) && isRealValue(r.company))
      .map((r: any) => ({
        registration_id: r.id,
        full_name: r.full_name ?? r.email,
        job_title: r.job_title ?? null,
        company: r.company ?? null,
        email: r.email,
      }))

    if (available.length < 2) {
      return new Response(JSON.stringify({
        success: true,
        message: 'All registrants are already matched',
        pairs_created: 0,
        unmatched_count: 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Call Claude to generate optimal pairings with preceding words
    const anthropic = new Anthropic({ apiKey: anthropicKey })

    const attendeeList = available.map((r, i) =>
      `${i}: ${r.full_name} — ${r.job_title ?? 'Unknown role'} at ${r.company ?? 'Unknown company'}`
    ).join('\n')

    const prompt = `You are an expert networking facilitator for professional events.

Create optimal 1:1 pairings for ALL ${available.length} event registrants. Every person must be matched — no one should be left without a pair (except one person if the total count is odd).

Pairing rules:
1. NEVER pair two people from the same company. This is the #1 most important rule — same-company pairs are strictly forbidden. They already know each other. The whole point is to introduce people who would NOT otherwise meet.
2. Match people where the conversation would be naturally interesting: similar seniority but different disciplines, or complementary roles (e.g. engineer + product manager, founder + investor, marketer + data scientist)
3. Score each pair 0.00–1.00 based on conversation potential
4. Write a short, specific reason (max 12 words) why this pair would have a good conversation
5. For each person, determine the correct preceding article for their job title:
   - "the" → unique/singular titles (CEO, CTO, CFO, COO, CMO, CIO, President, Founder, Co-Founder, Head of X, Director of X, VP of X)
   - "an" → titles starting with a vowel sound (e.g. "an Engineer", "an ML Engineer", "an Operations Manager")
   - "a" → everything else (e.g. "a Product Manager", "a Software Developer", "a Research Scientist")

Attendees (index: name — title at company):
${attendeeList}

Respond with a JSON object in this exact format:
{
  "pairs": [
    { "indexA": 0, "indexB": 3, "score": 0.87, "reason": "...", "preceding_word_a": "an", "preceding_word_b": "the" },
    ...
  ],
  "unmatched": []
}

CRITICAL RULES:
- NEVER pair two people from the same company. Check the company name for each person — if they match (even with different capitalization), do NOT pair them.
- You MUST include ALL ${available.length} attendees in pairs. The pairs array must have ${Math.floor(available.length / 2)} entries${available.length % 2 !== 0 ? ' (one person will be unmatched since the count is odd)' : ''}.
- Each index must appear EXACTLY ONCE across all pairs. Do not skip anyone, do not reuse an index.
- Return ONLY the JSON object, no other text.`

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 16000,
      messages: [{ role: 'user', content: prompt }],
    })

    const content = message.content[0]
    if (content.type !== 'text') throw new Error('Unexpected response type from Claude')

    // Check if response was truncated
    if (message.stop_reason === 'max_tokens') {
      console.error('Claude response was truncated! Response so far:', content.text.slice(-500))
      throw new Error(`AI response was truncated before completing (stop_reason=max_tokens). Try with fewer attendees or contact support.`)
    }

    let parsed: { pairs: MatchPair[]; unmatched?: number[] }
    try {
      const text = content.text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()
      parsed = JSON.parse(text)
    } catch (e) {
      const snippet = content.text.slice(-200)
      console.error('Failed to parse Claude response. Last 200 chars:', snippet)
      throw new Error(`Failed to parse AI matching response. Response ended with: ...${snippet}`)
    }

    // Build validated pairs from Claude's response
    const usedIndices = new Set<number>()
    const validPairs: { pair: MatchPair; idxA: number; idxB: number }[] = []
    const sameCompanyPairs: { pair: MatchPair; idxA: number; idxB: number }[] = []

    for (const pair of parsed.pairs) {
      if (pair.indexA < 0 || pair.indexA >= available.length) {
        console.warn(`Skipping out-of-bounds indexA=${pair.indexA}`)
        continue
      }
      if (pair.indexB < 0 || pair.indexB >= available.length) {
        console.warn(`Skipping out-of-bounds indexB=${pair.indexB}`)
        continue
      }
      if (pair.indexA === pair.indexB) {
        console.warn(`Skipping self-pair at index ${pair.indexA}`)
        continue
      }
      if (available[pair.indexA].email === available[pair.indexB].email) {
        console.warn(`Skipping same-person pair (email: ${available[pair.indexA].email})`)
        continue
      }
      if (usedIndices.has(pair.indexA) || usedIndices.has(pair.indexB)) {
        console.warn(`Skipping duplicate usage of index ${pair.indexA} or ${pair.indexB}`)
        continue
      }

      usedIndices.add(pair.indexA)
      usedIndices.add(pair.indexB)

      // Check same-company violation
      if (sameCompany(available[pair.indexA], available[pair.indexB])) {
        console.warn(`Same-company pair detected: ${available[pair.indexA].full_name} (${available[pair.indexA].company}) & ${available[pair.indexB].full_name} (${available[pair.indexB].company})`)
        sameCompanyPairs.push({ pair, idxA: pair.indexA, idxB: pair.indexB })
      } else {
        validPairs.push({ pair, idxA: pair.indexA, idxB: pair.indexB })
      }
    }

    // Fix same-company pairs by swapping person B between two bad pairs
    // e.g. if (A1, A2) and (B1, B2) are both same-company, try (A1, B2) and (B1, A2)
    const fixedPairs: { pair: MatchPair; idxA: number; idxB: number }[] = []
    const stillBroken: number[] = [] // indices to put back in the pool

    const badPairsCopy = [...sameCompanyPairs]
    const usedBadIdx = new Set<number>()

    for (let i = 0; i < badPairsCopy.length; i++) {
      if (usedBadIdx.has(i)) continue
      let fixed = false

      // Try swapping with another bad pair first
      for (let j = i + 1; j < badPairsCopy.length; j++) {
        if (usedBadIdx.has(j)) continue
        const p1 = badPairsCopy[i]
        const p2 = badPairsCopy[j]

        // Try swap: (p1.A, p2.B) and (p2.A, p1.B)
        if (!sameCompany(available[p1.idxA], available[p2.idxB]) &&
            !sameCompany(available[p2.idxA], available[p1.idxB])) {
          fixedPairs.push({ pair: { ...p1.pair, indexB: p2.idxB }, idxA: p1.idxA, idxB: p2.idxB })
          fixedPairs.push({ pair: { ...p2.pair, indexB: p1.idxB }, idxA: p2.idxA, idxB: p1.idxB })
          usedBadIdx.add(i)
          usedBadIdx.add(j)
          fixed = true
          break
        }
        // Try other swap direction: (p1.A, p2.A) and (p1.B, p2.B)
        if (!sameCompany(available[p1.idxA], available[p2.idxA]) &&
            !sameCompany(available[p1.idxB], available[p2.idxB])) {
          fixedPairs.push({ pair: { ...p1.pair, indexA: p1.idxA, indexB: p2.idxA }, idxA: p1.idxA, idxB: p2.idxA })
          fixedPairs.push({ pair: { ...p2.pair, indexA: p1.idxB, indexB: p2.idxB }, idxA: p1.idxB, idxB: p2.idxB })
          usedBadIdx.add(i)
          usedBadIdx.add(j)
          fixed = true
          break
        }
      }

      // If no bad-pair swap worked, try swapping with a valid pair
      if (!fixed) {
        const p1 = badPairsCopy[i]
        for (let v = 0; v < validPairs.length; v++) {
          const p2 = validPairs[v]
          if (!sameCompany(available[p1.idxA], available[p2.idxB]) &&
              !sameCompany(available[p2.idxA], available[p1.idxB])) {
            // Swap p1.B and p2.B
            fixedPairs.push({ pair: { ...p1.pair, indexB: p2.idxB }, idxA: p1.idxA, idxB: p2.idxB })
            validPairs[v] = { pair: { ...p2.pair, indexB: p1.idxB }, idxA: p2.idxA, idxB: p1.idxB }
            usedBadIdx.add(i)
            fixed = true
            break
          }
        }
      }

      if (!fixed) {
        // Could not fix — put both people back in the unmatched pool
        stillBroken.push(badPairsCopy[i].idxA, badPairsCopy[i].idxB)
        usedBadIdx.add(i)
      }
    }

    console.log(`Same-company pairs: ${sameCompanyPairs.length} detected, ${fixedPairs.length} fixed by swapping, ${stillBroken.length} people returned to pool`)

    // Build final row set
    const allFinalPairs = [...validPairs, ...fixedPairs]
    const rows = allFinalPairs.map(({ idxA, idxB, pair }) => ({
      event_id,
      registration_a_id: available[idxA].registration_id,
      registration_b_id: available[idxB].registration_id,
      match_score: pair.score,
      match_reason: pair.reason,
      preceding_word_a: pair.preceding_word_a ?? getPrecedingWord(available[idxA].job_title),
      preceding_word_b: pair.preceding_word_b ?? getPrecedingWord(available[idxB].job_title),
      status: 'pending',
    }))

    // Rebuild used indices from final pairs
    const finalUsedIndices = new Set<number>()
    for (const { idxA, idxB } of allFinalPairs) {
      finalUsedIndices.add(idxA)
      finalUsedIndices.add(idxB)
    }

    // Greedy cross-company fallback: pair anyone left unmatched (broken pairs + Claude misses)
    const remainingIndices = available
      .map((_, i) => i)
      .filter((i) => !finalUsedIndices.has(i))

    console.log(`Final matched: ${finalUsedIndices.size} people, ${remainingIndices.length} need fallback pairing`)

    // Sort remaining by company so we can interleave different companies
    remainingIndices.sort((a, b) =>
      normalizeCompany(available[a].company).localeCompare(normalizeCompany(available[b].company))
    )

    // Pair remaining with different companies where possible
    const fallbackUsed = new Set<number>()
    for (let i = 0; i < remainingIndices.length; i++) {
      if (fallbackUsed.has(i)) continue
      const idxA = remainingIndices[i]
      // Find best partner: first non-same-company person
      let bestJ = -1
      for (let j = i + 1; j < remainingIndices.length; j++) {
        if (fallbackUsed.has(j)) continue
        const idxB = remainingIndices[j]
        if (!sameCompany(available[idxA], available[idxB])) {
          bestJ = j
          break
        }
      }
      // If no cross-company match, take anyone
      if (bestJ === -1) {
        for (let j = i + 1; j < remainingIndices.length; j++) {
          if (!fallbackUsed.has(j)) { bestJ = j; break }
        }
      }
      if (bestJ === -1) continue
      const idxB = remainingIndices[bestJ]
      fallbackUsed.add(i)
      fallbackUsed.add(bestJ)
      rows.push({
        event_id,
        registration_a_id: available[idxA].registration_id,
        registration_b_id: available[idxB].registration_id,
        match_score: null as any,
        match_reason: null as any,
        preceding_word_a: getPrecedingWord(available[idxA].job_title),
        preceding_word_b: getPrecedingWord(available[idxB].job_title),
        status: 'pending',
      })
      finalUsedIndices.add(idxA)
      finalUsedIndices.add(idxB)
    }

    const trulyUnmatched = available
      .map((r, i) => ({ ...r, idx: i }))
      .filter(({ idx }) => !finalUsedIndices.has(idx))

    if (rows.length > 0) {
      const { error: insertError } = await supabase
        .from('events_attendee_matches')
        .insert(rows)

      if (insertError) throw insertError
    }

    const unmatchedRegistrants = trulyUnmatched.map((r) => ({
      registration_id: r.registration_id,
      full_name: r.full_name,
      job_title: r.job_title,
      company: r.company,
    }))

    return new Response(JSON.stringify({
      success: true,
      pairs_created: rows.length,
      unmatched_count: unmatchedRegistrants.length,
      unmatched: unmatchedRegistrants,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (error: any) {
    console.error('Error generating matches:', error)
    return new Response(JSON.stringify({ error: error.message ?? 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
