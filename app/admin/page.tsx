'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import LoginModal from '@/components/LoginModal'

interface UserRow {
  id: string
  created: string | null
  email: string
  name: string
  firstName: string
  location: string
  frequency: string
  grade: 'A' | 'Polish' | 'B' | 'C' | null
  matchCount: number
  nearbyEventCount: number
  localMatchPct: number | null
  totalContributions: number
  lastContribution: string | null
  lastSeen: string | null
  lastDigestSent: string | null
  lastBlastSent: string | null
}

interface Stats {
  activeUserCount: number
  futureEventCount: number
  generatedAt: string
}

type SortKey =
  | 'name'
  | 'location'
  | 'frequency'
  | 'grade'
  | 'matches'
  | 'localMatch'
  | 'contributions'
  | 'created'
  | 'lastContribution'
  | 'lastSeen'
  | 'lastDigestSent'
  | 'lastBlastSent'

type SortDir = 'asc' | 'desc'

// Initial direction when switching TO a column. Text columns ascend
// (A→Z); numeric and date columns descend (highest / newest first).
const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: 'asc',
  location: 'asc',
  frequency: 'asc',
  grade: 'asc',
  matches: 'desc',
  localMatch: 'desc',
  contributions: 'desc',
  created: 'desc',
  lastContribution: 'desc',
  lastSeen: 'desc',
  lastDigestSent: 'desc',
  lastBlastSent: 'desc',
}

const POLL_MS = 10_000

const FREQUENCY_FILTERS = ['All', 'As they arrive', 'Weekly', 'Monthly', 'Paused']

// Display-only shortening. Keeps backend value 'As they arrive' intact
// (Airtable picklist relies on the exact string).
function shortFrequency(f: string): string {
  return f === 'As they arrive' ? 'Arrive' : f
}

const GRADE_FILTERS = ['All', 'A', 'Polish', 'B', 'C'] as const

// Quality ordering for sorting Grade asc/desc. Aligns with the quality
// multiplier in lib/matching.ts — higher rank = better fit.
const GRADE_RANK: Record<string, number> = {
  A: 4,
  Polish: 3,
  B: 2,
  C: 1,
}

// Date filter buckets. 'never' = only show users with no value in that
// column; numeric strings = within that many days. Stored as strings
// because that's what <select> hands back.
type DateBucket = 'any' | '7' | '30' | '90' | 'never'
const DATE_OPTIONS: { value: DateBucket; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: '7', label: 'Within 7 days' },
  { value: '30', label: 'Within 30 days' },
  { value: '90', label: 'Within 90 days' },
  { value: 'never', label: 'Never' },
]

interface Filters {
  frequency: string
  grade: string
  minMatches: string
  minContributions: string
  minLocalPct: string
  maxLocalPct: string
  created: DateBucket
  lastContribution: DateBucket
  lastSent: DateBucket
  lastBlast: DateBucket
  lastSeen: DateBucket
}

function emptyFilters(): Filters {
  return {
    frequency: 'All',
    grade: 'All',
    minMatches: '',
    minContributions: '',
    minLocalPct: '',
    maxLocalPct: '',
    created: 'any',
    lastContribution: 'any',
    lastSent: 'any',
    lastBlast: 'any',
    lastSeen: 'any',
  }
}

function activeFilterCount(f: Filters): number {
  let n = 0
  if (f.frequency !== 'All') n++
  if (f.grade !== 'All') n++
  if (f.minMatches.trim() !== '') n++
  if (f.minContributions.trim() !== '') n++
  if (f.minLocalPct.trim() !== '') n++
  if (f.maxLocalPct.trim() !== '') n++
  if (f.created !== 'any') n++
  if (f.lastContribution !== 'any') n++
  if (f.lastSent !== 'any') n++
  if (f.lastBlast !== 'any') n++
  if (f.lastSeen !== 'any') n++
  return n
}

