'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import LoginModal from '@/components/LoginModal'
import { AdminTabs } from '@/components/AdminTabs'
import { formatEventDate } from '@/lib/dates'
import { normalizeStatus, statusDotClass } from '@/lib/user-status'
import {
  FIELDS,
  FIELDS_BY_ID,
  OPERATORS_BY_TYPE,
  cloneAndAppend,
  cloneAndRemove,
  cloneAndReplace,
  countConditions,
  emptyGeoValue,
  emptyRoot,
  evalGroup,
  newCondition,
  newGroup,
  parseGeoValue,
  stringifyGeoValue,
  type Condition,
  type Conjunction,
  type GeoValue,
  type Group,
  type Node as FilterNode,
  type OperatorId,
  type UserRow,
} from '@/lib/admin-filters'
import { toCsv, type CsvColumn } from '@/lib/csv'

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
  | 'ratings'

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
  ratings: 'desc',
}

const POLL_MS = 10_000

// Display-only shortening. Keeps backend value 'As they arrive' intact
// (Airtable picklist relies on the exact string).
function shortFrequency(f: string): string {
  return f === 'As they arrive' ? 'Arrive' : f
}

// Quality ordering for sorting Grade asc/desc. Aligns with the quality
// multiplier in lib/matching.ts — higher rank = better fit.
const GRADE_RANK: Record<string, number> = {
  A: 4,
  Polish: 3,
  B: 2,
  C: 1,
}

interface EventOption {
  id: string
  name: string
  date: string
}

// Page-level filter state. The condition tree handles every row-level
// predicate; matchedEventId is its own slot because it drives the
// server fetch (eventId query param), not the client-side filter pass.
interface AdminFilterState {
  matchedEventId: string
  root: Group
}

function emptyFilterState(): AdminFilterState {
  return { matchedEventId: '', root: emptyRoot() }
}

function activeFilterCount(s: AdminFilterState): number {
  return countConditions(s.root) + (s.matchedEventId ? 1 : 0)
}

// CSV column catalog for the Download CSV button. Order mirrors how
// admin scans the row in their head: identity → profile → location →
// activity → matching → flags. Every UserRow column is exported. Dates
// pass through as ISO strings (already ISO on the row). Booleans render
// 'true' / 'false'. Null/undefined → empty.
const USER_CSV_COLUMNS: CsvColumn<UserRow>[] = [
  { id: 'id', header: 'id', format: (r) => r.id },
  { id: 'email', header: 'email', format: (r) => r.email },
  { id: 'name', header: 'name', format: (r) => r.name },
  { id: 'firstName', header: 'first_name', format: (r) => r.firstName },
  { id: 'function', header: 'function', format: (r) => r.function },
  { id: 'seniority', header: 'seniority', format: (r) => r.seniority },
  { id: 'grade', header: 'grade', format: (r) => r.grade ?? '' },
  { id: 'status', header: 'status', format: (r) => r.status },
  { id: 'frequency', header: 'frequency', format: (r) => r.frequency },
  { id: 'employment', header: 'employment', format: (r) => r.employment },
  { id: 'companySize', header: 'company_size', format: (r) => r.companySize },
  { id: 'interest', header: 'topics', format: (r) => r.interest },
  { id: 'linkedin', header: 'linkedin', format: (r) => r.linkedin },
  { id: 'learn', header: 'how_they_heard', format: (r) => r.learn },
  { id: 'location', header: 'location', format: (r) => r.location },
  { id: 'lat', header: 'lat', format: (r) => r.lat },
  { id: 'lng', header: 'lng', format: (r) => r.lng },
  { id: 'created', header: 'signed_up_at', format: (r) => r.created },
  { id: 'lastSeen', header: 'last_seen_at', format: (r) => r.lastSeen },
  { id: 'lastDigestSent', header: 'last_digest_sent_at', format: (r) => r.lastDigestSent },
  { id: 'lastBlastSent', header: 'last_blast_sent_at', format: (r) => r.lastBlastSent },
  { id: 'matchCount', header: 'match_count', format: (r) => r.matchCount },
  { id: 'nearbyEventCount', header: 'nearby_event_count', format: (r) => r.nearbyEventCount },
  { id: 'localMatchPct', header: 'local_match_pct', format: (r) => r.localMatchPct },
  { id: 'totalContributions', header: 'contributions_total', format: (r) => r.totalContributions },
  { id: 'lastContribution', header: 'last_contribution_at', format: (r) => r.lastContribution },
  { id: 'ratingsGoing', header: 'interested', format: (r) => r.ratingsGoing },
  { id: 'ratingsCantMakeIt', header: 'hide', format: (r) => r.ratingsCantMakeIt },
  { id: 'ratingsNotAFit', header: 'not_a_fit', format: (r) => r.ratingsNotAFit },
  { id: 'isHost', header: 'is_host', format: (r) => (r.isHost ? 'true' : 'false') },
]

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
    case 'ratings': return (a.ratingsGoing + a.ratingsCantMakeIt + a.ratingsNotAFit) - (b.ratingsGoing + b.ratingsCantMakeIt + b.ratingsNotAFit)
  }
}

