'use client'

import { useState, useEffect } from 'react'
import { AirtableEvent } from '@/lib/airtable'
import Header from '@/components/Header'
import MultiSelect from '@/components/MultiSelect'
import TopicChips from '@/components/TopicChips'

interface DashboardUser {
  email: string
  name: string
  interest: string
  location: string
  employment: string
  companySize: string
  function: string
  linkedin: string
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
  rating: 'up' | 'down' | null
  ratingReason: string | null
}

const EMPLOYMENT_OPTIONS = ['Employed', 'Fractional', 'Searching', 'Other']

// Exact spellings match the Size single-select options in the Airtable
// Users table — do not change here without also updating Airtable.
const COMPANY_SIZE_OPTIONS = ['<$5M', '$5-25M', '$25-100M', '$100M-1B', '$1B+', 'Other']

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
  const [editingBio, setEditingBio] = useState(false)
  const [editingTopics, setEditingTopics] = useState(false)

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
    return <NotLoggedInPrompt />
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
          <button
            type="button"
            onClick={async () => {
              // Best-effort session destroy on the server; either way we
              // land the user on the homepage. fetch lets us swallow
              // network errors silently — a stale cookie isn't worth
              // blocking the user on.
              try {
                await fetch('/api/auth/logout', {
                  method: 'POST',
                  redirect: 'manual',
                })
              } catch {
                // ignore
              }
              window.location.href = '/'
            }}
            className="text-[13px] transition-colors"
            style={{ color: 'var(--ink-2)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-2)')}
          >
            Logout
          </button>
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

        {/* Profile CTA — split into Bio and Topics so users get the
            mental model up front (who you are vs. what you want to
            see). Each row opens its own modal so the form stays light. */}
        <section className="mb-6">
          <div className="eyebrow mb-2.5">Your profile</div>
          <div
            className="rounded-card border overflow-hidden"
            style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
          >
            <div
              className="px-5 py-4"
              style={{ borderBottom: '1px solid var(--rule-soft)' }}
            >
              <p className="m-0 font-medium" style={{ fontSize: 14, color: 'var(--ink)' }}>
                Update your profile to improve your matches
              </p>
            </div>
            <ProfileSubRow
              title="Bio"
              description="Who you are, where you are located and employment status."
              onEdit={() => setEditingBio(true)}
            />
            <div style={{ borderTop: '1px solid var(--rule-soft)' }} />
            <ProfileSubRow
              title="Topics"
              description="What topics you are interested in."
              onEdit={() => setEditingTopics(true)}
            />
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
                <EventCard
                  key={event.id}
                  event={event}
                  onRated={(rating, reason) =>
                    setEvents((prev) =>
                      prev.map((e) =>
                        e.id === event.id
                          ? { ...e, rating, ratingReason: rating === 'down' ? reason : null }
                          : e,
                      ),
                    )
                  }
                />
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

      {editingBio && (
        <BioModal
          user={user}
          onClose={() => setEditingBio(false)}
          onSaved={(u) => setUser(u)}
        />
      )}
      {editingTopics && (
        <TopicsModal
          user={user}
          onClose={() => setEditingTopics(false)}
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
        backgroundColor: 'var(--paper)',
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

// One row inside the "Your profile" card. Title + description on the
// left, accent "Edit" affordance on the right. Used for Bio and Topics.
function ProfileSubRow({
  title,
  description,
  onEdit,
}: {
  title: string
  description: string
  onEdit: () => void
}) {
  return (
    <div className="flex justify-between items-center gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="m-0 font-medium" style={{ fontSize: 14, color: 'var(--ink)' }}>
          {title}
        </p>
        <p className="mt-0.5 m-0" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {description}
        </p>
      </div>
      <button
        onClick={onEdit}
        className="eyebrow shrink-0 underline"
        style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
      >
        Edit
      </button>
    </div>
  )
}

// Shared modal chrome — heading, scrolling body, Cancel + Save footer.
// Bio and Topics modals each wrap their fields in this so the chrome
// stays consistent between them without copy-pasting 60 lines twice.
function ProfileModalShell({
  title,
  saving,
  error,
  onSave,
  onClose,
  children,
}: {
  title: string
  saving: boolean
  error: string | null
  onSave: () => void
  onClose: () => void
  children: React.ReactNode
}) {
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
            {title}
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

        <div className="px-5 py-4 space-y-4 overflow-y-auto">{children}</div>

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
              onClick={onSave}
              disabled={saving}
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

// Read-only field box used for Email + LinkedIn. Matches the look of
// the editable inputs below so the visual rhythm of the modal stays
// consistent — the only signal that the field isn't editable is the
// muted text color + the accompanying mailto hint underneath.
function ReadOnlyField({
  label,
  children,
  hint,
}: {
  label: string
  children: React.ReactNode
  hint: React.ReactNode
}) {
  return (
    <ModalField label={label}>
      <p
        className="m-0 px-3 py-2 rounded-input border text-[13px]"
        style={{
          background: 'var(--paper-2)',
          borderColor: 'var(--rule)',
          color: 'var(--ink-2)',
        }}
      >
        {children}
      </p>
      <p
        className="mt-1.5 m-0"
        style={{ fontSize: 11.5, lineHeight: 1.5, color: 'var(--ink-3)' }}
      >
        {hint}
      </p>
    </ModalField>
  )
}

function BioModal({
  user,
  onClose,
  onSaved,
}: {
  user: DashboardUser
  onClose: () => void
  onSaved: (u: DashboardUser) => void
}) {
  const [location, setLocation] = useState(user.location || '')
  const [func, setFunc] = useState(user.function || '')
  const [employment, setEmployment] = useState(user.employment || '')
  const [companySize, setCompanySize] = useState(user.companySize || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const nextSize = employment.toLowerCase() === 'employed' ? companySize : ''
      const payload = {
        location,
        function: func,
        employment,
        companySize: nextSize,
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
      onSaved({
        ...user,
        location,
        function: func,
        employment,
        companySize: nextSize,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const showSize = employment.toLowerCase() === 'employed'

  return (
    <ProfileModalShell
      title="Edit bio"
      saving={saving}
      error={error}
      onSave={handleSave}
      onClose={onClose}
    >
      <ReadOnlyField
        label="Email"
        hint={
          <>
            Need a different email? Email{' '}
            <a
              href="mailto:team@whisperedevents.com"
              style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 2 }}
            >
              team@whisperedevents.com
            </a>{' '}
            and we&rsquo;ll switch it for you.
          </>
        }
      >
        {user.email}
      </ReadOnlyField>

      <ReadOnlyField
        label="LinkedIn"
        hint={
          <>
            Changed your LinkedIn handle? Email{' '}
            <a
              href="mailto:team@whispered.com"
              style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 2 }}
            >
              team@whispered.com
            </a>{' '}
            to update it.
          </>
        }
      >
        {user.linkedin ? (
          <a
            href={user.linkedin}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: 'var(--accent)', textDecoration: 'underline', textUnderlineOffset: 2 }}
          >
            {user.linkedin}
          </a>
        ) : (
          <span style={{ color: 'var(--ink-3)' }}>Not provided</span>
        )}
      </ReadOnlyField>

      <ModalField label="Location">
        <input
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="e.g. San Francisco, CA"
          className={modalInputCls}
          style={modalInputStyle}
        />
      </ModalField>

      <ModalField label="Function">
        <input
          value={func}
          onChange={(e) => setFunc(e.target.value)}
          placeholder="e.g. RevOps, Sales, GTM"
          className={modalInputCls}
          style={modalInputStyle}
        />
      </ModalField>

      <ModalField label="Employment">
        <select
          value={employment}
          onChange={(e) => setEmployment(e.target.value)}
          className={`salon-select ${modalInputCls}`}
          style={modalInputStyle}
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
          <select
            value={companySize}
            onChange={(e) => setCompanySize(e.target.value)}
            className={`salon-select ${modalInputCls}`}
            style={modalInputStyle}
          >
            <option value="">Select…</option>
            {COMPANY_SIZE_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </ModalField>
      )}
    </ProfileModalShell>
  )
}

