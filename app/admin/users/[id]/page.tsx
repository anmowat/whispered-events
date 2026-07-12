'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import LoginModal from '@/components/LoginModal'
import {
  STATUS_OPTIONS,
  normalizeStatus,
  statusPillClass,
  type UserStatus,
} from '@/lib/user-status'
import { SENIORITY_OPTIONS, normalizeSeniority } from '@/lib/seniority'

const EMPLOYMENT_OPTIONS = ['Employed', 'Fractional', 'Searching', 'Other']
const COMPANY_SIZE_OPTIONS = ['<$5M', '$5-25M', '$25-100M', '$100M-1B', '$1B+', 'Other']

interface UserDetail {
  id: string
  email: string
  name: string
  firstName: string
  function: string
  seniority: string
  linkedin: string
  grade: string
  interest: string
  learn: string
  employment: string
  companySize: string
  location: string
  lat: number | null
  lng: number | null
  active: boolean
  status: string
  frequency: string
  lastContribution: string | null
  totalContributions: number
  contributionsLast30: number
  contributionsLast90: number
  lastSeen: string | null
  lastEmailSent: string | null
  hostedEvents: { id: string; name: string; date: string }[]
}

// Draft mirrors UserDetail's editable subset. Email and the read-only
// contribution/seen stats stay outside the form. Status is the canonical
// lifecycle picklist — replaces the legacy active boolean we shipped in
// Phase G. Sync derives active and is_partner from this value. The enum,
// options, and pill classes live in @/lib/user-status so the user list
// page shares the same source of truth.
interface UserDraft {
  email: string
  name: string
  firstName: string
  function: string
  seniority: string
  grade: string
  location: string
  interest: string
  employment: string
  companySize: string
  frequency: string
  linkedin: string
  learn: string
  status: UserStatus
}

const GRADE_OPTIONS = ['', 'A', 'Polish', 'B', 'C'] as const
const FREQUENCY_OPTIONS = ['As they arrive', 'Weekly', 'Monthly', 'Paused'] as const

function draftFromUser(u: UserDetail): UserDraft {
  return {
    email: u.email,
    name: u.name,
    firstName: u.firstName,
    function: u.function,
    seniority: u.seniority,
    grade: u.grade,
    location: u.location,
    interest: u.interest,
    employment: u.employment,
    companySize: u.companySize,
    frequency: u.frequency,
    linkedin: u.linkedin,
    learn: u.learn,
    status: normalizeStatus(u.status),
  }
}


function draftDiff(draft: UserDraft, original: UserDraft): Partial<UserDraft> {
  const diff: Partial<UserDraft> = {}
  ;(Object.keys(draft) as Array<keyof UserDraft>).forEach((k) => {
    if (draft[k] !== original[k]) {
      ;(diff as Record<string, unknown>)[k] = draft[k]
    }
  })
  return diff
}

interface EventRow {
  id: string
  name: string
  type: string
  date: string
  location: string
  audience: string[]
  link: string
  score: number | null
  matchPercent: number | null
  locationScore: number | null
  audienceScore: number | null
  qualityScore: number | null
  preferenceScore: number | null
  skippedReason: string | null
}

function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return n.toFixed(2)
}

