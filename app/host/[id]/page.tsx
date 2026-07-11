'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import Header from '@/components/Header'
import LoginModal from '@/components/LoginModal'
import { formatEventDate } from '@/lib/dates'
import { EMPLOYMENT_OPTIONS, COMPANY_SIZE_OPTIONS } from '@/lib/types'

interface HostEvent {
  id: string
  name: string
  type: string
  date: string
  location: string
  description: string
  link: string
  audience: string[]
  employment: string[]
  companySize: string[]
  seniority: string[]
}

interface HostMatch {
  userId: string
  name: string
  linkedin: string
  function: string
  seniority: string
  interest: string
  matchPercent: number
  score: number | null
  locationScore: number | null
  audienceScore: number | null
  qualityScore: number | null
  preferenceScore: number | null
  rating: 'interested' | 'hide' | 'not_a_fit' | null
  ratingReason: string | null
  hostRating: 'up' | 'down' | null
  hostFeedback: string | null
}

function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return n.toFixed(2)
}

function scoreTooltip(m: HostMatch): string {
  return [
    `Location: ${fmtNum(m.locationScore)}`,
    `Audience: ${fmtNum(m.audienceScore)}`,
    `Quality:  ${fmtNum(m.qualityScore)}`,
    `Topics:   ${fmtNum(m.preferenceScore)}`,
    `Total:    ${fmtNum(m.score)}`,
  ].join('\n')
}

// Same options as ShareEventTab — must match the Airtable Type single-select.
// Virtual is intentionally omitted from edit-time choices (we don't accept
// virtuals); the PATCH route also rejects Virtual on save.
const TYPE_OPTIONS = ['Conference', 'Dinner', 'Happy Hour', 'Panel', 'Workshop', 'Activity', 'Other']

function shortDate(iso: string): string {
  return formatEventDate(iso, { month: 'short', day: 'numeric', year: 'numeric' })
}

type MatchSortKey = 'function' | 'seniority' | 'matchPercent' | 'hostRating'

function SortArrow({ col, sortBy, dir }: { col: MatchSortKey; sortBy: MatchSortKey | null; dir: 'asc' | 'desc' }) {
  if (sortBy !== col) return <span style={{ opacity: 0.35 }}>⇅</span>
  return <span style={{ color: 'var(--accent)' }}>{dir === 'asc' ? '↑' : '↓'}</span>
}

