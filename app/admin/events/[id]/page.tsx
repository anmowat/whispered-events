'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import LoginModal from '@/components/LoginModal'
import {
  EVENT_STATUS_OPTIONS,
  normalizeEventStatus,
  eventStatusPillClass,
  type EventStatus,
} from '@/lib/event-status'
import { EMPLOYMENT_OPTIONS, COMPANY_SIZE_OPTIONS } from '@/lib/types'
import { SENIORITY_OPTIONS } from '@/lib/seniority'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

interface Host {
  id: string
  email: string
  name: string
  firstName: string
}

interface EventDetail {
  id: string
  name: string
  type: string
  date: string
  location: string
  description: string
  link: string
  audience: string[]
  lat: number | null
  lng: number | null
  imageUrl: string
  featured: boolean
  hosts: Host[]
  status: string
  submitterEmail: string
  employment: string[]
  companySize: string[]
  seniority: string[]
  organizer: string
}

// Draft mirrors EventDetail's editable fields. audience is a comma-joined
// string while editing so the input doesn't have to manage chip state; we
// split on save. Hosts are managed in a separate piece of state since they
// flow through the API as resolved email -> id pairs, not as a single
// string field.
interface EventDraft {
  name: string
  type: string
  date: string
  location: string
  link: string
  description: string
  audience: string
  featured: boolean
  status: EventStatus
  employment: string[]
  companySize: string[]
  seniority: string[]
  organizer: string
}

function hostDisplayName(h: Host): string {
  if (h.name && h.name !== 'DEFAULT') return h.name
  if (h.firstName && h.firstName !== 'DEFAULT') return h.firstName
  return h.email
}

const EVENT_TYPE_OPTIONS = ['Conference', 'Dinner', 'Happy Hour', 'Panel', 'Workshop', 'Activity', 'Other'] as const

function draftFromEvent(e: EventDetail): EventDraft {
  return {
    name: e.name,
    type: e.type,
    date: e.date,
    location: e.location,
    link: e.link,
    description: e.description,
    audience: e.audience.join(', '),
    featured: e.featured,
    status: normalizeEventStatus(e.status),
    employment: e.employment ?? [],
    companySize: e.companySize ?? [],
    seniority: e.seniority ?? [],
    organizer: e.organizer ?? '',
  }
}

function draftDiff(draft: EventDraft, original: EventDraft): Partial<EventDraft> {
  const diff: Partial<EventDraft> = {}
  ;(Object.keys(draft) as Array<keyof EventDraft>).forEach((k) => {
    const dv = draft[k]
    const ov = original[k]
    const changed = Array.isArray(dv)
      ? JSON.stringify(dv) !== JSON.stringify(ov)
      : dv !== ov
    if (changed) {
      ;(diff as Record<string, unknown>)[k] = dv
    }
  })
  return diff
}

function hostsChanged(original: Host[], drafted: Host[]): boolean {
  const a = original.map((h) => h.id).sort()
  const b = drafted.map((h) => h.id).sort()
  return a.length !== b.length || a.some((id, i) => id !== b[i])
}

