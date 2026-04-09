'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'

interface Question {
  id: string
  question_text: string
  question_type: 'select' | 'multi_select' | 'text' | 'yes_no'
  options: string[] | null
  is_required: boolean
  applies_to: 'all' | 'accepted_only'
  current_answer: unknown
}

interface MemberEvent {
  member_event_id: string
  event_id: string
  event_title: string
  event_start: string | null
  event_end: string | null
  event_location: string | null
  rsvp_status: string
  rsvp_deadline: string | null
  linked_rsvp: boolean
  questions: Question[]
}

interface Member {
  id: string
  first_name: string | null
  last_name: string | null
  is_lead_booker: boolean
  is_plus_one: boolean
  events: MemberEvent[]
}

interface Party {
  id: string
  name: string
  status: string
  max_plus_ones: number
  plus_ones_added: number
  version: number
}

interface RsvpEntry {
  rsvp_status: string
  answers: Record<string, unknown>
}

interface NewPlusOne {
  first_name: string
  last_name: string
  event_ids: string[]
  rsvp_statuses: Record<string, string>
  answers: { event_id: string; question_id: string; answer: unknown }[]
}

interface Props {
  eventIdentifier?: string
  primaryColor: string
  brandName: string
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${days[d.getUTCDay()]}, ${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} at ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

function isDeadlinePassed(deadline: string | null): boolean {
  if (!deadline) return false
  return new Date(deadline) < new Date()
}

function getMemberName(m: { first_name: string | null; last_name: string | null }): string {
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || 'Guest'
}

export function RsvpPageClient({ primaryColor, brandName }: Props) {
  const [party, setParty] = useState<Party | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [noToken, setNoToken] = useState(false)
  const [rsvpData, setRsvpData] = useState<Record<string, RsvpEntry>>({})
  const [plusOnes, setPlusOnes] = useState<NewPlusOne[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [submitResult, setSubmitResult] = useState<Record<string, number> | null>(null)
  const [error, setError] = useState<string | null>(null)

  const searchParams = useSearchParams()

  useEffect(() => {
    const inviteParam = searchParams.get('invite')
    if (inviteParam) {
      localStorage.setItem('invite_short_code', inviteParam)
    }
  }, [searchParams])

  const loadParty = useCallback(async () => {
    const token = searchParams.get('invite') || localStorage.getItem('invite_short_code')
    if (token) {
      localStorage.setItem('invite_short_code', token)
    }
    if (!token) {
      setNoToken(true)
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/invite-rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'load', token }),
      })

      if (!res.ok) {
        setNoToken(true)
        setLoading(false)
        return
      }

      const data = await res.json()
      setParty(data.party)
      setMembers(data.members || [])

      const initial: Record<string, RsvpEntry> = {}
      for (const member of data.members || []) {
        for (const event of member.events) {
          const answers: Record<string, unknown> = {}
          for (const q of event.questions) {
            if (q.current_answer != null) answers[q.id] = q.current_answer
          }
          initial[event.member_event_id] = { rsvp_status: event.rsvp_status, answers }
        }
      }
      setRsvpData(initial)
    } catch {
      setNoToken(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadParty() }, [loadParty])

  const updateRsvp = (memberEventId: string, status: string, member?: Member) => {
    setRsvpData(prev => {
      const updated = { ...prev, [memberEventId]: { ...prev[memberEventId], rsvp_status: status } }

      if (status === 'accepted' && member) {
        const thisEvent = member.events.find(e => e.member_event_id === memberEventId)
        if (thisEvent?.linked_rsvp) {
          for (const otherEvent of member.events) {
            if (otherEvent.member_event_id !== memberEventId && otherEvent.linked_rsvp) {
              updated[otherEvent.member_event_id] = { ...prev[otherEvent.member_event_id], rsvp_status: 'accepted' }
            }
          }
        }
      }

      if (status === 'declined' && member) {
        const thisEvent = member.events.find(e => e.member_event_id === memberEventId)
        if (thisEvent?.linked_rsvp) {
          for (const otherEvent of member.events) {
            if (otherEvent.member_event_id !== memberEventId && otherEvent.linked_rsvp) {
              updated[otherEvent.member_event_id] = { ...prev[otherEvent.member_event_id], rsvp_status: 'declined' }
            }
          }
        }
      }

      return updated
    })
  }

