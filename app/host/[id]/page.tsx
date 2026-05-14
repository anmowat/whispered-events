'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import LoginModal from '@/components/LoginModal'

interface HostEvent {
  id: string
  name: string
  type: string
  date: string
  location: string
  description: string
  link: string
  audience: string[]
}

interface HostMatch {
  userId: string
  name: string
  linkedin: string
  function: string
  seniority: string
  interest: string
  matchPercent: number
}

// Same options as ShareEventTab — must match the Airtable Type single-select.
// Virtual is intentionally omitted from edit-time choices (we don't accept
// virtuals); if an existing event somehow lands here as Virtual, the type
// field would show stale, but the PATCH route rejects Virtual on save.
const TYPE_OPTIONS = ['Conference', 'Dinner', 'Other']

function shortDate(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function HostEventDetailPage() {
  const params = useParams<{ id: string }>()
  const eventId = params?.id

  const [event, setEvent] = useState<HostEvent | null>(null)
  const [matches, setMatches] = useState<HostMatch[]>([])
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'not_found' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [editing, setEditing] = useState(false)

  async function fetchDetail() {
    if (!eventId) return
    try {
      const res = await fetch(`/api/host/events/${eventId}`, { cache: 'no-store' })
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
      const data = (await res.json()) as { event: HostEvent; matches: HostMatch[] }
      setEvent(data.event)
      setMatches(data.matches)
      setAuthState('authorized')
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    fetchDetail()
  }, [eventId])

  return (
    <div className="min-h-screen bg-[#F5EFE6] flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchDetail() }} />}

      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/host" className="flex items-center gap-3">
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
            <span className="text-xs uppercase tracking-widest text-gray-500">← Host</span>
          </a>
          <button
            onClick={fetchDetail}
            className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm"
          >
            Refresh
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        {authState === 'unknown' && <p className="text-sm text-gray-500">Loading…</p>}

        {authState === 'unauthorized' && (
          <div className="bg-white border border-[#E8DDD0] rounded-2xl p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Log in to view this event</h2>
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
            <p className="text-sm text-gray-600">Event not found, or you&apos;re not listed as a host.</p>
          </div>
        )}

        {authState === 'error' && (
          <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm">
            <p className="text-sm text-red-600">Error: {errorMsg}</p>
          </div>
        )}

        {authState === 'authorized' && event && (
          <>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">
              {event.link ? (
                <a href={event.link} target="_blank" rel="noopener noreferrer" className="hover:text-gold-700 transition-colors">
                  {event.name}
                </a>
              ) : event.name}
            </h1>
            <p className="text-sm text-gray-500 mb-6">
              {[event.type, event.location, shortDate(event.date)].filter(Boolean).join(' · ')}
            </p>

            {editing ? (
              <EditForm
                event={event}
                onCancel={() => setEditing(false)}
                onSaved={() => {
                  setEditing(false)
                  fetchDetail()
                }}
              />
            ) : (
              <EventSummary event={event} onEdit={() => setEditing(true)} />
            )}

            <div className="flex items-end justify-between mb-3 mt-8 flex-wrap gap-2">
              <h3 className="text-xs uppercase tracking-widest text-gold-700 font-medium">
                Matches · {matches.length}
              </h3>
              <p className="text-xs text-gray-400">Execs whose profile fits this event (≥ 33% match)</p>
            </div>
            <div className="bg-white border border-[#E8DDD0] rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-[#FDFAF6] border-b border-[#E8DDD0]">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Name</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Function</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Seniority</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Interest</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">% Match</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m) => (
                    <tr key={m.userId} className="border-b border-[#F0E8DC] last:border-b-0 hover:bg-[#FDFAF6] transition-colors">
                      <td className="px-4 py-3">
                        {m.linkedin ? (
                          <a href={m.linkedin} target="_blank" rel="noopener noreferrer" className="text-gold-700 hover:text-gold-600 underline underline-offset-2">
                            {m.name}
                          </a>
                        ) : (
                          <span className="text-gray-800">{m.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {m.function || <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {m.seniority || <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-xs truncate">
                        {m.interest || <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${m.matchPercent >= 33 ? 'text-green-600' : 'text-gray-800'}`}>
                        {m.matchPercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {matches.length === 0 && (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">No matches above 33% yet.</p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function EventSummary({ event, onEdit }: { event: HostEvent; onEdit: () => void }) {
  return (
    <section>
      <div className="bg-gold-700 rounded-2xl p-5 shadow-sm space-y-4 text-white">
        <div className="flex justify-end">
          <button
            onClick={onEdit}
            className="shrink-0 px-4 py-2 rounded-lg bg-white text-gold-700 hover:bg-gold-50 text-sm font-semibold shadow-sm transition-colors"
          >
            Edit Event
          </button>
        </div>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <BrownField label="Name" value={event.name} />
          <BrownField label="Type" value={event.type} />
          <BrownField label="Date" value={shortDate(event.date)} />
          <BrownField label="Location" value={event.location} />
          <BrownField label="Audience" value={event.audience.join(', ')} />
          <BrownField label="Description" value={event.description} multiline />
        </dl>
      </div>
    </section>
  )
}

function BrownField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide font-bold text-white">{label}</dt>
      <dd className={`text-sm text-white/90 mt-0.5 ${multiline ? 'whitespace-pre-wrap' : ''}`}>
        {value || <span className="italic text-white/60">not set</span>}
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
      <div className="bg-gold-700 rounded-2xl p-5 shadow-sm space-y-4 text-white">
        <h3 className="text-xs uppercase tracking-widest font-bold">Edit event</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EditField label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={editInputCls} />
          </EditField>
          <EditField label="Type">
            <select value={type} onChange={(e) => setType(e.target.value)} className={editInputCls}>
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
        </div>
        {error && <p className="text-xs text-white bg-red-500/40 border border-white/30 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm text-white hover:bg-white/10 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-lg bg-white text-gold-700 hover:bg-gold-50 disabled:opacity-50 text-sm font-semibold shadow-sm transition-colors"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </section>
  )
}

function EditField({ label, hint, wide, children }: { label: string; hint?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <div className={`space-y-1 ${wide ? 'sm:col-span-2' : ''}`}>
      <label className="text-xs uppercase tracking-wide font-bold text-white">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-white/70">{hint}</p>}
    </div>
  )
}

const editInputCls =
  'w-full bg-white/95 border border-white/40 rounded-lg px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:border-white transition-colors'
