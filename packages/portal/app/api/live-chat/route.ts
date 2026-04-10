import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Force dynamic so Next.js doesn't try to collect page data at build time
export const dynamic = 'force-dynamic'

// Service role client for DB writes (lazy so build-time page data collection
// doesn't fail when env vars aren't set)
let _serviceSupabase: ReturnType<typeof createClient> | null = null
function getServiceSupabase() {
  if (!_serviceSupabase) {
    _serviceSupabase = createClient(
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    )
  }
  return _serviceSupabase
}

async function getAuthenticatedPersonId(): Promise<string | null> {
  try {
    const publicUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const internalUrl = process.env.SUPABASE_URL || publicUrl
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const cookieStore = await cookies()

    const authClient = createServerClient(publicUrl, anonKey, {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll() {},
      },
      ...(internalUrl !== publicUrl ? {
        global: {
          fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
            return fetch(url.replace(publicUrl, internalUrl), init)
          },
        },
      } : {}),
    })

    const { data: { user } } = await authClient.auth.getUser()
    if (!user?.id) return null

    const { data: person } = await getServiceSupabase()
      .from('people')
      .select('id')
      .eq('auth_user_id', user.id)
      .maybeSingle()

    return person?.id || null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    const personId = await getAuthenticatedPersonId()
    if (!personId) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    if (action === 'send') {
      const { event_id, track_id, content, reply_to_id } = body

      if (!event_id || !track_id || !content?.trim()) {
        return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
      }

      if (content.length > 1000) {
        return NextResponse.json({ error: 'Message too long (max 1000 chars)' }, { status: 400 })
      }

      // Check if user is blocked
      const { data: blocked } = await getServiceSupabase()
        .from('live_chat_blocked_users')
        .select('id')
        .eq('event_id', event_id)
        .eq('person_id', personId)
        .maybeSingle()

      if (blocked) {
        return NextResponse.json({ error: 'You have been muted' }, { status: 403 })
      }

      const { data: msg, error } = await getServiceSupabase()
        .from('live_chat_messages')
        .insert({
          event_id,
          track_id,
          person_id: personId,
          content: content.trim(),
          reply_to_id: reply_to_id || null,
        })
        .select('id, is_deleted, content, moderation_flags')
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      return NextResponse.json({
        success: true,
        id: msg.id,
        is_deleted: msg.is_deleted,
        auto_moderated: !!(msg.moderation_flags as any)?.auto_moderated,
      })
    }

    if (action === 'react') {
      const { message_id, reaction_type } = body

      // Try insert — if duplicate, toggle off
      const { error } = await getServiceSupabase()
        .from('live_chat_reactions')
        .insert({ message_id, person_id: personId, reaction_type })

      if (error?.code === '23505') {
        // Duplicate — remove (toggle off)
        await getServiceSupabase()
          .from('live_chat_reactions')
          .delete()
          .eq('message_id', message_id)
          .eq('person_id', personId)
          .eq('reaction_type', reaction_type)

        return NextResponse.json({ success: true, toggled: 'off' })
      }

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      return NextResponse.json({ success: true, toggled: 'on' })
    }

    if (action === 'edit') {
      const { message_id, content } = body
      if (!message_id || !content?.trim()) {
        return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
      }
      if (content.length > 1000) {
        return NextResponse.json({ error: 'Message too long' }, { status: 400 })
      }

      // Verify the message belongs to this user
      const { data: msg } = await getServiceSupabase()
        .from('live_chat_messages')
        .select('person_id')
        .eq('id', message_id)
        .single()

      if (!msg || msg.person_id !== personId) {
        return NextResponse.json({ error: 'Not your message' }, { status: 403 })
      }

      const { error } = await getServiceSupabase()
        .from('live_chat_messages')
        .update({ content: content.trim(), is_edited: true })
        .eq('id', message_id)

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      return NextResponse.json({ success: true })
    }

    if (action === 'check-blocked') {
      const { event_id, known_message_ids } = body
      if (!event_id) return NextResponse.json({ blocked: false })

      const { data: blockData } = await getServiceSupabase()
        .from('live_chat_blocked_users')
        .select('id')
        .eq('event_id', event_id)
        .eq('person_id', personId)
        .maybeSingle()

      // Check which of the client's known messages have been deleted
      let deleted_message_ids: string[] = []
      if (known_message_ids?.length > 0) {
        const { data: deletedMsgs } = await getServiceSupabase()
          .from('live_chat_messages')
          .select('id')
          .in('id', known_message_ids.slice(0, 500))
          .eq('is_deleted', true)

        deleted_message_ids = (deletedMsgs || []).map(m => m.id)
      }

      return NextResponse.json({ blocked: !!blockData, deleted_message_ids })
    }

    if (action === 'log-viewer') {
      const { event_id, viewer_action } = body
      if (!event_id || !['join', 'leave'].includes(viewer_action)) {
        return NextResponse.json({ error: 'Invalid' }, { status: 400 })
      }
      await getServiceSupabase().from('live_event_viewer_log').insert({
        event_id, person_id: personId, action: viewer_action,
      })
      return NextResponse.json({ success: true })
    }

    if (action === 'get-viewer-stats') {
      const { event_id } = body
      if (!event_id) return NextResponse.json({ error: 'Missing event_id' }, { status: 400 })

      // Total unique viewers
      const { data: uniqueViewers } = await getServiceSupabase()
        .from('live_event_viewer_log')
        .select('person_id')
        .eq('event_id', event_id)
        .eq('action', 'join')

      const totalUnique = new Set((uniqueViewers || []).map(v => v.person_id)).size

      // Join timeline (bucketed by minute)
      const { data: timeline } = await getServiceSupabase()
        .from('live_event_viewer_log')
        .select('action, created_at')
        .eq('event_id', event_id)
        .order('created_at')

      // Build minute-by-minute concurrent viewer count
      const buckets: { time: string; viewers: number }[] = []
      let concurrent = 0
      const minuteMap = new Map<string, number>()

      for (const entry of timeline || []) {
        if (entry.action === 'join') concurrent++
        else concurrent = Math.max(0, concurrent - 1)
        const minute = entry.created_at.slice(0, 16) // YYYY-MM-DDTHH:MM
        minuteMap.set(minute, concurrent)
      }

      for (const [time, viewers] of minuteMap) {
        buckets.push({ time, viewers })
      }

      return NextResponse.json({ total_unique: totalUnique, current: concurrent, timeline: buckets })
    }

    if (action === 'get-pinned') {
      const { event_id, track_id } = body
      const { data } = await getServiceSupabase()
        .from('live_chat_pinned_messages')
        .select('id, message_id, pinned_at, live_chat_messages!inner(content, track_id)')
        .eq('event_id', event_id)
        .order('pinned_at', { ascending: false })

      const pinned = (data || [])
        .filter((p: any) => p.live_chat_messages?.track_id === track_id)
        .map((p: any) => ({
          id: p.id,
          message_id: p.message_id,
          content: p.live_chat_messages?.content || '',
          pinned_at: p.pinned_at,
        }))

      return NextResponse.json({ pinned })
    }

    if (action === 'lookup-names') {
      const { person_ids } = body
      if (!Array.isArray(person_ids) || person_ids.length === 0) {
        return NextResponse.json({ names: {} })
      }
      // Limit to 100 at a time
      const ids = person_ids.slice(0, 100)
      const { data: people } = await getServiceSupabase()
        .from('people')
        .select('id, email, attributes')
        .in('id', ids)

      const names: Record<string, string> = {}
      for (const p of people || []) {
        const attrs = (p.attributes || {}) as Record<string, string>
        names[p.id] = [attrs.first_name, attrs.last_name].filter(Boolean).join(' ') || p.email || 'Anonymous'
      }
      return NextResponse.json({ names })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('[live-chat] Error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
