import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

const supabase = createClient(
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
)

interface SubmitResponse {
  member_event_id: string
  rsvp_status: string
  answers?: { question_id: string; answer: unknown }[]
}

interface NewPlusOne {
  first_name?: string
  last_name?: string
  event_ids: string[]
  rsvp_statuses: Record<string, string>
  answers?: { event_id: string; question_id: string; answer: unknown }[]
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action, token } = body

    if (!token) {
      return NextResponse.json({ error: 'VALIDATION_ERROR', message: 'Token is required' }, { status: 400 })
    }

    // Resolve party
    const field = token.length <= 12 ? 'short_code' : 'token'
    const { data: party } = await supabase
      .from('invite_parties')
      .select('id, name, status, max_plus_ones, plus_ones_added, version')
      .eq(field, token)
      .single()

    if (!party) {
      return NextResponse.json({ error: 'INVITE_NOT_FOUND', message: 'Invite not found' }, { status: 404 })
    }

    if (party.status === 'cancelled') {
      return NextResponse.json({ error: 'INVITE_CANCELLED', message: 'Invite cancelled' }, { status: 403 })
    }

    if (action === 'load') {
      // Get members
      const { data: members } = await supabase
        .from('invite_party_members')
        .select('id, first_name, last_name, email, is_lead_booker, is_plus_one, sort_order')
        .eq('party_id', party.id)
        .order('sort_order')

      const memberIds = (members || []).map(m => m.id)
      const { data: memberEvents } = await supabase
        .from('invite_party_member_events')
        .select('id, party_member_id, event_id, sub_event_id, rsvp_status, rsvp_deadline, rsvp_responded_at')
        .in('party_member_id', memberIds)

      const eventIds = [...new Set((memberEvents || []).map(me => me.event_id))]
      const { data: events } = eventIds.length > 0
        ? await supabase.from('events').select('id, event_title, event_start, event_end, event_location, event_slug').in('id', eventIds)
        : { data: [] }
      const eventMap = new Map((events || []).map(e => [e.id, e]))

      // Load sub-events
      const subEventIds = [...new Set((memberEvents || []).map(me => me.sub_event_id).filter(Boolean))]
      const { data: subEvents } = subEventIds.length > 0
        ? await supabase.from('invite_sub_events').select('id, name, description, starts_at, ends_at, rsvp_deadline').in('id', subEventIds)
        : { data: [] }
      const subEventMap = new Map((subEvents || []).map(se => [se.id, se]))

      const { data: questions } = eventIds.length > 0
        ? await supabase.from('invite_questions').select('*').in('event_id', eventIds).order('sort_order')
        : { data: [] }

      const memberEventIds = (memberEvents || []).map(me => me.id)
      const { data: responses } = memberEventIds.length > 0
        ? await supabase.from('invite_responses').select('party_member_event_id, question_id, answer').in('party_member_event_id', memberEventIds)
        : { data: [] }

      const responseMap = new Map<string, Map<string, unknown>>()
      for (const r of responses || []) {
        if (!responseMap.has(r.party_member_event_id)) responseMap.set(r.party_member_event_id, new Map())
        responseMap.get(r.party_member_event_id)!.set(r.question_id, r.answer)
      }

      const membersWithEvents = (members || []).map(member => ({
        id: member.id,
        first_name: member.first_name,
        last_name: member.last_name,
        is_lead_booker: member.is_lead_booker,
        is_plus_one: member.is_plus_one,
        events: (memberEvents || [])
          .filter(me => me.party_member_id === member.id)
          .map(me => {
            const event = eventMap.get(me.event_id)
            const subEvent = me.sub_event_id ? subEventMap.get(me.sub_event_id) : null
            return {
              member_event_id: me.id,
              event_id: me.event_id,
              sub_event_id: me.sub_event_id || null,
              // Use sub-event name/times if available, fall back to parent event
              event_title: subEvent?.name || event?.event_title || '',
              event_start: subEvent?.starts_at || event?.event_start || null,
              event_end: subEvent?.ends_at || event?.event_end || null,
              event_location: event?.event_location || null,
              event_slug: event?.event_slug || null,
              sub_event_name: subEvent?.name || null,
              rsvp_status: me.rsvp_status,
              rsvp_deadline: me.rsvp_deadline || subEvent?.rsvp_deadline || null,
              questions: (questions || [])
                .filter(q => {
                  if (q.event_id !== me.event_id) return false;
                  // Strict matching: sub-event questions only for that sub-event,
                  // parent-event questions only when member has no sub-event
                  if (me.sub_event_id) return q.sub_event_id === me.sub_event_id;
                  return !q.sub_event_id;
                })
                // Return all questions — client filters by applies_to based on live RSVP state
                .map(q => ({
                  id: q.id,
                  question_text: q.question_text,
                  question_type: q.question_type,
                  options: q.options,
                  is_required: q.is_required,
                  applies_to: q.applies_to || 'all',
                  current_answer: responseMap.get(me.id)?.get(q.id) ?? null,
                })),
            }
          }),
      }))

      // Mark as opened
      if (party.status === 'sent') {
        await supabase.from('invite_parties').update({ status: 'opened', opened_at: new Date().toISOString() }).eq('id', party.id)
      }

      // Track
      await supabase.from('event_invite_interactions').insert({ party_id: party.id, interaction_type: 'opened' }).then(() => {}, () => {})

      // Find the primary event identifier for redirect purposes
      const firstEvent = events?.[0]
      const eventIdentifier = firstEvent?.event_slug || firstEvent?.id || null

      return NextResponse.json({
        party: { ...party, status: party.status === 'sent' ? 'opened' : party.status },
        members: membersWithEvents,
        event_identifier: eventIdentifier,
      })
    }

    if (action === 'track') {
      await supabase.from('event_invite_interactions').insert({
        party_id: party.id,
        interaction_type: body.interaction_type || 'opened',
        ip_address: req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        user_agent: req.headers.get('user-agent') || null,
      })
      return NextResponse.json({ success: true })
    }

    if (action === 'submit') {
      // Optimistic locking
      if (body.version && body.version !== party.version) {
        return NextResponse.json({ error: 'VERSION_CONFLICT', message: 'Please reload and try again.' }, { status: 409 })
      }

      const responses: SubmitResponse[] = body.responses || []
      const newPlusOnes: NewPlusOne[] = body.new_plus_ones || []

      // Validate member_event_ids belong to this party
      const { data: partyMembers } = await supabase
        .from('invite_party_members')
        .select('id')
        .eq('party_id', party.id)

      const { data: validMemberEvents } = await supabase
        .from('invite_party_member_events')
        .select('id, party_member_id, event_id, rsvp_deadline')
        .in('party_member_id', (partyMembers || []).map(m => m.id))

      const validIds = new Set((validMemberEvents || []).map(me => me.id))
      const memberEventMap = new Map((validMemberEvents || []).map(me => [me.id, me]))

      for (const r of responses) {
        if (!validIds.has(r.member_event_id)) {
          return NextResponse.json({ error: 'INVALID_REFERENCE', message: 'Invalid member_event_id' }, { status: 400 })
        }
      }

      // Check deadlines
      const lockedEvents: string[] = []
      for (const r of responses) {
        const me = memberEventMap.get(r.member_event_id)
        if (me?.rsvp_deadline && new Date(me.rsvp_deadline) < new Date()) {
          lockedEvents.push(me.event_id)
        }
      }
      if (lockedEvents.length > 0) {
        return NextResponse.json({ error: 'DEADLINE_PASSED', locked_events: lockedEvents }, { status: 400 })
      }

      // Check plus-one limits
      if (newPlusOnes.length > 0) {
        const remaining = party.max_plus_ones - party.plus_ones_added
        if (newPlusOnes.length > remaining) {
          return NextResponse.json({ error: 'PLUS_ONE_LIMIT', message: `Max ${party.max_plus_ones} plus-ones` }, { status: 400 })
        }
      }

      // Apply RSVP updates
      const acceptedMembers = new Set<string>()
      const declinedMembers = new Set<string>()

      for (const r of responses) {
        await supabase
          .from('invite_party_member_events')
          .update({ rsvp_status: r.rsvp_status, rsvp_responded_at: new Date().toISOString() })
          .eq('id', r.member_event_id)

        const me = memberEventMap.get(r.member_event_id)
        if (me && r.rsvp_status === 'accepted') acceptedMembers.add(me.party_member_id)
        else if (me && r.rsvp_status === 'declined') declinedMembers.add(me.party_member_id)

        // Upsert answers
        for (const answer of r.answers || []) {
          await supabase
            .from('invite_responses')
            .upsert({
              party_member_event_id: r.member_event_id,
              question_id: answer.question_id,
              answer: answer.answer,
            }, { onConflict: 'party_member_event_id,question_id' })
        }

        // Create registration for accepted members
        if (r.rsvp_status === 'accepted') {
          const me = memberEventMap.get(r.member_event_id)
          if (me) {
            const { data: member } = await supabase
              .from('invite_party_members')
              .select('person_id')
              .eq('id', me.party_member_id)
              .single()

            if (member?.person_id) {
              const { data: existingReg } = await supabase
                .from('events_registrations')
                .select('id')
                .eq('event_id', me.event_id)
                .eq('person_id', member.person_id)
                .maybeSingle()

              if (!existingReg) {
                const { data: reg } = await supabase
                  .from('events_registrations')
                  .insert({
                    event_id: me.event_id,
                    person_id: member.person_id,
                    registration_type: 'free',
                    registration_source: 'invite',
                    status: 'confirmed',
                    registration_metadata: { party_id: party.id },
                  })
                  .select('id')
                  .single()

                if (reg) {
                  await supabase
                    .from('invite_party_member_events')
                    .update({ registration_id: reg.id })
                    .eq('id', r.member_event_id)
                }
              }
            }
          }
        }
      }

      // Create new plus-ones
      let plusOnesAdded = 0
      for (const po of newPlusOnes) {
        const { data: newMember } = await supabase
          .from('invite_party_members')
          .insert({
            party_id: party.id,
            first_name: po.first_name || null,
            last_name: po.last_name || null,
            is_lead_booker: false,
            is_plus_one: true,
            sort_order: 100 + plusOnesAdded,
          })
          .select('id')
          .single()

        if (!newMember) continue
        plusOnesAdded++

        for (const eventId of po.event_ids) {
          const rsvpStatus = po.rsvp_statuses?.[eventId] || 'accepted'
          const { data: newMemberEvent } = await supabase
            .from('invite_party_member_events')
            .insert({
              party_member_id: newMember.id,
              event_id: eventId,
              rsvp_status: rsvpStatus,
              rsvp_responded_at: new Date().toISOString(),
            })
            .select('id')
            .single()

          if (newMemberEvent && po.answers) {
            for (const answer of po.answers) {
              if (answer.event_id === eventId) {
                await supabase.from('invite_responses').insert({
                  party_member_event_id: newMemberEvent.id,
                  question_id: answer.question_id,
                  answer: answer.answer,
                })
              }
            }
          }
          if (rsvpStatus === 'accepted') acceptedMembers.add(newMember.id)
        }
      }

      // Update party status
      const { data: allME } = await supabase
        .from('invite_party_member_events')
        .select('rsvp_status')
        .in('party_member_id', (partyMembers || []).map(m => m.id))

      const allStatuses = (allME || []).map(me => me.rsvp_status)
      const allResponded = allStatuses.every(s => s !== 'pending')
      const someResponded = allStatuses.some(s => s !== 'pending')
      const newStatus = allResponded ? 'responded' : someResponded ? 'partially_responded' : party.status

      await supabase
        .from('invite_parties')
        .update({
          status: newStatus,
          responded_at: new Date().toISOString(),
          plus_ones_added: party.plus_ones_added + plusOnesAdded,
          version: party.version + 1,
        })
        .eq('id', party.id)

      return NextResponse.json({
        success: true,
        version: party.version + 1,
        summary: { accepted: acceptedMembers.size, declined: declinedMembers.size, plus_ones_added: plusOnesAdded },
      })
    }

    return NextResponse.json({ error: 'INVALID_ACTION' }, { status: 400 })
  } catch (error) {
    console.error('[invite-rsvp] Error:', error)
    return NextResponse.json({ error: 'INTERNAL_ERROR', message: 'Internal server error' }, { status: 500 })
  }
}