interface UserRow {
  id: string
  email: string
  name: string
  firstName: string
  function: string
  seniority: string
  grade: string
  location: string
  interest: string
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

function scoreTooltip(u: UserRow): string {
  if (u.skippedReason) return `Skipped: ${u.skippedReason}`
  if (u.matchPercent === null) return 'Not scored yet'
  const lines = [
    `Location: ${fmtNum(u.locationScore)}`,
    `Audience: ${fmtNum(u.audienceScore)}`,
    `Quality:  ${fmtNum(u.qualityScore)}`,
    `Topics:   ${fmtNum(u.preferenceScore)}`,
    `Total:    ${fmtNum(u.score)}`,
  ]
  return lines.join('\n')
}

function displayName(u: UserRow): string {
  if (u.name && u.name !== 'DEFAULT') return u.name
  if (u.firstName && u.firstName !== 'DEFAULT') return u.firstName
  return u.email
}

export default function AdminEventDetailPage() {
  const params = useParams<{ id: string }>()
  const eventId = params?.id

  const [event, setEvent] = useState<EventDetail | null>(null)
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'not_found' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  // Bumped after every image upload/delete so the preview <img> bypasses the
  // 24h Cache-Control on /api/event-image/[id] and shows the new bytes
  // immediately. Initialized to 0 so first render reuses any browser cache.
  const [imageVersion, setImageVersion] = useState(0)
  const [imageBusy, setImageBusy] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [featuredBusy, setFeaturedBusy] = useState(false)
  const [featuredError, setFeaturedError] = useState<string | null>(null)
  // Edit mode batches every field change into a single PATCH on Save, so
  // updateEvent (and its mirror + match-rerun pipeline) fires once per edit
  // session rather than once per keystroke or per field. Draft starts at
  // null and is populated from event when the admin clicks Edit.
  const [draft, setDraft] = useState<EventDraft | null>(null)
  // Hosts edit state. Parallel to `draft` (the field-bag) because hosts are
  // structured records, not free-text fields. Null when not editing.
  const [hostsDraft, setHostsDraft] = useState<Host[] | null>(null)
  // Search query for the host-add typeahead. Debounced into a fetch against
  // /api/admin/users/search which returns up to 10 matches by name/email.
  const [hostSearch, setHostSearch] = useState('')
  const [hostSearchResults, setHostSearchResults] = useState<Host[]>([])
  const [hostSearchBusy, setHostSearchBusy] = useState(false)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  // Tracks the per-event rescore the Refresh button kicks off, so the
  // label can show "Rescoring…" while the work is in flight.
  const [rescoring, setRescoring] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const isEditing = draft !== null
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete() {
    if (!eventId) return
    try {
      const res = await fetch(`/api/admin/events/${eventId}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setDeleteError(data.error || `HTTP ${res.status}`)
        return
      }
      window.location.href = '/admin?tab=events'
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e))
    }
  }

  // Typeahead: re-run the name search whenever the query changes, debounced
  // so we don't fire on every keystroke. Empty query clears results.
  useEffect(() => {
    const q = hostSearch.trim()
    if (!q) {
      setHostSearchResults([])
      return
    }
    let cancelled = false
    setHostSearchBusy(true)
    const id = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/admin/users/search?q=${encodeURIComponent(q)}`,
          { cache: 'no-store' },
        )
        if (!res.ok || cancelled) return
        const data = (await res.json()) as { results: Host[] }
        if (!cancelled) setHostSearchResults(data.results ?? [])
      } catch (e) {
        if (!cancelled) console.error('host search failed', e)
      } finally {
        if (!cancelled) setHostSearchBusy(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(id)
    }
  }, [hostSearch])

  // Refresh = rescore this event's pairs, then re-read. The global
  // rescore-missing button on /admin tends to time out before reaching
  // every (event, user) pair, so an event-scoped trigger guarantees we
  // re-evaluate Nick & co. against the latest matching rules.
  async function rescoreAndFetch() {
    if (!eventId) return
    setRescoring(true)
    try {
      await fetch(`/api/process-matches?trigger=event&id=${eventId}`, {
        cache: 'no-store',
      })
    } catch (e) {
      console.error('rescoreAndFetch failed', e)
    } finally {
      setRescoring(false)
    }
    await fetchDetail()
  }

  async function syncSeniorityToAirtable() {
    if (!eventId) return
    setSyncing(true)
    setSyncMsg(null)
    try {
      const res = await fetch('/api/admin/backfill-airtable-seniority', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: eventId }),
      })
      const data = (await res.json()) as { ok?: boolean; updated?: number; errors?: number; error?: string }
      if (!res.ok || !data.ok) {
        setSyncMsg(`Sync failed: ${data.error || res.status}`)
      } else {
        setSyncMsg(`Synced (${data.updated} updated, ${data.errors} errors)`)
        setTimeout(() => setSyncMsg(null), 4000)
      }
    } catch (e) {
      setSyncMsg(`Sync failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  async function fetchDetail() {
    if (!eventId) return
    try {
      const res = await fetch(`/api/admin/events/${eventId}`, { cache: 'no-store' })
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
      const data = (await res.json()) as { event: EventDetail; users: UserRow[] }
      setEvent(data.event)
      setUsers(data.users)
      setAuthState('authorized')
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  async function handleImageUpload(file: File) {
    if (!eventId) return
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(`File too large (max ${MAX_IMAGE_BYTES / 1024 / 1024}MB).`)
      return
    }
    setImageError(null)
    setImageBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/admin/events/${eventId}/image`, {
        method: 'POST',
        body: form,
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setImageError(data.error || `HTTP ${res.status}`)
        return
      }
      setImageVersion((v) => v + 1)
      await fetchDetail()
    } catch (e) {
      setImageError(e instanceof Error ? e.message : String(e))
    } finally {
      setImageBusy(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  async function handleImageDelete() {
    if (!eventId) return
    if (!window.confirm('Remove the image for this event?')) return
    setImageError(null)
    setImageBusy(true)
    try {
      const res = await fetch(`/api/admin/events/${eventId}/image`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setImageError(data.error || `HTTP ${res.status}`)
        return
      }
      setImageVersion((v) => v + 1)
      await fetchDetail()
    } catch (e) {
      setImageError(e instanceof Error ? e.message : String(e))
    } finally {
      setImageBusy(false)
    }
  }

  async function handleFeaturedToggle(next: boolean) {
    if (!eventId) return
    setFeaturedError(null)
    setFeaturedBusy(true)
    try {
      const res = await fetch(`/api/admin/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featured: next }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setFeaturedError(data.error || `HTTP ${res.status}`)
        return
      }
      await fetchDetail()
    } catch (e) {
      setFeaturedError(e instanceof Error ? e.message : String(e))
    } finally {
      setFeaturedBusy(false)
    }
  }

  function startEdit() {
    if (!event) return
    setEditError(null)
    setDraft(draftFromEvent(event))
    setHostsDraft(event.hosts)
    setHostSearch('')
    setHostSearchResults([])
  }

  function cancelEdit() {
    setEditError(null)
    setDraft(null)
    setHostsDraft(null)
    setHostSearch('')
    setHostSearchResults([])
  }

  // Add a host from the typeahead. Idempotent against already-added users.
  function addHost(h: Host) {
    if (!hostsDraft) return
    if (hostsDraft.some((existing) => existing.id === h.id)) return
    setHostsDraft([...hostsDraft, h])
    setHostSearch('')
    setHostSearchResults([])
  }

  function removeHost(id: string) {
    if (!hostsDraft) return
    setHostsDraft(hostsDraft.filter((h) => h.id !== id))
  }

  async function saveEdit() {
    if (!eventId || !event || !draft) return
    const original = draftFromEvent(event)
    const diff = draftDiff(draft, original)

    // Hosts diff: compare id sets between the original event and the
    // working draft. If unchanged, omit hostEmails from the PATCH so the
    // server doesn't rewrite the link field.
    const draftHosts = hostsDraft ?? event.hosts
    const hostsDirty = hostsChanged(event.hosts, draftHosts)

    if (Object.keys(diff).length === 0 && !hostsDirty) {
      setDraft(null)
      setHostsDraft(null)
      return
    }
    setEditError(null)
    setEditBusy(true)
    try {
      // audience travels as an array on the wire even though the form holds
      // it as a comma-joined string. Split, trim, drop empties so a stray
      // comma doesn't add a blank audience entry.
      const body: Record<string, unknown> = { ...diff }
      if (typeof body.audience === 'string') {
        body.audience = (body.audience as string)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      }
      if (hostsDirty) {
        body.hostEmails = draftHosts.map((h) => h.email)
      }
      const res = await fetch(`/api/admin/events/${eventId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setEditError(data.error || `HTTP ${res.status}`)
        return
      }
      setDraft(null)
      setHostsDraft(null)
      setHostSearch('')
      setHostSearchResults([])
      await fetchDetail()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e))
    } finally {
      setEditBusy(false)
    }
  }

  useEffect(() => {
    fetchDetail()
  }, [eventId])

  const [userSortBy, setUserSortBy] = useState<'matchPercent' | 'function' | 'seniority' | 'grade' | 'location' | 'interest'>('matchPercent')
  const [userSortDir, setUserSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleUserSort(key: typeof userSortBy) {
    if (userSortBy === key) {
      setUserSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setUserSortBy(key)
      setUserSortDir(key === 'matchPercent' ? 'desc' : 'asc')
    }
  }

  const matched = users?.filter((u) => u.matchPercent !== null && u.matchPercent >= 40) ?? []
  const visible = (() => {
    if (!users) return []
    const dir = userSortDir === 'asc' ? 1 : -1
    return [...users].sort((a, b) => {
      if (userSortBy === 'matchPercent') {
        const ap = a.matchPercent ?? -1
        const bp = b.matchPercent ?? -1
        return (ap - bp) * dir
      }
      const av = (a[userSortBy] ?? '').toLowerCase()
      const bv = (b[userSortBy] ?? '').toLowerCase()
      return av.localeCompare(bv) * dir
    })
  })()

  return (
    <div className="min-h-screen bg-[#F5EFE6] flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchDetail() }} />}

      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/admin/events" className="flex items-center gap-3">
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
            <span className="text-xs uppercase tracking-widest text-gray-500">← Events</span>
          </a>
          <div className="flex items-center gap-2">
            {syncMsg && (
              <span className="text-xs text-gray-500">{syncMsg}</span>
            )}
            <button
              onClick={syncSeniorityToAirtable}
              disabled={syncing}
              title="Push seniority from Supabase → Airtable for this event"
              className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {syncing ? 'Syncing…' : 'Sync → Airtable'}
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

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-8">
        {authState === 'unknown' && <p className="text-sm text-gray-500">Loading…</p>}

        {authState === 'unauthorized' && (
          <div className="bg-white border border-[#E8DDD0] rounded-2xl p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Not authorized</h2>
            <button
              onClick={() => setShowLogin(true)}
              className="px-4 py-2 rounded-xl text-white text-sm font-medium transition-colors"
              style={{ background: '#6E1F2B' }}
            >
              Log in
            </button>
          </div>
        )}

        {authState === 'not_found' && (
          <div className="bg-white border border-[#E8DDD0] rounded-2xl p-8 text-center shadow-sm">
            <p className="text-sm text-gray-600">Event not found.</p>
          </div>
        )}

        {authState === 'error' && (
          <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm">
            <p className="text-sm text-red-600">Error: {errorMsg}</p>
          </div>
        )}

        {authState === 'authorized' && event && users && (
          <>
            <div className="flex items-start justify-between gap-4 mb-6">
              <div className="flex-1 min-w-0">
                <h1 className="text-2xl font-semibold text-gray-900 mb-1">
                  {event.link ? (
                    <a
                      href={event.link}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline transition-colors"
                      style={{ color: '#6E1F2B' }}
                    >
                      {event.name}
                    </a>
                  ) : (
                    event.name
                  )}
                </h1>
                <p className="text-sm text-gray-500">
                  {[event.type, event.location, event.date].filter(Boolean).join(' · ')}
                </p>
                {imageError && (
                  <p className="text-xs text-red-600 mt-1">{imageError}</p>
                )}
              </div>

              <div className="relative flex-shrink-0">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handleImageUpload(f)
                  }}
                />
                {event.imageUrl ? (
                  <>
                    <img
                      src={`/api/event-image/${event.id}?v=${imageVersion}`}
                      alt=""
                      onClick={() => !imageBusy && fileInputRef.current?.click()}
                      title="Click to replace"
                      className={`w-20 h-20 rounded-lg border border-[#E8DDD0] object-cover cursor-pointer transition-opacity ${imageBusy ? 'opacity-50' : ''}`}
                    />
                    <button
                      type="button"
                      disabled={imageBusy}
                      onClick={handleImageDelete}
                      title="Remove image"
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-[#E8DDD0] text-gray-500 text-xs leading-none flex items-center justify-center shadow-sm hover:bg-red-50 hover:text-red-600 hover:border-red-200 transition-colors disabled:opacity-50"
                    >
                      ×
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={imageBusy}
                    onClick={() => fileInputRef.current?.click()}
                    title="Upload image"
                    className={`w-20 h-20 rounded-lg border border-dashed border-[#E8DDD0] bg-[#FDFAF6] text-3xl text-gray-300 hover:text-gray-500 hover:border-gray-300 transition-colors ${imageBusy ? 'opacity-50' : ''}`}
                  >
                    +
                  </button>
                )}
              </div>
            </div>

            <div className="bg-white border border-[#E8DDD0] rounded-2xl p-6 shadow-sm mb-8">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h3 className="text-xs uppercase tracking-widest font-medium" style={{ color: '#6E1F2B' }}>Event</h3>
                <div className="flex items-center gap-3">
                  {!isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={startEdit}
                        className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm"
                      >
                        Edit
                      </button>
                      <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={event.featured}
                          disabled={featuredBusy}
                          onChange={(e) => handleFeaturedToggle(e.target.checked)}
                          className="w-4 h-4 rounded border-[#E8DDD0] cursor-pointer accent-[#6E1F2B] disabled:opacity-50"
                        />
                        <span className={featuredBusy ? 'opacity-50' : ''}>Featured on homepage</span>
                      </label>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={
                          editBusy ||
                          (Object.keys(draftDiff(draft!, draftFromEvent(event))).length === 0 &&
                            !hostsChanged(event.hosts, hostsDraft ?? event.hosts))
                        }
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
              {featuredError && !isEditing && (
                <p className="text-xs text-red-600 mb-3">{featuredError}</p>
              )}
              {editError && (
                <p className="text-xs text-red-600 mb-3">{editError}</p>
              )}
              {!isEditing ? (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-400">Status</dt>
                    <dd className="mt-0.5">
                      {(() => {
                        const s = normalizeEventStatus(event.status)
                        return (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${eventStatusPillClass(s)}`}
                          >
                            {s}
                          </span>
                        )
                      })()}
                    </dd>
                  </div>
                  <Field label="Name" value={event.name} />
                  <Field label="Type" value={event.type} />
                  <Field label="Date" value={event.date} />
                  <Field label="Location" value={event.location} />
                  <Field label="LatLon" value={event.lat !== null && event.lng !== null ? `${event.lat}, ${event.lng}` : ''} />
                  <Field label="Link" value={event.link} />
                  <Field label="Submitter" value={event.submitterEmail} />
                  <Field label="Audience" value={event.audience.join(', ')} />
                  <Field label="Description" value={event.description} multiline />
                  <Field label="Organizer" value={event.organizer} />
                  <Field label="Employment" value={event.employment.join(', ')} />
                  <Field label="Company Size" value={event.companySize.join(', ')} />
                  <Field label="Seniority" value={event.seniority.join(', ')} />
                </dl>
              ) : (
                <EventEditForm draft={draft!} onChange={setDraft} disabled={editBusy} />
              )}

              <div className="mt-6 pt-6 border-t border-[#E8DDD0]">
                <h3 className="text-[11px] uppercase tracking-widest text-gray-500 font-medium mb-3">
                  Hosts {event.hosts.length > 0 && `· ${event.hosts.length}`}
                </h3>
                {!isEditing ? (
                  event.hosts.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {event.hosts.map((h) => (
                        <a
                          key={h.id}
                          href={`/admin/users/${h.id}`}
                          className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors"
                          title={h.email}
                        >
                          <span className="font-medium">{hostDisplayName(h)}</span>
                          <span className="text-gray-400">{h.email}</span>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">No hosts assigned.</p>
                  )
                ) : (
                  <div className="space-y-3">
                    {(hostsDraft ?? []).length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {(hostsDraft ?? []).map((h) => (
                          <span
                            key={h.id}
                            className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full border border-[#E8DDD0] bg-white text-xs text-gray-700"
                            title={h.email}
                          >
                            <span className="font-medium">{hostDisplayName(h)}</span>
                            <span className="text-gray-400">{h.email}</span>
                            <button
                              type="button"
                              onClick={() => removeHost(h.id)}
                              disabled={editBusy}
                              className="ml-1 text-gray-400 hover:text-[#6E1F2B] transition-colors disabled:opacity-50"
                              aria-label={`Remove ${hostDisplayName(h)}`}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 italic">No hosts assigned.</p>
                    )}
                    <div className="relative">
                      <input
                        type="text"
                        value={hostSearch}
                        onChange={(e) => setHostSearch(e.target.value)}
                        placeholder="Search to add a host (name or email)…"
                        disabled={editBusy}
                        className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#6E1F2B] disabled:opacity-50 transition-colors"
                      />
                      {hostSearch.trim() && (
                        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-[#E8DDD0] rounded-lg shadow-popover max-h-72 overflow-auto">
                          {hostSearchBusy && hostSearchResults.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-gray-400 italic">Searching…</div>
                          ) : hostSearchResults.length === 0 ? (
                            <div className="px-3 py-2 text-xs text-gray-400 italic">No matches.</div>
                          ) : (
                            hostSearchResults.map((h) => {
                              const alreadyAdded = (hostsDraft ?? []).some((x) => x.id === h.id)
                              return (
                                <button
                                  key={h.id}
                                  type="button"
                                  onClick={() => addHost(h)}
                                  disabled={alreadyAdded || editBusy}
                                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#F5EFE6] transition-colors flex items-center justify-between gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-white"
                                >
                                  <span className="flex flex-col">
                                    <span className="font-medium text-gray-800">{hostDisplayName(h)}</span>
                                    <span className="text-xs text-gray-400">{h.email}</span>
                                  </span>
                                  {alreadyAdded && (
                                    <span className="text-[10px] uppercase tracking-widest text-gray-400">added</span>
                                  )}
                                </button>
                              )
                            })
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="mb-3">
              <h3 className="text-xs uppercase tracking-widest font-medium" style={{ color: '#6E1F2B' }}>
                Users in range · {users.length}
                {' · '}
                {matched.length} matched ({users.length > 0 ? Math.round((matched.length / users.length) * 100) : 0}%)
              </h3>
            </div>

            <div className="bg-white border border-[#E8DDD0] rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-[#FDFAF6] border-b border-[#E8DDD0]">
                  <tr>
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Name</th>
                    <UserSortHeader label="Function" sortKey="function" align="left" sortBy={userSortBy} sortDir={userSortDir} toggle={toggleUserSort} />
                    <UserSortHeader label="Seniority" sortKey="seniority" align="left" sortBy={userSortBy} sortDir={userSortDir} toggle={toggleUserSort} />
                    <UserSortHeader label="Grade" sortKey="grade" align="left" sortBy={userSortBy} sortDir={userSortDir} toggle={toggleUserSort} />
                    <UserSortHeader label="Location" sortKey="location" align="left" sortBy={userSortBy} sortDir={userSortDir} toggle={toggleUserSort} />
                    <UserSortHeader label="Interest" sortKey="interest" align="left" sortBy={userSortBy} sortDir={userSortDir} toggle={toggleUserSort} />
                    <UserSortHeader label="% Match" sortKey="matchPercent" align="right" sortBy={userSortBy} sortDir={userSortDir} toggle={toggleUserSort} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((u) => (
                    <tr key={u.id} className="border-b border-[#F0E8DC] last:border-b-0 hover:bg-[#FDFAF6] transition-colors">
                      <td className="px-3 py-3 max-w-sm">
                        <a
                          href={`/admin/users/${u.id}`}
                          className="text-gray-800 underline decoration-[#D9CAB0] underline-offset-2 hover:decoration-gold-700"
                        >
                          {displayName(u)}
                        </a>
                      </td>
                      <td className="px-3 py-3 text-gray-600 text-xs">{u.function || <span className="text-gray-400 italic">—</span>}</td>
                      <td className="px-3 py-3 text-gray-600 text-xs">{u.seniority || <span className="text-gray-400 italic">—</span>}</td>
                      <td className="px-3 py-3 text-gray-600 text-xs">{u.grade || <span className="text-gray-400 italic">—</span>}</td>
                      <td className="px-3 py-3 text-gray-600 text-xs truncate max-w-[180px]">{u.location || <span className="text-gray-400 italic">—</span>}</td>
                      <td className="px-3 py-3 text-gray-600 text-xs truncate max-w-[260px]">
                        {u.interest || <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums font-medium cursor-help ${
                          u.skippedReason
                            ? 'text-red-600'
                            : u.matchPercent === null
                              ? 'text-gray-400'
                              : u.matchPercent >= 40
                                ? 'text-green-700'
                                : 'text-red-600'
                        }`}
                        title={scoreTooltip(u)}
                      >
                        {u.skippedReason
                          ? 'skip'
                          : u.matchPercent === null
                            ? '—'
                            : `${u.matchPercent}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length === 0 && (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">
                  No users in range.
                </p>
              )}
            </div>

            {/* Delete event */}
            <div className="mt-10 pt-6 border-t border-[#E8DDD0]">
              {!deleteConfirm ? (
                <button
                  onClick={() => setDeleteConfirm(true)}
                  className="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50 transition-colors"
                >
                  Delete event
                </button>
              ) : (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-4 space-y-3">
                  <p className="text-sm text-red-800 font-medium">
                    This will permanently delete the event and all its matches. This cannot be undone.
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

function UserSortHeader({
  label,
  sortKey,
  align,
  sortBy,
  sortDir,
  toggle,
}: {
  label: string
  sortKey: 'matchPercent' | 'function' | 'seniority' | 'grade' | 'location' | 'interest'
  align: 'left' | 'right'
  sortBy: typeof sortKey
  sortDir: 'asc' | 'desc'
  toggle: (k: typeof sortKey) => void
}) {
  const isActive = sortBy === sortKey
  return (
    <th
      className={`px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium select-none ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        onClick={() => toggle(sortKey)}
        className="inline-flex items-center gap-1 transition-colors"
        style={{ color: isActive ? '#6E1F2B' : undefined }}
      >
        {label}
        <span className="text-[10px] opacity-60">{isActive ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
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

function EventEditForm({
  draft,
  onChange,
  disabled,
}: {
  draft: EventDraft
  onChange: (next: EventDraft) => void
  disabled: boolean
}) {
  function update<K extends keyof EventDraft>(key: K, value: EventDraft[K]) {
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
            onChange={(e) => update('status', e.target.value as EventStatus)}
            className="bg-white border border-[#E8DDD0] rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:border-[#6E1F2B] disabled:opacity-50 transition-colors"
          >
            {EVENT_STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${eventStatusPillClass(draft.status)}`}
          >
            {draft.status}
          </span>
        </label>
        <label className="inline-flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={draft.featured}
            disabled={disabled}
            onChange={(e) => update('featured', e.target.checked)}
            className="w-4 h-4 rounded border-[#E8DDD0] cursor-pointer accent-[#6E1F2B] disabled:opacity-50"
          />
          <span className={disabled ? 'opacity-50' : ''}>Featured on homepage</span>
        </label>
      </div>
      {/* Grid mirrors the view layout: Status occupies col A row 1 in view,
          so a hidden spacer holds that position here (Status is above the grid
          in edit mode), keeping Name at col B row 1, Type at col A row 2, etc. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <div className="hidden sm:block" aria-hidden />
        <FormField label="Name">
          <input
            type="text"
            value={draft.name}
            disabled={disabled}
            onChange={(e) => update('name', e.target.value)}
            className={input}
          />
        </FormField>
        <FormField label="Type">
          <select
            value={draft.type}
            disabled={disabled}
            onChange={(e) => update('type', e.target.value)}
            className={input}
          >
            {EVENT_TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Date">
          <input
            type="date"
            value={draft.date}
            disabled={disabled}
            onChange={(e) => update('date', e.target.value)}
            className={input}
          />
        </FormField>
        {/* Row 3: Location | [LatLon auto-derived] */}
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
        {/* Row 4: Link | [Submitter read-only] */}
        <FormField label="Link">
          <input
            type="url"
            value={draft.link}
            disabled={disabled}
            onChange={(e) => update('link', e.target.value)}
            placeholder="https://…"
            className={input}
          />
        </FormField>
        <div className="hidden sm:block" aria-hidden />
        {/* Row 5: Audience | Description */}
        <FormField label="Audience (comma-separated)">
          <input
            type="text"
            value={draft.audience}
            disabled={disabled}
            onChange={(e) => update('audience', e.target.value)}
            placeholder="CRO, CMO, VP Sales"
            className={input}
          />
        </FormField>
        <FormField label="Description">
          <textarea
            value={draft.description}
            disabled={disabled}
            onChange={(e) => update('description', e.target.value)}
            rows={5}
            className={`${input} font-normal leading-relaxed`}
          />
        </FormField>
        <FormField label="Organizer">
          <input
            type="text"
            value={draft.organizer}
            disabled={disabled}
            onChange={(e) => update('organizer', e.target.value)}
            placeholder="Acme Corp"
            className={input}
          />
        </FormField>
        {/* Row 6: Employment | Company Size | Seniority */}
        <AdminMultiCheckbox
          label="Employment"
          options={[...EMPLOYMENT_OPTIONS]}
          value={draft.employment}
          onChange={(v) => update('employment', v)}
          disabled={disabled}
        />
        <AdminMultiCheckbox
          label="Company Size"
          options={[...COMPANY_SIZE_OPTIONS]}
          value={draft.companySize}
          onChange={(v) => update('companySize', v)}
          disabled={disabled}
        />
        <AdminMultiCheckbox
          label="Seniority"
          options={[...SENIORITY_OPTIONS]}
          value={draft.seniority}
          onChange={(v) => update('seniority', v)}
          disabled={disabled}
        />
      </div>
      <p className="text-[11px] text-gray-400">
        LatLon is auto-derived from Location on save. Saving fires updateEvent
        once, which mirrors back to Supabase and reruns matches.
      </p>
    </div>
  )
}

function AdminMultiCheckbox({
  label,
  options,
  value,
  onChange,
  disabled,
  wide,
}: {
  label: string
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  wide?: boolean
}) {
  function toggle(opt: string) {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt))
    else onChange([...value, opt])
  }
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <span className="block text-xs uppercase tracking-wide text-gray-400 mb-2">{label}</span>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {options.map((opt) => (
          <label key={opt} className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={value.includes(opt)}
              onChange={() => toggle(opt)}
              disabled={disabled}
              className="w-3.5 h-3.5 rounded border-[#E8DDD0] accent-[#6E1F2B] disabled:opacity-50 cursor-pointer"
            />
            <span className={`text-sm text-gray-700 ${disabled ? 'opacity-50' : ''}`}>{opt}</span>
          </label>
        ))}
      </div>
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
