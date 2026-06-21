'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import LoginModal from '@/components/LoginModal'
import {
  STATUS_OPTIONS,
  normalizeStatus,
  statusPillClass,
  type UserStatus,
} from '@/lib/user-status'

interface UserDetail {
  id: string
  email: string
  name: string
  firstName: string
  function: string
  seniority: string
  linkedin: string
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

// Draft mirrors UserDetail's editable subset. Email and the read-only
// contribution/seen stats stay outside the form. Status is the canonical
// lifecycle picklist — replaces the legacy active boolean we shipped in
// Phase G. Sync derives active and is_partner from this value. The enum,
// options, and pill classes live in @/lib/user-status so the user list
// page shares the same source of truth.
interface UserDraft {
  name: string
  firstName: string
  function: string
  seniority: string
  grade: string
  location: string
  interest: string
  employment: string
  companySize: string
  frequency: string
  linkedin: string
  learn: string
  status: UserStatus
}

const GRADE_OPTIONS = ['', 'A', 'Polish', 'B', 'C'] as const

function draftFromUser(u: UserDetail): UserDraft {
  return {
    name: u.name,
    firstName: u.firstName,
    function: u.function,
    seniority: u.seniority,
    grade: u.grade,
    location: u.location,
    interest: u.interest,
    employment: u.employment,
    companySize: u.companySize,
    frequency: u.frequency,
    linkedin: u.linkedin,
    learn: u.learn,
    status: normalizeStatus(u.status),
  }
}


function draftDiff(draft: UserDraft, original: UserDraft): Partial<UserDraft> {
  const diff: Partial<UserDraft> = {}
  ;(Object.keys(draft) as Array<keyof UserDraft>).forEach((k) => {
    if (draft[k] !== original[k]) {
      ;(diff as Record<string, unknown>)[k] = draft[k]
    }
  })
  return diff
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
    `Topics:   ${fmtNum(e.preferenceScore)}`,
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
  // Edit mode batches every field change into a single PATCH on Save, so
  // updateUserAdmin (and its mirror + match-rerun pipeline) fires once per
  // edit session rather than once per keystroke. Draft is null when not
  // editing; populated from user when admin clicks Edit.
  const [draft, setDraft] = useState<UserDraft | null>(null)
  const [editBusy, setEditBusy] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const isEditing = draft !== null
  const [enrichBusy, setEnrichBusy] = useState(false)
  const [enrichMessage, setEnrichMessage] = useState<string | null>(null)

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

  function startEdit() {
    if (!user) return
    setEditError(null)
    setDraft(draftFromUser(user))
  }

  function cancelEdit() {
    setEditError(null)
    setDraft(null)
  }

  async function handleEnrich() {
    if (!userId || enrichBusy) return
    if (!window.confirm('Re-run LinkedIn enrichment? This will overwrite Name, Function, and Seniority.')) return
    setEnrichBusy(true)
    setEnrichMessage(null)
    try {
      const res = await fetch(`/api/admin/users/${userId}/enrich`, {
        method: 'POST',
        cache: 'no-store',
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        result?: { function?: string[]; seniority?: string; functionFrom?: string }
      }
      if (!res.ok || !data.ok) {
        setEnrichMessage(`Enrich failed: ${data.error || `HTTP ${res.status}`}`)
        return
      }
      const fn = data.result?.function?.join(', ') || '?'
      const sen = data.result?.seniority || '?'
      const from = data.result?.functionFrom ? ` (from ${data.result.functionFrom})` : ''
      setEnrichMessage(`Enriched → ${fn} / ${sen}${from}`)
      await fetchDetail()
    } catch (e) {
      setEnrichMessage(`Enrich failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setEnrichBusy(false)
    }
  }

  // Clear the enrich message after a few seconds.
  useEffect(() => {
    if (!enrichMessage) return
    const id = setTimeout(() => setEnrichMessage(null), 8000)
    return () => clearTimeout(id)
  }, [enrichMessage])

  async function saveEdit() {
    if (!userId || !user || !draft) return
    const original = draftFromUser(user)
    const diff = draftDiff(draft, original)
    if (Object.keys(diff).length === 0) {
      setDraft(null)
      return
    }
    setEditError(null)
    setEditBusy(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(diff),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setEditError(data.error || `HTTP ${res.status}`)
        return
      }
      setDraft(null)
      await fetchDetail()
    } catch (e) {
      setEditError(e instanceof Error ? e.message : String(e))
    } finally {
      setEditBusy(false)
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
          <div className="flex items-center gap-2">
            {enrichMessage && (
              <span
                className={`text-xs ${enrichMessage.startsWith('Enrich failed') ? 'text-red-600' : 'text-gray-500'}`}
              >
                {enrichMessage}
              </span>
            )}
            <button
              onClick={handleEnrich}
              disabled={enrichBusy || !user?.linkedin}
              title={
                user?.linkedin
                  ? 'Re-run LinkedIn enrichment via AnySite'
                  : 'No LinkedIn URL on record — add one to enable enrichment'
              }
              className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {enrichBusy ? 'Enriching…' : 'Enrich from LinkedIn'}
            </button>
            <button
              onClick={fetchDetail}
              className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm"
            >
              Refresh
            </button>
          </div>
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
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h3 className="text-xs uppercase tracking-widest text-gold-700 font-medium">Profile</h3>
                <div className="flex items-center gap-3">
                  {!isEditing ? (
                    <button
                      type="button"
                      onClick={startEdit}
                      className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors shadow-sm"
                    >
                      Edit
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={saveEdit}
                        disabled={editBusy || Object.keys(draftDiff(draft!, draftFromUser(user))).length === 0}
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
              {editError && (
                <p className="text-xs text-red-600 mb-3">{editError}</p>
              )}
              {!isEditing ? (
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-gray-400">Status</dt>
                    <dd className="mt-0.5">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${statusPillClass(normalizeStatus(user.status))}`}
                      >
                        {normalizeStatus(user.status)}
                      </span>
                    </dd>
                  </div>
                  <Field label="Frequency" value={user.frequency} />
                  <Field label="Location" value={user.location} />
                  <Field label="LatLon" value={user.lat !== null && user.lng !== null ? `${user.lat}, ${user.lng}` : ''} />
                  <Field label="Function" value={user.function} />
                  <Field label="Seniority" value={user.seniority} />
                  <Field label="Grade" value={user.grade} />
                  <Field label="Employment" value={user.employment} />
                  <Field label="Company Size" value={user.companySize} />
                  <Field label="Topics" value={user.interest} multiline />
                  <Field label="How they heard" value={user.learn} multiline />
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
              ) : (
                <UserEditForm
                  draft={draft!}
                  email={user.email}
                  onChange={setDraft}
                  disabled={editBusy}
                />
              )}
            </div>

            {/* Future events sorted by % match */}
            <div className="flex items-end justify-between mb-3 flex-wrap gap-2">
              <h3 className="text-xs uppercase tracking-widest text-gold-700 font-medium">Future events · {events.length}</h3>
              <p className="text-xs text-gray-400">Hover the % to see the score breakdown · Green ≥ 40%, red below</p>
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
                              : e.matchPercent >= 40
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

function UserEditForm({
  draft,
  email,
  onChange,
  disabled,
}: {
  draft: UserDraft
  email: string
  onChange: (next: UserDraft) => void
  disabled: boolean
}) {
  function update<K extends keyof UserDraft>(key: K, value: UserDraft[K]) {
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
            onChange={(e) => update('status', e.target.value as UserStatus)}
            className="bg-white border border-[#E8DDD0] rounded-lg px-2 py-1 text-sm text-gray-800 focus:outline-none focus:border-[#6E1F2B] disabled:opacity-50 transition-colors"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-full border text-xs font-medium ${statusPillClass(draft.status)}`}
          >
            {draft.status}
          </span>
        </label>
        <div className="text-xs text-gray-400">
          Email <span className="text-gray-700 ml-1">{email}</span>
          <span className="ml-2 italic">(read-only)</span>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
        <FormField label="Name">
          <input
            type="text"
            value={draft.name}
            disabled={disabled}
            onChange={(e) => update('name', e.target.value)}
            className={input}
          />
        </FormField>
        <FormField label="First Name">
          <input
            type="text"
            value={draft.firstName}
            disabled={disabled}
            onChange={(e) => update('firstName', e.target.value)}
            className={input}
          />
        </FormField>
        <FormField label="Function">
          <input
            type="text"
            value={draft.function}
            disabled={disabled}
            onChange={(e) => update('function', e.target.value)}
            className={input}
          />
        </FormField>
        <FormField label="Seniority">
          <input
            type="text"
            value={draft.seniority}
            disabled={disabled}
            onChange={(e) => update('seniority', e.target.value)}
            placeholder="leave blank to clear"
            className={input}
          />
        </FormField>
        <FormField label="Grade">
          <select
            value={draft.grade}
            disabled={disabled}
            onChange={(e) => update('grade', e.target.value)}
            className={input}
          >
            {GRADE_OPTIONS.map((g) => (
              <option key={g || 'blank'} value={g}>{g || '— blank —'}</option>
            ))}
          </select>
        </FormField>
        <FormField label="Frequency">
          <input
            type="text"
            value={draft.frequency}
            disabled={disabled}
            onChange={(e) => update('frequency', e.target.value)}
            placeholder="leave blank to clear"
            className={input}
          />
        </FormField>
        <FormField label="Employment">
          <input
            type="text"
            value={draft.employment}
            disabled={disabled}
            onChange={(e) => update('employment', e.target.value)}
            placeholder="leave blank to clear"
            className={input}
          />
        </FormField>
        <FormField label="Company Size">
          <input
            type="text"
            value={draft.companySize}
            disabled={disabled}
            onChange={(e) => update('companySize', e.target.value)}
            placeholder="leave blank to clear"
            className={input}
          />
        </FormField>
        <FormField label="Location" wide>
          <input
            type="text"
            value={draft.location}
            disabled={disabled}
            onChange={(e) => update('location', e.target.value)}
            placeholder="City, State or full address"
            className={input}
          />
        </FormField>
        <FormField label="LinkedIn" wide>
          <input
            type="url"
            value={draft.linkedin}
            disabled={disabled}
            onChange={(e) => update('linkedin', e.target.value)}
            placeholder="https://linkedin.com/in/…"
            className={input}
          />
        </FormField>
        <FormField label="Topics" wide>
          <textarea
            value={draft.interest}
            disabled={disabled}
            onChange={(e) => update('interest', e.target.value)}
            rows={3}
            className={`${input} leading-relaxed`}
          />
        </FormField>
        <FormField label="How they heard" wide>
          <textarea
            value={draft.learn}
            disabled={disabled}
            onChange={(e) => update('learn', e.target.value)}
            rows={3}
            className={`${input} leading-relaxed`}
          />
        </FormField>
      </div>
      <p className="text-[11px] text-gray-400">
        LatLon is auto-derived from Location on save. Single-select fields
        (Seniority, Employment, Company Size, Frequency, Grade) accept blank
        to clear. Saving fires updateUserAdmin once, which mirrors back to
        Supabase and reruns matches for this user.
      </p>
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
