'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Header from '@/components/Header'
import LoginModal from '@/components/LoginModal'
import { formatEventDate } from '@/lib/dates'
import { INVITE_EMPLOYMENT_OPTIONS, INVITE_COMPANY_SIZE_OPTIONS } from '@/lib/types'

interface HostEvent {
  id: string
  name: string
  type: string
  date: string
  location: string
  description: string
  link: string
  audience: string[]
  inviteEmployment: string[]
  inviteCompanySize: string[]
  inviteSeniority: string[]
}

interface HostMatch {
  userId: string
  name: string
  linkedin: string
  function: string
  seniority: string
  interest: string
  matchPercent: number
  score: number | null
  locationScore: number | null
  audienceScore: number | null
  qualityScore: number | null
  preferenceScore: number | null
}

function fmtNum(n: number | null): string {
  if (n === null || n === undefined) return '—'
  return n.toFixed(2)
}

function scoreTooltip(m: HostMatch): string {
  return [
    `Location: ${fmtNum(m.locationScore)}`,
    `Audience: ${fmtNum(m.audienceScore)}`,
    `Quality:  ${fmtNum(m.qualityScore)}`,
    `Topics:   ${fmtNum(m.preferenceScore)}`,
    `Total:    ${fmtNum(m.score)}`,
  ].join('\n')
}

// Same options as ShareEventTab — must match the Airtable Type single-select.
// Virtual is intentionally omitted from edit-time choices (we don't accept
// virtuals); the PATCH route also rejects Virtual on save.
const TYPE_OPTIONS = ['Conference', 'Dinner', 'Other']