function scoreTooltip(e: EventRow): string {
  if (e.skippedReason) return `Skipped: ${e.skippedReason}`
  if (e.matchPercent === null) return 'Not scored yet'
  const lines = [
    `Location: ${fmtNum(e.locationScore)}`,
    `Audience: ${fmtNum(e.audienceScore)}`,
    `Quality:  ${fmtNum(e.qualityScore)}`,
    `Topics:   ${fmtNum(e.preferenceScore)}`,
    `Total:    ${fmtNum(e.score)}`,
  ]
  return lines.join('\n')
}

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>()
  const userId = params?.id

  const [user, setUser] = useState<UserDetail | null>(null)
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'not_found' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  // Edit mode batches every field change into a single PATCH on Save, so
  // updateUserAdmin (and its mirror + match-rerun pipeline) fires once per
  // edit session rather than once per keystroke. Draft is null when not
  // editing; populated from user when admin clicks Edit.
  const [draft, setDraft] = useState<UserDraft | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const isEditing = draft !== null
  const [enrichBusy, setEnrichBusy] = useState(false)
  const [enrichMessage, setEnrichMessage] = useState<string | null>(null)
  // Tracks the per-user rescore the Refresh button kicks off.
  const [rescoring, setRescoring] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  // Hosted-events edit state
  const [hostedEventsDraft, setHostedEventsDraft] = useState<{ id: string; name: string; date: string }[] | null>(null)
  const [eventSearch, setEventSearch] = useState('')
  const [eventSearchResults, setEventSearchResults] = useState<{ id: string; name: string; date: string }[]>([])
  const [hostingBusy, setHostingBusy] = useState(false)
  const eventSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function handleDelete() {
    if (!userId) return
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setDeleteError(data.error || `HTTP ${res.status}`)
        return
      }
      window.location.href = '/admin'
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    }
  }

  // Refresh = rescore this user's matches across every future event,
  // then re-read. noEmail=1 keeps the trigger from sending a welcome
  // or per-event digest as a side effect.
  async function rescoreAndFetch() {
    if (!userId) return
    setRescoring(true)
    try {
      await fetch(`/api/process-matches?trigger=user&id=${userId}&noEmail=1`, {
        cache: 'no-store',
      })
    } catch (e) {
      console.error('rescoreAndFetch failed', e)
    } finally {
      setRescoring(false)
    }
    await fetchDetail()
  }

  async function fetchDetail() {
    if (!userId) return
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { cache: 'no-store' })
      if (res.status === 401) {
        setAuthState('unauthorized')
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
      const data = (await res.json()) as { user: Omit<UserDetail, 'hostedEvents'>; events: EventRow[]; hostedEvents: { id: string; name: string; date: string }[] }
      setUser({ ...data.user, hostedEvents: data.hostedEvents ?? [] })
      setEvents(data.events)
      setAuthState('authorized')
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  function startEdit() {
    if (!user) return
    setEditError(null)
    setDraft(draftFromUser(user))
    setHostedEventsDraft([...(user.hostedEvents ?? [])])
    setEventSearch('')
    setEventSearchResults([])
  }

  function cancelEdit() {
    setEditError(null)
    setDraft(null)
    setHostedEventsDraft(null)
    setEventSearch('')
    setEventSearchResults([])
  }

  async function handleEnrich() {
    if (!userId || enrichBusy) return
    if (!window.confirm('Re-run LinkedIn enrichment? This will overwrite Name, Function, and Seniority.')) return
    setEnrichBusy(true)
    setEnrichMessage(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/enrich`, {
        method: 'POST',
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        result?: { function?: string | string[]; seniority?: string; functionFrom?: string }
      }
      if (!res.ok || !data.ok) {
        setEnrichMessage(`Enrich failed: ${data.error || `HTTP ${res.status}`}`)
        return
      }
      const rawFn = data.result?.function
      const fn = Array.isArray(rawFn) ? rawFn.join(', ') : rawFn || '?'
      const sen = data.result?.seniority || '?'
      const from = data.result?.functionFrom ? ` (from ${data.result.functionFrom})` : ''
      setEnrichMessage(`Enriched → ${fn} / ${sen}${from}`)
      await fetchDetail()
    } catch (e) {
      setEnrichMessage(`Enrich failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setEnrichBusy(false)
    }
  }

  // Clear the enrich message after a few seconds.
  useEffect(() => {
    if (!enrichMessage) return
    const id = setTimeout(() => setEnrichMessage(null), 8000)
    return () => clearTimeout(id)
  }, [enrichMessage])

  function searchEvents(q: string) {
    setEventSearch(q)
    if (eventSearchTimer.current) clearTimeout(eventSearchTimer.current)
    if (!q.trim()) { setEventSearchResults([]); return }
    eventSearchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/events/search?q=${encodeURIComponent(q)}`)
        const data = (await res.json()) as { results: { id: string; name: string; date: string }[] }
        const draft = hostedEventsDraft ?? []
        const draftIds = new Set(draft.map((e) => e.id))
        setEventSearchResults((data.results ?? []).filter((e) => !draftIds.has(e.id)))
      } catch { /* ignore */ }
    }, 200)
  }

  function addHostEvent(e: { id: string; name: string; date: string }) {
    setHostedEventsDraft((prev) => {
      if (!prev) return [e]
      if (prev.some((x) => x.id === e.id)) return prev
      return [...prev, e]
    })
    setEventSearch('')
    setEventSearchResults([])
  }

  function removeHostEvent(id: string) {
    setHostedEventsDraft((prev) => (prev ?? []).filter((e) => e.id !== id))
  }

  async function saveEdit() {
    if (!userId || !user || !draft) return
    const original = draftFromUser(user)
    const diff = draftDiff(draft, original)

    const originalHostIds = new Set((user.hostedEvents ?? []).map((e) => e.id))
    const draftHostIds = new Set((hostedEventsDraft ?? []).map((e) => e.id))
    const add = (hostedEventsDraft ?? []).map((e) => e.id).filter((id) => !originalHostIds.has(id))
    const remove = (user.hostedEvents ?? []).map((e) => e.id).filter((id) => !draftHostIds.has(id))
    const hostingChanged = add.length > 0 || remove.length > 0

    if (Object.keys(diff).length === 0 && !hostingChanged) {
      setDraft(null)
      setHostedEventsDraft(null)
      return
    }

    setEditError(null)
    setEditBusy(true)
    try {
      const tasks: Promise<Response>[] = []
      if (Object.keys(diff).length > 0) {
        tasks.push(fetch(`/api/admin/users/${userId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(diff),
        }))
      }
      if (hostingChanged) {
        setHostingBusy(true)
        tasks.push(fetch(`/api/admin/users/${userId}/hosted-events`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ add, remove }),
        }))
      }
      const results = await Promise.all(tasks)
      for (const res of results) {
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string }
          setEditError(data.error || `HTTP ${res.status}`)
          return
        }
      }
      setDraft(null)
      setHostedEventsDraft(null)
      await fetchDetail()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e))
    } finally {
      setEditBusy(false)
      setHostingBusy(false)
    }
  }

  useEffect(() => {
    fetchDetail()
  }, [userId])

  const displayName = user
    ? user.name && user.name !== 'DEFAULT'
      ? user.name
      : user.firstName && user.firstName !== 'DEFAULT'
        ? user.firstName
        : user.email
    : ''

  // Older Airtable rows store LinkedIn without a scheme (just
  // "linkedin.com/in/foo"), which the browser treats as relative to
  // the current path. Force https:// when missing so the anchor lands
  // on the real profile.
  function absoluteLinkedin(raw: string): string {
    const trimmed = (raw || '').trim()
    if (!trimmed) return ''
    if (/^https?:\/\//i.test(trimmed)) return trimmed
    return `https://${trimmed}`
  }

  return (
    <div className="min-h-screen bg-[#F5EFE6] flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchDetail() }} />}

      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/admin" className="flex items-center gap-3">
            <img src="/w-olive-gold.svg" alt="Whispered Events" className="h-10 w-auto" />
            <span className="text-xs uppercase tracking-widest text-gray-500">← Admin</span>
          </a>
          <div className="flex items-center gap-2">
            {enrichMessage && (
              <span
                className={`text-xs ${enrichMessage.startsWith('Enrich failed') ? 'text-red-600' : 'text-gray-500'}`}
              >
                {enrichMessage}
              </span>
            )}
            <button
              onClick={handleEnrich}
              disabled={enrichBusy || !user?.linkedin}
              title={
                user?.linkedin
                  ? 'Re-run LinkedIn enrichment via AnySite'
                  : 'No LinkedIn URL on record — add one to enable enrichment'
              }
              className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {enrichBusy ? 'Enriching…' : 'Enrich from LinkedIn'}
            </button>
            <button
              onClick={rescoreAndFetch}
              disabled={rescoring}
              className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {rescoring ? 'Rescoring…' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        {authState === 'unknown' && <p className="text-sm text-gray-500">Loading…</p>}

        {authState === 'unauthorized' && (
          <div className="bg-white border border-[#E8DDD0] rounded-2xl p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Not authorized</h2>
            <p className="text-sm text-gray-500 mb-6">Log in as an admin to view this page.</p>
            <button
              onClick={() => setShowLogin(true)}
              className="px-4 py-2 rounded-xl bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors"
            >
              Log in
            </button>
          </div>
        )}

        {authState === 'not_found' && (
          <div className="bg-white border border-[#E8DDD0] rounded-2xl p-8 text-center shadow-sm">
            <p className="text-sm text-gray-600">User not found.</p>
          </div>
        )}

        {authState === 'error' && (
          <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm">
            <p className="text-sm text-red-600">Error: {errorMsg}</p>
          </div>
        )}

        {authState === 'authorized' && user && events && (
          <>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">
              {user.linkedin ? (
                <a
                  href={absoluteLinkedin(user.linkedin)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:underline transition-colors"
                  style={{ color: 'var(--accent)' }}
                  title={absoluteLinkedin(user.linkedin)}
                >
                  {displayName}
                </a>
              ) : (
                displayName
              )}
            </h1>
            <p className="text-sm text-gray-500 mb-6">{user.email}</p>

            {/* Profile fields */}
            <div className="bg-white border border-[#E8DDD0] rounded-2xl p-6 shadow-sm mb-8">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h3 className="text-xs uppercase tracking-widest text-gold-700 font-medium">Profile</h3>
                <div className="flex items-center gap-3">
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={startEdit}
                      className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm"
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={editBusy || (
                          Object.keys(draftDiff(draft!, draftFromUser(user))).length === 0 &&
                          JSON.stringify((hostedEventsDraft ?? []).map(e => e.id).sort()) ===
                          JSON.stringify((user.hostedEvents ?? []).map(e => e.id).sort())
                        )}
                        className="px-3 py-1.5 rounded-lg text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{ background: '#6E1F2B' }}
                      >
                        {editBusy ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        disabled={editBusy}
                        className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </div>
              {editError && (
                <p className="text-xs text-red-600 mb-3">{editError}</p>
              )}
              {!isEditing ? (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-400">Status</dt>
                    <dd className="mt-0.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${statusPillClass(normalizeStatus(user.status))}`}
                      >
                        {normalizeStatus(user.status)}
                      </span>
                    </dd>
                  </div>
                  <Field label="Frequency" value={user.frequency} />
                  <Field label="Location" value={user.location} />
                  <Field label="LatLon" value={user.lat !== null && user.lng !== null ? `${user.lat}, ${user.lng}` : ''} />
                  <Field label="Function" value={user.function} />
                  <Field label="Topics" value={user.interest} multiline />
                  <Field label="Grade" value={user.grade} />
                  <Field
                    label="Last Contribution"
                    value={
                      user.lastContribution
                        ? new Date(user.lastContribution).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : ''
                    }
                  />
                  <Field label="Company Size" value={user.companySize} />
                  <Field
                    label="Last seen"
                    value={
                      user.lastSeen
                        ? new Date(user.lastSeen).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : ''
                    }
                  />
                  <Field label="Seniority" value={user.seniority} />
                  <Field label="How they heard" value={user.learn} multiline />
                  <Field label="Employment" value={user.employment} />
                  <Field
                    label="Contributions (total / 30d / 90d)"
                    value={`${user.totalContributions} / ${user.contributionsLast30} / ${user.contributionsLast90}`}
                  />
                  <Field
                    label="Last email sent"
                    value={
                      user.lastEmailSent
                        ? new Date(user.lastEmailSent).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : ''
                    }
                  />
                </dl>
              ) : (
                <UserEditForm
                  draft={draft!}
                  onChange={setDraft}
                  disabled={editBusy}
                />
              )}
            </div>

            {/* Events hosting */}
            <div className="bg-white border border-[#E8DDD0] rounded-2xl p-6 shadow-sm mb-8">
              <h3 className="text-xs uppercase tracking-widest text-gold-700 font-medium mb-3">Events hosting</h3>
              {!isEditing ? (
                <div className="flex flex-wrap gap-2">
                  {(user.hostedEvents ?? []).length === 0 ? (
                    <span className="text-sm text-gray-400 italic">None</span>
                  ) : (
                    (user.hostedEvents ?? []).map((e) => (
                      <a
                        key={e.id}
                        href={`/admin/events/${e.id}`}
                        title={e.date}
                        className="inline-flex items-center gap-1 px-3 py-1 rounded-full border border-[#E8DDD0] bg-[#FDFAF6] text-xs text-gray-700 hover:border-gold-400 hover:text-gold-700 transition-colors"
                      >
                        {e.name}
                      </a>
                    ))
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {(hostedEventsDraft ?? []).length === 0 ? (
                      <span className="text-sm text-gray-400 italic">None</span>
                    ) : (
                      (hostedEventsDraft ?? []).map((e) => (
                        <span
                          key={e.id}
                          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-[#E8DDD0] bg-[#FDFAF6] text-xs text-gray-700"
                        >
                          {e.name}
                          <button
                            type="button"
                            onClick={() => removeHostEvent(e.id)}
                            disabled={editBusy}
                            className="text-gray-400 hover:text-red-500 transition-colors leading-none disabled:opacity-50"
                            title="Remove"
                          >
                            ×
                          </button>
                        </span>
                      ))
                    )}
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      value={eventSearch}
                      onChange={(e) => searchEvents(e.target.value)}
                      placeholder="Search events to add…"
                      disabled={editBusy}
                      className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#6E1F2B] disabled:opacity-50 transition-colors"
                    />
                    {eventSearchResults.length > 0 && (
                      <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#E8DDD0] rounded-xl shadow-lg overflow-hidden">
                        {eventSearchResults.map((e) => (
                          <button
                            key={e.id}
                            type="button"
                            onClick={() => addHostEvent(e)}
                            className="w-full text-left px-4 py-2.5 text-sm text-gray-800 hover:bg-[#F5EFE6] transition-colors border-b border-[#F0E8DC] last:border-b-0"
                          >
                            {e.name}
                            {e.date && <span className="ml-2 text-xs text-gray-400">{e.date}</span>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {hostingBusy && <p className="text-xs text-gray-400 mt-2">Saving hosting changes…</p>}
                </div>
              )}
            </div>

            {/* Future events sorted by % match */}
            <div className="flex items-end justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-xs uppercase tracking-widest text-gold-700 font-medium">Future events within range · {events.length}</h3>
              <p className="text-xs text-gray-400">Hover the % to see the score breakdown · Green ≥ 40%, red below</p>
            </div>
            <div className="bg-white border border-[#E8DDD0] rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-[#FDFAF6] border-b border-[#E8DDD0]">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Event</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Location</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Audience</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">% Match</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-b border-[#F0E8DC] last:border-b-0 hover:bg-[#FDFAF6] transition-colors">
                      <td className="px-4 py-3 max-w-sm">
                        <a href={`/admin/events/${e.id}`} className="text-gray-800 hover:text-gold-700 transition-colors">
                          {e.name}
                        </a>
                        <div className="text-xs text-gray-400 mt-0.5">{e.type}{e.date ? ` · ${e.date}` : ''}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-600 truncate max-w-xs">
                        {e.location || <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {e.audience.length ? (
                          <span className="text-xs">{e.audience.join(', ')}</span>
                        ) : (
                          <span className="text-gray-400 italic">—</span>
                        )}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums font-medium cursor-help ${
                          e.skippedReason
                            ? 'text-red-600'
                            : e.matchPercent === null
                              ? 'text-gray-400'
                              : e.matchPercent >= 40
                                ? 'text-green-600'
                                : 'text-red-600'
                        }`}
                        title={scoreTooltip(e)}
                      >
                        {e.skippedReason
                          ? 'skip'
                          : e.matchPercent === null
                            ? '—'
                            : `${e.matchPercent}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {events.length === 0 && (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">No future events.</p>
              )}
            </div>

            {/* Delete user */}
            <div className="mt-10 pt-6 border-t border-[#E8DDD0]">
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 transition-colors"
                >
                  Delete user
                </button>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
                  <p className="text-sm text-red-800 font-medium">
                    This will permanently delete the user and all their matches. This cannot be undone.
                  </p>
                  {deleteError && <p className="text-xs text-red-600">{deleteError}</p>}
                  <div className="flex gap-2">
                    <button
                      onClick={handleDelete}
                      className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-medium hover:bg-red-700 transition-colors"
                    >
                      Yes, delete
                    </button>
                    <button
                      onClick={() => { setDeleteConfirm(false); setDeleteError(null) }}
                      className="px-4 py-2 rounded-lg border border-[#E8DDD0] text-sm text-gray-600 hover:bg-[#F5EFE6] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function Field({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-gray-400">{label}</dt>
      <dd className={`text-sm text-gray-800 mt-0.5 ${multiline ? 'whitespace-pre-wrap' : 'truncate'}`}>
        {value ? value : <span className="text-gray-400 italic">not provided</span>}
      </dd>
    </div>
  )
}

function UserEditForm({
  draft,
  onChange,
  disabled,
}: {
  draft: UserDraft
  onChange: (next: UserDraft) => void
  disabled: boolean
}) {
  function update<K extends keyof UserDraft>(key: K, value: UserDraft[K]) {
    onChange({ ...draft, [key]: value })
  }
  const input =
    'w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-[#6E1F2B] disabled:opacity-50 transition-colors'
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4">
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 select-none">
          <span className={disabled ? 'opacity-50' : ''}>Status</span>
          <select
            value={draft.status}
            disabled={disabled}
            onChange={(e) => update('status', e.target.value as UserStatus)}
            className="bg-white border border-[#E8DDD0] rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:border-[#6E1F2B] disabled:opacity-50 transition-colors"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${statusPillClass(draft.status)}`}
          >
            {draft.status}
          </span>
        </label>
      </div>
      {/* Extra identity fields not shown in view — separate section so they
          don't shift the positions of the profile fields below. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm pb-4 mb-1 border-b border-[#E8DDD0]">
        <FormField label="Email">
          <input
            type="email"
            value={draft.email}
            disabled={disabled}
            onChange={(e) => update('email', e.target.value)}
            placeholder="user@example.com"
            className={input}
          />
        </FormField>
        <FormField label="Name">
          <input
            type="text"
            value={draft.name}
            disabled={disabled}
            onChange={(e) => update('name', e.target.value)}
            className={input}
          />
        </FormField>
        <FormField label="First Name">
          <input
            type="text"
            value={draft.firstName}
            disabled={disabled}
            onChange={(e) => update('firstName', e.target.value)}
            className={input}
          />
        </FormField>
        <FormField label="LinkedIn">
          <input
            type="url"
            value={draft.linkedin}
            disabled={disabled}
            onChange={(e) => update('linkedin', e.target.value)}
            placeholder="https://linkedin.com/in/…"
            className={input}
          />
        </FormField>
      </div>
      {/* Profile grid — every field is in the EXACT same col/row as the view.
          Spacers hold slots occupied by Status (moved above), LatLon (auto),
          Last Contribution, Last seen, and Contributions (all read-only).
          Topics stays at col B row 3, How they heard at col B row 6 — not wide. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
        {/* Row 1: [Status is above the grid] | Frequency */}
        <div className="hidden sm:block" aria-hidden />
        <FormField label="Frequency">
          <select
            value={draft.frequency}
            disabled={disabled}
            onChange={(e) => update('frequency', e.target.value)}
            className={input}
          >
            {FREQUENCY_OPTIONS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </FormField>
        {/* Row 2: Location | [LatLon auto-derived] */}
        <FormField label="Location">
          <input
            type="text"
            value={draft.location}
            disabled={disabled}
            onChange={(e) => update('location', e.target.value)}
            placeholder="City, State or full address"
            className={input}
          />
        </FormField>
        <div className="hidden sm:block" aria-hidden />
        {/* Row 3: Function | Topics */}
        <FormField label="Function">
          <input
            type="text"
            value={draft.function}
            disabled={disabled}
            onChange={(e) => update('function', e.target.value)}
            className={input}
          />
        </FormField>
        <FormField label="Topics">
          <textarea
            value={draft.interest}
            disabled={disabled}
            onChange={(e) => update('interest', e.target.value)}
            rows={3}
            className={`${input} leading-relaxed`}
          />
        </FormField>
        {/* Row 4: Grade | [Last Contribution read-only] */}
        <FormField label="Grade">
          <select
            value={draft.grade}
            disabled={disabled}
            onChange={(e) => update('grade', e.target.value)}
            className={input}
          >
            {GRADE_OPTIONS.map((g) => (
              <option key={g || 'blank'} value={g}>{g || '— blank —'}</option>
            ))}
          </select>
        </FormField>
        <div className="hidden sm:block" aria-hidden />
        {/* Row 5: Seniority | How they heard */}
        <FormField label="Seniority">
          <select
            value={normalizeSeniority(draft.seniority)}
            disabled={disabled}
            onChange={(e) => update('seniority', e.target.value)}
            className={input}
          >
            <option value="">— blank —</option>
            {SENIORITY_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </FormField>
        <FormField label="How they heard">
          <textarea
            value={draft.learn}
            disabled={disabled}
            onChange={(e) => update('learn', e.target.value)}
            rows={3}
            className={`${input} leading-relaxed`}
          />
        </FormField>
        {/* Row 6: Employment | Company Size */}
        <FormField label="Employment">
          <select
            value={draft.employment}
            disabled={disabled}
            onChange={(e) => update('employment', e.target.value)}
            className={input}
          >
            <option value="">— blank —</option>
            {EMPLOYMENT_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Company Size">
          <select
            value={draft.companySize}
            disabled={disabled}
            onChange={(e) => update('companySize', e.target.value)}
            className={input}
          >
            <option value="">— blank —</option>
            {COMPANY_SIZE_OPTIONS.map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
        </FormField>
      </div>
      <p className="text-[11px] text-gray-400">
        LatLon is auto-derived from Location on save. Saving fires updateUserAdmin
        once, which mirrors back to Supabase and reruns matches for this user.
      </p>
    </div>
  )
}

function FormField({
  label,
  children,
  wide,
}: {
  label: string
  children: React.ReactNode
  wide?: boolean
}) {
  return (
    <label className={`block ${wide ? 'sm:col-span-2' : ''}`}>
      <span className="block text-xs uppercase tracking-wide text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  )
}
