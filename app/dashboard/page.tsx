'use client'

import { useState, useEffect } from 'react'
import { AirtableEvent } from '@/lib/airtable'

interface DashboardUser {
  email: string
  name: string
  interest: string
  location: string
  employment: string
  companySize: string
  status: string
  active: boolean
  lastContribution: string
  totalContributions: number
  frequency: string
}

const FREQUENCY_OPTIONS = [
  'Each New Event',
  'Weekly When New Events',
  'Monthly When New Events',
  'Dashboard Only',
]

type DashboardEvent = AirtableEvent & {
  matchScore: number | null
  matchPercent: number | null
}

const EMPLOYMENT_OPTIONS = ['Employed', 'Fractional', 'Searching', 'Other']

export default function DashboardPage() {
  const [user, setUser] = useState<DashboardUser | null>(null)
  const [events, setEvents] = useState<DashboardEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [editingProfile, setEditingProfile] = useState(false)
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [dateRange, setDateRange] = useState<'' | '30' | '60' | '90'>('')
  const [sortBy, setSortBy] = useState<'match' | 'date-asc' | 'date-desc'>('match')

  useEffect(() => {
    async function load() {
      const meRes = await fetch('/api/auth/me')
      const meData = (await meRes.json()) as { user: DashboardUser | null }

      if (!meData.user) {
        setLoading(false)
        return
      }
      setUser(meData.user)

      const eventsRes = await fetch('/api/dashboard/events')
      if (eventsRes.ok) {
        const eventsData = (await eventsRes.json()) as { events: DashboardEvent[] }
        setEvents(eventsData.events)
      }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5EFE6] flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5EFE6] flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <p className="text-gray-800 font-medium">You&apos;re not logged in</p>
          <a href="/" className="text-sm text-gold-600 underline underline-offset-2">Go back to Whispered Events</a>
        </div>
      </div>
    )
  }

  const types = Array.from(new Set(events.map((e) => e.type).filter(Boolean))).sort()

  const cutoffDate = (() => {
    if (!dateRange) return null
    const days = Number(dateRange)
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString().slice(0, 10)
  })()

  const filteredEvents = events
    .filter((e) => {
      if (typeFilter && e.type !== typeFilter) return false
      if (cutoffDate && e.date && e.date > cutoffDate) return false
      return true
    })
    .sort((a, b) => {
      if (sortBy === 'match') {
        const diff = (b.matchScore ?? -1) - (a.matchScore ?? -1)
        if (diff !== 0) return diff
        return (a.date || '').localeCompare(b.date || '')
      }
      if (sortBy === 'date-desc') return (b.date || '').localeCompare(a.date || '')
      return (a.date || '').localeCompare(b.date || '')
    })

  const filtersActive = !!(typeFilter || dateRange)

  return (
    <div className="min-h-screen bg-[#F5EFE6]">
      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/">
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
          </a>
          <a
            href="/"
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            ← Back to home
          </a>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        <AccountStats user={user} />

        <section className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-xs uppercase tracking-widest text-gray-400 font-medium">
                Matched events
              </h2>
              <button
                onClick={() => setEditingProfile(true)}
                className="shrink-0 px-4 py-2 rounded-lg border border-[#E8DDD0] bg-white text-sm text-gray-700 hover:border-gold-400 hover:text-gray-900 transition-colors"
              >
                Refine Matches
              </button>
            </div>
            <div className="flex items-center gap-3">
              {filtersActive && (
                <button
                  onClick={() => {
                    setTypeFilter('')
                    setDateRange('')
                  }}
                  className="text-xs text-gray-500 hover:text-gray-800 transition-colors"
                >
                  Clear filters
                </button>
              )}
              <FrequencyControl user={user} onSaved={(u) => setUser(u)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className={inputCls}
              >
                <option value="">All types</option>
                {types.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Date range</label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as '' | '30' | '60' | '90')}
                className={inputCls}
              >
                <option value="">All upcoming</option>
                <option value="90">Next 90 days</option>
                <option value="60">Next 60 days</option>
                <option value="30">Next 30 days</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as 'match' | 'date-asc' | 'date-desc')}
                className={inputCls}
              >
                <option value="match">Best match</option>
                <option value="date-asc">Date (earliest)</option>
                <option value="date-desc">Date (latest)</option>
              </select>
            </div>
          </div>

          {filteredEvents.length > 0 && (
            <div className="space-y-3">
              {filteredEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}

          <div className="pt-6 text-center text-xs text-gray-500 leading-relaxed space-y-1">
            <p>Matches are personalized based on your LinkedIn profile (seniority, function, work history).</p>
            <p>Update your profile above (Click Refine Matches).</p>
            <p>
              And if your LinkedIn has changed, email{' '}
              <a href="mailto:team@whisperedevents.com" className="text-gold-700 hover:underline">team@whisperedevents.com</a>{' '}
              and we can refresh your matches.
            </p>
          </div>
        </section>
      </main>

      {editingProfile && (
        <ProfileModal
          user={user}
          onClose={() => setEditingProfile(false)}
          onSaved={(u) => setUser(u)}
        />
      )}
    </div>
  )
}