  const updateAnswer = (memberEventId: string, questionId: string, answer: unknown) => {
    setRsvpData(prev => ({
      ...prev,
      [memberEventId]: {
        ...prev[memberEventId],
        answers: { ...prev[memberEventId]?.answers, [questionId]: answer },
      },
    }))
  }

  const allEvents = members.flatMap(m => m.events).reduce((acc, e) => {
    if (!acc.find(x => x.event_id === e.event_id)) acc.push(e)
    return acc
  }, [] as MemberEvent[])

  const remainingPlusOnes = (party?.max_plus_ones || 0) - (party?.plus_ones_added || 0) - plusOnes.length

  const addPlusOne = () => {
    setPlusOnes(prev => [...prev, {
      first_name: '', last_name: '',
      event_ids: allEvents.map(e => e.event_id),
      rsvp_statuses: Object.fromEntries(allEvents.map(e => [e.event_id, 'accepted'])),
      answers: [],
    }])
  }

  const removePlusOne = (i: number) => setPlusOnes(prev => prev.filter((_, idx) => idx !== i))

  const updatePlusOne = (i: number, field: string, value: unknown) => {
    setPlusOnes(prev => prev.map((po, idx) => idx === i ? { ...po, [field]: value } : po))
  }

  const handleSubmit = async () => {
    if (!party) return
    setSubmitting(true)
    setError(null)

    try {
      const token = localStorage.getItem('invite_short_code')
      const responses = Object.entries(rsvpData).map(([member_event_id, data]) => ({
        member_event_id,
        rsvp_status: data.rsvp_status,
        answers: Object.entries(data.answers)
          .filter(([, v]) => v != null && v !== '')
          .map(([question_id, answer]) => ({ question_id, answer })),
      }))

      const body: Record<string, unknown> = {
        action: 'submit', token, version: party.version, responses,
      }
      if (plusOnes.length > 0) {
        body.new_plus_ones = plusOnes.filter(po => po.first_name || po.last_name)
      }

      const res = await fetch('/api/invite-rsvp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const result = await res.json()
      if (!res.ok) {
        const msgs: Record<string, string> = {
          VERSION_CONFLICT: 'Someone else updated this RSVP. Please refresh.',
          VALIDATION_ERROR: 'Please fill in all required fields.',
          DEADLINE_PASSED: 'The RSVP deadline has passed for some events.',
          PLUS_ONE_LIMIT: result.message || 'Plus-one limit exceeded.',
        }
        setError(msgs[result.error] || result.message || 'Something went wrong.')
        return
      }

      setSubmitResult(result.summary)
      setSubmitted(true)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return <div className="py-12 text-center text-gray-500">Loading your invitation...</div>
  }

  if (noToken || !party) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500">No active invitation found. Please use your invite link to access this page.</p>
      </div>
    )
  }

