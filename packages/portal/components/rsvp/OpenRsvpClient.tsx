'use client'

import { useState, useEffect, useCallback } from 'react'

interface SubEvent {
  id: string
  name: string
  description: string | null
  starts_at: string | null
  ends_at: string | null
  rsvp_deadline: string | null
}

interface Question {
  id: string
  sub_event_id: string | null
  question_text: string
  question_type: 'select' | 'multi_select' | 'text' | 'yes_no'
  options: string[] | null
  is_required: boolean
  applies_to: 'all' | 'accepted_only'
}

interface LoadResponse {
  link: {
    id: string
    short_code: string
    label: string | null
    sub_event_id: string | null
    max_members_per_party: number
  }
  event: {
    id: string
    title: string
    starts_at: string | null
    ends_at: string | null
    location: string | null
  }
  sub_events: SubEvent[]
  questions: Question[]
}

interface MemberDraft {
  first_name: string
  last_name: string
  email: string
  phone: string
  // keyed by sub_event_id ('' for event-level) → 'accepted' | 'declined' | 'maybe' | ''
  rsvps: Record<string, string>
  // keyed by `${sub_event_id || ''}:${question_id}` → answer value
  answers: Record<string, unknown>
}

interface Props {
  code: string
  primaryColor: string
  brandName: string
}

function emptyMember(): MemberDraft {
  return {
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    rsvps: {},
    answers: {},
  }
}