function shortDate(iso: string): string {
  return formatEventDate(iso, { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function HostEventDetailPage() {
  const params = useParams<{ id: string }>()
  const eventId = params?.id

  const [event, setEvent] = useState<HostEvent | null>(null)
  const [matches, setMatches] = useState<HostMatch[]>([])
  const [regionCount, setRegionCount] = useState<number | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'not_found' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [editing, setEditing] = useState(false)

  async function fetchDetail() {
    if (!eventId) return
    try {
      const res = await fetch(`/api/host/events/${eventId}`, { cache: 'no-store' })
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
      const data = (await res.json()) as { event: HostEvent; matches: HostMatch[]; regionCount?: number }
      setEvent(data.event)
      setMatches(data.matches)
      setRegionCount(data.regionCount ?? null)
      setAuthState('authorized')
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    fetchDetail()
  }, [eventId])

  // After Hours palette for the host event detail page.
  useEffect(() => {
    document.body.classList.add('theme-after-hours')
    return () => document.body.classList.remove('theme-after-hours')
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchDetail() }} />}

      <Header
        activeTab={null}
        onLogoClick={() => (window.location.href = '/host')}
        rightSlot={
          <div className="flex items-center gap-3">
            <a
              href="/host"
              className="eyebrow"
              style={{ color: 'var(--ink-3)' }}
            >
              ← Host
            </a>
            <button
              onClick={fetchDetail}
              className="rounded-pill border text-[12px] px-3 py-1.5 transition-colors"
              style={{
                background: 'var(--paper)',
                borderColor: 'var(--rule)',
                color: 'var(--ink-2)',
              }}
            >
              Refresh
            </button>
          </div>
        }
      />

      <main className="flex-1 max-w-5xl w-full mx-auto px-6 sm:px-8 py-10 pb-20">
        {authState === 'unknown' && (
          <p style={{ fontSize: 14, color: 'var(--ink-3)' }}>Loading…</p>
        )}

        {authState === 'unauthorized' && (
          <div
            className="rounded-card border p-8 text-center"
            style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
          >
            <h2
              className="font-serif mb-3"
              style={{ fontSize: 24, color: 'var(--ink)', letterSpacing: '-0.01em' }}
            >
              Log in to view this event
            </h2>
            <button
              onClick={() => setShowLogin(true)}
              className="px-5 py-2 rounded-pill text-[13px] font-medium text-white transition-colors"
              style={{ background: 'var(--accent)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
            >
              Log in
            </button>
          </div>
        )}

        {authState === 'not_found' && (
          <div
            className="rounded-card border p-8 text-center"
            style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
          >
            <p style={{ fontSize: 14, color: 'var(--ink-2)' }}>
              Event not found, or you&apos;re not listed as a host.
            </p>
          </div>
        )}

        {authState === 'error' && (
          <div
            className="rounded-card border p-6"
            style={{
              background: 'var(--paper)',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
            }}
          >
            <p style={{ fontSize: 14 }}>Error: {errorMsg}</p>
          </div>
        )}

        {authState === 'authorized' && event && (
          <>
            <h1
              className="font-serif m-0 mb-1"
              style={{
                fontSize: 32,
                lineHeight: 1.1,
                color: 'var(--ink)',
                letterSpacing: '-0.01em',
              }}
            >
              {event.link ? (
                <a
                  href={event.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="event-link"
                >
                  {event.name}
                  <span className="arrow" aria-hidden>↗</span>
                </a>
              ) : (
                event.name
              )}
            </h1>
            <p className="mb-3" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {[event.type, event.location, shortDate(event.date)].filter(Boolean).join(' · ')}
            </p>

            <p
              className="mt-2 mb-5 max-w-2xl leading-relaxed"
              style={{ fontSize: 13.5, color: 'var(--ink-2)' }}
            >
              <strong style={{ color: 'var(--accent)' }}>Want to change your event criteria and refine matches?</strong>{' '}
              Email{' '}
              <a
                href="mailto:team@whisperedevents.com"
                className="underline"
                style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
              >
                team@whisperedevents.com
              </a>
              {' '}with adjustments.
            </p>

            <EventSummary event={event} />

            <div className="flex items-end justify-between mt-10 mb-3.5 flex-wrap gap-2">
              <div className="eyebrow">
                Matches · {matches.length}
                {regionCount !== null && regionCount > 0 && (
                  <span
                    style={{ fontWeight: 400, color: 'var(--ink-3)', letterSpacing: 0 }}
                    title={`${matches.length} matched · ${regionCount} members within 150 miles`}
                  >
                    {' '}out of {regionCount} within region
                  </span>
                )}
              </div>
              <p style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>
                Execs whose profile fits this event (≥ 40% match)
              </p>
            </div>

            <div
              className="rounded-card border overflow-hidden"
              style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
            >
              <table className="w-full text-[13px]">
                <thead
                  style={{
                    background: 'var(--paper-2)',
                    borderBottom: '1px solid var(--rule)',
                  }}
                >
                  <tr>
                    <th className="text-left px-4 py-3 eyebrow">Name</th>
                    <th className="text-left px-4 py-3 eyebrow">Function</th>
                    <th className="text-left px-4 py-3 eyebrow">Seniority</th>
                    <th className="text-left px-4 py-3 eyebrow">Interest</th>
                    <th className="text-right px-4 py-3 eyebrow">% Match</th>
                  </tr>
                </thead>
                <tbody>
                  {matches.map((m, i) => (
                    <tr
                      key={m.userId}
                      style={{
                        borderBottom:
                          i === matches.length - 1 ? 'none' : '1px solid var(--rule-soft)',
                      }}
                    >
                      <td className="px-4 py-3">
                        {m.linkedin ? (
                          <a
                            href={m.linkedin}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline"
                            style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
                          >
                            {m.name}
                          </a>
                        ) : (
                          <span style={{ color: 'var(--ink)' }}>{m.name}</span>
                        )}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>
                        {m.function || <span className="italic" style={{ color: 'var(--ink-3)' }}>—</span>}
                      </td>
                      <td className="px-4 py-3" style={{ color: 'var(--ink-2)' }}>
                        {m.seniority || <span className="italic" style={{ color: 'var(--ink-3)' }}>—</span>}
                      </td>
                      <td
                        className="px-4 py-3 max-w-xs truncate"
                        style={{ color: 'var(--ink-2)' }}
                      >
                        {m.interest || <span className="italic" style={{ color: 'var(--ink-3)' }}>—</span>}
                      </td>
                      <td
                        className="px-4 py-3 text-right num font-medium cursor-help"
                        style={{
                          color: m.matchPercent >= 40 ? 'var(--positive)' : 'var(--ink-3)',
                        }}
                        title={scoreTooltip(m)}
                      >
                        {m.matchPercent}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {matches.length === 0 && (
                <p
                  className="px-4 py-6 text-center"
                  style={{ fontSize: 13, color: 'var(--ink-3)' }}
                >
                  No matches above 40% yet.
                </p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function EventSummary({ event }: { event: HostEvent }) {
  return (
    <section>
      <div
        className="rounded-card border p-5 space-y-4 relative"
        style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
      >
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-[13px]">
          <SummaryField label="Name" value={event.name} />
          <SummaryField label="Type" value={event.type} />
          <SummaryField label="Date" value={shortDate(event.date)} />
          <SummaryField label="Location" value={event.location} />
          <SummaryField label="Audience" value={event.audience.join(', ')} />
          <SummaryField label="Description" value={event.description} multiline />
          <SummaryField label="Employment" value={(event.inviteEmployment ?? []).join(', ')} />
          <SummaryField label="Company Size" value={(event.inviteCompanySize ?? []).join(', ')} />
          <SummaryField label="Seniority" value={(event.inviteSeniority ?? []).join(', ')} />
        </dl>
      </div>
    </section>
  )
}

function SummaryField({ label, value, multiline }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={`mt-1 ${multiline ? 'whitespace-pre-wrap' : ''}`}
        style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5 }}
      >
        {value || <span className="italic" style={{ color: 'var(--ink-3)' }}>not set</span>}
      </dd>
    </div>
  )
}

function EditForm({
  event,
  onCancel,
  onSaved,
}: {
  event: HostEvent
  onCancel: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(event.name)
  const [type, setType] = useState(event.type || 'Other')
  const [date, setDate] = useState(event.date)
  const [location, setLocation] = useState(event.location)
  const [description, setDescription] = useState(event.description)
  const [audience, setAudience] = useState(event.audience.join(', '))
  const [inviteEmployment, setInviteEmployment] = useState<string[]>(event.inviteEmployment ?? [])
  const [inviteCompanySize, setInviteCompanySize] = useState<string[]>(event.inviteCompanySize ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const payload = {
        name,
        type,
        date,
        location,
        description,
        audience: audience.split(',').map((s) => s.trim()).filter(Boolean),
        inviteEmployment,
        inviteCompanySize,
      }
      const res = await fetch(`/api/host/events/${event.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section>
      <div
        className="rounded-card border p-5 space-y-4"
        style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
      >
        <div className="eyebrow" style={{ color: 'var(--accent)' }}>Edit event</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EditField label="Name">
            <input value={name} onChange={(e) => setName(e.target.value)} className={editInputCls} />
          </EditField>
          <EditField label="Type">
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className={`salon-select ${editInputCls}`}
            >
              {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </EditField>
          <EditField label="Date">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={editInputCls} />
          </EditField>
          <EditField label="Location">
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, State" className={editInputCls} />
          </EditField>
          <EditField label="Audience" hint="Comma-separated tags">
            <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. RevOps, Sales Leaders" className={editInputCls} />
          </EditField>
          <EditField label="Description" wide>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} className={`${editInputCls} resize-none`} />
          </EditField>
          <HostMultiCheckbox
            label="Employment"
            options={[...INVITE_EMPLOYMENT_OPTIONS]}
            value={inviteEmployment}
            onChange={setInviteEmployment}
          />
          <HostMultiCheckbox
            label="Company Size"
            options={[...INVITE_COMPANY_SIZE_OPTIONS]}
            value={inviteCompanySize}
            onChange={setInviteCompanySize}
          />
        </div>
        {error && (
          <p
            className="rounded-input border px-3 py-2 text-[12px]"
            style={{
              background: 'var(--accent-soft)',
              borderColor: 'var(--accent)',
              color: 'var(--accent)',
            }}
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-4 py-2 rounded-pill text-[13px]"
            style={{ color: 'var(--ink-2)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 rounded-pill text-[13px] font-medium text-white disabled:opacity-50 transition-colors"
            style={{ background: 'var(--accent)' }}
            onMouseEnter={(e) => !saving && (e.currentTarget.style.background = 'var(--accent-2)')}
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </section>
  )
}

function EditField({
  label,
  hint,
  wide,
  children,
}: {
  label: string
  hint?: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <div className={`space-y-1.5 ${wide ? 'sm:col-span-2' : ''}`}>
      <label className="eyebrow">{label}</label>
      {children}
      {hint && (
        <p className="text-[11px]" style={{ color: 'var(--ink-3)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

function HostMultiCheckbox({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: string[]
  value: string[]
  onChange: (next: string[]) => void
}) {
  function toggle(opt: string) {
    if (value.includes(opt)) onChange(value.filter((v) => v !== opt))
    else onChange([...value, opt])
  }
  return (
    <div className="space-y-1.5">
      <label className="eyebrow">{label}</label>
      <div className="flex flex-wrap gap-x-4 gap-y-2 pt-0.5">
        {options.map((opt) => (
          <label key={opt} className="inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={value.includes(opt)}
              onChange={() => toggle(opt)}
              className="w-3.5 h-3.5 rounded cursor-pointer"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>{opt}</span>
          </label>
        ))}
      </div>
    </div>
  )
}

const editInputCls =
  'w-full rounded-input border border-rule bg-paper-2 text-ink px-3 py-2 text-[13px] placeholder:opacity-60 focus:outline-none focus:border-accent transition-colors'