  if (submitted && submitResult) {
    return (
      <div className="py-12 text-center">
        <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ backgroundColor: `${primaryColor}20` }}>
          <svg className="w-8 h-8" style={{ color: primaryColor }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">RSVP Confirmed!</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-6">Thank you for responding.</p>
        <div className="flex justify-center gap-6 text-sm mb-6">
          {submitResult.accepted > 0 && <div><p className="text-2xl font-bold text-green-600">{submitResult.accepted}</p><p className="text-gray-500">Attending</p></div>}
          {submitResult.declined > 0 && <div><p className="text-2xl font-bold text-red-500">{submitResult.declined}</p><p className="text-gray-500">Not attending</p></div>}
        </div>
        <button onClick={() => { setSubmitted(false); loadParty() }} className="text-sm font-medium hover:underline cursor-pointer" style={{ color: primaryColor }}>
          Edit your response
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6 py-4">
      <div>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">RSVP</h2>
      </div>

      {members.map(member => (
        <div key={member.id} className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-white/10">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
              {getMemberName(member)}
              {member.is_plus_one && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300">Guest</span>}
            </h3>
          </div>

          <div className="p-5 space-y-5">
            {member.events.map((event) => {
              const entry = rsvpData[event.member_event_id]
              const locked = isDeadlinePassed(event.rsvp_deadline)
              const isAccepted = entry?.rsvp_status === 'accepted'

              const linkedEvents = member.events.filter(e => e.linked_rsvp)
              const isLinked = event.linked_rsvp
              const isFirstLinked = isLinked && linkedEvents[0]?.member_event_id === event.member_event_id
              const isSecondaryLinked = isLinked && !isFirstLinked

              if (isSecondaryLinked) {
                return (
                  <div key={event.member_event_id} className="flex items-center gap-3 py-2 pl-4 border-l-2 border-gray-200 dark:border-white/10">
                    <div className="flex-1">
                      <h4 className="font-medium text-gray-700 dark:text-gray-300">{event.event_title}</h4>
                      {event.event_start && <p className="text-xs text-gray-400 mt-0.5">{formatDate(event.event_start)}</p>}
                    </div>
                    <span className="text-xs text-gray-500 italic">
                      {isAccepted ? 'Included' : entry?.rsvp_status === 'declined' ? 'Not attending' : '—'}
                    </span>
                  </div>
                )
              }

              return (
                <div key={event.member_event_id} className="space-y-3">
                  <div>
                    <h4 className="font-medium text-gray-900 dark:text-white">{event.event_title}</h4>
                    {event.event_start && <p className="text-sm text-gray-500 mt-0.5">{formatDate(event.event_start)}</p>}
                    {event.event_location && <p className="text-sm text-gray-500">{event.event_location}</p>}
                    {isFirstLinked && linkedEvents.length > 1 && (
                      <p className="text-xs text-gray-400 mt-1">
                        Includes: {linkedEvents.slice(1).map(e => e.event_title).join(', ')}
                      </p>
                    )}
                  </div>

                  {locked ? (
                    <div className="inline-block px-3 py-1.5 text-sm font-medium text-gray-400 bg-gray-100 dark:bg-white/5 rounded-lg">RSVP Closed</div>
                  ) : (
                    <div className="flex gap-2">
                      <button onClick={() => updateRsvp(event.member_event_id, 'accepted', member)}
                        className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all cursor-pointer border-2"
                        style={isAccepted ? { backgroundColor: primaryColor, borderColor: primaryColor, color: '#fff' } : { borderColor: '#d1d5db', color: '#374151' }}>
                        Attending
                      </button>
                      <button onClick={() => updateRsvp(event.member_event_id, 'declined', member)}
                        className="flex-1 py-2.5 px-4 rounded-lg text-sm font-semibold transition-all cursor-pointer border-2"
                        style={entry?.rsvp_status === 'declined' ? { backgroundColor: '#ef4444', borderColor: '#ef4444', color: '#fff' } : { borderColor: '#d1d5db', color: '#374151' }}>
                        Not Attending
                      </button>
                    </div>
                  )}

                  {isAccepted && !locked && event.questions.filter(q => q.applies_to === 'all' || isAccepted).length > 0 && (
                    <div className="space-y-3 pl-4 border-l-2" style={{ borderColor: `${primaryColor}60` }}>
                      {event.questions.filter(q => q.applies_to === 'all' || isAccepted).map(q => (
                        <div key={q.id}>
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">
                            {q.question_text}{q.is_required && <span className="text-red-500 ml-0.5">*</span>}
                          </label>
                          {q.question_type === 'select' && q.options && (
                            <select value={(entry?.answers[q.id] as string) || ''} onChange={e => updateAnswer(event.member_event_id, q.id, e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-white/20 rounded-lg bg-white dark:bg-white/10 text-gray-900 dark:text-white focus:outline-none focus:ring-2">
                              <option value="">Select...</option>
                              {q.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          )}
                          {q.question_type === 'multi_select' && q.options && (
                            <div className="space-y-1.5">
                              {q.options.map(opt => {
                                const sel = Array.isArray(entry?.answers[q.id]) ? (entry.answers[q.id] as string[]).includes(opt) : false
                                return (
                                  <label key={opt} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                                    <input type="checkbox" checked={sel} onChange={() => {
                                      const cur = Array.isArray(entry?.answers[q.id]) ? [...(entry.answers[q.id] as string[])] : []
                                      updateAnswer(event.member_event_id, q.id, sel ? cur.filter(x => x !== opt) : [...cur, opt])
                                    }} className="rounded" />{opt}
                                  </label>
                                )
                              })}
                            </div>
                          )}
                          {q.question_type === 'text' && (
                            <textarea value={(entry?.answers[q.id] as string) || ''} onChange={e => updateAnswer(event.member_event_id, q.id, e.target.value)}
                              rows={2} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-white/20 rounded-lg bg-white dark:bg-white/10 text-gray-900 dark:text-white focus:outline-none focus:ring-2 resize-y" />
                          )}
                          {q.question_type === 'yes_no' && (
                            <div className="flex gap-2">
                              {['Yes', 'No'].map(val => (
                                <button key={val} onClick={() => updateAnswer(event.member_event_id, q.id, val === 'Yes')}
                                  className="px-4 py-1.5 text-sm rounded-lg border-2 font-medium cursor-pointer transition-colors"
                                  style={entry?.answers[q.id] === (val === 'Yes') ? { backgroundColor: primaryColor, borderColor: primaryColor, color: '#fff' } : { borderColor: '#d1d5db', color: '#374151' }}>
                                  {val}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {remainingPlusOnes > 0 && (
                    <div className="bg-white/80 dark:bg-white/10 backdrop-blur-sm rounded-xl border border-gray-200 dark:border-white/10 p-5">
                      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">Additional Guests</h3>
                      {plusOnes.map((po, i) => (
                        <div key={i} className="mb-4 p-4 bg-gray-50 dark:bg-white/5 rounded-lg space-y-3">
                          <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Guest {i + 1}</span>
                            <button onClick={() => removePlusOne(i)} className="text-sm text-red-500 hover:text-red-700 cursor-pointer">Remove</button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input type="text" placeholder="First name" value={po.first_name} onChange={e => updatePlusOne(i, 'first_name', e.target.value)}
                              className="px-3 py-2 text-sm border border-gray-300 dark:border-white/20 rounded-lg bg-white dark:bg-white/10 text-gray-900 dark:text-white placeholder-gray-400" />
                            <input type="text" placeholder="Last name" value={po.last_name} onChange={e => updatePlusOne(i, 'last_name', e.target.value)}
                              className="px-3 py-2 text-sm border border-gray-300 dark:border-white/20 rounded-lg bg-white dark:bg-white/10 text-gray-900 dark:text-white placeholder-gray-400" />
                          </div>
                          {allEvents.length > 1 && (
                            <div className="space-y-1">
                              <label className="text-xs font-medium text-gray-500">Attending:</label>
                              {allEvents.map(ev => (
                                <label key={ev.event_id} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
                                  <input type="checkbox" checked={po.event_ids.includes(ev.event_id)}
                                    onChange={() => updatePlusOne(i, 'event_ids', po.event_ids.includes(ev.event_id) ? po.event_ids.filter(id => id !== ev.event_id) : [...po.event_ids, ev.event_id])}
                                    className="rounded" />{ev.event_title}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                      <button onClick={addPlusOne} className="text-sm font-medium hover:underline cursor-pointer" style={{ color: primaryColor }}>
                        + Add a guest ({remainingPlusOnes} remaining)
                      </button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      {error && <div className="bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">{error}</div>}

      <button onClick={handleSubmit} disabled={submitting}
        className="w-full py-4 rounded-xl text-white font-semibold text-lg shadow-lg hover:shadow-xl transition-all disabled:opacity-50 cursor-pointer"
        style={{ backgroundColor: primaryColor }}>
        {submitting ? 'Submitting...' : 'Confirm RSVP'}
      </button>
    </div>
  )
}