function formatWhen(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function OpenRsvpClient({ code, primaryColor }: Props) {
  const [data, setData] = useState<LoadResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const [partyName, setPartyName] = useState('')
  const [members, setMembers] = useState<MemberDraft[]>([emptyMember()])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const res = await fetch(`${supabaseUrl}/functions/v1/event-invite-rsvp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ action: 'open-link-load', code }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.message || 'Failed to load invitation.')
        return
      }
      setData(body as LoadResponse)
    } catch {
      setError('Failed to load invitation.')
    } finally {
      setLoading(false)
    }
  }, [code])

  useEffect(() => {
    load()
  }, [load])

  const updateMember = (idx: number, patch: Partial<MemberDraft>) => {
    setMembers(prev => prev.map((m, i) => (i === idx ? { ...m, ...patch } : m)))
  }

  const setMemberRsvp = (idx: number, subEventId: string, status: string) => {
    setMembers(prev =>
      prev.map((m, i) =>
        i === idx ? { ...m, rsvps: { ...m.rsvps, [subEventId]: status } } : m,
      ),
    )
  }

  const setMemberAnswer = (idx: number, subEventId: string, questionId: string, value: unknown) => {
    const key = `${subEventId}:${questionId}`
    setMembers(prev =>
      prev.map((m, i) => (i === idx ? { ...m, answers: { ...m.answers, [key]: value } } : m)),
    )
  }

  const addMember = () => setMembers(prev => [...prev, emptyMember()])
  const removeMember = (idx: number) => setMembers(prev => prev.filter((_, i) => i !== idx))

  // Only show the questions for a given sub-event if the member accepted (or
  // maybe'd) that sub-event, or the question is flagged `all`.
  const questionsFor = (subEventId: string | null): Question[] => {
    if (!data) return []
    return data.questions
      .filter(q => q.sub_event_id === subEventId || q.sub_event_id === null)
      .sort((a, b) => a.question_text.localeCompare(b.question_text))
  }

  const handleSubmit = async () => {
    if (!data) return
    setError(null)

    // Validate per member: must have a name and at least one rsvp
    const isSingleSubEvent = data.sub_events.length === 1
    for (let i = 0; i < members.length; i++) {
      const m = members[i]
      if (!m.first_name.trim() && !m.last_name.trim()) {
        setError(`Member ${i + 1} needs a name`)
        return
      }
      const rsvpEntries = Object.entries(m.rsvps).filter(([, status]) => !!status)
      if (rsvpEntries.length === 0) {
        setError(`${m.first_name || 'Member ' + (i + 1)} hasn't RSVP'd to any event`)
        return
      }
      // Validate required questions for accepted/maybe sub-events
      for (const [subEventId, status] of rsvpEntries) {
        if (status !== 'accepted' && status !== 'maybe') continue
        const qs = questionsFor(subEventId || null)
        for (const q of qs) {
          if (!q.is_required) continue
          if (q.applies_to === 'accepted_only' && status !== 'accepted') continue
          const ans = m.answers[`${subEventId}:${q.id}`]
          const empty =
            ans === undefined ||
            ans === null ||
            ans === '' ||
            (Array.isArray(ans) && ans.length === 0)
          if (empty) {
            setError(`"${q.question_text}" is required for ${m.first_name || 'a member'}`)
            return
          }
        }
      }
    }

    setSubmitting(true)
    try {
      // Build payload shaped for the edge function
      const payloadMembers = members.map(m => {
        const rsvps: Array<{ sub_event_id: string | null; status: string }> = []
        const answers: Array<{ sub_event_id: string | null; question_id: string; answer: unknown }> = []

        for (const [subEventId, status] of Object.entries(m.rsvps)) {
          if (!status) continue
          rsvps.push({ sub_event_id: subEventId || null, status })
          const qs = questionsFor(subEventId || null)
          for (const q of qs) {
            const key = `${subEventId}:${q.id}`
            if (m.answers[key] !== undefined && m.answers[key] !== '' && m.answers[key] !== null) {
              answers.push({
                sub_event_id: subEventId || null,
                question_id: q.id,
                answer: m.answers[key],
              })
            }
          }
        }

        return {
          first_name: m.first_name.trim(),
          last_name: m.last_name.trim(),
          email: m.email.trim() || undefined,
          phone: m.phone.trim() || undefined,
          rsvps,
          answers,
        }
      })

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      const res = await fetch(`${supabaseUrl}/functions/v1/event-invite-rsvp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${anonKey}`,
          apikey: anonKey,
        },
        body: JSON.stringify({
          action: 'open-link-submit',
          code,
          party_name: partyName.trim() || undefined,
          members: payloadMembers,
        }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.message || 'Failed to submit.')
        return
      }
      setSubmitted(true)
    } catch {
      setError('Failed to submit.')
    } finally {
      setSubmitting(false)
    }
    // isSingleSubEvent not referenced at runtime — kept for future use
    void isSingleSubEvent
  }

  if (loading) {
    return <div className="py-12 text-center text-gray-300">Loading invitation...</div>
  }

  if (error && !data) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Can&apos;t load this invitation</h1>
        <p className="text-gray-600">{error}</p>
      </div>
    )
  }

  if (!data) return null

  if (submitted) {
    return (
      <div className="bg-white rounded-lg shadow-lg p-8 text-center">
        <div
          className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
          style={{ backgroundColor: `${primaryColor}22` }}
        >
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke={primaryColor} strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">Thank you!</h1>
        <p className="text-gray-600">Your RSVP has been recorded.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 md:p-8 space-y-6">
      {/* Event header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{data.event.title}</h1>
        {data.event.location && <p className="text-sm text-gray-600 mt-1">{data.event.location}</p>}
        {data.event.starts_at && (
          <p className="text-sm text-gray-600">{formatWhen(data.event.starts_at)}</p>
        )}
      </div>

      {/* Party name (optional) */}
      <div>
        <label className="block text-sm font-medium text-gray-900 mb-1">
          Party name <span className="text-gray-500 font-normal">(optional)</span>
        </label>
        <input
          type="text"
          value={partyName}
          onChange={e => setPartyName(e.target.value)}
          placeholder="e.g. The Smith family"
          className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-offset-1"
          style={{ borderColor: '#d1d5db' }}
        />
      </div>

      {/* Members */}
      {members.map((member, idx) => (
        <div key={idx} className="border border-gray-200 rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-gray-900">
              {idx === 0 ? 'You' : `Party member ${idx + 1}`}
            </h2>
            {members.length > 1 && (
              <button
                type="button"
                onClick={() => removeMember(idx)}
                className="text-sm text-red-600 hover:text-red-800"
              >
                Remove
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">First name</label>
              <input
                type="text"
                value={member.first_name}
                onChange={e => updateMember(idx, { first_name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Last name</label>
              <input
                type="text"
                value={member.last_name}
                onChange={e => updateMember(idx, { last_name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
              />
            </div>
            {idx === 0 && (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Email <span className="text-gray-500 font-normal">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={member.email}
                    onChange={e => updateMember(idx, { email: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-1">
                    Phone <span className="text-gray-500 font-normal">(optional)</span>
                  </label>
                  <input
                    type="tel"
                    value={member.phone}
                    onChange={e => updateMember(idx, { phone: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                  />
                </div>
              </>
            )}
          </div>

          {/* RSVP per sub-event (or single event-level RSVP) */}
          <div className="space-y-3">
            {(data.sub_events.length === 0
              ? [{ id: '', name: data.event.title, description: null, starts_at: data.event.starts_at, ends_at: null, rsvp_deadline: null } as SubEvent]
              : data.sub_events
            ).map(se => {
              const currentStatus = member.rsvps[se.id] || ''
              const qs = currentStatus === 'accepted' || currentStatus === 'maybe'
                ? questionsFor(se.id || null).filter(q =>
                    q.applies_to === 'all' || currentStatus === 'accepted',
                  )
                : []
              return (
                <div key={se.id || 'event'} className="rounded-md border border-gray-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900">{se.name}</p>
                      {se.starts_at && (
                        <p className="text-xs text-gray-600 mt-0.5">{formatWhen(se.starts_at)}</p>
                      )}
                      {se.description && (
                        <p className="text-xs text-gray-600 mt-1">{se.description}</p>
                      )}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      {(['accepted', 'declined', 'maybe'] as const).map(status => {
                        const isSelected = currentStatus === status
                        return (
                          <button
                            key={status}
                            type="button"
                            onClick={() => setMemberRsvp(idx, se.id, status)}
                            className="px-2.5 py-1 text-xs rounded-md border font-medium transition-colors"
                            style={
                              isSelected
                                ? { backgroundColor: primaryColor, color: '#fff', borderColor: primaryColor }
                                : { backgroundColor: '#fff', color: '#374151', borderColor: '#d1d5db' }
                            }
                          >
                            {status === 'accepted' ? 'Yes' : status === 'declined' ? 'No' : 'Maybe'}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Follow-up questions, shown only when accepted/maybe */}
                  {qs.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
                      {qs.map(q => {
                        const ansKey = `${se.id}:${q.id}`
                        const value = member.answers[ansKey]
                        return (
                          <div key={q.id}>
                            <label className="block text-xs font-medium text-gray-700 mb-1">
                              {q.question_text}
                              {q.is_required && <span className="text-red-500 ml-1">*</span>}
                            </label>
                            {q.question_type === 'select' && (
                              <select
                                value={(value as string) || ''}
                                onChange={e => setMemberAnswer(idx, se.id, q.id, e.target.value)}
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md"
                              >
                                <option value="">Select an option</option>
                                {(q.options || []).map(opt => (
                                  <option key={opt} value={opt}>{opt}</option>
                                ))}
                              </select>
                            )}
                            {q.question_type === 'multi_select' && (
                              <div className="space-y-1">
                                {(q.options || []).map(opt => {
                                  const arr = Array.isArray(value) ? (value as string[]) : []
                                  const checked = arr.includes(opt)
                                  return (
                                    <label key={opt} className="flex items-center gap-2 text-sm text-gray-900 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={e => {
                                          const next = e.target.checked ? [...arr, opt] : arr.filter(x => x !== opt)
                                          setMemberAnswer(idx, se.id, q.id, next)
                                        }}
                                      />
                                      {opt}
                                    </label>
                                  )
                                })}
                              </div>
                            )}
                            {q.question_type === 'yes_no' && (
                              <div className="flex gap-2">
                                {['yes', 'no'].map(v => {
                                  const isSelected = value === v
                                  return (
                                    <button
                                      key={v}
                                      type="button"
                                      onClick={() => setMemberAnswer(idx, se.id, q.id, v)}
                                      className="px-3 py-1.5 text-sm rounded-md border"
                                      style={
                                        isSelected
                                          ? { backgroundColor: primaryColor, color: '#fff', borderColor: primaryColor }
                                          : { backgroundColor: '#fff', color: '#374151', borderColor: '#d1d5db' }
                                      }
                                    >
                                      {v.charAt(0).toUpperCase() + v.slice(1)}
                                    </button>
                                  )
                                })}
                              </div>
                            )}
                            {q.question_type === 'text' && (
                              <textarea
                                value={(value as string) || ''}
                                onChange={e => setMemberAnswer(idx, se.id, q.id, e.target.value)}
                                rows={2}
                                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-md resize-y"
                              />
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {/* Add-member button */}
      {members.length < data.link.max_members_per_party && (
        <button
          type="button"
          onClick={addMember}
          className="w-full py-2 text-sm font-medium border border-dashed border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          + Add another person
        </button>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded-md p-3">{error}</div>
      )}

      <button
        type="button"
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full py-3 text-sm font-semibold text-white rounded-md disabled:opacity-60"
        style={{ backgroundColor: primaryColor }}
      >
        {submitting ? 'Submitting...' : 'Submit RSVP'}
      </button>
    </div>
  )
}
