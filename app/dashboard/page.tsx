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
}

type DashboardEvent = AirtableEvent & { matchScore: number | null }

const EMPLOYMENT_OPTIONS = ['Employed', 'Fractional', 'Searching', 'Other']

export default function DashboardPage() {
  const [user, setUser] = useState<DashboardUser | null>(null)
  const [events, setEvents] = useState<DashboardEvent[]>([])
  const [loading, setLoading] = useState(true)

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

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/'
  }

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

  const firstName = user.name && user.name !== 'DEFAULT' ? user.name.split(' ')[0] : null

  return (
    <div className="min-h-screen bg-[#F5EFE6]">
      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/">
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
          </a>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        <div>
          <h1 className="text-xl font-serif text-gray-900">
            {firstName ? `Welcome back, ${firstName}` : 'Your dashboard'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{user.email}</p>
        </div>

        <AccountStats user={user} />

        <ProfileForm user={user} onSaved={(u) => setUser(u)} />

        <section className="space-y-4">
          <h2 className="text-xs uppercase tracking-widest text-gray-400 font-medium">
            Upcoming events
          </h2>
          {events.length === 0 ? (
            <p className="text-sm text-gray-500">No upcoming events yet.</p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>
      </main>
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
    <section className="space-y-4">
      <h2 className="text-xs uppercase tracking-widest text-gray-400 font-medium">Account</h2>
      <div className="bg-white border border-[#E8DDD0] rounded-2xl p-5 shadow-sm space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Stat label="Last contribution" value={lastContribution} />
          <Stat label="Total contributions" value={String(user.totalContributions)} />
          <Stat label="Status" value={statusLabel} />
        </div>
        {!user.active && (
          <p className="text-xs text-gray-600 bg-[#F5EFE6] border border-[#E8DDD0] rounded-lg px-3 py-2">
            To reactivate your account, contribute an event.
          </p>
        )}
      </div>
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm text-gray-900 mt-1">{value}</div>
    </div>
  )
}

function ProfileForm({ user, onSaved }: { user: DashboardUser; onSaved: (u: DashboardUser) => void }) {
  const [location, setLocation] = useState(user.location || '')
  const [interest, setInterest] = useState(user.interest || '')
  const [employment, setEmployment] = useState(user.employment || '')
  const [companySize, setCompanySize] = useState(user.companySize || '')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
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
      setSavedAt(Date.now())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const showSize = employment.toLowerCase() === 'employed'

  return (
    <section className="space-y-4">
      <h2 className="text-xs uppercase tracking-widest text-gray-400 font-medium">Your profile</h2>
      <div className="bg-white border border-[#E8DDD0] rounded-2xl p-5 space-y-4 shadow-sm">
        <Field label="Location" tooltip="The cit(ies) / metro area(s) you want to see events for">
          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="e.g. New York, NY · San Francisco, CA"
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

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="text-xs">
            {error && <span className="text-red-600">{error}</span>}
            {!error && savedAt && !dirty && <span className="text-gray-400">Saved.</span>}
          </div>
          <button
            onClick={handleSave}
            disabled={!dirty || saving}
            className="px-5 py-2.5 rounded-lg bg-gold-600 hover:bg-gold-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </section>
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
    event.matchScore !== null && event.matchScore !== undefined
      ? `${Math.round(event.matchScore * 100)}%`
      : null

  return (
    <div className="bg-white border border-[#E8DDD0] rounded-2xl px-5 py-4 shadow-sm space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <div>{NameEl}</div>
        {matchPct && (
          <span className="shrink-0 text-[11px] font-medium text-gold-700 bg-gold-50 border border-gold-200 rounded-full px-2 py-0.5">
            {matchPct} match
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