function TopicsModal({
  user,
  onClose,
  onSaved,
}: {
  user: DashboardUser
  onClose: () => void
  onSaved: (u: DashboardUser) => void
}) {
  const [interest, setInterest] = useState(user.interest || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = { interest }
      const res = await fetch('/api/dashboard/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      onSaved({ ...user, interest })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <ProfileModalShell
      title="Edit topics"
      saving={saving}
      error={error}
      onSave={handleSave}
      onClose={onClose}
    >
      <ModalField label="Topics">
        <div className="space-y-3">
          <textarea
            value={interest}
            onChange={(e) => setInterest(e.target.value)}
            placeholder="e.g. AI agents, RevOps, GTM, Women"
            rows={3}
            className={`${modalInputCls} resize-none`}
            style={modalInputStyle}
          />
          <TopicChips value={interest} onChange={setInterest} />
        </div>
      </ModalField>
    </ProfileModalShell>
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

// Inline style co-applied to every modal input so the colors track the
// active theme via CSS vars. Tailwind's `border` adds width only; we
// pin border-color, background, and text color explicitly so the form
// is legible on both Salon (cream) and After Hours (dark).
const modalInputStyle: React.CSSProperties = {
  backgroundColor: 'var(--paper-2)',
  borderColor: 'var(--rule)',
  color: 'var(--ink)',
}

function EventCard({
  event,
  onRated,
}: {
  event: DashboardEvent
  onRated: (rating: 'up' | 'down' | null, reason: string | null) => void
}) {
  const [showDownModal, setShowDownModal] = useState(false)
  const [showThanks, setShowThanks] = useState(false)
  const [submitting, setSubmitting] = useState(false)

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

  // Optimistically flip the UI, fire to the API, revert + alert on failure.
  // Net-negative UX to spin forever waiting on the network for a one-bit
  // rating that the user can re-click to fix anyway.
  async function writeRating(rating: 'up' | 'down' | null, reason: string | null) {
    const prevRating = event.rating
    const prevReason = event.ratingReason
    onRated(rating, reason)
    setSubmitting(true)
    try {
      const res = await fetch('/api/dashboard/match-rating', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: event.id, rating, reason }),
      })
      if (!res.ok) {
        onRated(prevRating, prevReason)
        alert("Couldn't save your rating. Please try again.")
      }
    } catch {
      onRated(prevRating, prevReason)
      alert("Couldn't save your rating. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  function handleThumbsUp() {
    if (submitting) return
    if (event.rating === 'up') {
      void writeRating(null, null)
    } else {
      void writeRating('up', null)
    }
  }

  function handleThumbsDown() {
    if (submitting) return
    if (event.rating === 'down') {
      void writeRating(null, null)
    } else {
      setShowDownModal(true)
    }
  }

  async function handleDownSubmit(reason: string) {
    setShowDownModal(false)
    await writeRating('down', reason || null)
    setShowThanks(true)
  }

  // Card background tints when the user thumbs-up'd the match — quick
  // glance signal that they've rated this one. Thumbs-down stays neutral
  // (the filled icon is the visual cue) so the negative isn't visually
  // shouty when scanning the list.
  const ratedUp = event.rating === 'up'

  return (
    <>
      <article
        className="rounded-card border px-5 py-4"
        style={{
          background: ratedUp ? 'var(--accent-soft)' : 'var(--paper)',
          borderColor: ratedUp ? 'var(--accent)' : 'var(--rule)',
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline flex-wrap gap-x-3 gap-y-1">
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
              {matchPct && <MatchBadge percent={matchPct} />}
            </div>
            <p className="m-0 mt-1" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              {[event.type, dateFormatted, event.location].filter(Boolean).join(' · ')}
            </p>
          </div>
          <RatingButtons
            rating={event.rating}
            disabled={submitting}
            onThumbsUp={handleThumbsUp}
            onThumbsDown={handleThumbsDown}
          />
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
      {showDownModal && (
        <ThumbsDownModal
          eventName={event.name}
          onCancel={() => setShowDownModal(false)}
          onSubmit={handleDownSubmit}
        />
      )}
      {showThanks && <ThumbsDownThanksModal onClose={() => setShowThanks(false)} />}
    </>
  )
}

function RatingButtons({
  rating,
  disabled,
  onThumbsUp,
  onThumbsDown,
}: {
  rating: 'up' | 'down' | null
  disabled: boolean
  onThumbsUp: () => void
  onThumbsDown: () => void
}) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        type="button"
        onClick={onThumbsUp}
        disabled={disabled}
        aria-pressed={rating === 'up'}
        aria-label={rating === 'up' ? 'Remove thumbs up' : 'Thumbs up — good match'}
        title={rating === 'up' ? 'Remove rating' : 'Good match'}
        className="inline-flex items-center justify-center rounded-full border w-8 h-8 transition-colors disabled:opacity-50"
        style={{
          background: rating === 'up' ? 'var(--accent)' : 'transparent',
          color: rating === 'up' ? 'var(--paper)' : 'var(--ink-3)',
          borderColor: rating === 'up' ? 'var(--accent)' : 'var(--rule)',
        }}
      >
        <ThumbsUpIcon filled={rating === 'up'} />
      </button>
      <button
        type="button"
        onClick={onThumbsDown}
        disabled={disabled}
        aria-pressed={rating === 'down'}
        aria-label={rating === 'down' ? 'Remove thumbs down' : 'Thumbs down — not a fit'}
        title={rating === 'down' ? 'Remove rating' : 'Not a fit'}
        className="inline-flex items-center justify-center rounded-full border w-8 h-8 transition-colors disabled:opacity-50"
        style={{
          background: rating === 'down' ? '#7A2A36' : 'transparent',
          color: rating === 'down' ? 'var(--paper)' : 'var(--ink-3)',
          borderColor: rating === 'down' ? '#7A2A36' : 'var(--rule)',
        }}
      >
        <ThumbsDownIcon filled={rating === 'down'} />
      </button>
    </div>
  )
}

function ThumbsUpIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M7 11v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3z" />
      <path d="M7 11l4-8a2 2 0 0 1 2-1c1.1 0 2 .9 2 2v6h4.5a2 2 0 0 1 2 2.3l-1.2 6A2 2 0 0 1 18.3 20H7" />
    </svg>
  )
}

function ThumbsDownIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M17 13V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3z" />
      <path d="M17 13l-4 8a2 2 0 0 1-2 1c-1.1 0-2-.9-2-2v-6H4.5a2 2 0 0 1-2-2.3l1.2-6A2 2 0 0 1 5.7 4H17" />
    </svg>
  )
}

function ThumbsDownModal({
  eventName,
  onCancel,
  onSubmit,
}: {
  eventName: string
  onCancel: () => void
  onSubmit: (reason: string) => void | Promise<void>
}) {
  const [reason, setReason] = useState('')
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-card border w-full max-w-md p-6"
        style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-serif m-0" style={{ fontSize: 20, color: 'var(--ink)' }}>
          Tell us why this one wasn&rsquo;t a fit
        </p>
        <p className="mt-1 m-0" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {eventName}
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          className="mt-3 w-full rounded-card border px-3 py-2"
          style={{
            ...modalInputStyle,
            fontSize: 14,
            resize: 'vertical',
          }}
          placeholder="Wrong topic, wrong city, wrong seniority…"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="eyebrow px-3 py-2"
            style={{ color: 'var(--ink-3)' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSubmit(reason.trim())}
            className="eyebrow px-3 py-2 rounded-pill"
            style={{
              background: 'var(--accent)',
              color: 'var(--paper)',
            }}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}

function ThumbsDownThanksModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="rounded-card border w-full max-w-md p-6"
        style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-serif m-0" style={{ fontSize: 20, color: 'var(--ink)' }}>
          Thank you for the feedback.
        </p>
        <p className="mt-2 leading-relaxed m-0" style={{ fontSize: 14, color: 'var(--ink-2)' }}>
          We&rsquo;ll use this to improve matches in the future. We love any additional feedback at{' '}
          <a
            href="mailto:team@whisperedevents.com"
            className="underline"
            style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
          >
            team@whisperedevents.com
          </a>
          .
        </p>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="eyebrow px-3 py-2 rounded-pill"
            style={{ background: 'var(--accent)', color: 'var(--paper)' }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

// Match badge — preserves the existing tooltip copy verbatim per the
// user's direction ("keep our current match visualization functionality").
function MatchBadge({ percent }: { percent: string }) {
  return (
    <span className="relative inline-flex group shrink-0">
      <span
        className="cursor-help inline-flex items-center gap-1.5 text-[11px] font-medium rounded-pill px-2.5 py-[3px] border num"
        style={{
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          borderColor: 'var(--accent-soft)',
        }}
      >
        <span
          className="rounded-full"
          style={{ width: 5, height: 5, background: 'var(--accent)' }}
        />
        {percent}
        <span style={{ opacity: 0.7 }}>match</span>
      </span>
      <span
        className="pointer-events-none absolute left-0 top-full mt-2 z-20 hidden group-hover:block w-64 text-[12px] leading-snug rounded-lg px-3 py-2 shadow-lg"
        style={{ background: 'var(--ink)', color: 'var(--paper)' }}
      >
        Matches are based on event criteria, your profile, and your interests. To improve your matches, update your profile.
      </span>
    </span>
  )
}

// Shown when /dashboard is hit without a valid session — typically a
// user clicking the footer link in a digest email on a device where
// they've never logged in. Reads ?email= from the URL so the input is
// pre-filled (every email-side dashboard link carries the recipient's
// address). Mirrors the LoginModal state machine but rendered inline
// so the user sees the form immediately rather than having to dismiss
// a modal first.
function NotLoggedInPrompt() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'loading' | 'sent' | 'not_found' | 'inactive' | 'error'>('idle')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const fromUrl = params.get('email')?.trim() ?? ''
    if (fromUrl) setEmail(fromUrl)
  }, [])

  async function handleSubmit() {
    const trimmed = email.trim()
    if (!trimmed || state === 'loading') return
    setState('loading')
    try {
      const res = await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      })
      if (res.ok) {
        setState('sent')
        return
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (data.error === 'not_found') setState('not_found')
      else if (data.error === 'inactive') setState('inactive')
      else setState('error')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div
        className="w-full max-w-[420px] rounded-card border p-7 space-y-4"
        style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
      >
        {state === 'sent' ? (
          <>
            <h2
              className="font-serif m-0"
              style={{ fontSize: 26, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              Check your email.
            </h2>
            <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              We sent a login link to <strong>{email}</strong>. It expires in 15 minutes.
            </p>
          </>
        ) : state === 'not_found' ? (
          <>
            <h2
              className="font-serif m-0"
              style={{ fontSize: 26, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              Not in our system yet.
            </h2>
            <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              Head over to <a href="/" className="underline" style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}>Find Events</a> to share your profile and apply for access.
            </p>
          </>
        ) : state === 'inactive' ? (
          <>
            <h2
              className="font-serif m-0"
              style={{ fontSize: 26, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              Account inactive.
            </h2>
            <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              New profiles are reviewed manually — if you&apos;ve just applied, you&apos;ll hear from us soon. If your access has lapsed, contribute an event to reactivate.
            </p>
          </>
        ) : (
          <>
            <h2
              className="font-serif m-0"
              style={{ fontSize: 28, lineHeight: 1.15, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              <span className="italic">Welcome</span>.
            </h2>
            <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              Your dashboard allows you to see all your matches and update your profile (to improve your matches).
            </p>
            <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55 }}>
              It looks like you haven&apos;t logged in on this device. Click below to get a secure login link.
            </p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit()
              }}
              placeholder="you@company.com"
              autoFocus
              className="w-full rounded-input border px-3.5 py-2.5 text-[14px] focus:outline-none transition-colors"
              style={{
                background: 'var(--paper-2)',
                borderColor: 'var(--rule)',
                color: 'var(--ink)',
              }}
            />
            <button
              onClick={handleSubmit}
              disabled={state === 'loading' || !email.trim()}
              className="w-full py-2.5 rounded-pill text-[13.5px] font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent)' }}
              onMouseEnter={(e) =>
                state !== 'loading' &&
                email.trim() &&
                (e.currentTarget.style.background = 'var(--accent-2)')
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
            >
              {state === 'loading' ? 'Sending…' : 'Send login link →'}
            </button>
            {state === 'error' && (
              <p className="text-center text-[12.5px]" style={{ color: 'var(--accent)' }}>
                Something went wrong. Please try again.
              </p>
            )}
            <p
              className="text-center font-serif italic"
              style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 6 }}
            >
              We look forward to seeing you at an event soon. 🥂
            </p>
            <p
              className="text-center text-[12px]"
              style={{ color: 'var(--ink-3)' }}
            >
              New here?{' '}
              <a
                href="/"
                className="underline font-medium"
                style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
              >
                Apply for access →
              </a>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