function passesDateBucket(iso: string | null, choice: DateBucket): boolean {
  if (choice === 'any') return true
  if (choice === 'never') return !iso
  if (!iso) return false
  const days = parseInt(choice, 10)
  if (!Number.isFinite(days)) return true
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return false
  return t >= Date.now() - days * 86_400_000
}

// Long form (with year) for tooltips. Short form for table cells —
// month + day only fits comfortably in the narrow date columns.
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

function compareByKey(a: UserRow, b: UserRow, key: SortKey): number {
  switch (key) {
    case 'name': return (a.name || a.email).toLowerCase().localeCompare((b.name || b.email).toLowerCase())
    case 'location': return (a.location || '').toLowerCase().localeCompare((b.location || '').toLowerCase())
    case 'frequency': return (a.frequency || '').localeCompare(b.frequency || '')
    case 'grade': return (GRADE_RANK[a.grade ?? ''] ?? 0) - (GRADE_RANK[b.grade ?? ''] ?? 0)
    case 'matches': return a.matchCount - b.matchCount
    case 'localMatch': {
      // Nulls sort last on desc (effectively -Infinity) so users with
      // no nearby events drop to the bottom when sorting "best %" first.
      const ap = a.localMatchPct ?? -1
      const bp = b.localMatchPct ?? -1
      return ap - bp
    }
    case 'contributions': return a.totalContributions - b.totalContributions
    case 'created': return dateMs(a.created) - dateMs(b.created)
    case 'lastContribution': return dateMs(a.lastContribution) - dateMs(b.lastContribution)
    case 'lastSeen': return dateMs(a.lastSeen) - dateMs(b.lastSeen)
    case 'lastDigestSent': return dateMs(a.lastDigestSent) - dateMs(b.lastDigestSent)
    case 'lastBlastSent': return dateMs(a.lastBlastSent) - dateMs(b.lastBlastSent)
  }
}