export default function AdminPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [events, setEvents] = useState<EventOption[]>([])
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
  const [filters, setFilters] = useState<AdminFilterState>(emptyFilterState())
  const [rescoring, setRescoring] = useState(false)
  const [rescoreResult, setRescoreResult] = useState<string | null>(null)
  const [rescoreProgress, setRescoreProgress] = useState<{ scored: number; total: number; pass: number } | null>(null)
  const rescoreCancelled = useRef(false)
  const [refreshingCache, setRefreshingCache] = useState(false)
  const [loadingCounts, setLoadingCounts] = useState(false)
  const [cacheResult, setCacheResult] = useState<string | null>(null)
  // Server-side status filter — translates to ?statusBucket= on the API
  // call. Defaults to 'toApprove' so admin lands on the triage queue first;
  // if the queue is empty, the first fetch auto-switches to 'live'. The
  // hasAutoFallenBack flag stops the auto-switch from firing again so admin
  // can stay on the empty queue if they explicitly navigate back.
  const [statusBucket, setStatusBucket] = useState<'live' | 'toApprove' | 'deactivated' | 'all'>('toApprove')
  const [hasAutoFallenBack, setHasAutoFallenBack] = useState(false)

  function toggleSort(key: SortKey) {
    if (sortBy === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(key)
      setSortDir(DEFAULT_DIR[key])
    }
  }

  async function fetchCounts() {
    setLoadingCounts(true)
    try {
      const params = new URLSearchParams()
      params.set('statusBucket', statusBucket)
      if (filters.matchedEventId) params.set('eventId', filters.matchedEventId)
      const res = await fetch(`/api/admin/dashboard-counts?${params}`, { cache: 'no-store' })
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
      const data = (await res.json()) as {
        users: UserRow[]
        events?: EventOption[]
        stats: Stats
      }
      setUsers(data.users)
      if (data.events) setEvents(data.events)
      setStats(data.stats)
      setAuthState('authorized')
      setRefreshedAt(new Date())

      // First-mount default lands on toApprove. If the queue is empty, fall
      // back to live so admin sees the active list instead of an empty page.
      // Guarded by hasAutoFallenBack so we don't fight admin who navigates
      // back to To Approve manually after triaging.
      if (
        statusBucket === 'toApprove' &&
        !hasAutoFallenBack &&
        data.users.length === 0
      ) {
        setHasAutoFallenBack(true)
        setStatusBucket('live')
      }
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingCounts(false)
    }
  }

  useEffect(() => {
    fetchCounts()
    const id = setInterval(fetchCounts, POLL_MS)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.matchedEventId, statusBucket])

  // Export the currently visible (post-filter, post-search) user set as
  // CSV. UTF-8 BOM prepended so Excel renders accented characters
  // cleanly. Filename includes the row count so the admin can tell which
  // slice each download was without opening it.
  function downloadCsv() {
    if (visibleUsers.length === 0) return
    const csv = toCsv(visibleUsers, USER_CSV_COLUMNS)
    const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const today = new Date().toISOString().slice(0, 10)
    const a = document.createElement('a')
    a.href = url
    a.download = `whispered-users-${today}-${visibleUsers.length}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  async function rescoreMissing() {
    if (rescoring) return
    rescoreCancelled.current = false
    setRescoring(true)
    setRescoreResult(null)
    setRescoreProgress(null)
    const MAX_PASSES = 100
    let totalScored = 0
    let totalFailed = 0
    let pass = 0
    let pairsTotal = 0
    try {
      while (pass < MAX_PASSES) {
        if (rescoreCancelled.current) {
          setRescoreResult(`Cancelled after ${pass} pass${pass === 1 ? '' : 'es'} — scored ${totalScored}`)
          fetchCounts()
          return
        }
        pass++
        const res = await fetch('/api/admin/rescore-missing', { method: 'POST' })
        const data = (await res.json().catch(() => ({}))) as {
          done?: boolean
          pairsTotal?: number
          pairsMissing?: number
          pairsStale?: number
          scored?: number
          failed?: number
          error?: string
        }
        if (!res.ok) {
          setRescoreResult(`Error on pass ${pass}: ${data.error || `HTTP ${res.status}`}`)
          return
        }
        totalScored += data.scored ?? 0
        totalFailed += data.failed ?? 0
        if (data.pairsTotal) pairsTotal = data.pairsTotal
        setRescoreProgress({ scored: totalScored, total: pairsTotal, pass })
        if (data.done) {
          setRescoreProgress(null)
          setRescoreResult(
            `Done in ${pass} pass${pass === 1 ? '' : 'es'} — scored ${totalScored} pair${
              totalScored === 1 ? '' : 's'
            }${totalFailed ? ` (${totalFailed} failed)` : ''}`,
          )
          fetchCounts()
          return
        }
      }
      setRescoreResult(
        `Stopped after ${MAX_PASSES} passes — scored ${totalScored}${
          totalFailed ? ` (${totalFailed} failed)` : ''
        }. Run again to continue.`,
      )
      fetchCounts()
    } catch (e) {
      setRescoreResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRescoring(false)
      setRescoreProgress(null)
    }
  }

  // Manual cache flush. The three public homepage endpoints
  // (/api/partners, /api/events-count, /api/featured-events) each cache
  // for 24h, so Airtable edits don't show up live until this fires.
  async function refreshCache() {
    if (refreshingCache) return
    setRefreshingCache(true)
    setCacheResult(null)
    try {
      const res = await fetch('/api/admin/refresh-cache', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as {
        revalidated?: string[]
        error?: string
      }
      if (!res.ok) {
        setCacheResult(`Error: ${data.error || `HTTP ${res.status}`}`)
      } else {
        setCacheResult(`Refreshed ${(data.revalidated ?? []).length} endpoints`)
      }
    } catch (e) {
      setCacheResult(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRefreshingCache(false)
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
    // Single pass via the condition tree. matchedEventId is applied
    // server-side via the eventId query param above, so it's not in here.
    const byFilters = users.filter((u) => evalGroup(u, filters.root, FIELDS_BY_ID))
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
            <img src="/w-olive-gold.svg" alt="Whispered Events" className="h-10 w-auto" />
          </a>
          <div className="text-xs uppercase tracking-widest text-gray-500">Admin</div>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-8">
        <AdminTabs active="users" />

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
                <h1 className="text-2xl font-semibold text-gray-900">
                  {statusBucket === 'live' && 'Live users'}
                  {statusBucket === 'toApprove' && 'Users to approve'}
                  {statusBucket === 'deactivated' && 'Deactivated users'}
                  {statusBucket === 'all' && 'All users'}
                </h1>
                <p className="text-xs text-gray-500 mt-1">
                  {stats?.activeUserCount ?? 0} users · {stats?.futureEventCount ?? 0} future events
                  {refreshedAt && ` · refreshed ${refreshedAt.toLocaleTimeString()}`}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {cacheResult && (
                  <span className="text-xs text-gray-500">{cacheResult}</span>
                )}
                <button
                  onClick={refreshCache}
                  disabled={refreshingCache}
                  className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                  title="Flush the 24h cache on the public homepage (partners list, featured events, event count). Use after editing a partner or toggling Featured on an event."
                >
                  {refreshingCache ? 'Refreshing…' : 'Refresh homepage'}
                </button>
                {rescoreProgress && (
                  <div className="flex flex-col gap-1 min-w-[180px]">
                    <span className="text-xs text-gray-500">
                      Pass {rescoreProgress.pass} — {rescoreProgress.scored}{rescoreProgress.total ? ` / ${rescoreProgress.total}` : ''} pairs scored…
                    </span>
                    {rescoreProgress.total > 0 && (
                      <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(100, (rescoreProgress.scored / rescoreProgress.total) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
                {rescoreResult && !rescoreProgress && (
                  <span className="text-xs text-gray-500">{rescoreResult}</span>
                )}
                <button
                  onClick={rescoreMissing}
                  disabled={rescoring}
                  className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {rescoring ? 'Rescoring…' : 'Rescore missing + stale matches'}
                </button>
                {rescoring && (
                  <button
                    onClick={() => { rescoreCancelled.current = true }}
                    className="px-3 py-1.5 rounded-lg border border-red-200 bg-white text-xs text-red-500 hover:bg-red-50 transition-colors shadow-sm"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={fetchCounts}
                  disabled={loadingCounts}
                  className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loadingCounts ? 'Loading…' : 'Refresh'}
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
                    events={events}
                    onChange={setFilters}
                    onClear={() => setFilters(emptyFilterState())}
                    onClose={() => setShowFilters(false)}
                  />
                )}
              </div>

              <button
                onClick={downloadCsv}
                disabled={visibleUsers.length === 0}
                title={
                  visibleUsers.length === 0
                    ? 'No rows to export'
                    : `Download ${visibleUsers.length} ${visibleUsers.length === 1 ? 'user' : 'users'} as CSV`
                }
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#E8DDD0] bg-white text-sm text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Download CSV
              </button>

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
                    {statusBucket === 'toApprove' ? (
                      <>
                        <th className="text-left px-4 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Name</th>
                        <th className="text-left px-4 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Function</th>
                        <th className="text-left px-4 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Seniority</th>
                        <th className="text-left px-4 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Location</th>
                        <th className="text-left px-4 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">LatLon</th>
                        <th className="text-left px-4 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">Employment</th>
                        <th className="text-left px-4 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium">How heard</th>
                      </>
                    ) : (
                      <>
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
                          title="Matches divided by total future events in range of this user's location, as a percentage. Hover any cell in this column for the raw N of M breakdown."
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
                          label="LastCont"
                          sortKey="lastContribution"
                          align="right"
                          sortBy={sortBy}
                          sortDir={sortDir}
                          onToggle={toggleSort}
                          title="Last contribution — date the user most recently shared / spotted an event (whichever is more recent)."
                        />
                        <SortHeader
                          label="Rating"
                          sortKey="ratings"
                          align="right"
                          sortBy={sortBy}
                          sortDir={sortDir}
                          onToggle={toggleSort}
                          title="Lifetime ratings submitted on their dashboard. Format: interested / hide / not a fit. Sorted by total."
                        />
                        <SortHeader
                          label="Sent"
                          sortKey="lastDigestSent"
                          align="right"
                          sortBy={sortBy}
                          sortDir={sortDir}
                          onToggle={toggleSort}
                          title="Last sent — last time we actually emailed this user a digest containing events OR a coaching nudge (the Monday cron fires coaching to dormant users with no matches; counts the same as a digest for cadence purposes). The Monday cron skips any Weekly/Monthly user whose Sent value is within the last 7 days, so a manual re-run mid-week won't be piled on top of by Sunday's cron. Excludes admin blasts, silent stamps from frequency-flip backlog suppression, and transactional emails (login link, application received, event-added confirmations)."
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
                          title="Last seen — most recent of: (1) active session on the site (refreshed on page load while logged in, throttled to once per 5 min), or (2) click on a rating button in an email. Empty means no login and no email engagement recorded."
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
                      </>
                    )}
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
                      <td className="px-4 py-3 min-w-[200px] whitespace-nowrap">
                        <a href={`/admin/users/${u.id}`} className="text-gold-700 hover:text-gold-600 underline underline-offset-2">
                          {displayName(u)}
                        </a>
                        {u.isHost && (
                          <span
                            className="ml-1 align-middle"
                            title="Hosts at least one future event"
                            aria-label="Host"
                          >
                            ⭐
                          </span>
                        )}
                        {(() => {
                          const s = normalizeStatus(u.status)
                          return (
                            <span
                              className={`ml-2 inline-block w-2 h-2 rounded-full border align-middle ${statusDotClass(s)}`}
                              title={`Status: ${s}`}
                              aria-label={`Status: ${s}`}
                            />
                          )
                        })()}
                      </td>
                      {statusBucket === 'toApprove' ? (
                        <>
                          <td className={`px-4 py-3 ${u.function ? 'text-gray-600' : 'text-gray-400'}`}>
                            {u.function || <span className="italic">—</span>}
                          </td>
                          <td className={`px-4 py-3 ${u.seniority ? 'text-gray-600' : 'text-gray-400'}`}>
                            {u.seniority || <span className="italic">—</span>}
                          </td>
                          <td className={`px-4 py-3 ${u.location ? 'text-gray-600' : 'text-gray-400'}`}>
                            {u.location || <span className="italic">—</span>}
                          </td>
                          <td
                            className={`px-4 py-3 whitespace-nowrap tabular-nums ${u.lat !== null && u.lng !== null ? 'text-gray-600' : 'text-gray-400'}`}
                            title={u.lat !== null && u.lng !== null ? `${u.lat}, ${u.lng}` : 'Not geocoded'}
                          >
                            {u.lat !== null && u.lng !== null
                              ? `${u.lat.toFixed(4)}, ${u.lng.toFixed(4)}`
                              : <span className="italic">—</span>}
                          </td>
                          <td className={`px-4 py-3 ${u.employment ? 'text-gray-600' : 'text-gray-400'}`}>
                            {u.employment || <span className="italic">—</span>}
                          </td>
                          <td className={`px-4 py-3 ${u.learn ? 'text-gray-600' : 'text-gray-400'}`} title={u.learn}>
                            {u.learn || <span className="italic">—</span>}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-gray-600 truncate max-w-[140px]">
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
                                : `${u.matchCount} of ${u.nearbyEventCount} events in range`
                            }
                          >
                            {u.localMatchPct === null ? '—' : `${u.localMatchPct}%`}
                          </td>
                          <td className={`px-4 py-3 text-right tabular-nums ${u.totalContributions === 0 ? 'text-gray-400' : 'text-gray-800'}`}>
                            {u.totalContributions}
                          </td>
                          <td
                            className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${u.lastContribution ? 'text-gray-800' : 'text-gray-400'}`}
                            title={formatDate(u.lastContribution)}
                          >
                            {formatDateShort(u.lastContribution)}
                          </td>
                          <td
                            className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${u.ratingsGoing + u.ratingsCantMakeIt + u.ratingsNotAFit === 0 ? 'text-gray-400' : 'text-gray-800'}`}
                            title={`${u.ratingsGoing} interested / ${u.ratingsCantMakeIt} hide / ${u.ratingsNotAFit} not a fit`}
                          >
                            {u.ratingsGoing + u.ratingsCantMakeIt + u.ratingsNotAFit === 0
                              ? '—'
                              : `${u.ratingsGoing} / ${u.ratingsCantMakeIt} / ${u.ratingsNotAFit}`}
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
                          <td
                            className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${u.created ? 'text-gray-800' : 'text-gray-400'}`}
                            title={formatDate(u.created)}
                          >
                            {formatDateShort(u.created)}
                          </td>
                        </>
                      )}
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

