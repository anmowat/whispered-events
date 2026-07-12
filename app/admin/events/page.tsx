'use client'

import { useEffect, useMemo, useState } from 'react'
import LoginModal from '@/components/LoginModal'
import { AdminTabs } from '@/components/AdminTabs'
import { formatEventDate } from '@/lib/dates'
import { normalizeEventStatus, eventStatusDotClass } from '@/lib/event-status'

interface EventRow {
  id: string
  name: string
  type: string
  date: string
  created: string | null
  location: string
  audience: string[]
  lat: number | null
  lng: number | null
  matchCount: number
  usersInRange: number
  matchPct: number | null
  featured: boolean
  status: string
  hostCount: number
}

interface Stats {
  futureEventCount: number
  generatedAt: string
}

type Scope = 'future' | 'past' | 'all'
type FeaturedFilter = 'all' | 'yes' | 'no'

const SCOPE_LABEL: Record<Scope, string> = {
  future: 'Future events',
  past: 'Past events',
  all: 'All events',
}

type SortKey = 'name' | 'type' | 'date' | 'created' | 'location' | 'matches' | 'usersInRange' | 'matchPct'
type SortDir = 'asc' | 'desc'

const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  type: 'asc',
  date: 'asc',
  created: 'desc',
  location: 'asc',
  matches: 'desc',
  usersInRange: 'desc',
  matchPct: 'desc',
}

const POLL_MS = 15_000

const TYPE_FILTERS = ['All', 'Conference', 'Dinner', 'Happy Hour', 'Panel', 'Workshop', 'Activity', 'Other'] as const

interface Filters {
  type: (typeof TYPE_FILTERS)[number]
  location: string
  audience: string
  minMatches: string
  minMatchPct: string
}

function emptyFilters(): Filters {
  return { type: 'All', location: '', audience: '', minMatches: '', minMatchPct: '' }
}

