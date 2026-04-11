import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Portal-internal API for the Open RSVP self-serve flow.
 *
 * We route through here (rather than calling the edge function directly from
 * the browser) because the event-page component lives in an external module
 * source tree and Next.js `NEXT_PUBLIC_*` env inlining doesn't reach it
 * reliably during the portal build.
 *
 * Two actions:
 *   - load   → fetch link + event + sub-events + questions
 *   - submit → create the party + members + member-events + responses
 */

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

const BASE36 = 'abcdefghijklmnopqrstuvwxyz0123456789'

function generateShortCode(): string {
  const array = new Uint8Array(6)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => BASE36[b % 36]).join('')
}

function generateToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

interface SubmitMember {
  first_name?: string
  last_name?: string
  email?: string
  phone?: string
  rsvps: Array<{ sub_event_id: string | null; status: string }>
  answers?: Array<{ sub_event_id: string | null; question_id: string; answer: unknown }>
}

/**
 * Find an existing person by email (case-insensitive) or create a new one.
 * Returns the person_id. Guests created via open-rsvp are flagged
 * `is_guest = true` so the admin can tell them apart from full users.
 */
async function findOrCreatePerson(
  supabase: ReturnType<typeof getSupabase>,
  input: { email: string; first_name?: string; last_name?: string; phone?: string },
): Promise<string | null> {
  const email = input.email.toLowerCase().trim()
  if (!email) return null

  const { data: existing } = await supabase
    .from('people')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (existing) return (existing as { id: string }).id

  const attributes: Record<string, unknown> = {}
  if (input.first_name) attributes.first_name = input.first_name
  if (input.last_name) attributes.last_name = input.last_name

  const { data: newPerson, error: insertErr } = await supabase
    .from('people')
    .insert({
      email,
      phone: input.phone || null,
      attributes,
      is_guest: true,
    })
    .select('id')
    .single()

  if (insertErr || !newPerson) {
    console.error('[open-rsvp] Failed to create person:', insertErr)
    return null
  }

  // Also create the paired people_profiles row so the person appears in
  // admin views that JOIN against profiles. This is best-effort — if the
  // table has different columns or profile creation fails, we still keep
  // the person we just inserted.
  try {
    await supabase
      .from('people_profiles')
      .insert({ person_id: (newPerson as { id: string }).id })
  } catch { /* best-effort */ }

  return (newPerson as { id: string }).id
}

/**
 * Create an events_registrations row for a person/event pair, avoiding
 * duplicates. Returns the registration id (new or existing).
 */