export default function AdminPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('matches')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [search, setSearch] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<Filters>(emptyFilters())
  const [rescoring, setRescoring] = useState(false)
  const [rescoreResult, setRescoreResult] = useState<string | null>(null)

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      setSortDir(DEFAULT_DIR[key])
    }
  }

  async function fetchCounts() {
    try {
      const res = await fetch('/api/admin/dashboard-counts', { cache: 'no-store' })
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
      const data = (await res.json()) as { users: UserRow[]; stats: Stats }
      setUsers(data.users)
      setStats(data.stats)
      setAuthState('authorized')
      setRefreshedAt(new Date())
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    fetchCounts()
    const id = setInterval(fetchCounts, POLL_MS)
    return () => clearInterval(id)
  }, [])

  async function rescoreMissing() {
    if (rescoring) return
    setRescoring(true)
    setRescoreResult(null)
    try {
      const res = await fetch('/api/admin/rescore-missing', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as {
        pairsMissing?: number
        pairsStale?: number
        scored?: number
        failed?: number
        error?: string
      }
      if (!res.ok) {
        setRescoreResult(`Error: ${data.error || `HTTP ${res.status}`}`)
      } else {
        const missing = data.pairsMissing ?? 0
        const stale = data.pairsStale ?? 0
        setRescoreResult(
          `Scored ${data.scored ?? 0} pairs (${missing} missing, ${stale} stale)` +
            (data.failed ? ` — ${data.failed} failed` : ''),
        )
        fetchCounts()
      }
    } catch (e) {
      setRescoreResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRescoring(false)
    }
  }

  function displayName(u: UserRow): string {
    if (u.name && u.name !== 'DEFAULT') return u.name
    if (u.firstName && u.firstName !== 'DEFAULT') return u.firstName
    return u.email
  }

  const visibleUsers = useMemo(() => {
    if (!users) return []
    const q = search.trim().toLowerCase()
    const minM = filters.minMatches.trim() === '' ? null : parseInt(filters.minMatches, 10)
    const minC = filters.minContributions.trim() === '' ? null : parseInt(filters.minContributions, 10)
    const minPct = filters.minLocalPct.trim() === '' ? null : parseInt(filters.minLocalPct, 10)
    const maxPct = filters.maxLocalPct.trim() === '' ? null : parseInt(filters.maxLocalPct, 10)
    const byFilters = users.filter((u) => {
      if (filters.frequency !== 'All' && (u.frequency || '') !== filters.frequency) return false
      if (filters.grade !== 'All' && (u.grade ?? '') !== filters.grade) return false
      if (minM !== null && Number.isFinite(minM) && u.matchCount < minM) return false
      if (minC !== null && Number.isFinite(minC) && u.totalContributions < minC) return false
      if (minPct !== null && Number.isFinite(minPct)) {
        if (u.localMatchPct === null || u.localMatchPct < minPct) return false
      }
      if (maxPct !== null && Number.isFinite(maxPct)) {
        if (u.localMatchPct === null || u.localMatchPct > maxPct) return false
      }
      if (!passesDateBucket(u.created, filters.created)) return false
      if (!passesDateBucket(u.lastContribution, filters.lastContribution)) return false
      if (!passesDateBucket(u.lastDigestSent, filters.lastSent)) return false
      if (!passesDateBucket(u.lastBlastSent, filters.lastBlast)) return false
      if (!passesDateBucket(u.lastSeen, filters.lastSeen)) return false
      return true
    })
    const filtered = q
      ? byFilters.filter((u) => {
          const name = (u.name && u.name !== 'DEFAULT' ? u.name : '').toLowerCase()
          const firstName = (u.firstName && u.firstName !== 'DEFAULT' ? u.firstName : '').toLowerCase()
          const email = u.email.toLowerCase()
          return name.includes(q) || firstName.includes(q) || email.includes(q)
        })
      : byFilters

    const dirMul = sortDir === 'asc' ? 1 : -1
    const sorted = [...filtered].sort((a, b) => {
      const primary = compareByKey(a, b, sortBy) * dirMul
      if (primary !== 0) return primary
      // Stable secondary order by name so equal primary keys don't
      // bounce around between renders.
      const an = (a.name || a.email).toLowerCase()
      const bn = (b.name || b.email).toLowerCase()
      return an.localeCompare(bn)
    })
    return sorted
  }, [users, search, sortBy, sortDir, filters])

  return (
    <div className="min-h-screen bg-[#F5EFE6] flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchCounts() }} />}

      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center">
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
          </a>
          <div className="text-xs uppercase tracking-widest text-gray-500">Admin</div>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-8">
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
            <button onClick={fetchCounts} className="mt-3 text-xs text-gold-700 hover:text-gold-600 underline">
              Retry
            </button>
          </div>
        )}

        {authState === 'authorized' && users && (
          <>
            <div className="flex items-end justify-between mb-4 flex-wrap gap-2">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">Active users</h1>
                <p className="text-xs text-gray-500 mt-1">
                  {stats?.activeUserCount ?? 0} active users · {stats?.futureEventCount ?? 0} future events
                  {refreshedAt && ` · refreshed ${refreshedAt.toLocaleTimeString()}`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {rescoreResult && (
                  <span className="text-xs text-gray-500">{rescoreResult}</span>
                )}
                <button
                  onClick={rescoreMissing}
                  disabled={rescoring}
                  className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {rescoring ? 'Rescoring…' : 'Rescore missing + stale matches'}
                </button>
                <button
                  onClick={fetchCounts}
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
                placeholder="Search by name or email…"
                className="flex-1 min-w-[200px] bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none transition-colors shadow-sm"
              />

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

            {/* Action bar for selected rows. Sticks just above the table
                so the count + buttons stay near where you're working. */}
            {selectedIds.size > 0 && (
              <div className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-[#E8DDD0] bg-white px-4 py-2.5 shadow-sm">
                <span className="text-sm text-gray-700">
                  <strong>{selectedIds.size}</strong> selected
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setSelectedIds(new Set())}
                    className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors"
                  >
                    Clear selection
                  </button>
                  <button
                    onClick={() => {
                      const ids = Array.from(selectedIds)
                      // Stash the chosen recipients for /admin/blast. Using
                      // sessionStorage instead of a URL param so the list
                      // can be arbitrarily large without bloating the URL.
                      sessionStorage.setItem('blastRecipientIds', JSON.stringify(ids))
                      window.location.href = '/admin/blast'
                    }}
                    className="px-3 py-1.5 rounded-lg text-white text-xs font-medium transition-colors"
                    style={{ background: '#6E1F2B' }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#8E2E3B')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = '#6E1F2B')}
                  >
                    Send blast →
                  </button>
                </div>
              </div>
            )}

            <div className="bg-white border border-[#E8DDD0] rounded-2xl shadow-sm">
              <table className="w-full text-sm">
                <thead
                  className="bg-[#FDFAF6] border-b border-[#E8DDD0] sticky top-0 z-20 shadow-[0_1px_0_0_#E8DDD0]"
                >
                  <tr>
                    <th className="px-3 py-3 w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all visible rows"
                        checked={
                          visibleUsers.length > 0 &&
                          visibleUsers.every((u) => selectedIds.has(u.id))
                        }
                        ref={(el) => {
                          if (!el) return
                          const some = visibleUsers.some((u) => selectedIds.has(u.id))
                          const all =
                            visibleUsers.length > 0 &&
                            visibleUsers.every((u) => selectedIds.has(u.id))
                          el.indeterminate = some && !all
                        }}
                        onChange={(e) => {
                          const next = new Set(selectedIds)
                          if (e.target.checked) {
                            visibleUsers.forEach((u) => next.add(u.id))
                          } else {
                            visibleUsers.forEach((u) => next.delete(u.id))
                          }
                          setSelectedIds(next)
                        }}
                        style={{ accentColor: '#8E2E3B' }}
                      />
                    </th>
                    <SortHeader label="Name" sortKey="name" align="left" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                    <SortHeader label="Location" sortKey="location" align="left" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                    <SortHeader label="Frequency" sortKey="frequency" align="left" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                    <SortHeader
                      label="Grade"
                      sortKey="grade"
                      align="left"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onToggle={toggleSort}
                      title="Vetting grade from Airtable. A = strongest fit (quality multiplier 1.5), Polish = solid baseline (1.0), B = down-weighted (0.5), C = won't reach notify threshold (0.25, short-circuited from scoring)."
                    />
                    <SortHeader label="Matches" sortKey="matches" align="right" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                    <SortHeader
                      label="Local"
                      sortKey="localMatch"
                      align="right"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onToggle={toggleSort}
                      title="Matches divided by total future events within 100 miles of this user's location, as a percentage. Hover any cell in this column for the raw N of M breakdown."
                    />
                    <SortHeader
                      label="Cont"
                      sortKey="contributions"
                      align="right"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onToggle={toggleSort}
                      title="Contributions — total number of events this user has shared all time (via the contribute chat, by emailing event@whispered.com, or by being recorded as the duplicate-spotter on an existing event)."
                    />
                    <SortHeader
                      label="Create"
                      sortKey="created"
                      align="right"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onToggle={toggleSort}
                      title="Created — when this user record was first added to Airtable. Pulled from the record's createdTime."
                    />
                    <SortHeader
                      label="LastCont"
                      sortKey="lastContribution"
                      align="right"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onToggle={toggleSort}
                      title="Last contribution — date the user most recently shared / spotted an event (whichever is more recent)."
                    />
                    <SortHeader
                      label="Sent"
                      sortKey="lastDigestSent"
                      align="right"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onToggle={toggleSort}
                      title="Last sent — last time we actually emailed this user a digest containing events OR a coaching nudge (the Monday cron fires coaching to dormant users with no matches; counts the same as a digest for cadence purposes). Excludes admin blasts, silent stamps from frequency-flip backlog suppression, and transactional emails (login link, application received, event-added confirmations)."
                    />
                    <SortHeader
                      label="Blast"
                      sortKey="lastBlastSent"
                      align="right"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onToggle={toggleSort}
                      title="Last blast — last time this user received an admin-composed broadcast email from /admin/blast. Separate from Sent so the digest-with-events column stays meaningful."
                    />
                    <SortHeader
                      label="Seen"
                      sortKey="lastSeen"
                      align="right"
                      sortBy={sortBy}
                      sortDir={sortDir}
                      onToggle={toggleSort}
                      title="Last seen — last time this user had an active session on the site (refreshed on any page load while logged in, throttled to once per 5 minutes per session). Empty means they've never logged in or sessions have all expired."
                    />
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((u) => (
                    <tr key={u.id} className="border-b border-[#F0E8DC] last:border-b-0 hover:bg-[#FDFAF6] transition-colors">
                      <td className="px-3 py-3 w-8">
                        <input
                          type="checkbox"
                          aria-label={`Select ${u.email}`}
                          checked={selectedIds.has(u.id)}
                          onChange={(e) => {
                            const next = new Set(selectedIds)
                            if (e.target.checked) next.add(u.id)
                            else next.delete(u.id)
                            setSelectedIds(next)
                          }}
                          style={{ accentColor: '#8E2E3B' }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <a href={`/admin/users/${u.id}`} className="text-gold-700 hover:text-gold-600 underline underline-offset-2">
                          {displayName(u)}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-gray-600 truncate max-w-xs">
                        {u.location || <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td
                        className={`px-4 py-3 whitespace-nowrap ${u.frequency ? 'text-gray-600' : 'text-gray-400'}`}
                        title={u.frequency || ''}
                      >
                        {u.frequency
                          ? shortFrequency(u.frequency)
                          : <span className="italic">—</span>}
                      </td>
                      <td className={`px-4 py-3 ${u.grade ? 'text-gray-600' : 'text-gray-400'}`}>
                        {u.grade || <span className="italic">—</span>}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${u.matchCount === 0 ? 'text-gray-400' : 'text-gray-800'}`}>
                        {u.matchCount}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${u.localMatchPct === null ? 'text-gray-400' : 'text-gray-800'}`}
                        title={
                          u.localMatchPct === null
                            ? 'No nearby events (or user has no geocoded location)'
                            : `${u.matchCount} of ${u.nearbyEventCount} events within 100mi`
                        }
                      >
                        {u.localMatchPct === null ? '—' : `${u.localMatchPct}%`}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${u.totalContributions === 0 ? 'text-gray-400' : 'text-gray-800'}`}>
                        {u.totalContributions}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${u.created ? 'text-gray-800' : 'text-gray-400'}`}
                        title={formatDate(u.created)}
                      >
                        {formatDateShort(u.created)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${u.lastContribution ? 'text-gray-800' : 'text-gray-400'}`}
                        title={formatDate(u.lastContribution)}
                      >
                        {formatDateShort(u.lastContribution)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${u.lastDigestSent ? 'text-gray-800' : 'text-gray-400'}`}
                        title={formatDate(u.lastDigestSent)}
                      >
                        {formatDateShort(u.lastDigestSent)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${u.lastBlastSent ? 'text-gray-800' : 'text-gray-400'}`}
                        title={formatDate(u.lastBlastSent)}
                      >
                        {formatDateShort(u.lastBlastSent)}
                      </td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${u.lastSeen ? 'text-gray-800' : 'text-gray-400'}`}
                        title={formatDate(u.lastSeen)}
                      >
                        {formatDateShort(u.lastSeen)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {visibleUsers.length === 0 && (
                <p className="px-4 py-6 text-sm text-gray-500 text-center">
                  {users.length === 0 ? 'No active users.' : 'No users match your search.'}
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

// Floating filter panel anchored under the Filters button. Click-outside
// dismissal handled here so the parent doesn't need a ref-passing dance.
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
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onEsc)
    }
  }, [onClose])

  function update<K extends keyof Filters>(key: K, value: Filters[K]) {
    onChange({ ...filters, [key]: value })
  }

  return (
    <div
      ref={ref}
      className="absolute z-20 mt-2 left-0 sm:left-auto sm:right-0 w-[320px] rounded-xl border border-[#E8DDD0] bg-white shadow-lg p-4 space-y-3"
    >
      <div className="grid grid-cols-2 gap-3">
        <FilterField label="Frequency">
          <select
            value={filters.frequency}
            onChange={(e) => update('frequency', e.target.value)}
            className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
          >
            {FREQUENCY_FILTERS.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Grade">
          <select
            value={filters.grade}
            onChange={(e) => update('grade', e.target.value)}
            className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
          >
            {GRADE_FILTERS.map((g) => (
              <option key={g} value={g}>{g}</option>
            ))}
          </select>
        </FilterField>
      </div>

      <div className="grid grid-cols-2 gap-3">
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
        <FilterField label="Min contributions">
          <input
            type="number"
            min={0}
            value={filters.minContributions}
            onChange={(e) => update('minContributions', e.target.value)}
            placeholder="Any"
            className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
          />
        </FilterField>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <FilterField label="Min local %">
          <input
            type="number"
            min={0}
            max={100}
            value={filters.minLocalPct}
            onChange={(e) => update('minLocalPct', e.target.value)}
            placeholder="Any"
            className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
          />
        </FilterField>
        <FilterField label="Max local %">
          <input
            type="number"
            min={0}
            max={100}
            value={filters.maxLocalPct}
            onChange={(e) => update('maxLocalPct', e.target.value)}
            placeholder="Any"
            className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
          />
        </FilterField>
      </div>

      <FilterField label="Created">
        <DateSelect
          value={filters.created}
          onChange={(v) => update('created', v)}
        />
      </FilterField>
      <FilterField label="Last contribution">
        <DateSelect
          value={filters.lastContribution}
          onChange={(v) => update('lastContribution', v)}
        />
      </FilterField>
      <FilterField label="Last sent">
        <DateSelect
          value={filters.lastSent}
          onChange={(v) => update('lastSent', v)}
        />
      </FilterField>
      <FilterField label="Last blast">
        <DateSelect
          value={filters.lastBlast}
          onChange={(v) => update('lastBlast', v)}
        />
      </FilterField>
      <FilterField label="Last seen">
        <DateSelect
          value={filters.lastSeen}
          onChange={(v) => update('lastSeen', v)}
        />
      </FilterField>

      <div className="flex items-center justify-between pt-2 border-t border-[#F0E8DC]">
        <button
          onClick={onClear}
          className="text-xs text-gray-600 hover:text-gray-900 transition-colors underline"
        >
          Clear filters
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg text-white text-xs font-medium transition-colors"
          style={{ background: '#6E1F2B' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#8E2E3B')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#6E1F2B')}
        >
          Done
        </button>
      </div>
    </div>
  )
}

// Sortable column header — clicking toggles asc/desc on the same
// column, or switches sortBy with the column's default direction.
function SortHeader({
  label,
  sortKey,
  align,
  sortBy,
  sortDir,
  onToggle,
  title,
}: {
  label: string
  sortKey: SortKey
  align: 'left' | 'right'
  sortBy: SortKey
  sortDir: SortDir
  onToggle: (key: SortKey) => void
  title?: string
}) {
  const active = sortBy === sortKey
  const arrow = active ? (sortDir === 'asc' ? '▲' : '▼') : ''
  return (
    <th className={`${align === 'left' ? 'text-left' : 'text-right'} px-4 py-3`}>
      <button
        onClick={() => onToggle(sortKey)}
        title={title}
        className={`inline-flex items-center gap-1 text-xs uppercase tracking-widest font-medium transition-colors ${
          active ? 'text-[#6E1F2B]' : 'text-gray-600 hover:text-gray-900'
        } ${align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        <span>{label}</span>
        <span className="text-[9px] opacity-70">{arrow || '↕'}</span>
      </button>
    </th>
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

function DateSelect({
  value,
  onChange,
}: {
  value: DateBucket
  onChange: (v: DateBucket) => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as DateBucket)}
      className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
    >
      {DATE_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  )
}