// Airtable-style filter modal. Holds the matched-event picker (server-
// side filter — drives the fetch) at the top, then a recursive group
// tree of conditions client-filtered against the loaded user rows.
function FilterPopover({
  filters,
  events,
  onChange,
  onClear,
  onClose,
}: {
  filters: AdminFilterState
  events: EventOption[]
  onChange: (f: AdminFilterState) => void
  onClear: () => void
  onClose: () => void
}) {
  useEffect(() => {
    function onEsc(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onEsc)
    // Lock body scroll while the modal is open so the page underneath
    // doesn't jitter when the user wheels over a select.
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onEsc)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  function setRoot(next: Group) {
    onChange({ ...filters, root: next })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ background: 'rgba(27, 24, 20, 0.45)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[820px] max-h-[90vh] overflow-y-auto"
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

        <div className="px-6 py-5 space-y-6">
          <div>
            <h3 className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold mb-3">
              Matched event
            </h3>
            <p className="text-xs text-gray-500 mb-2">
              Server-side filter — narrows the fetch to users above the notify threshold for one event.
            </p>
            <EventPicker
              events={events}
              selectedId={filters.matchedEventId}
              onChange={(id) => onChange({ ...filters, matchedEventId: id })}
            />
          </div>

          <div>
            <h3 className="text-[11px] uppercase tracking-widest text-gray-500 font-semibold mb-3">
              Conditions
            </h3>
            <GroupContainer group={filters.root} root={filters.root} onRootChange={setRoot} isRoot />
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

// Renders one group: a conjunction picker, its children (Condition rows
// or nested GroupContainers), then the Add-condition / Add-group / ×
// affordances. All mutations work by id against the root group so a
// nested row doesn't have to thread setters back up the tree.
function GroupContainer({
  group,
  root,
  onRootChange,
  isRoot = false,
}: {
  group: Group
  root: Group
  onRootChange: (next: Group) => void
  isRoot?: boolean
}) {
  function patchGroup(patch: Partial<Group>) {
    onRootChange(cloneAndReplace(root, group.id, { ...group, ...patch }))
  }

  function replaceChild(child: FilterNode) {
    onRootChange(cloneAndReplace(root, child.id, child))
  }

  function removeChild(childId: string) {
    onRootChange(cloneAndRemove(root, childId))
  }

  function addCondition() {
    onRootChange(cloneAndAppend(root, group.id, newCondition()))
  }

  function addGroup() {
    // Nested groups default to OR so the first nesting is meaningful —
    // a nested AND inside an AND tree adds no expressive power.
    onRootChange(cloneAndAppend(root, group.id, newGroup(group.conjunction === 'AND' ? 'OR' : 'AND')))
  }

  function removeSelf() {
    onRootChange(cloneAndRemove(root, group.id))
  }

  return (
    <div
      className={`${isRoot ? '' : 'border-l-2 border-[#E8DDD0] pl-3'} space-y-2`}
    >
      <div className="flex items-center gap-2 text-sm text-gray-700">
        <span>Match</span>
        <select
          value={group.conjunction}
          onChange={(e) => patchGroup({ conjunction: e.target.value as Conjunction })}
          className="bg-white border border-[#E8DDD0] rounded-lg px-2 py-1 text-sm text-gray-700 focus:outline-none transition-colors"
        >
          <option value="AND">ALL</option>
          <option value="OR">ANY</option>
        </select>
        <span>of the following:</span>
        {!isRoot && (
          <button
            type="button"
            onClick={removeSelf}
            className="ml-auto text-xs text-gray-500 hover:text-[#6E1F2B] transition-colors"
            aria-label="Remove group"
          >
            × Remove group
          </button>
        )}
      </div>

      {group.children.length === 0 && (
        <p className="text-xs text-gray-400 italic pl-1">No conditions yet.</p>
      )}

      <div className="space-y-2">
        {group.children.map((child) => {
          if (child.kind === 'condition') {
            return (
              <ConditionRow
                key={child.id}
                condition={child}
                onChange={replaceChild}
                onRemove={() => removeChild(child.id)}
              />
            )
          }
          return (
            <GroupContainer
              key={child.id}
              group={child}
              root={root}
              onRootChange={onRootChange}
            />
          )
        })}
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button
          type="button"
          onClick={addCondition}
          className="text-xs text-[#6E1F2B] hover:text-[#8E2E3B] transition-colors"
        >
          + Add condition
        </button>
        <button
          type="button"
          onClick={addGroup}
          className="text-xs text-[#6E1F2B] hover:text-[#8E2E3B] transition-colors"
        >
          + Add group
        </button>
      </div>
    </div>
  )
}

// Single condition row: Field → Operator → Value → ×. Switching field
// resets the operator (since operator sets are type-scoped); switching
// to a no-value operator clears the value.
function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: Condition
  onChange: (next: Condition) => void
  onRemove: () => void
}) {
  const field = FIELDS_BY_ID[condition.fieldId] ?? FIELDS[0]
  const operators = OPERATORS_BY_TYPE[field.type]
  const op = operators.find((o) => o.id === condition.operator) ?? operators[0]
  const inputCls =
    'bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors'

  function setField(nextFieldId: string) {
    const next = FIELDS_BY_ID[nextFieldId] ?? FIELDS[0]
    const nextOps = OPERATORS_BY_TYPE[next.type]
    // Prefer keeping the same operator if it's valid for the new field's
    // type; otherwise jump to the first operator (typically a contains/
    // equals/= depending on type) so the row stays usable.
    const sameOp = nextOps.find((o) => o.id === condition.operator)
    const nextOp = sameOp ?? nextOps[0]
    // Geo fields stash a structured JSON value; seed it so the input
    // never has to parse an empty string on first render.
    const nextValue =
      next.type === 'geo'
        ? stringifyGeoValue(emptyGeoValue())
        : nextOp.needsValue
          ? condition.value
          : ''
    onChange({
      ...condition,
      fieldId: nextFieldId,
      operator: nextOp.id,
      value: nextValue,
    })
  }

  function setOperator(nextOpId: OperatorId) {
    const nextOp = operators.find((o) => o.id === nextOpId) ?? operators[0]
    onChange({
      ...condition,
      operator: nextOpId,
      value: nextOp.needsValue ? condition.value : '',
    })
  }

  function setValue(v: string) {
    onChange({ ...condition, value: v })
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={condition.fieldId}
        onChange={(e) => setField(e.target.value)}
        className={`${inputCls} min-w-[140px]`}
      >
        {FIELDS.map((f) => (
          <option key={f.id} value={f.id}>{f.label}</option>
        ))}
      </select>
      <select
        value={condition.operator}
        onChange={(e) => setOperator(e.target.value as OperatorId)}
        className={`${inputCls} min-w-[140px]`}
      >
        {operators.map((o) => (
          <option key={o.id} value={o.id}>{o.label}</option>
        ))}
      </select>
      <ConditionValueInput field={field} operatorId={op.id} value={condition.value} onChange={setValue} />
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove condition"
        className="ml-1 w-7 h-7 rounded-full text-gray-400 hover:bg-[#F5EFE6] hover:text-[#6E1F2B] transition-colors text-base leading-none"
      >
        ×
      </button>
    </div>
  )
}

// Value input switches by field type and operator. No-value operators
// (is empty / is not empty / is true / is false) render nothing.
function ConditionValueInput({
  field,
  operatorId,
  value,
  onChange,
}: {
  field: typeof FIELDS[number]
  operatorId: OperatorId
  value: string
  onChange: (v: string) => void
}) {
  const op = OPERATORS_BY_TYPE[field.type].find((o) => o.id === operatorId)
  if (!op || !op.needsValue) return null
  const inputCls =
    'bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors min-w-[180px]'

  if (field.type === 'enum' && field.enumOptions) {
    const value0 = value || field.enumOptions[0]?.value || ''
    return (
      <select value={value0} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {field.enumOptions.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    )
  }

  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="value"
        className={inputCls}
      />
    )
  }

  if (field.type === 'date') {
    // Rolling-window operators take a count of days, not a calendar date.
    if (operatorId === 'withinDays' || operatorId === 'moreThanDaysAgo') {
      return (
        <input
          type="number"
          min={0}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="days"
          className={inputCls}
        />
      )
    }
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    )
  }

  if (field.type === 'geo') {
    return <GeoValueInput value={value} onChange={onChange} />
  }

  // text fallback
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="value"
      className={inputCls}
    />
  )
}