async function ensureRegistration(
  supabase: ReturnType<typeof getSupabase>,
  input: { event_id: string; person_id: string; party_id: string },
): Promise<string | null> {
  const { data: existing } = await supabase
    .from('events_registrations')
    .select('id')
    .eq('event_id', input.event_id)
    .eq('person_id', input.person_id)
    .maybeSingle()

  if (existing) return (existing as { id: string }).id

  const { data: reg, error } = await supabase
    .from('events_registrations')
    .insert({
      event_id: input.event_id,
      person_id: input.person_id,
      registration_type: 'free',
      registration_source: 'invite',
      status: 'confirmed',
      registration_metadata: { party_id: input.party_id },
    })
    .select('id')
    .single()

  if (error || !reg) {
    console.error('[open-rsvp] Failed to create registration:', error)
    return null
  }

  return (reg as { id: string }).id
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, code } = body

    if (!code) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'code is required' }, { status: 400 })
    }

    const supabase = getSupabase()

    // Resolve the open link
    const { data: link } = await supabase
      .from('invite_open_links')
      .select('id, event_id, sub_event_id, short_code, label, is_active, max_members_per_party, expires_at')
      .eq('short_code', code)
      .maybeSingle()

    if (!link) {
      return NextResponse.json({ error: 'LINK_NOT_FOUND', message: 'This link is not valid.' }, { status: 404 })
    }
    if (!link.is_active) {
      return NextResponse.json({ error: 'LINK_DISABLED', message: 'This link has been disabled.' }, { status: 403 })
    }
    if (link.expires_at && new Date(link.expires_at) < new Date()) {
      return NextResponse.json({ error: 'LINK_EXPIRED', message: 'This link has expired.' }, { status: 403 })
    }

    if (action === 'load') {
      const { data: event } = await supabase
        .from('events')
        .select('id, event_title, event_start, event_end, event_location')
        .eq('id', link.event_id)
        .single()

      if (!event) {
        return NextResponse.json({ error: 'EVENT_NOT_FOUND', message: 'Event no longer available.' }, { status: 404 })
      }

      let subEventQuery = supabase
        .from('invite_sub_events')
        .select('id, name, description, starts_at, ends_at, rsvp_deadline, sort_order')
        .eq('event_id', link.event_id)
        .order('sort_order')
      if (link.sub_event_id) {
        subEventQuery = subEventQuery.eq('id', link.sub_event_id)
      }
      const { data: subEvents } = await subEventQuery

      const { data: questions } = await supabase
        .from('invite_questions')
        .select('id, sub_event_id, question_text, question_type, options, is_required, applies_to, sort_order')
        .eq('event_id', link.event_id)
        .order('sort_order')

      return NextResponse.json({
        link: {
          id: link.id,
          short_code: link.short_code,
          label: link.label,
          sub_event_id: link.sub_event_id,
          max_members_per_party: link.max_members_per_party,
        },
        event: {
          id: event.id,
          title: event.event_title,
          starts_at: event.event_start,
          ends_at: event.event_end,
          location: event.event_location,
        },
        sub_events: (subEvents || []).map((se) => ({
          id: se.id,
          name: se.name,
          description: se.description,
          starts_at: se.starts_at,
          ends_at: se.ends_at,
          rsvp_deadline: se.rsvp_deadline,
        })),
        questions: (questions || []).map((q) => ({
          id: q.id,
          sub_event_id: q.sub_event_id,
          question_text: q.question_text,
          question_type: q.question_type,
          options: q.options,
          is_required: q.is_required,
          applies_to: q.applies_to || 'all',
        })),
      })
    }

    if (action === 'submit') {
      const members: SubmitMember[] = body.members || []
      const partyName: string | undefined = body.party_name

      if (!Array.isArray(members) || members.length === 0) {
        return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'At least one member is required' }, { status: 400 })
      }
      if (members.length > (link.max_members_per_party || 10)) {
        return NextResponse.json(
          { error: 'TOO_MANY_MEMBERS', message: `Parties are limited to ${link.max_members_per_party} members on this link.` },
          { status: 400 },
        )
      }

      // Lead booker must have a valid email address
      const leadEmail = members[0]?.email?.trim() || ''
      if (!leadEmail) {
        return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'Your email address is required' }, { status: 400 })
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(leadEmail)) {
        return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'Please enter a valid email address' }, { status: 400 })
      }

      for (const m of members) {
        if (!m.first_name?.trim() && !m.last_name?.trim()) {
          return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'Every member must have a name' }, { status: 400 })
        }
        if (!Array.isArray(m.rsvps) || m.rsvps.length === 0) {
          return NextResponse.json(
            { error: 'VALIDATION_ERROR', message: 'Every member must RSVP to at least one event' },
            { status: 400 },
          )
        }
        for (const r of m.rsvps) {
          if (!['accepted', 'declined'].includes(r.status)) {
            return NextResponse.json({ error: 'VALIDATION_ERROR', message: `Invalid rsvp status: ${r.status}` }, { status: 400 })
          }
        }
      }

      // Generate unique party short code (retry on collision)
      let partyShortCode = ''
      for (let attempt = 0; attempt < 3; attempt++) {
        partyShortCode = generateShortCode()
        const { data: collision } = await supabase
          .from('invite_parties')
          .select('id')
          .eq('short_code', partyShortCode)
          .maybeSingle()
        if (!collision) break
        if (attempt === 2) {
          return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to generate unique code' }, { status: 500 })
        }
      }

      const leadName = members[0]
      const fallbackName = [leadName.first_name, leadName.last_name].filter(Boolean).join(' ') || 'Guest party'

      const nowIso = new Date().toISOString()
      const { data: party, error: partyErr } = await supabase
        .from('invite_parties')
        .insert({
          name: partyName?.trim() || fallbackName,
          token: generateToken(),
          short_code: partyShortCode,
          status: 'responded',
          responded_at: nowIso,
          open_link_id: link.id,
        })
        .select('id, short_code')
        .single()

      if (partyErr || !party) {
        console.error('[open-rsvp] Failed to create party:', partyErr)
        return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Failed to create party' }, { status: 500 })
      }

      for (let i = 0; i < members.length; i++) {
        const member = members[i]

        // Resolve or create a person record if an email was provided.
        // Every guest who submits with an email ends up in the people
        // table, regardless of whether they accepted or declined the
        // event. Only accepted members are written to events_registrations
        // further down.
        let personId: string | null = null
        const memberEmail = member.email?.toLowerCase().trim() || ''
        if (memberEmail) {
          personId = await findOrCreatePerson(supabase, {
            email: memberEmail,
            first_name: member.first_name?.trim(),
            last_name: member.last_name?.trim(),
            phone: member.phone?.trim(),
          })
        }

        const { data: partyMember, error: memberErr } = await supabase
          .from('invite_party_members')
          .insert({
            party_id: party.id,
            person_id: personId,
            first_name: member.first_name?.trim() || null,
            last_name: member.last_name?.trim() || null,
            email: memberEmail || null,
            phone: member.phone?.trim() || null,
            is_lead_booker: i === 0,
            sort_order: i,
          })
          .select('id')
          .single()

        if (memberErr || !partyMember) {
          console.error('[open-rsvp] Failed to create member:', memberErr)
          continue
        }

        // Track whether this member accepted ANY sub-event so we know
        // whether to create an event registration. A single accept is
        // enough — the registration is on the parent event, not the
        // sub-event.
        let memberAccepted = false

        // Create member-event rows keyed by sub-event
        const memberEventIdsBySubEvent = new Map<string, string>()
        for (const rsvp of member.rsvps) {
          const { data: me, error: meErr } = await supabase
            .from('invite_party_member_events')
            .insert({
              party_member_id: partyMember.id,
              event_id: link.event_id,
              sub_event_id: rsvp.sub_event_id,
              rsvp_status: rsvp.status,
              rsvp_responded_at: nowIso,
            })
            .select('id')
            .single()
          if (meErr || !me) {
            console.error('[open-rsvp] Failed to create member-event:', meErr)
            continue
          }
          memberEventIdsBySubEvent.set(rsvp.sub_event_id || '__event__', me.id)
          if (rsvp.status === 'accepted') memberAccepted = true
        }

        // Create an events_registrations row only if the member actually
        // accepted something AND we have a person record to link it to.
        // Declined and email-less guests stay out of the registration list.
        if (memberAccepted && personId) {
          const registrationId = await ensureRegistration(supabase, {
            event_id: link.event_id,
            person_id: personId,
            party_id: party.id,
          })
          // Link the registration back to each accepted member-event row
          // so the admin can jump from party → registration cleanly.
          if (registrationId) {
            for (const rsvp of member.rsvps) {
              if (rsvp.status !== 'accepted') continue
              const memberEventId = memberEventIdsBySubEvent.get(rsvp.sub_event_id || '__event__')
              if (!memberEventId) continue
              await supabase
                .from('invite_party_member_events')
                .update({ registration_id: registrationId })
                .eq('id', memberEventId)
            }
          }
        }

        // Upsert follow-up answers
        if (member.answers && member.answers.length > 0) {
          const responseRows = member.answers
            .map((a) => {
              const memberEventId = memberEventIdsBySubEvent.get(a.sub_event_id || '__event__')
              if (!memberEventId) return null
              return {
                party_member_event_id: memberEventId,
                question_id: a.question_id,
                answer: a.answer,
              }
            })
            .filter(Boolean) as Array<{ party_member_event_id: string; question_id: string; answer: unknown }>

          if (responseRows.length > 0) {
            const { error: responseErr } = await supabase
              .from('invite_responses')
              .upsert(responseRows, { onConflict: 'party_member_event_id,question_id' })
            if (responseErr) {
              console.error('[open-rsvp] Failed to insert responses:', responseErr)
            }
          }
        }
      }

      // Bump usage stats on the link (read-then-update; not atomic but fine
      // for low-contention self-serve submissions)
      const { data: currentLink } = await supabase
        .from('invite_open_links')
        .select('times_used')
        .eq('id', link.id)
        .single()
      await supabase
        .from('invite_open_links')
        .update({
          times_used: (currentLink?.times_used || 0) + 1,
          last_used_at: nowIso,
        })
        .eq('id', link.id)

      return NextResponse.json({
        success: true,
        party: { id: party.id, short_code: party.short_code },
      })
    }

    return NextResponse.json({ error: 'INVALID_ACTION', message: `Unknown action: ${action}` }, { status: 400 })
  } catch (err) {
    console.error('[open-rsvp] Error:', err)
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Internal server error' }, { status: 500 })
  }
}
