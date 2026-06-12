'use client'

import { useState, useEffect } from 'react'
import { AirtableEvent } from '@/lib/airtable'
import Header from '@/components/Header'
import MultiSelect from '@/components/MultiSelect'

interface DashboardUser {
  email: string
  name: string
  interest: string
  location: string
  employment: string
  companySize: string
  status: string
  active: boolean
  lastContribution: string | null
  totalContributions: number
  contributionsLast30: number
  contributionsLast90: number
  frequency: string
}

// Frequency picklist values — must match the Airtable Users table
// Frequency single-select options. Empty value = "not set" → no segment
// is active.
const FREQUENCY_OPTIONS = ['As they arrive', 'Weekly', 'Monthly', 'Paused']

// Display-only relabel of 'Paused' → 'Dashboard Only'. Same intent as
// the matching helper in ViewEventsTab — the backend value stays
// 'Paused' so the digest cron's frequency check keeps working.
function displayFrequency(value: string): string {
  return value === 'Paused' ? 'Dashboard Only' : value
}

type DashboardEvent = AirtableEvent & {
  matchScore: number | null
  matchPercent: number | null
}

const EMPLOYMENT_OPTIONS = ['Employed', 'Fractional', 'Searching', 'Other']

const DATE_RANGES: { id: '' | '30' | '60' | '90'; label: string }[] = [
  { id: '', label: 'All upcoming' },
  { id: '90', label: 'Next 90 days' },
  { id: '60', label: 'Next 60 days' },
  { id: '30', label: 'Next 30 days' },
]

const SORT_OPTIONS: { id: 'match' | 'date-asc' | 'date-desc'; label: string }[] = [
  { id: 'match', label: 'Best match' },
  { id: 'date-asc', label: 'Date (earliest)' },
  { id: 'date-desc', label: 'Date (latest)' },
]