export default function HostEventDetailPage() {
  const params = useParams<{ id: string }>()
  const eventId = params?.id

  const [event, setEvent] = useState<HostEvent | null>(null)
  const [matches, setMatches] = useState<HostMatch[]>([])
  const [regionCount, setRegionCount] = useState<number | null>(null)
  const [isPartner, setIsPartner] = useState(false)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'forbidden' | 'not_found' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [editing, setEditing] = useState(false)
  const [hostTab, setHostTab] = useState<'matches' | 'insights'>('matches')
  const [feedbackFor, setFeedbackFor] = useState<string | null>(null)
  const [feedbackText, setFeedbackText] = useState('')
  const [ratingBusy, setRatingBusy] = useState<Set<string>>(new Set())
  const [matchSortBy, setMatchSortBy] = useState<MatchSortKey | null>(null)
  const [matchSortDir, setMatchSortDir] = useState<'asc' | 'desc'>('asc')

  function toggleMatchSort(key: MatchSortKey) {
    if (matchSortBy === key) {
      setMatchSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setMatchSortBy(key)
      setMatchSortDir('asc')
    }
  }

  const sortedMatches = useMemo(() => {
    if (!matchSortBy) return matches
    return [...matches].sort((a, b) => {
      let cmp = 0
      if (matchSortBy === 'function') cmp = (a.function || '').localeCompare(b.function || '')
      else if (matchSortBy === 'seniority') cmp = (a.seniority || '').localeCompare(b.seniority || '')
      else if (matchSortBy === 'matchPercent') cmp = a.matchPercent - b.matchPercent
      else if (matchSortBy === 'hostRating') {
        const order = (r: string | null) => r === 'up' ? 0 : r === null ? 1 : 2
        cmp = order(a.hostRating) - order(b.hostRating)
      }
      return matchSortDir === 'asc' ? cmp : -cmp
    })
  }, [matches, matchSortBy, matchSortDir])

  async function fetchDetail() {
    if (!eventId) return
    try {
      const res = await fetch(`/api/host/events/${eventId}`, { cache: 'no-store' })
      if (res.status === 401) {
        setAuthState('unauthorized')
        return
      }
      if (res.status === 403) {
        setAuthState('forbidden')
        return
      }
      if (res.status === 404) {
        setAuthState('not_found')
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setAuthState('error')
        setErrorMsg(data.error || `HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { event: HostEvent; matches: HostMatch[]; regionCount?: number; isPartner?: boolean }
      setEvent(data.event)
      setMatches(data.matches)
      setRegionCount(data.regionCount ?? null)
      setIsPartner(data.isPartner ?? false)
      setAuthState('authorized')
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function rateGuest(userId: string, rating: 'up' | 'down' | null, feedback?: string) {
    if (!eventId) return
    setRatingBusy((prev) => new Set(prev).add(userId))
    try {
      const res = await fetch('/api/host/match-rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId, userId, rating, feedback: feedback ?? null }),
      })
      if (!res.ok) return
      setMatches((prev) =>
        prev.map((m) =>
          m.userId === userId
            ? { ...m, hostRating: rating, hostFeedback: rating === 'down' ? (feedback ?? null) : null }
            : m,
        ),
      )
    } finally {
      setRatingBusy((prev) => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }

  useEffect(() => {
    fetchDetail()
  }, [eventId])

  // After Hours palette for the host event detail page.
  useEffect(() => {
    document.body.classList.add('theme-after-hours')
    return () => document.body.classList.remove('theme-after-hours')
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchDetail() }} />}

      <Header
        activeTab={null}
        onLogoClick={() => (window.location.href = '/host')}
        rightSlot={
          <div className="flex items-center gap-3">
            <a
              href="/host"
              className="eyebrow"
              style={{ color: 'var(--ink-3)' }}
            >
              ← Host
            </a>
            <button
              onClick={fetchDetail}
              className="rounded-pill border text-[12px] px-3 py-1.5 transition-colors"
              style={{
                background: 'var(--paper)',
                borderColor: 'var(--rule)',
                color: 'var(--ink-2)',
              }}
            >
              Refresh
            </button>
          </div>
        }
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 sm:px-8 py-10 pb-20">
        {authState === 'unknown' && (
          <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>Loading…</p>
        )}

        {authState === 'unauthorized' && (
          <div
            className="rounded-card border p-8 text-center"
            style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
          >
            <h2
              className="font-serif mb-3"
              style={{ fontSize: 24, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              Log in to view this event
            </h2>
            <button
              onClick={() => setShowLogin(true)}
              className="px-5 py-2 rounded-pill text-[13px] font-medium text-white transition-colors"
              style={{ background: 'var(--accent)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
            >
              Log in
            </button>
          </div>
        )}

        {authState === 'forbidden' && (
          <div
            className="rounded-card border p-8 text-center"
            style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
          >
            <p style={{ fontSize: 14, color: 'var(--ink-2)' }}>
              The host dashboard is available to Live and Partner members.
            </p>
          </div>
        )}

        {authState === 'not_found' && (
          <div
            className="rounded-card border p-8 text-center"
            style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
          >
            <p style={{ fontSize: 14, color: 'var(--ink-2)' }}>
              Event not found, or you&apos;re not listed as a host.
            </p>
          </div>
        )}

        {authState === 'error' && (
          <div
            className="rounded-card border p-6"
            style={{
              background: 'var(--paper)',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
            }}
          >
            <p style={{ fontSize: 14 }}>Error: {errorMsg}</p>
          </div>
        )}

        {authState === 'authorized' && event && (
          <>
            <h1
              className="font-serif m-0 mb-1"
              style={{
                fontSize: 32,
                lineHeight: 1.1,
                color: 'var(--ink)',
                letterSpacing: '-0.01em',
              }}
            >
              {event.link ? (
                <a
                  href={event.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="event-link"
                >
                  {event.name}
                  <span className="arrow" aria-hidden>↗</span>
                </a>
              ) : (
                event.name
              )}
            </h1>
            <p className="mb-3" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {[event.type, event.location, shortDate(event.date)].filter(Boolean).join(' · ')}
            </p>

            {isPartner && !editing && (
              <p
                className="mt-2 mb-5 max-w-2xl leading-relaxed"
                style={{ fontSize: 13.5, color: 'var(--ink-2)' }}
              >
                <strong style={{ color: 'var(--accent)' }}>Change any information yourself.</strong>{' '}
                Hit <strong>Edit</strong> below to update event details — matches will automatically be rerun.
              </p>
            )}

            {editing ? (
              <EditForm
                event={event}
                onCancel={() => setEditing(false)}
                onSaved={() => { setEditing(false); fetchDetail() }}
              />
            ) : (
              <>
                <EventSummary event={event} />
                {isPartner && (
                  <div className="flex justify-end mt-3 mb-2">
                    <button
                      onClick={() => setEditing(true)}
                      className="px-4 py-2 rounded-pill border text-[13px] transition-colors"
                      style={{
                        background: 'var(--paper)',
                        borderColor: 'var(--rule)',
                        color: 'var(--ink-2)',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--rule)')}
                    >
                      Edit
                    </button>
                  </div>
                )}
              </>
            )}

            <div className="flex gap-0 mt-10 mb-4 border-b" style={{ borderColor: 'var(--rule)' }}>
              {(['matches', 'insights'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setHostTab(tab)}
                  className="px-5 py-2 text-[13px] font-medium capitalize transition-colors"
                  style={{
                    borderBottom: hostTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
                    color: hostTab === tab ? 'var(--accent)' : 'var(--ink-3)',
                    marginBottom: -1,
                  }}
                >
                  {tab === 'matches' ? `Matches · ${matches.length}` : 'Insights'}
                </button>
              ))}
            </div>

            {hostTab === 'matches' && (<>
            {feedbackFor && (
              <div
                style={{
                  position: 'fixed',
                  inset: 0,
                  background: 'rgba(0,0,0,0.55)',
                  zIndex: 50,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '1rem',
                }}
                onClick={() => { setFeedbackFor(null); setFeedbackText('') }}
              >
                <div
                  className="rounded-card border"
                  style={{
                    background: 'var(--paper)',
                    borderColor: 'var(--rule)',
                    padding: '1.5rem',
                    maxWidth: 400,
                    width: '100%',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <p className="eyebrow mb-2" style={{ color: 'var(--accent)' }}>👎 Not a fit</p>
                  <p style={{ fontSize: 13, color: 'var(--ink-2)', marginBottom: '0.75rem' }}>
                    Optional: why isn&apos;t this a fit?
                  </p>
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value.slice(0, 500))}
                    rows={3}
                    placeholder="e.g. Wrong seniority level, not aligned on industry…"
                    className="w-full rounded-input border px-3 py-2 text-[13px] resize-none focus:outline-none focus:border-accent transition-colors"
                    style={{
                      background: 'var(--paper-2)',
                      borderColor: 'var(--rule)',
                      color: 'var(--ink)',
                    }}
                  />
                  <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: '0.25rem', textAlign: 'right' }}>
                    {feedbackText.length}/500
                  </p>
                  <div className="flex justify-end gap-2 mt-3">
                    <button
                      onClick={() => {
                        const uid = feedbackFor
                        setFeedbackFor(null)
                        setFeedbackText('')
                        rateGuest(uid, 'down', '')
                      }}
                      className="px-4 py-2 rounded-pill text-[13px]"
                      style={{ color: 'var(--ink-2)' }}
                    >
                      Skip feedback
                    </button>
                    <button
                      onClick={() => {
                        const uid = feedbackFor
                        const fb = feedbackText
                        setFeedbackFor(null)
                        setFeedbackText('')
                        rateGuest(uid, 'down', fb)
                      }}
                      className="px-5 py-2 rounded-pill text-[13px] font-medium text-white transition-colors"
                      style={{ background: '#7A2A36' }}
                    >
                      Submit
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div
              className="rounded-card border overflow-hidden"
              style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
            >
              <table className="w-full text-[13px]">
                <thead
                  style={{
                    background: 'var(--paper-2)',
                    borderBottom: '1px solid var(--rule)',
                  }}
                >
                  <tr>
                    <th className="text-left px-4 py-3 eyebrow">Name</th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => toggleMatchSort('function')} className="eyebrow" style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                        Function <SortArrow col="function" sortBy={matchSortBy} dir={matchSortDir} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3">
                      <button onClick={() => toggleMatchSort('seniority')} className="eyebrow" style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 4 }}>
                        Seniority <SortArrow col="seniority" sortBy={matchSortBy} dir={matchSortDir} />
                      </button>
                    </th>
                    <th className="text-left px-4 py-3 eyebrow">Interest</th>
                    <th className="text-right px-4 py-3">
                      <button onClick={() => toggleMatchSort('matchPercent')} className="eyebrow" style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                        Match <SortArrow col="matchPercent" sortBy={matchSortBy} dir={matchSortDir} />
                      </button>
                    </th>
                    {isPartner && (
                      <th className="text-right px-4 py-3">
                        <button onClick={() => toggleMatchSort('hostRating')} className="eyebrow" style={{ cursor: 'pointer', background: 'none', border: 'none', padding: 0, display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                          Rate <SortArrow col="hostRating" sortBy={matchSortBy} dir={matchSortDir} />
                        </button>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {sortedMatches.map((m, i) => (
                    <tr
                      key={m.userId}
                      style={{
                        borderBottom:
                          i === matches.length - 1 ? 'none' : '1px solid var(--rule-soft)',
                      }}
                    >
                      <td
                        className="px-4 py-3"
                        title={!isPartner ? 'Names of matches available to partners' : undefined}
                      >
                        {isPartner ? (
                          <div className="flex items-center gap-1.5">
                            {m.linkedin ? (
                              <a
                                href={m.linkedin}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline"
                                style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
                              >
                                {m.name}
                              </a>
                            ) : (
                              <span style={{ color: 'var(--ink)' }}>{m.name}</span>
                            )}
                            {m.rating === 'not_a_fit' && (
                              <span title="Guest rated this event: not a fit" style={{ fontSize: 11, opacity: 0.6 }}>❌</span>
                            )}
                            {m.rating === 'interested' && (
                              <span title="Guest rated this event: interested" style={{ fontSize: 11, opacity: 0.6 }}>✅</span>
                            )}
                          </div>
                        ) : (
                          <span
                            style={{
                              filter: 'blur(5px)',
                              userSelect: 'none',
                              color: 'var(--ink)',
                              pointerEvents: 'none',
                            }}
                          >
                            {m.name}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>
                        {m.function || <span className="italic" style={{ color: 'var(--ink-3)' }}>—</span>}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>
                        {m.seniority || <span className="italic" style={{ color: 'var(--ink-3)' }}>—</span>}
                      </td>
                      <td
                        className="px-4 py-3 max-w-xs truncate"
                        style={{ color: 'var(--ink-2)' }}
                        title={m.interest || ''}
                      >
                        {m.interest || <span className="italic" style={{ color: 'var(--ink-3)' }}>—</span>}
                      </td>
                      <td
                        className="px-4 py-3 text-right num font-medium"
                        style={{
                          color: m.matchPercent >= 40 ? 'var(--positive)' : 'var(--ink-3)',
                        }}
                      >
                        {m.matchPercent}%
                      </td>
                      {isPartner && (
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              disabled={ratingBusy.has(m.userId)}
                              onClick={() => rateGuest(m.userId, m.hostRating === 'up' ? null : 'up')}
                              title={m.hostRating === 'up' ? 'Clear rating' : 'Good fit'}
                              className="rounded-pill border text-[12px] px-2 py-0.5 transition-colors disabled:opacity-40"
                              style={{
                                background: m.hostRating === 'up' ? 'var(--accent)' : 'transparent',
                                borderColor: m.hostRating === 'up' ? 'var(--accent)' : 'var(--rule)',
                                color: m.hostRating === 'up' ? '#fff' : 'var(--ink-2)',
                              }}
                            >
                              👍
                            </button>
                            <button
                              disabled={ratingBusy.has(m.userId)}
                              onClick={() => {
                                if (m.hostRating === 'down') {
                                  rateGuest(m.userId, null)
                                } else {
                                  setFeedbackFor(m.userId)
                                  setFeedbackText('')
                                }
                              }}
                              title={m.hostRating === 'down' ? 'Clear rating' : 'Not a fit'}
                              className="rounded-pill border text-[12px] px-2 py-0.5 transition-colors disabled:opacity-40"
                              style={{
                                background: m.hostRating === 'down' ? '#7A2A36' : 'transparent',
                                borderColor: m.hostRating === 'down' ? '#7A2A36' : 'var(--rule)',
                                color: m.hostRating === 'down' ? '#fff' : 'var(--ink-2)',
                              }}
                            >
                              👎
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {matches.length === 0 && (
                <p
                  className="px-4 py-6 text-center"
                  style={{ fontSize: 13, color: 'var(--ink-3)' }}
                >
                  No matches above 40% yet.
                </p>
              )}
            </div>
            </>)}

            {hostTab === 'insights' && <InsightsTab matches={matches} />}
          </>
        )}
      </main>
    </div>
  )
}


function InsightsTab({ matches }: { matches: HostMatch[] }) {
  const going = matches.filter((m) => m.rating === 'interested')
  const cantMakeIt = matches.filter((m) => m.rating === 'hide')
  const notAFit = matches.filter((m) => m.rating === 'not_a_fit')
  const withFeedback = notAFit.filter((m) => m.ratingReason)

  const total = going.length + cantMakeIt.length + notAFit.length

  if (total === 0) {
    return (
      <p className="py-8 text-center" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
        No user ratings yet for this event.
      </p>
    )
  }

  return (
    <div className="space-y-6">
      <div
        className="rounded-card border p-5"
        style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
      >
        <p className="eyebrow mb-4">User Ratings</p>
        <div className="flex gap-4 flex-wrap">
          <RatingPill label="Interested" count={going.length} color="#2D6A4F" />
          <RatingPill label="Hide" count={cantMakeIt.length} color="#3A5F8A" />
          <RatingPill label="Not a Fit" count={notAFit.length} color="#8A2A38" />
        </div>
      </div>

      {withFeedback.length > 0 && (
        <div
          className="rounded-card border p-5"
          style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
        >
          <p className="eyebrow mb-4">Not a Fit — Feedback</p>
          <div className="space-y-3">
            {withFeedback.map((m, i) => (
              <div
                key={m.userId}
                className="rounded-input px-4 py-3"
                style={{
                  background: 'var(--paper-2)',
                  borderLeft: '3px solid #8A2A38',
                  fontSize: 13,
                  color: 'var(--ink-2)',
                  lineHeight: 1.5,
                }}
              >
                {m.ratingReason}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function RatingPill({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div
      className="flex items-center gap-2 px-4 py-2.5 rounded-pill"
      style={{ background: color + '18', border: `1px solid ${color}40` }}
    >
      <span
        className="w-2.5 h-2.5 rounded-full shrink-0"
        style={{ background: color }}
      />
      <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>{label}</span>
      <span
        className="ml-1 font-semibold tabular-nums"
        style={{ fontSize: 15, color }}
      >
        {count}
      </span>
    </div>
  )
}

function EventSummary({ event }: { event: HostEvent }) {
  return (
    <section>
      <div
        className="rounded-card border p-5 space-y-4 relative"
        style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
      >
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-[13px]">
          <SummaryField label="Name" value={event.name} />
          <SummaryField label="Type" value={event.type} />
          <SummaryField label="Date" value={shortDate(event.date)} />
          <SummaryField label="Location" value={event.location} />
          <SummaryField label="Audience" value={event.audience.join(', ')} />
          <SummaryField label="Description" value={event.description} multiline />
          <SummaryField label="Employment" value={(event.employment ?? []).join(', ')} />
          <SummaryField label="Company Size" value={(event.companySize ?? []).join(', ')} />
          <SummaryField label="Seniority" value={(event.seniority ?? []).join(', ')} />
        </dl>
      </div>
    </section>
  )
}

function SummaryField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={`mt-1 ${multiline ? 'whitespace-pre-wrap' : ''}`}
        style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}
      >
        {value || <span className="italic" style={{ color: 'var(--ink-3)' }}>not set</span>}
      </dd>
    </div>
  )
}

function EditForm({
  event,
  onCancel,
  onSaved,
}: {
  event: HostEvent
  onCancel: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(event.name)
  const [type, setType] = useState(event.type || 'Other')
  const [date, setDate] = useState(event.date)
  const [location, setLocation] = useState(event.location)
  const [description, setDescription] = useState(event.description)
  const [audience, setAudience] = useState(event.audience.join(', '))
  const [employment, setEmployment] = useState<string[]>(event.employment ?? [])
  const [companySize, setCompanySize] = useState<string[]>(event.companySize ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name,
        type,
        date,
        location,
        description,
        audience: audience.split(',').map((s) => s.trim()).filter(Boolean),
        employment,
        companySize,
      }
      const res = await fetch(`/api/host/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div
        className="rounded-card border p-5 space-y-4"
        style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
      >
        <div className="eyebrow" style={{ color: 'var(--accent)' }}>Edit event</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EditField label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={editInputCls} />
          </EditField>
          <EditField label="Type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className={`salon-select ${editInputCls}`}
            >
              {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </EditField>
          <EditField label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={editInputCls} />
          </EditField>
          <EditField label="Location">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, State" className={editInputCls} />
          </EditField>
          <EditField label="Audience" hint="Comma-separated tags">
            <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. RevOps, Sales Leaders" className={editInputCls} />
          </EditField>
          <EditField label="Description" wide>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={`${editInputCls} resize-none`} />
          </EditField>
          <HostMultiCheckbox
            label="Employment"
            options={[...EMPLOYMENT_OPTIONS]}
            value={employment}
            onChange={setEmployment}
          />
          <HostMultiCheckbox
            label="Company Size"
            options={[...COMPANY_SIZE_OPTIONS]}
            value={companySize}
            onChange={setCompanySize}
          />
        </div>
        {error && (
          <p
            className="rounded-input border px-3 py-2 text-[12px]"
            style={{
              background: 'var(--accent-soft)',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
            }}
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded-pill text-[13px]"
            style={{ color: 'var(--ink-2)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-pill text-[13px] font-medium text-white disabled:opacity-50 transition-colors"
            style={{ background: 'var(--accent)' }}
            onMouseEnter={(e) => !saving && (e.currentTarget.style.background = 'var(--accent-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </section>
  )
}

function EditField({
  label,
  hint,
  wide,
  children,
}: {
  label: string
  hint?: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <label className="eyebrow">{label}</label>
      {children}
      {hint && (
        <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

function HostMultiCheckbox({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  function toggle(opt: string) {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt))
    else onChange([...value, opt])
  }
  return (
    <div className="space-y-1.5">
      <label className="eyebrow">{label}</label>
      <div className="flex flex-wrap gap-x-4 gap-y-2 pt-0.5">
        {options.map((opt) => (
          <label key={opt} className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={value.includes(opt)}
              onChange={() => toggle(opt)}
              className="w-3.5 h-3.5 rounded cursor-pointer"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{opt}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

const editInputCls =
  'w-full rounded-input border border-rule bg-paper-2 text-ink px-3 py-2 text-[13px] placeholder:opacity-60 focus:outline-none focus:border-accent transition-colors'