function activeFilterCount(f: Filters): number {
  let n = 0
  if (f.type !== 'All') n++
  if (f.location.trim()) n++
  if (f.audience.trim()) n++
  if (f.minMatches.trim()) n++
  if (f.minMatchPct.trim()) n++
  return n
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDateShort(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function dateMs(iso: string | null): number {
  if (!iso) return -Infinity
  const t = new Date(iso).getTime()
  return Number.isFinite(t) ? t : -Infinity
}

function compareByKey(a: EventRow, b: EventRow, key: SortKey): number {
  switch (key) {
    case 'name': return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
    case 'type': return (a.type || '').localeCompare(b.type || '')
    case 'date': return (a.date || '').localeCompare(b.date || '')
    case 'created': return dateMs(a.created) - dateMs(b.created)
    case 'location': return (a.location || '').toLowerCase().localeCompare((b.location || '').toLowerCase())
    case 'matches': return a.matchCount - b.matchCount
    case 'usersInRange': return a.usersInRange - b.usersInRange
    case 'matchPct': {
      const ap = a.matchPct ?? -1
      const bp = b.matchPct ?? -1
      return ap - bp
    }
  }
}

export default function AdminEventsPage() {
  const [events, setEvents] = useState<EventRow[] | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [search, setSearch] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<Filters>(emptyFilters())
  // Scope and featured are server-side filters (the API translates them into
  // SQL predicates) so changes trigger refetch via the useEffect below.
  // Defaulting to future + all keeps the page's existing behavior.
  const [scope, setScope] = useState<Scope>('future')
  const [featuredFilter, setFeaturedFilter] = useState<FeaturedFilter>('all')
  // Lifecycle bucket. Default 'toApprove' so newly submitted events are front
  // and center. Auto-falls back to 'live' when there's nothing pending.
  const [statusBucket, setStatusBucket] = useState<'live' | 'toApprove' | 'deactivated' | 'all'>('toApprove')

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      setSortDir(DEFAULT_DIR[key])
    }
  }

  async function fetchEvents() {
    try {
      const qs = new URLSearchParams({ scope, featured: featuredFilter, statusBucket })
      const res = await fetch(`/api/admin/events?${qs}`, { cache: 'no-store' })
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
      const data = (await res.json()) as { events: EventRow[]; stats: Stats }
      setEvents(data.events)
      setStats(data.stats)
      setAuthState('authorized')
      setRefreshedAt(new Date())
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    fetchEvents()
    const id = setInterval(fetchEvents, POLL_MS)
    return () => clearInterval(id)
    // Refetch whenever the server-side filters change. Linter warns about
    // fetchEvents identity but it closes over both deps so this is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, featuredFilter, statusBucket])

  // If "To Approve" returns empty, fall through to "Live" automatically so
  // the page is never a blank dead end when there's nothing pending.
  useEffect(() => {
    if (statusBucket === 'toApprove' && events !== null && events.length === 0) {
      setStatusBucket('live')
    }
  }, [events, statusBucket])

  const visible = useMemo(() => {
    if (!events) return []
    const q = search.trim().toLowerCase()
    const minM = filters.minMatches.trim() === '' ? null : parseInt(filters.minMatches, 10)
    const minP = filters.minMatchPct.trim() === '' ? null : parseInt(filters.minMatchPct, 10)
    const locQ = filters.location.trim().toLowerCase()
    const audQ = filters.audience.trim().toLowerCase()
    const byFilters = events.filter((e) => {
      if (filters.type !== 'All' && e.type !== filters.type) return false
      if (locQ && !(e.location || '').toLowerCase().includes(locQ)) return false
      if (audQ && !e.audience.some((a) => a.toLowerCase().includes(audQ))) return false
      if (minM !== null && Number.isFinite(minM) && e.matchCount < minM) return false
      if (minP !== null && Number.isFinite(minP)) {
        if (e.matchPct === null || e.matchPct < minP) return false
      }
      return true
    })
    const filtered = q
      ? byFilters.filter(
          (e) =>
            e.name.toLowerCase().includes(q) ||
            e.location.toLowerCase().includes(q) ||
            e.audience.some((a) => a.toLowerCase().includes(q)),
        )
      : byFilters
    const dirMul = sortDir === 'asc' ? 1 : -1
    return [...filtered].sort((a, b) => {
      const primary = compareByKey(a, b, sortBy) * dirMul
      if (primary !== 0) return primary
      return (a.date || '').localeCompare(b.date || '')
    })
  }, [events, search, sortBy, sortDir, filters])

  return (
    <div className="min-h-screen bg-[#F5EFE6] flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchEvents() }} />}

      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center">
            <img src="/w-olive-gold.svg" alt="Whispered Events" className="h-10 w-auto" />
          </a>
          <div className="text-xs uppercase tracking-widest text-gray-500">Admin</div>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-8">
        <AdminTabs active="events" />

        {authState === 'unknown' && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}

        {authState === 'unauthorized' && (
          <div className="bg-white border border-[#E8DDD0] rounded-2xl p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Not authorized</h2>
            <p className="text-sm text-gray-500 mb-6">
              You need to be logged in as an admin email to view this page.
            </p>
            <button
              onClick={() => setShowLogin(true)}
              className="px-4 py-2 rounded-xl text-white text-sm font-medium transition-colors"
              style={{ background: '#6E1F2B' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#8E2E3B')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#6E1F2B')}
            >
              Log in
            </button>
          </div>
        )}

        {authState === 'error' && (
          <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm">
            <p className="text-sm text-red-600">Error loading data: {errorMsg}</p>
            <button onClick={fetchEvents} className="mt-3 text-xs text-gold-700 hover:text-gold-600 underline">Retry</button>
          </div>
        )}

        {authState === 'authorized' && events && (
          <>
            <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">{SCOPE_LABEL[scope]}</h1>
                <p className="text-xs text-gray-500 mt-1">
                  {stats?.futureEventCount ?? 0} events
                  {statusBucket === 'live' && ' · live'}
                  {statusBucket === 'toApprove' && ' · to approve'}
                  {statusBucket === 'deactivated' && ' · deactivated'}
                  {statusBucket === 'all' && ' · all statuses'}
                  {featuredFilter === 'yes' && ' · featured only'}
                  {featuredFilter === 'no' && ' · unfeatured only'}
                  {refreshedAt && ` · refreshed ${refreshedAt.toLocaleTimeString()}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <a
                  href="/admin/events/reclassify"
                  className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm"
                >
                  Re-classify types
                </a>
                <button
                  onClick={fetchEvents}
                  className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm"
                >
                  Refresh
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 mb-4 flex-wrap">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, location, or audience…"
                className="flex-1 min-w-[200px] bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none transition-colors shadow-sm"
              />
              <select
                value={statusBucket}
                onChange={(e) => setStatusBucket(e.target.value as typeof statusBucket)}
                title="Lifecycle bucket"
                className="bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors shadow-sm"
              >
                <option value="live">Live</option>
                <option value="toApprove">To Approve</option>
                <option value="deactivated">Deactivated</option>
                <option value="all">All</option>
              </select>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as Scope)}
                title="Date scope"
                className="bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors shadow-sm"
              >
                <option value="future">Future</option>
                <option value="past">Past</option>
                <option value="all">All time</option>
              </select>
              <select
                value={featuredFilter}
                onChange={(e) => setFeaturedFilter(e.target.value as FeaturedFilter)}
                title="Featured filter"
                className="bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors shadow-sm"
              >
                <option value="all">Featured: all</option>
                <option value="yes">Featured: yes</option>
                <option value="no">Featured: no</option>
              </select>
              <div className="relative">
                <button
                  onClick={() => setShowFilters((v) => !v)}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E8DDD0] bg-white text-sm text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm"
                >
                  Filters
                  {activeFilterCount(filters) > 0 && (
                    <span
                      className="inline-flex items-center justify-center rounded-full text-white text-[10px] font-medium w-5 h-5"
                      style={{ background: '#6E1F2B' }}
                    >
                      {activeFilterCount(filters)}
                    </span>
                  )}
                </button>
                {showFilters && (
                  <FilterPopover
                    filters={filters}
                    onChange={setFilters}
                    onClear={() => setFilters(emptyFilters())}
                    onClose={() => setShowFilters(false)}
                  />
                )}
              </div>
            </div>

            <div className="bg-white border border-[#E8DDD0] rounded-2xl shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-[#FDFAF6] border-b border-[#E8DDD0] sticky top-0 z-20 shadow-[0_1px_0_0_#E8DDD0]">
                  <tr>
                    <SortHeader label="Event" sortKey="name" align="left" toggleSort={toggleSort} sortBy={sortBy} sortDir={sortDir} />
                    <SortHeader label="Type" sortKey="type" align="left" toggleSort={toggleSort} sortBy={sortBy} sortDir={sortDir} />
                    <SortHeader label="Date" sortKey="date" align="left" toggleSort={toggleSort} sortBy={sortBy} sortDir={sortDir} />
                    <SortHeader label="Created" sortKey="created" align="left" toggleSort={toggleSort} sortBy={sortBy} sortDir={sortDir} />
                    <SortHeader label="Location" sortKey="location" align="left" toggleSort={toggleSort} sortBy={sortBy} sortDir={sortDir} />
                    <th className="text-left px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Audience</th>
                    <SortHeader label="In range" sortKey="usersInRange" align="right" toggleSort={toggleSort} sortBy={sortBy} sortDir={sortDir} />
                    <SortHeader label="Matches" sortKey="matches" align="right" toggleSort={toggleSort} sortBy={sortBy} sortDir={sortDir} />
                    <SortHeader label="% Match" sortKey="matchPct" align="right" toggleSort={toggleSort} sortBy={sortBy} sortDir={sortDir} />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => (window.location.href = `/admin/events/${e.id}`)}
                      className="border-b border-[#F0E8DC] last:border-b-0 hover:bg-[#FDFAF6] transition-colors cursor-pointer"
                    >
                      <td className="px-3 py-3 max-w-sm">
                        <span className="text-gray-800 underline decoration-[#D9CAB0] underline-offset-2 hover:decoration-gold-700">
                          {e.name}
                        </span>
                        {(() => {
                          const s = normalizeEventStatus(e.status)
                          return (
                            <span
                              className={`ml-2 inline-block w-2 h-2 rounded-full border align-middle ${eventStatusDotClass(s)}`}
                              title={`Status: ${s}`}
                              aria-label={`Status: ${s}`}
                            />
                          )
                        })()}
                        {e.featured && (
                          <span
                            className="ml-1 text-[11px] align-middle"
                            style={{ color: '#6E1F2B' }}
                            title="Featured on homepage"
                          >
                            ★
                          </span>
                        )}
                        {e.hostCount > 0 && (
                          <span
                            className="ml-1 text-[13px] align-middle"
                            title="Has a host"
                          >
                            👋🏽
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-gray-600 text-xs">{e.type || <span className="text-gray-400 italic">—</span>}</td>
                      <td className="px-3 py-3 text-gray-600 text-xs" title={formatEventDate(e.date, { month: 'short', day: 'numeric', year: 'numeric' })}>
                        {formatEventDate(e.date, { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-3 py-3 text-gray-500 text-xs" title={e.created ? formatDate(e.created) : ''}>
                        {e.created ? formatDateShort(e.created) : <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-3 py-3 text-gray-600 text-xs truncate max-w-[200px]">
                        {e.location || <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-3 py-3 text-gray-600 text-xs truncate max-w-[200px]">
                        {e.audience.length ? e.audience.join(', ') : <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-700">{e.usersInRange}</td>
                      <td className="px-3 py-3 text-right tabular-nums text-gray-700">{e.matchCount}</td>
                      <td
                        className={`px-3 py-3 text-right tabular-nums font-medium ${
                          e.matchPct === null
                            ? 'text-gray-400'
                            : e.matchPct >= 40
                              ? 'text-green-700'
                              : e.matchPct >= 15
                                ? 'text-gray-700'
                                : 'text-red-600'
                        }`}
                      >
                        {e.matchPct === null ? '—' : `${e.matchPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visible.length === 0 && (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">No events match your filters.</p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function SortHeader({
  label,
  sortKey,
  align,
  toggleSort,
  sortBy,
  sortDir,
}: {
  label: string
  sortKey: SortKey
  align: 'left' | 'right'
  toggleSort: (k: SortKey) => void
  sortBy: SortKey
  sortDir: SortDir
}) {
  const isActive = sortBy === sortKey
  return (
    <th
      className={`px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium select-none ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <button
        onClick={() => toggleSort(sortKey)}
        className={`inline-flex items-center gap-1 transition-colors ${isActive ? 'text-gold-700' : 'hover:text-gray-700'}`}
        style={{ color: isActive ? '#6E1F2B' : undefined }}
      >
        {label}
        <span className="text-[10px] opacity-60">{isActive ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
  )
}

function FilterPopover({
  filters,
  onChange,
  onClear,
  onClose,
}: {
  filters: Filters
  onChange: (f: Filters) => void
  onClear: () => void
  onClose: () => void
}) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange({ ...filters, [key]: value })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ background: 'rgba(27, 24, 20, 0.45)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[560px] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-[#E8DDD0] bg-white">
          <h2 className="text-base font-semibold text-gray-900">Filters</h2>
          <button
            onClick={onClose}
            aria-label="Close filters"
            className="w-8 h-8 rounded-full text-gray-500 hover:bg-[#F5EFE6] hover:text-gray-900 transition-colors text-lg leading-none"
          >
            ×
          </button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <FilterField label="Type">
            <select
              value={filters.type}
              onChange={(e) => update('type', e.target.value as Filters['type'])}
              className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
            >
              {TYPE_FILTERS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </FilterField>
          <FilterField label="Location contains">
            <input
              value={filters.location}
              onChange={(e) => update('location', e.target.value)}
              placeholder="e.g. San Francisco"
              className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
            />
          </FilterField>
          <FilterField label="Audience contains">
            <input
              value={filters.audience}
              onChange={(e) => update('audience', e.target.value)}
              placeholder="e.g. CRO"
              className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
            />
          </FilterField>
          <div className="grid grid-cols-2 gap-4">
            <FilterField label="Min matches">
              <input
                type="number"
                min={0}
                value={filters.minMatches}
                onChange={(e) => update('minMatches', e.target.value)}
                placeholder="Any"
                className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
              />
            </FilterField>
            <FilterField label="Min match %">
              <input
                type="number"
                min={0}
                max={100}
                value={filters.minMatchPct}
                onChange={(e) => update('minMatchPct', e.target.value)}
                placeholder="Any"
                className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
              />
            </FilterField>
          </div>
        </div>
        <div className="sticky bottom-0 flex items-center justify-between px-6 py-4 border-t border-[#E8DDD0] bg-white">
          <button
            onClick={onClear}
            className="text-sm text-gray-600 hover:text-gray-900 transition-colors underline"
          >
            Clear filters
          </button>
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg text-white text-sm font-medium transition-colors"
            style={{ background: '#6E1F2B' }}
            onMouseEnter={(e) => (e.currentTarget.style.background = '#8E2E3B')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#6E1F2B')}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] uppercase tracking-widest text-gray-500 font-medium mb-1">
        {label}
      </span>
      {children}
    </label>
  )
}