function AccountStats({ user }: { user: DashboardUser }) {
  const lastContribution = user.lastContribution
    ? new Date(user.lastContribution).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : '—'

  const statusLabel = user.status
    ? user.status.charAt(0).toUpperCase() + user.status.slice(1).toLowerCase()
    : 'Inactive'

  return (
    <section>
      <div className="bg-gold-700 rounded-2xl p-5 shadow-sm space-y-4 text-white">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Stat label="Last contribution" value={lastContribution} />
          <Stat label="Total contributions" value={String(user.totalContributions)} />
          <Stat label="Status" value={statusLabel} />
        </div>
        {!user.active && (
          <p className="text-xs text-white/90 bg-white/10 border border-white/20 rounded-lg px-3 py-2">
            To reactivate your account, contribute an event.
          </p>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-xs uppercase tracking-wide font-bold text-white">{label}</div>
      <div className="text-sm text-white mt-1">{value}</div>
    </div>
  )
}

function FrequencyControl({
  user,
  onSaved,
}: {
  user: DashboardUser
  onSaved: (u: DashboardUser) => void
}) {
  const [saving, setSaving] = useState(false)
  const value = user.frequency || ''

  async function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value
    if (next === value) return
    setSaving(true)
    onSaved({ ...user, frequency: next })
    try {
      const res = await fetch('/api/dashboard/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency: next }),
      })
      if (!res.ok) {
        // Revert on failure
        onSaved({ ...user, frequency: value })
      }
    } catch {
      onSaved({ ...user, frequency: value })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden sm:flex items-center gap-1.5">
        <label className="text-xs text-gray-500">Email updates</label>
        <Tooltip text="Email updates coming shortly. Currently, use dashboard." />
      </div>
      <select
        value={value}
        onChange={handleChange}
        disabled={saving}
        className="bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:border-gold-400 disabled:opacity-50 transition-colors"
      >
        <option value="">Select…</option>
        {FREQUENCY_OPTIONS.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  )
}

function ProfileModal({
  user,
  onClose,
  onSaved,
}: {
  user: DashboardUser
  onClose: () => void
  onSaved: (u: DashboardUser) => void
}) {
  const [location, setLocation] = useState(user.location || '')
  const [interest, setInterest] = useState(user.interest || '')
  const [employment, setEmployment] = useState(user.employment || '')
  const [companySize, setCompanySize] = useState(user.companySize || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty =
    location !== (user.location || '') ||
    interest !== (user.interest || '') ||
    employment !== (user.employment || '') ||
    companySize !== (user.companySize || '')

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        location,
        interest,
        employment,
        companySize: employment.toLowerCase() === 'employed' ? companySize : '',
      }
      const res = await fetch('/api/dashboard/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      onSaved({ ...user, ...payload })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const showSize = employment.toLowerCase() === 'employed'

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-xl border border-[#E8DDD0] max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E8DDD0]">
          <h2 className="font-serif text-gray-900 text-lg">Edit profile</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div className="space-y-1.5">
            <label className="text-xs text-gray-500">Email</label>
            <p className="text-sm text-gray-700 bg-[#F5EFE6] border border-[#E8DDD0] rounded-lg px-3 py-2">{user.email}</p>
          </div>

          <Field label="Location" tooltip="The city that you are located in. We will show you events within a hundred miles. You can update this at any time to get refreshed matches (5 min delay once you update your profile).">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. San Francisco, CA"
              className={inputCls}
            />
          </Field>

          <Field
            label="Interests"
            tooltip="The types of events you want to see and ones you don't want to see. Add more here to refine your matches."
          >
            <textarea
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
              placeholder="e.g. RevOps, AI/ML, founder-led dinners — not pure SaaS pitch fests"
              rows={3}
              className={`${inputCls} resize-none`}
            />
          </Field>

          <Field label="Employment" tooltip="Share your current employment status.">
            <select
              value={employment}
              onChange={(e) => setEmployment(e.target.value)}
              className={inputCls}
            >
              <option value="">Select…</option>
              {EMPLOYMENT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </Field>

          {showSize && (
            <Field label="Company size" tooltip="The annual revenue of your company in millions.">
              <input
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
                placeholder="e.g. $4 million"
                className={inputCls}
              />
            </Field>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-[#E8DDD0]">
          <div className="text-xs">
            {error && <span className="text-red-600">{error}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:text-gray-900 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-5 py-2 rounded-lg bg-gold-600 hover:bg-gold-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, tooltip, children }: { label: string; tooltip: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <label className="text-xs text-gray-500">{label}</label>
        <Tooltip text={tooltip} />
      </div>
      {children}
    </div>
  )
}

function Tooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group">
      <span
        aria-label={text}
        className="cursor-help w-4 h-4 rounded-full border border-gray-300 text-gray-400 text-[10px] flex items-center justify-center select-none"
      >
        i
      </span>
      <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 z-20 hidden group-hover:block w-64 bg-gray-900 text-white text-xs leading-snug rounded-lg px-3 py-2 shadow-lg">
        {text}
      </span>
    </span>
  )
}

function EventCard({ event }: { event: DashboardEvent }) {
  const dateFormatted = event.date
    ? new Date(event.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  const NameEl = event.link ? (
    <a
      href={event.link}
      target="_blank"
      rel="noopener noreferrer"
      className="text-sm font-medium text-gold-700 hover:underline"
    >
      {event.name}
    </a>
  ) : (
    <span className="text-sm font-medium text-gray-900">{event.name}</span>
  )

  const matchPct =
    event.matchPercent !== null && event.matchPercent !== undefined
      ? `${event.matchPercent}%`
      : null

  return (
    <div className="bg-white border border-[#E8DDD0] rounded-2xl px-5 py-4 shadow-sm space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div>{NameEl}</div>
        {matchPct && (
          <span className="relative inline-flex group shrink-0">
            <span className="cursor-help text-[11px] font-medium text-gold-700 bg-gold-50 border border-gold-200 rounded-full px-2 py-0.5">
              {matchPct} match
            </span>
            <span className="pointer-events-none absolute right-0 top-full mt-1 z-20 hidden group-hover:block w-64 bg-gray-900 text-white text-xs leading-snug rounded-lg px-3 py-2 shadow-lg">
              Matches are based on event criteria, your profile, and your interests. To improve your matches, update your profile.
            </span>
          </span>
        )}
      </div>
      <p className="text-xs text-gray-500">
        {[event.type, event.location, dateFormatted].filter(Boolean).join(' · ')}
      </p>
      {event.description && (
        <p className="text-sm text-gray-600 leading-relaxed">{event.description}</p>
      )}
    </div>
  )
}

const inputCls =
  'w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gold-400 transition-colors'