// Custom value input for geo conditions. Two controls:
//   [ city text · ✓/…/✗ ]   within  [ miles number ]  miles
// Typing in the city box debounces 400ms, then POSTs to the admin
// geocode proxy (Nominatim can't be called from the browser due to CORS
// + the throttle). Each new keystroke aborts the previous in-flight
// request so a fast typist doesn't get stale lat/lng written over a
// fresh resolution. The whole GeoValue (city, lat, lng, miles) is
// serialized to JSON in the condition's value string.
function GeoValueInput({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const initial = useMemo<GeoValue>(() => parseGeoValue(value || stringifyGeoValue(emptyGeoValue())), [value])
  // Local city/miles state so typing feels instant while the parent
  // only sees resolved values + miles changes.
  const [city, setCity] = useState(initial.city)
  const [miles, setMiles] = useState(String(initial.miles))
  const [status, setStatus] = useState<'idle' | 'loading' | 'ok' | 'fail'>(
    initial.city && initial.lat !== null && initial.lng !== null ? 'ok' : 'idle',
  )
  const latRef = useRef<number | null>(initial.lat)
  const lngRef = useRef<number | null>(initial.lng)
  const abortRef = useRef<AbortController | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Re-emit JSON whenever any field changes. Sourced from refs (for
  // coords) + state (for inputs) so a city resolve and a miles edit
  // both produce a fresh, valid JSON value.
  function emit(nextCity: string, nextMiles: string, lat: number | null, lng: number | null) {
    const m = Number(nextMiles)
    onChange(
      stringifyGeoValue({
        city: nextCity,
        lat,
        lng,
        miles: Number.isFinite(m) && m > 0 ? m : initial.miles,
      }),
    )
  }

  function scheduleLookup(nextCity: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (abortRef.current) abortRef.current.abort()
    const trimmed = nextCity.trim()
    if (!trimmed) {
      latRef.current = null
      lngRef.current = null
      setStatus('idle')
      emit(nextCity, miles, null, null)
      return
    }
    setStatus('loading')
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const res = await fetch(`/api/admin/geocode?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
          cache: 'no-store',
        })
        if (!res.ok) {
          latRef.current = null
          lngRef.current = null
          setStatus('fail')
          emit(nextCity, miles, null, null)
          return
        }
        const data = (await res.json()) as { lat: number; lng: number }
        latRef.current = data.lat
        lngRef.current = data.lng
        setStatus('ok')
        emit(nextCity, miles, data.lat, data.lng)
      } catch (e) {
        if ((e as { name?: string }).name === 'AbortError') return
        setStatus('fail')
        latRef.current = null
        lngRef.current = null
        emit(nextCity, miles, null, null)
      }
    }, 400)
  }

  function onCityChange(v: string) {
    setCity(v)
    scheduleLookup(v)
  }

  function onMilesChange(v: string) {
    setMiles(v)
    emit(city, v, latRef.current, lngRef.current)
  }

  const indicator =
    status === 'ok' ? '✓' : status === 'loading' ? '…' : status === 'fail' ? '✗' : ''
  const indicatorColor =
    status === 'ok' ? '#2F7A36' : status === 'fail' ? '#A1241E' : '#9CA3AF'
  const indicatorTitle =
    status === 'fail' ? "Couldn't find that city" : status === 'loading' ? 'Looking up…' : ''

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <div className="relative">
        <input
          type="text"
          value={city}
          onChange={(e) => onCityChange(e.target.value)}
          placeholder="city"
          className="bg-white border border-[#E8DDD0] rounded-lg pl-3 pr-8 py-2 text-sm text-gray-700 focus:outline-none transition-colors min-w-[180px]"
        />
        {indicator && (
          <span
            title={indicatorTitle}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-sm font-medium leading-none"
            style={{ color: indicatorColor }}
          >
            {indicator}
          </span>
        )}
      </div>
      <span className="text-sm text-gray-500">within</span>
      <input
        type="number"
        min={1}
        value={miles}
        onChange={(e) => onMilesChange(e.target.value)}
        className="bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors w-20"
      />
      <span className="text-sm text-gray-500">miles</span>
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

// Searchable single-select for the matched-event filter. Typing in the
// box narrows the dropdown to events whose name contains the query
// (case-insensitive). Clicking a row commits the id; the "× Clear"
// affordance resets the filter back to all users.
function EventPicker({
  events,
  selectedId,
  onChange,
}: {
  events: EventOption[]
  selectedId: string
  onChange: (id: string) => void
}) {
  const selected = events.find((e) => e.id === selectedId) || null
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!containerRef.current) return
      if (!containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const q = query.trim().toLowerCase()
  const filtered = q
    ? events.filter((e) => e.name.toLowerCase().includes(q))
    : events
  const shown = filtered.slice(0, 50)

  function pick(id: string) {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  return (
    <div ref={containerRef} className="relative">
      {selected ? (
        <div className="flex items-center justify-between gap-2 bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm">
          <span className="truncate text-gray-800">
            {selected.name}
            {selected.date && (
              <span className="text-gray-400 ml-2">· {formatEventDate(selected.date, { month: 'short', day: 'numeric', year: 'numeric' })}</span>
            )}
          </span>
          <button
            type="button"
            onClick={() => pick('')}
            className="text-xs text-gray-500 hover:text-gray-900 transition-colors shrink-0"
            aria-label="Clear matched-event filter"
          >
            × Clear
          </button>
        </div>
      ) : (
        <>
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
            onFocus={() => setOpen(true)}
            placeholder="Type to search events…"
            className="w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none transition-colors"
          />
          {open && shown.length > 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-white border border-[#E8DDD0] rounded-lg shadow-lg">
              {shown.map((e) => (
                <button
                  type="button"
                  key={e.id}
                  onClick={() => pick(e.id)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-[#F5EFE6] transition-colors border-b border-[#F0E8DC] last:border-b-0"
                >
                  <div className="text-gray-800 truncate">{e.name}</div>
                  {e.date && (
                    <div className="text-[11px] text-gray-400">{formatEventDate(e.date, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                  )}
                </button>
              ))}
            </div>
          )}
          {open && shown.length === 0 && (
            <div className="absolute z-10 left-0 right-0 mt-1 px-3 py-2 bg-white border border-[#E8DDD0] rounded-lg shadow-lg text-xs text-gray-500">
              No events match.
            </div>
          )}
        </>
      )}
    </div>
  )
}
