'use client'

import { useEffect, useMemo, useState } from 'react'
import LoginModal from '@/components/LoginModal'

interface HostedEvent {
  id: string
  name: string
  location: string
  date: string
  link: string
  matchCount: number
}

type SortKey = 'date' | 'name'

function formatDate(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function HostPage() {
  const [events, setEvents] = useState<HostedEvent[] | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortKey>('date')

  async function fetchEvents() {
    try {
      const res = await fetch('/api/host/events', { cache: 'no-store' })
      if (res.status === 401) {
        setAuthState('unauthorized')
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setAuthState('error')
        setErrorMsg(data.error || `HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { events: HostedEvent[] }
      setEvents(data.events)
      setAuthState('authorized')
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    fetchEvents()
  }, [])

  const visible = useMemo(() => {
    if (!events) return []
    const q = search.trim().toLowerCase()
    const filtered = q ? events.filter((e) => e.name.toLowerCase().includes(q)) : events
    return [...filtered].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name)
      return (a.date || '').localeCompare(b.date || '')
    })
  }, [events, search, sortBy])

  return (
    <div className="min-h-screen bg-[#F5EFE6] flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchEvents() }} />}

      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center">
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
          </a>
          <div className="text-xs uppercase tracking-widest text-gray-500">Host</div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
        {authState === 'unknown' && <p className="text-sm text-gray-500">Loading…</p>}

        {authState === 'unauthorized' && (
          <div className="bg-white border border-[#E8DDD0] rounded-2xl p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Log in to view your events</h2>
            <p className="text-sm text-gray-500 mb-6">We&apos;ll send you a magic link.</p>
            <button
              onClick={() => setShowLogin(true)}
              className="px-4 py-2 rounded-xl bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors"
            >
              Log in
            </button>
          </div>
        )}

        {authState === 'error' && (
          <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm">
            <p className="text-sm text-red-600">Error loading events: {errorMsg}</p>
            <button onClick={fetchEvents} className="mt-3 text-xs text-gold-700 hover:text-gold-600 underline">
              Retry
            </button>
          </div>
        )}

        {authState === 'authorized' && events && (
          <>
            <div className="mb-4">
              <h1 className="text-2xl font-semibold text-gray-900">Your hosted events</h1>
              <p className="text-xs text-gray-500 mt-1">
                {events.length} upcoming event{events.length === 1 ? '' : 's'}
              </p>
            </div>

            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by event name…"
                className="flex-1 min-w-[200px] bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gold-400 transition-colors shadow-sm"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Sort by</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  className="bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-gold-400 transition-colors shadow-sm"
                >
                  <option value="date">Date</option>
                  <option value="name">Name</option>
                </select>
              </div>
            </div>

            <div className="bg-white border border-[#E8DDD0] rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-[#FDFAF6] border-b border-[#E8DDD0]">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Event</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Location</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Date</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Matches</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr key={e.id} className="border-b border-[#F0E8DC] last:border-b-0 hover:bg-[#FDFAF6] transition-colors">
                      <td className="px-4 py-3 max-w-sm">
                        {e.link ? (
                          <a href={e.link} target="_blank" rel="noopener noreferrer" className="text-gold-700 hover:text-gold-600 underline underline-offset-2">
                            {e.name}
                          </a>
                        ) : (
                          <span className="text-gray-800">{e.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-600 truncate max-w-xs">
                        {e.location || <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">
                        {formatDate(e.date)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${e.matchCount === 0 ? 'text-gray-400' : 'text-gray-800'}`}>
                        {e.matchCount}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a href={`/host/${e.id}`} className="text-xs text-gold-700 hover:text-gold-600 underline underline-offset-2">
                          View
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length === 0 && (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">
                  {events.length === 0 ? 'No upcoming events where you are listed as host.' : 'No events match your search.'}
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
