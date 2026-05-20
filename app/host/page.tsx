'use client'

import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/Header'
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
    <div className="min-h-screen flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchEvents() }} />}

      <Header
        activeTab={null}
        onLogoClick={() => (window.location.href = '/')}
        rightSlot={
          <span className="eyebrow" style={{ color: 'var(--ink-3)' }}>Host</span>
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
              className="font-serif mb-2"
              style={{ fontSize: 24, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              Log in to view your events
            </h2>
            <p
              className="mb-6"
              style={{ fontSize: 13, color: 'var(--ink-3)' }}
            >
              We&apos;ll send you a magic link.
            </p>
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

        {authState === 'error' && (
          <div
            className="rounded-card border p-6"
            style={{
              background: 'var(--paper)',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
            }}
          >
            <p style={{ fontSize: 14 }}>Error loading events: {errorMsg}</p>
            <button
              onClick={fetchEvents}
              className="mt-3 underline text-[12px]"
              style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
            >
              Retry
            </button>
          </div>
        )}

        {authState === 'authorized' && events && (
          <>
            <div className="mb-6">
              <h1
                className="font-serif m-0"
                style={{
                  fontSize: 32,
                  color: 'var(--ink)',
                  letterSpacing: '-0.01em',
                  lineHeight: 1.1,
                }}
              >
                Your hosted events
              </h1>
              <p className="mt-1" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                {events.length} upcoming event{events.length === 1 ? '' : 's'}
              </p>
            </div>

            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by event name…"
                className="flex-1 min-w-[200px] rounded-input border border-rule bg-paper text-ink px-3 py-2 text-[13px] placeholder:opacity-60 focus:outline-none focus:border-accent transition-colors"
              />
              <div className="flex items-center gap-2">
                <label className="eyebrow">Sort by</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  className="salon-select rounded-input border border-rule bg-paper text-ink px-3 py-2 text-[13px] focus:outline-none focus:border-accent transition-colors"
                >
                  <option value="date">Date</option>
                  <option value="name">Name</option>
                </select>
              </div>
            </div>

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
                    <th className="text-left px-4 py-3 eyebrow">Event</th>
                    <th className="text-left px-4 py-3 eyebrow">Location</th>
                    <th className="text-left px-4 py-3 eyebrow">Date</th>
                    <th className="text-right px-4 py-3 eyebrow">Matches</th>
                    <th className="text-right px-4 py-3 eyebrow"></th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e, i) => (
                    <tr
                      key={e.id}
                      style={{
                        borderBottom:
                          i === visible.length - 1 ? 'none' : '1px solid var(--rule-soft)',
                      }}
                    >
                      <td className="px-4 py-3 max-w-sm">
                        {e.link ? (
                          <a
                            href={e.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                            style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
                          >
                            {e.name}
                          </a>
                        ) : (
                          <span style={{ color: 'var(--ink)' }}>{e.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 truncate max-w-xs" style={{ color: 'var(--ink-2)' }}>
                        {e.location || <span className="italic" style={{ color: 'var(--ink-3)' }}>—</span>}
                      </td>
                      <td className="px-4 py-3 num" style={{ color: 'var(--ink-2)' }}>
                        {formatDate(e.date)}
                      </td>
                      <td
                        className="px-4 py-3 text-right num font-medium"
                        style={{
                          color: e.matchCount === 0 ? 'var(--ink-3)' : 'var(--ink)',
                        }}
                      >
                        {e.matchCount}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={`/host/${e.id}`}
                          className="underline text-[12px]"
                          style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
                        >
                          View
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length === 0 && (
                <p
                  className="px-4 py-6 text-center"
                  style={{ fontSize: 13, color: 'var(--ink-3)' }}
                >
                  {events.length === 0
                    ? 'No upcoming events where you are listed as host.'
                    : 'No events match your search.'}
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
