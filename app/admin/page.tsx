'use client'

import { useEffect, useMemo, useState } from 'react'
import LoginModal from '@/components/LoginModal'

interface UserRow {
  id: string
  email: string
  name: string
  firstName: string
  location: string
  frequency: string
  matchCount: number
  totalContributions: number
  lastContribution: string | null
  lastSeen: string | null
  lastEmailSent: string | null
}

interface Stats {
  activeUserCount: number
  futureEventCount: number
  generatedAt: string
}

type SortKey = 'matches' | 'contributions' | 'lastContribution' | 'lastSeen' | 'lastEmailSent'

const POLL_MS = 10_000

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'matches', label: 'Match count' },
  { value: 'contributions', label: 'Total contributions' },
  { value: 'lastContribution', label: 'Last contribution' },
  { value: 'lastSeen', label: 'Last seen' },
  { value: 'lastEmailSent', label: 'Last email sent' },
]

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function AdminPage() {
  const [users, setUsers] = useState<UserRow[] | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [sortBy, setSortBy] = useState<SortKey>('matches')
  const [search, setSearch] = useState('')
  const [rescoring, setRescoring] = useState(false)
  const [rescoreResult, setRescoreResult] = useState<string | null>(null)

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
    const filtered = q
      ? users.filter((u) => {
          const name = (u.name && u.name !== 'DEFAULT' ? u.name : '').toLowerCase()
          const firstName = (u.firstName && u.firstName !== 'DEFAULT' ? u.firstName : '').toLowerCase()
          const email = u.email.toLowerCase()
          return name.includes(q) || firstName.includes(q) || email.includes(q)
        })
      : users
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'matches') {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount
      } else if (sortBy === 'contributions') {
        if (b.totalContributions !== a.totalContributions) {
          return b.totalContributions - a.totalContributions
        }
      } else if (sortBy === 'lastContribution') {
        const at = a.lastContribution ? new Date(a.lastContribution).getTime() : 0
        const bt = b.lastContribution ? new Date(b.lastContribution).getTime() : 0
        if (bt !== at) return bt - at
      } else if (sortBy === 'lastEmailSent') {
        const at = a.lastEmailSent ? new Date(a.lastEmailSent).getTime() : 0
        const bt = b.lastEmailSent ? new Date(b.lastEmailSent).getTime() : 0
        if (bt !== at) return bt - at
      } else {
        const at = a.lastSeen ? new Date(a.lastSeen).getTime() : 0
        const bt = b.lastSeen ? new Date(b.lastSeen).getTime() : 0
        if (bt !== at) return bt - at
      }
      const an = (a.name || a.email).toLowerCase()
      const bn = (b.name || b.email).toLowerCase()
      return an.localeCompare(bn)
    })
    return sorted
  }, [users, search, sortBy])

  return (
    <div className="min-h-screen bg-[#F5EFE6] flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchCounts() }} />}

      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center">
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
          </a>
          <div className="text-xs uppercase tracking-widest text-gray-500">Admin</div>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-8">
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
              className="px-4 py-2 rounded-xl bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors"
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
                className="flex-1 min-w-[200px] bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gold-400 transition-colors shadow-sm"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Sort by</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortKey)}
                  className="bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-gold-400 transition-colors shadow-sm"
                >
                  {SORT_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="bg-white border border-[#E8DDD0] rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-[#FDFAF6] border-b border-[#E8DDD0]">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Name</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Location</th>
                    <th className="text-left px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Frequency</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Matches</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Contributions</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Last contribution</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Last email sent</th>
                    <th className="text-right px-4 py-3 text-xs uppercase tracking-widest text-gold-700 font-medium">Last seen</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((u) => (
                    <tr key={u.id} className="border-b border-[#F0E8DC] last:border-b-0 hover:bg-[#FDFAF6] transition-colors">
                      <td className="px-4 py-3">
                        <a href={`/admin/users/${u.id}`} className="text-gold-700 hover:text-gold-600 underline underline-offset-2">
                          {displayName(u)}
                        </a>
                      </td>
                      <td className="px-4 py-3 text-gray-600 truncate max-w-xs">
                        {u.location || <span className="text-gray-400 italic">—</span>}
                      </td>
                      <td className={`px-4 py-3 ${u.frequency ? 'text-gray-600' : 'text-gray-400'}`}>
                        {u.frequency || <span className="italic">—</span>}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums font-medium ${u.matchCount === 0 ? 'text-gray-400' : 'text-gray-800'}`}>
                        {u.matchCount}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${u.totalContributions === 0 ? 'text-gray-400' : 'text-gray-800'}`}>
                        {u.totalContributions}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${u.lastContribution ? 'text-gray-800' : 'text-gray-400'}`}>
                        {formatDate(u.lastContribution)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${u.lastEmailSent ? 'text-gray-800' : 'text-gray-400'}`}>
                        {formatDate(u.lastEmailSent)}
                      </td>
                      <td className={`px-4 py-3 text-right tabular-nums ${u.lastSeen ? 'text-gray-800' : 'text-gray-400'}`}>
                        {formatDate(u.lastSeen)}
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
