import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Portal-internal API for calendar-scoped talk submissions.
 *
 * Forwards to the speakers-public-api edge function. Lives in core because
 * Next.js API routes can only live in packages/portal/app/api/. Thin
 * server-side proxy — the real logic is in
 * modules/event-speakers/functions/speakers-public-api.
 */

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Supabase env vars missing')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function errorResponse(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
  return NextResponse.json(
    { data: null, error: { code, message, details } },
    { status }
  )
}

export async function POST(request: NextRequest) {
  let body: any
  try {
    body = await request.json()
  } catch {
    return errorResponse(400, 'INVALID_INPUT', 'Body must be valid JSON.')
  }

  const calendarSlug = body?.calendar_slug
  if (!calendarSlug || typeof calendarSlug !== 'string') {
    return errorResponse(400, 'INVALID_INPUT', 'calendar_slug is required.')
  }

  const supabase = getSupabase()

  // Invoke the speakers-public-api edge function
  const { data, error } = await supabase.functions.invoke(
    `speakers-public-api/calendars/${encodeURIComponent(calendarSlug)}/talks`,
    {
      method: 'POST',
      body: {
        speaker: body.speaker,
        talk: body.talk,
        captcha_token: body.captcha_token,
      },
    }
  )

  if (error) {
    console.error('[calendar-talks] speakers-public-api invoke failed:', error)
    return errorResponse(500, 'INTERNAL', 'Failed to submit talk. Please try again.')
  }

  return NextResponse.json(data)
}