export default function DashboardPage() {
  const [user, setUser] = useState<DashboardUser | null>(null)
  const [events, setEvents] = useState<DashboardEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [editingProfile, setEditingProfile] = useState(false)

  // Filter state — Type is multi-select per the redesign, the other two
  // remain single-select wrapped around the existing values.
  const [typeFilter, setTypeFilter] = useState<string[] | null>(null)
  const [dateRange, setDateRange] = useState<'' | '30' | '60' | '90'>('')
  const [sortBy, setSortBy] = useState<'match' | 'date-asc' | 'date-desc'>('match')

  // Apply the After Hours dark palette to the dashboard. CSS-var
  // overrides defined in globals.css re-theme every component on this
  // page (Header, MultiSelect, cards) automatically. Removed on unmount
  // so client navigation doesn't carry the palette to /admin.
  useEffect(() => {
    document.body.classList.add('theme-after-hours')
    return () => document.body.classList.remove('theme-after-hours')
  }, [])

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
      <div className="min-h-screen flex items-center justify-center" style={{ color: 'var(--ink-3)' }}>
        <p className="text-sm">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <p className="font-medium" style={{ color: 'var(--ink)' }}>
            You&apos;re not logged in
          </p>
          <a
            href="/"
            className="text-sm underline"
            style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
          >
            Go back to Whispered Events
          </a>
        </div>
      </div>
    )
  }

  // Initialize Type filter to all available types on first events load.
  // We store `null` until events arrive so we can distinguish
  // "not initialised yet" from "user deselected everything".
  const types = Array.from(new Set(events.map((e) => e.type).filter(Boolean))).sort()
  const effectiveTypes = typeFilter ?? types

  const cutoffDate = (() => {
    if (!dateRange) return null
    const days = Number(dateRange)
    const d = new Date()
    d.setDate(d.getDate() + days)
    return d.toISOString().slice(0, 10)
  })()

  const filteredEvents = events
    .filter((e) => {
      if (effectiveTypes.length !== types.length && !effectiveTypes.includes(e.type)) return false
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

  const firstName = user.name?.split(' ')[0] || 'there'

  return (
    <div className="min-h-screen">
      <Header
        activeTab={null}
        onLogoClick={() => (window.location.href = '/')}
        rightSlot={
          <a
            href="/"
            className="text-[13px] transition-colors"
            style={{ color: 'var(--ink-2)' }}
          >
            ← Back to home
          </a>
        }
      />

      <main className="max-w-[820px] mx-auto px-6 sm:px-8 py-10 pb-20">
        {/* Welcome */}
        <div className="mb-8">
          <h1
            className="font-serif m-0"
            style={{ fontSize: 32, lineHeight: 1.1, color: 'var(--ink)', letterSpacing: '-0.01em' }}
          >
            Welcome back, <span className="italic">{firstName}</span>
          </h1>
          <p className="mt-1" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            {user.email}
          </p>
        </div>

        {!user.active && (
          <div
            className="mb-6 rounded-card border px-4 py-3 text-[13px]"
            style={{
              borderColor: 'var(--accent-soft)',
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
            }}
          >
            To reactivate your account, contribute an event.
          </div>
        )}

        {/* Event preferences */}
        <section className="mb-6">
          <div className="eyebrow mb-2.5">Event preferences</div>
          <div
            className="rounded-card border flex justify-between items-start gap-4 px-5 py-4"
            style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
          >
            <p
              className="m-0 leading-relaxed"
              style={{ fontSize: 14, color: 'var(--ink)' }}
            >
              {user.interest || <span style={{ color: 'var(--ink-3)' }}>No interests set yet.</span>}
            </p>
            <button
              onClick={() => setEditingProfile(true)}
              className="eyebrow shrink-0 underline"
              style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
            >
              Edit
            </button>
          </div>
        </section>

        {/* Email updates */}
        <section className="mb-8">
          <div className="eyebrow mb-2.5">Email updates</div>
          <div
            className="rounded-card border px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4"
            style={{
              background: 'var(--paper)',
              borderColor: 'var(--rule)',
            }}
          >
            <div className="min-w-0">
              <p className="m-0 font-medium" style={{ fontSize: 13.5, color: 'var(--ink)' }}>
                How often should we whisper to you?
              </p>
              <p className="mt-0.5 m-0" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                Email digest of new matched events.
              </p>
            </div>
            <FrequencyControl user={user} onSaved={(u) => setUser(u)} />
          </div>
        </section>

        {/* Matched events */}
        <section>
          <div className="flex items-center justify-between mb-3.5">
            <div className="eyebrow">Your matched events</div>
            <div className="eyebrow num" style={{ color: 'var(--ink-3)' }}>
              {filteredEvents.length} {filteredEvents.length === 1 ? 'result' : 'results'}
            </div>
          </div>

          <div
            className="rounded-card border mb-3 px-3.5 py-3"
            style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FilterField label="Type">
                <MultiSelect
                  options={types}
                  selected={effectiveTypes}
                  onChange={(next) => setTypeFilter(next)}
                  allLabel="All types"
                />
              </FilterField>
              <FilterField label="Date range">
                <NativeSelect
                  value={dateRange}
                  onChange={(v) => setDateRange(v as '' | '30' | '60' | '90')}
                  options={DATE_RANGES.map((o) => ({ value: o.id, label: o.label }))}
                />
              </FilterField>
              <FilterField label="Sort">
                <NativeSelect
                  value={sortBy}
                  onChange={(v) => setSortBy(v as 'match' | 'date-asc' | 'date-desc')}
                  options={SORT_OPTIONS.map((o) => ({ value: o.id, label: o.label }))}
                />
              </FilterField>
            </div>
          </div>

          {filteredEvents.length > 0 ? (
            <div className="flex flex-col gap-3">
              {filteredEvents.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          ) : (
            <p
              className="text-center py-8"
              style={{ fontSize: 13, color: 'var(--ink-3)' }}
            >
              No events match these filters.
            </p>
          )}

          <div
            className="pt-8 text-center space-y-1 leading-relaxed"
            style={{ fontSize: 12, color: 'var(--ink-3)' }}
          >
            <p>Matches are personalized based on your LinkedIn profile (seniority, function, work history).</p>
            <p>Click Edit above to refine your matches.</p>
            <p>
              If your LinkedIn has changed, email{' '}
              <a
                href="mailto:team@whisperedevents.com"
                className="underline"
                style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
              >
                team@whisperedevents.com
              </a>{' '}
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

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function NativeSelect({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="salon-select w-full rounded-input border text-[13px] py-2 pl-3 pr-8"
      style={{
        background: 'var(--paper)',
        borderColor: 'var(--rule)',
        color: 'var(--ink)',
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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

  async function setValue(next: string) {
    if (next === value || saving) return
    setSaving(true)
    const previous = value
    onSaved({ ...user, frequency: next })
    try {
      const res = await fetch('/api/dashboard/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frequency: next }),
      })
      if (!res.ok) onSaved({ ...user, frequency: previous })
    } catch {
      onSaved({ ...user, frequency: previous })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="flex flex-wrap p-[3px] rounded-full border"
      style={{ background: 'var(--paper-2)', borderColor: 'var(--rule)' }}
    >
      {FREQUENCY_OPTIONS.map((opt) => {
        const active = value === opt
        return (
          <button
            key={opt}
            onClick={() => setValue(opt)}
            disabled={saving}
            className="px-2.5 py-1.5 rounded-full text-[11.5px] font-medium transition-colors disabled:opacity-60"
            style={{
              background: active ? 'var(--ink)' : 'transparent',
              color: active ? 'var(--paper)' : 'var(--ink-2)',
            }}
          >
            {displayFrequency(opt)}
          </button>
        )
      })}
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto"
      style={{ background: 'rgba(20,15,10,0.45)' }}
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md max-h-[90vh] flex flex-col rounded-t-card sm:rounded-card border"
        style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-4 border-b"
          style={{ borderColor: 'var(--rule)' }}
        >
          <h2 className="font-serif m-0" style={{ fontSize: 22, color: 'var(--ink)' }}>
            Edit profile
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-xl leading-none"
            style={{ color: 'var(--ink-3)' }}
          >
            &times;
          </button>
        </div>

        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <ModalField label="Email">
            <p
              className="m-0 px-3 py-2 rounded-input border text-[13px]"
              style={{
                background: 'var(--paper-2)',
                borderColor: 'var(--rule)',
                color: 'var(--ink-2)',
              }}
            >
              {user.email}
            </p>
          </ModalField>

          <ModalField label="Location">
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="e.g. San Francisco, CA"
              className={modalInputCls}
            />
          </ModalField>

          <ModalField label="Interests">
            <textarea
              value={interest}
              onChange={(e) => setInterest(e.target.value)}
              placeholder="e.g. RevOps, AI/ML, founder-led dinners — not pure SaaS pitch fests"
              rows={3}
              className={`${modalInputCls} resize-none`}
            />
          </ModalField>

          <ModalField label="Employment">
            <select
              value={employment}
              onChange={(e) => setEmployment(e.target.value)}
              className={`salon-select ${modalInputCls}`}
            >
              <option value="">Select…</option>
              {EMPLOYMENT_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </ModalField>

          {showSize && (
            <ModalField label="Company size">
              <input
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
                placeholder="e.g. $4 million"
                className={modalInputCls}
              />
            </ModalField>
          )}
        </div>

        <div
          className="flex items-center justify-between gap-3 px-5 py-4 border-t"
          style={{ borderColor: 'var(--rule)' }}
        >
          <div className="text-[12px]">
            {error && <span style={{ color: 'var(--accent)' }}>{error}</span>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[13px]"
              style={{ color: 'var(--ink-2)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty || saving}
              className="px-5 py-2 rounded-pill text-[13px] font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ background: 'var(--accent)' }}
              onMouseEnter={(e) => !saving && (e.currentTarget.style.background = 'var(--accent-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
            >
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ModalField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="eyebrow">{label}</label>
      {children}
    </div>
  )
}

const modalInputCls =
  'w-full rounded-input border px-3 py-2 text-[13px] focus:outline-none transition-colors'

function EventCard({ event }: { event: DashboardEvent }) {
  const dateFormatted = event.date
    ? new Date(event.date).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      })
    : ''

  const matchPct =
    event.matchPercent !== null && event.matchPercent !== undefined
      ? `${event.matchPercent}%`
      : null

  return (
    <article
      className="rounded-card border px-5 py-4"
      style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {event.link ? (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className="event-link font-serif"
              style={{ fontSize: 18, lineHeight: 1.25 }}
            >
              {event.name}
              <span className="arrow" aria-hidden>↗</span>
            </a>
          ) : (
            <span className="font-serif" style={{ fontSize: 18, color: 'var(--ink)' }}>
              {event.name}
            </span>
          )}
          <p className="m-0 mt-1" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {[event.type, dateFormatted, event.location].filter(Boolean).join(' · ')}
          </p>
        </div>
        {matchPct && <MatchBadge percent={matchPct} />}
      </div>
      {event.description && (
        <p
          className="m-0 mt-2 leading-relaxed"
          style={{ fontSize: 13, color: 'var(--ink-2)' }}
        >
          {event.description}
        </p>
      )}
    </article>
  )
}

// Match badge — preserves the existing tooltip copy verbatim per the
// user's direction ("keep our current match visualization functionality").
function MatchBadge({ percent }: { percent: string }) {
  return (
    <span className="relative inline-flex group shrink-0">
      <span
        className="cursor-help inline-flex items-center gap-1.5 text-[12px] font-medium rounded-pill px-3 py-[5px] border num"
        style={{
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          borderColor: 'var(--accent-soft)',
        }}
      >
        <span
          className="rounded-full"
          style={{ width: 6, height: 6, background: 'var(--accent)' }}
        />
        {percent}
        <span style={{ opacity: 0.7 }}>match</span>
      </span>
      <span
        className="pointer-events-none absolute right-0 top-full mt-2 z-20 hidden group-hover:block w-64 text-[12px] leading-snug rounded-lg px-3 py-2 shadow-lg"
        style={{ background: 'var(--ink)', color: 'var(--paper)' }}
      >
        Matches are based on event criteria, your profile, and your interests. To improve your matches, update your profile.
      </span>
    </span>
  )
}
