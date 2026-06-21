'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import LoginModal from '@/components/LoginModal'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

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

  useEffect(() => {
    fetchDetail()
  }, [eventId])

  const matched = users?.filter((u) => u.matchPercent !== null && u.matchPercent >= 40) ?? []
  const visible = users ?? []

  return (
    <div className="min-h-screen bg-[#F5EFE6] flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchDetail() }} />}

      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/admin/events" className="flex items-center gap-3">
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
            <span className="text-xs uppercase tracking-widest text-gray-500">← Events</span>
          </a>
          <button
            onClick={fetchDetail}
            className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm"
          >
            Refresh
          </button>
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
            <p className="text-sm text-gray-500 mb-6">
              {[event.type, event.location, event.date].filter(Boolean).join(' · ')}
            </p>

            <div className="bg-white border border-[#E8DDD0] rounded-2xl p-6 shadow-sm mb-8">
              <h3 className="text-xs uppercase tracking-widest text-gold-700 font-medium mb-4" style={{ color: '#6E1F2B' }}>Event</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Field label="Name" value={event.name} />
                <Field label="Type" value={event.type} />
                <Field label="Date" value={event.date} />
                <Field label="Location" value={event.location} />
                <Field label="LatLon" value={event.lat !== null && event.lng !== null ? `${event.lat}, ${event.lng}` : ''} />
                <Field label="Audience" value={event.audience.join(', ')} />
                <Field label="Description" value={event.description} multiline />
              </dl>
            </div>

            <div className="bg-white border border-[#E8DDD0] rounded-2xl p-6 shadow-sm mb-8">
              <h3 className="text-xs uppercase tracking-widest font-medium mb-4" style={{ color: '#6E1F2B' }}>Image</h3>
              <div className="flex flex-col sm:flex-row gap-6">
                <div className="w-full sm:w-72 flex-shrink-0">
                  {event.imageUrl ? (
                    <img
                      src={`/api/event-image/${event.id}?v=${imageVersion}`}
                      alt=""
                      className="w-full rounded-lg border border-[#E8DDD0] bg-[#FDFAF6] object-cover"
                    />
                  ) : (
                    <div className="w-full aspect-[16/9] rounded-lg border border-dashed border-[#E8DDD0] bg-[#FDFAF6] flex items-center justify-center">
                      <span className="text-xs text-gray-400 italic">no image</span>
                    </div>
                  )}
                </div>
                <div className="flex-1 flex flex-col gap-3">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-400">image_url</dt>
                    <dd className="text-xs text-gray-700 mt-1 break-all">
                      {event.imageUrl ? (
                        <a
                          href={event.imageUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline decoration-[#D9CAB0] underline-offset-2"
                        >
                          {event.imageUrl}
                        </a>
                      ) : (
                        <span className="text-gray-400 italic">empty (Airtable fallback)</span>
                      )}
                    </dd>
                  </div>
                  <div className="flex flex-wrap gap-2">
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
                    <button
                      type="button"
                      disabled={imageBusy}
                      onClick={() => fileInputRef.current?.click()}
                      className="px-3 py-1.5 rounded-lg text-white text-xs font-medium disabled:opacity-50"
                      style={{ background: '#6E1F2B' }}
                    >
                      {imageBusy ? 'Working…' : event.imageUrl ? 'Replace image' : 'Upload image'}
                    </button>
                    {event.imageUrl && (
                      <button
                        type="button"
                        disabled={imageBusy}
                        onClick={handleImageDelete}
                        className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-gray-700 text-xs font-medium hover:bg-[#FDFAF6] disabled:opacity-50"
                      >
                        Remove image
                      </button>
                    )}
                  </div>
                  {imageError && (
                    <p className="text-xs text-red-600">{imageError}</p>
                  )}
                  <p className="text-[11px] text-gray-400">
                    Max 4MB. JPEG/PNG/WebP. Mirrors to Airtable and persists in Supabase Storage so the public carousel serves it directly.
                  </p>
                </div>
              </div>
            </div>

            <div className="mb-3">
              <h3 className="text-xs uppercase tracking-widest font-medium" style={{ color: '#6E1F2B' }}>
                Users within 100mi · {users.length}
                {' · '}
                {matched.length} matched ({users.length > 0 ? Math.round((matched.length / users.length) * 100) : 0}%)
              </h3>
            </div>

            <div className="bg-white border border-[#E8DDD0] rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-[#FDFAF6] border-b border-[#E8DDD0]">
                  <tr>
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Name</th>
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Function</th>
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Seniority</th>
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Grade</th>
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Location</th>
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium max-w-xs">Interest</th>
                    <th className="text-right px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">% Match</th>
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
                  No users within 100mi.
                </p>
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
