'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import LoginModal from '@/components/LoginModal'

interface UserDetail {
  id: string
  email: string
  name: string
  firstName: string
  function: string
  seniority: string
  linkedin: string
  fullExp: string
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
    `Prefs:    ${fmtNum(e.preferenceScore)}`,
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
      const data = (await res.json()) as { user: UserDetail; events: EventRow[] }
      setUser(data.user)
      setEvents(data.events)
      setAuthState('authorized')
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
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
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
            <span className="text-xs uppercase tracking-widest text-gray-500">← Admin</span>
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
              <h3 className="text-xs uppercase tracking-widest text-gold-700 font-medium mb-4">Profile</h3>
              <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <Field label="Status" value={user.status} />
                <Field label="Frequency" value={user.frequency} />
                <Field label="Location" value={user.location} />
                <Field label="LatLon" value={user.lat !== null && user.lng !== null ? `${user.lat}, ${user.lng}` : ''} />
                <Field label="Function" value={user.function} />
                <Field label="Seniority" value={user.seniority} />
                <Field label="Grade" value={user.grade} />
                <Field label="Employment" value={user.employment} />
                <Field label="Company Size" value={user.companySize} />
                <Field label="Interest" value={user.interest} multiline />
                <Field label="How they heard" value={user.learn} multiline />
                <Field label="Full Experience" value={user.fullExp} multiline />
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
                <Field
                  label="Contributions (total / 30d / 90d)"
                  value={`${user.totalContributions} / ${user.contributionsLast30} / ${user.contributionsLast90}`}
                />
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
              </dl>
            </div>

            {/* Future events sorted by % match */}
            <div className="flex items-end justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-xs uppercase tracking-widest text-gold-700 font-medium">Future events · {events.length}</h3>
              <p className="text-xs text-gray-400">Hover the % to see the score breakdown · Green ≥ 33%, red below</p>
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
                        <a href={e.link} target="_blank" rel="noopener noreferrer" className="text-gray-800 hover:text-gold-700 transition-colors">
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
                              : e.matchPercent >= 33
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
