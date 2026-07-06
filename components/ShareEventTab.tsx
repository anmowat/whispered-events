'use client'

import { useEffect, useState } from 'react'
import { EventRecord, EventType } from '@/lib/types'
import {
  BackLink,
  ChatBubble,
  ChatRow,
  StepIndicator,
  TypingIndicator,
  parseInline,
} from './chat/ChatShell'

type Step =
  | 'input'
  | 'submitter'
  | 'parsing'
  | 'review'
  | 'submitting'
  | 'submitted'
  | 'duplicate-not-host'
  | 'duplicate-existing-host'
  | 'duplicate-claim-available'
  | 'duplicate-claim-additional'
  | 'claim-success'
  | 'error'

const EVENT_TYPES: EventType[] = ['Conference', 'Dinner', 'Happy Hour', 'Panel', 'Workshop', 'Activity', 'Other']

const WELCOME_TEXT =
  'Paste a link to the event page — or type out the event details directly.'

// Steps shown in the indicator. Duplicate-event terminal states reuse the
// same slot as their non-duplicate equivalent so the progress doesn't
// jump backwards.
const STEP_INDEX: Partial<Record<Step, number>> = {
  input: 1,
  submitter: 2,
  parsing: 2,
  review: 3,
  submitting: 3,
  submitted: 3,
  'duplicate-not-host': 3,
  'duplicate-existing-host': 3,
  'duplicate-claim-available': 3,
  'duplicate-claim-additional': 3,
  'claim-success': 3,
  error: 3,
}
const TOTAL_STEPS = 3

export default function ShareEventTab({
  onDone,
  onShowPartner,
}: {
  onDone?: () => void
  onShowPartner?: () => void
}) {
  const [step, setStep] = useState<Step>('input')
  const [assistantContent, setAssistantContent] = useState<string>(WELCOME_TEXT)
  const [input, setInput] = useState('')
  const [pendingInput, setPendingInput] = useState('')
  const [submitterEmail, setSubmitterEmail] = useState('')
  // true once /api/auth/me confirms a logged-in session and we've
  // populated submitterEmail from it. Lets handleInputSubmit skip the
  // email-prompt step entirely for known users.
  const [emailPrefilled, setEmailPrefilled] = useState(false)
  // null = unknown (still loading or check failed). The inline host
  // notice shows for false AND null — safer to over-warn than to let a
  // non-partner think they'll be auto-linked.
  const [isPartner, setIsPartner] = useState<boolean | null>(null)
  const [parsed, setParsed] = useState<Partial<EventRecord>>({
    type: 'Other',
    host: false,
    audience: [],
    location: '',
  })
  // Set when check-event returns one of the duplicate-* statuses;
  // used by the claim flow to call /api/claim-host.
  const [existingId, setExistingId] = useState<string | undefined>(undefined)
  const [claimMessage, setClaimMessage] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)

  // Detect a logged-in session and pre-fill submitterEmail so the
  // contribute flow can skip the "what's your email?" step entirely.
  // Anonymous contributions still fall through to the prompt.
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { user?: { email?: string } } | null) => {
        if (cancelled || !data?.user?.email) return
        setSubmitterEmail(data.user.email)
        setEmailPrefilled(true)
      })
      .catch(() => {
        // Not logged in or check failed — fall back to the email prompt.
      })
    return () => {
      cancelled = true
    }
  }, [])

  function handleInputSubmit() {
    if (!input.trim()) return
    const userInput = input.trim()
    setInput('')
    setPendingInput(userInput)
    // Logged-in path: skip the email-prompt step and go straight to the
    // lookup. Anonymous path: ask for the email like before.
    if (emailPrefilled && submitterEmail) {
      runEventLookup(submitterEmail, userInput)
      return
    }
    setAssistantContent(
      "Got it. **What's your email?** We'll check whether this event is already in our database.",
    )
    setStep('submitter')
  }

  async function handleSubmitterContinue() {
    const email = submitterEmail.trim()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAssistantContent("That doesn't look like a valid email — please try again.")
      return
    }
    await runEventLookup(email, pendingInput)
  }

  // Shared lookup: kicks off the partner check in parallel and runs the
  // event de-dupe / parse against /api/check-event. Caller passes both
  // email and the raw event input so we don't have to wait on a state
  // update from the immediately-preceding setPendingInput.
  async function runEventLookup(email: string, eventInput: string) {
    setStep('parsing')
    setAssistantContent('Thanks. Let me look this up…')
    setIsLoading(true)

    // Kick off the partner check in parallel — we want to know by the
    // time the user reaches the review step (where the host checkbox
    // lives) so the inline notice can render or be suppressed instantly.
    fetch('/api/check-partner', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
      .then((r) => r.json())
      .then((d: { isPartner?: boolean }) => setIsPartner(!!d.isPartner))
      .catch(() => setIsPartner(false))

    try {
      const res = await fetch('/api/check-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: eventInput, email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to look up event')

      if (data.status === 'new') {
        const p = data.parsed
        setParsed({
          name: p.name || '',
          type: p.type || 'Other',
          date: p.date || '',
          location: p.location || '',
          description: p.description || '',
          link: p.link || '',
          audience: p.audience || [],
          host: false,
          image: p.image || undefined,
        })
        setExistingId(undefined)
        setAssistantContent(
          "Here's what I found. Review the details below and fill in anything that's missing, then we'll get this submitted.",
        )
        setStep('review')
        return
      }

      // Nothing extractable in the original input — bounce back to the
      // input step with a clear explanation instead of dropping the user
      // into an empty review form.
      if (data.status === 'unparseable') {
        setStep('input')
        setSubmitterEmail('')
        setAssistantContent(
          "I couldn't read that as an event. Try pasting a public event link (Luma, Eventbrite, the host's site), or type out the event with at least a name + link.",
        )
        return
      }

      // All duplicate-* statuses carry existingId (except duplicate-not-host).
      if (data.existingId) setExistingId(data.existingId)

      if (data.status === 'duplicate-existing-host') {
        setStep('duplicate-existing-host')
        return
      }
      if (data.status === 'duplicate-claim-available') {
        setStep('duplicate-claim-available')
        return
      }
      if (data.status === 'duplicate-claim-additional') {
        setStep('duplicate-claim-additional')
        return
      }
      setStep('duplicate-not-host')
    } catch (err) {
      setStep('error')
      setAssistantContent(
        `Something went wrong: ${err instanceof Error ? err.message : 'Please try again.'}`,
      )
    } finally {
      setIsLoading(false)
    }
  }

  async function handleClaimHost(successMessage: string) {
    if (!existingId) return
    setIsLoading(true)
    try {
      const res = await fetch('/api/claim-host', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId: existingId, email: submitterEmail }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`)
      setClaimMessage(successMessage)
      setStep('claim-success')
    } catch (err) {
      setStep('error')
      setAssistantContent(
        `Something went wrong: ${err instanceof Error ? err.message : 'Please try again.'}`,
      )
    } finally {
      setIsLoading(false)
    }
  }

  async function handleReviewContinue() {
    if (!parsed.name || !parsed.link) {
      setAssistantContent('Please add at least a name and link before continuing.')
      return
    }
    setStep('submitting')
    setIsLoading(true)
    const fullEvent: EventRecord = {
      name: parsed.name || '',
      type: parsed.type || 'Other',
      date: parsed.date || '',
      location: parsed.location || '',
      description: parsed.description || '',
      link: parsed.link || '',
      audience: parsed.audience || [],
      host: parsed.host || false,
      submitter: submitterEmail,
      image: parsed.image,
    }
    try {
      const res = await fetch('/api/submit-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: fullEvent }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
      setStep('submitted')
      setAssistantContent(
        'Thank you! The event has been added. We appreciate you helping the community discover exclusive events.',
      )
    } catch (err) {
      setStep('error')
      setAssistantContent(
        `Something went wrong: ${err instanceof Error ? err.message : 'Please try again.'}`,
      )
    } finally {
      setIsLoading(false)
    }
  }

  function handleReset() {
    setStep('input')
    setAssistantContent(WELCOME_TEXT)
    setParsed({ type: 'Other', host: false, audience: [], location: '' })
    setSubmitterEmail('')
    setPendingInput('')
    setExistingId(undefined)
    setIsPartner(null)
    setClaimMessage('')
    setInput('')
  }

  const audienceInput = parsed.audience?.join(', ') || ''
  const showStepIndicator = step !== 'submitted' && step !== 'error' && step !== 'claim-success'

  // Bubble width: full on mobile (avatars are gone so we can use the
  // viewport), capped at 80% on >=sm.
  const bubbleWidthCls = 'max-w-full sm:max-w-[80%]'

  const showBackLink = step !== 'submitted'

  return (
    <div className="flex flex-col h-full max-w-[680px] mx-auto">
      {showBackLink && onDone && <BackLink onClick={onDone} />}
      {showStepIndicator && (
        <StepIndicator
          label="Contribute"
          current={STEP_INDEX[step] || 1}
          total={TOTAL_STEPS}
        />
      )}

      <div className="flex-1 space-y-4 pb-4">
        {isLoading ? (
          <TypingIndicator />
        ) : (
          <ChatRow role="assistant">
            <ChatBubble role="assistant">
              <div className="space-y-1">
                {assistantContent.split('\n').map((line, j) => (
                  <p key={j} className="m-0">
                    {line ? parseInline(line) : ' '}
                  </p>
                ))}
              </div>
            </ChatBubble>
          </ChatRow>
        )}

        {step === 'submitter' && !isLoading && (
          <ChatRow role="assistant">
            <div className={bubbleWidthCls}>
              <SubmitterForm
                email={submitterEmail}
                onEmailChange={setSubmitterEmail}
                onContinue={handleSubmitterContinue}
              />
            </div>
          </ChatRow>
        )}

        {step === 'review' && !isLoading && (
          <ChatRow role="assistant">
            <div className={`${bubbleWidthCls} w-full`}>
              <EventReviewForm
                event={parsed}
                onChange={setParsed}
                audienceInput={audienceInput}
                onContinue={handleReviewContinue}
                isPartner={isPartner}
                onShowPartner={onShowPartner}
              />
            </div>
          </ChatRow>
        )}

        {step === 'duplicate-existing-host' && (
          <ChatRow role="assistant">
            <div className={`${bubbleWidthCls} space-y-3`}>
              <StatusCard>
                This event is already in Whispered Events with you listed as a host.
                <br />
                <br />
                Log in to your{' '}
                <a
                  href="/host"
                  className="underline"
                  style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
                >
                  /host page
                </a>{' '}
                to edit the event details and see who matches.
                <br />
                <br />
                We&apos;ve credited a contribution to your account for re-sharing.
              </StatusCard>
              <AccentLink href="/host">Go to /host</AccentLink>
            </div>
          </ChatRow>
        )}

        {step === 'duplicate-claim-available' && !isLoading && (
          <ChatRow role="assistant">
            <div className={`${bubbleWidthCls} space-y-3`}>
              <StatusCard>
                This event is already in Whispered Events but doesn&apos;t have a host on
                file yet.
                <br />
                <br />
                Are you hosting this event? If so, we can list you as the host so you
                can edit it and see the matching audience.
              </StatusCard>
              <div className="flex flex-col sm:flex-row gap-2">
                <AccentButton
                  onClick={() =>
                    handleClaimHost(
                      "You're now listed as the host. Edit the event and see your matches in /host.",
                    )
                  }
                >
                  Yes, claim as host
                </AccentButton>
                <GhostButton onClick={() => setStep('duplicate-not-host')}>No</GhostButton>
              </div>
            </div>
          </ChatRow>
        )}

        {step === 'duplicate-claim-additional' && !isLoading && (
          <ChatRow role="assistant">
            <div className={`${bubbleWidthCls} space-y-3`}>
              <StatusCard>
                This event is already in Whispered Events with another host listed.
                <br />
                <br />
                Are you also a host of this event? If so, we&apos;ll add you as a co-host.
                Our team will confirm — you&apos;ll be able to edit at /host once we do.
              </StatusCard>
              <div className="flex flex-col sm:flex-row gap-2">
                <AccentButton
                  onClick={() =>
                    handleClaimHost(
                      "Added as a co-host. Our team will confirm — you'll be able to edit at /host.",
                    )
                  }
                >
                  Yes, I&apos;m also a host
                </AccentButton>
                <GhostButton onClick={() => setStep('duplicate-not-host')}>No</GhostButton>
              </div>
            </div>
          </ChatRow>
        )}

        {step === 'claim-success' && (
          <ChatRow role="assistant">
            <div className={`${bubbleWidthCls} space-y-3`}>
              <StatusCard>{claimMessage}</StatusCard>
              <div className="flex flex-col sm:flex-row gap-2">
                <AccentLink href="/host" full>
                  Go to /host
                </AccentLink>
                <GhostButton onClick={() => onDone?.()}>Return home</GhostButton>
              </div>
            </div>
          </ChatRow>
        )}

        {step === 'duplicate-not-host' && (
          <ChatRow role="assistant">
            <div className={`${bubbleWidthCls} space-y-3`}>
              <StatusCard>
                Someone beat you to it — we already have this event in our database.
                <br />
                <br />
                Thank you for contributing. We&apos;ve credited a contribution to your
                account for sharing this event.
              </StatusCard>
              <AccentButton onClick={() => onDone?.()} full>
                Return home
              </AccentButton>
            </div>
          </ChatRow>
        )}

        {(step === 'submitted' || step === 'error') && (
          <div className="mt-2 flex flex-col sm:flex-row gap-2 animate-slide-up">
            <AccentButton onClick={() => onDone?.()} full>
              Return home
            </AccentButton>
            <GhostButton onClick={handleReset}>Share another event</GhostButton>
          </div>
        )}
      </div>

      {step === 'input' && (
        <div
          className="pt-3 sm:pt-4 border-t"
          style={{ borderColor: 'var(--rule-soft)' }}
        >
          {/* Stack textarea + Send vertically on mobile so the button is
              never clipped; side-by-side on desktop. */}
          <div className="flex flex-col sm:flex-row gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleInputSubmit()
                }
              }}
              placeholder="Paste a link or type event details…"
              rows={2}
              className="flex-1 min-w-0 rounded-input border px-3 py-2 sm:px-3.5 sm:py-2.5 text-[14px] resize-none focus:outline-none transition-colors"
              style={{
                background: 'var(--paper-2)',
                borderColor: 'var(--rule)',
                color: 'var(--ink)',
              }}
            />
            <button
              onClick={handleInputSubmit}
              disabled={!input.trim()}
              className="shrink-0 w-full sm:w-auto sm:self-end rounded-pill px-3.5 sm:px-4 py-2.5 text-[13px] font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'var(--accent)' }}
            >
              Send
            </button>
          </div>
          <p
            className="hidden sm:block mt-2 text-center text-[11px]"
            style={{ color: 'var(--ink-3)' }}
          >
            Shift+Enter for new line · Enter to send
          </p>
        </div>
      )}
    </div>
  )
}

// Status card body — uses the Salon paper+rule chrome, sits inside a
// ChatRow.
function StatusCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-card border px-5 py-4 leading-relaxed"
      style={{
        background: 'var(--paper)',
        borderColor: 'var(--rule)',
        color: 'var(--ink)',
        fontSize: 14,
      }}
    >
      {children}
    </div>
  )
}

function AccentButton({
  onClick,
  children,
  full,
}: {
  onClick: () => void
  children: React.ReactNode
  full?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`${
        full ? 'w-full' : 'flex-1'
      } py-2.5 rounded-pill text-[13px] font-medium text-white transition-colors`}
      style={{ background: 'var(--accent)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
    >
      {children}
    </button>
  )
}

function GhostButton({
  onClick,
  children,
}: {
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className="flex-1 py-2.5 rounded-pill border text-[13px] transition-colors"
      style={{
        background: 'var(--paper)',
        borderColor: 'var(--rule)',
        color: 'var(--ink-2)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--paper-2)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--paper)'
      }}
    >
      {children}
    </button>
  )
}

function AccentLink({
  href,
  children,
  full,
}: {
  href: string
  children: React.ReactNode
  full?: boolean
}) {
  return (
    <a
      href={href}
      className={`${
        full ? 'flex-1' : 'block w-full'
      } text-center py-2.5 rounded-pill text-[13px] font-medium text-white transition-colors`}
      style={{ background: 'var(--accent)' }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
    >
      {children}
    </a>
  )
}

function EventReviewForm({
  event,
  onChange,
  audienceInput,
  onContinue,
  isPartner,
  onShowPartner,
}: {
  event: Partial<EventRecord>
  onChange: (e: Partial<EventRecord>) => void
  audienceInput: string
  onContinue: () => void
  isPartner: boolean | null
  onShowPartner?: () => void
}) {
  const [localAudience, setLocalAudience] = useState(audienceInput)
  function update(field: keyof EventRecord, value: unknown) {
    onChange({ ...event, [field]: value })
  }
  function handleAudienceBlur() {
    onChange({
      ...event,
      audience: localAudience.split(',').map((s) => s.trim()).filter(Boolean),
    })
  }
  return (
    <div
      className="rounded-card border p-5 space-y-4"
      style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
    >
      <div className="eyebrow" style={{ color: 'var(--accent)' }}>
        Event Details · AI-extracted
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Name *">
          <input
            value={event.name || ''}
            onChange={(e) => update('name', e.target.value)}
            placeholder="e.g. GTM Summit 2025"
            className={inputCls}
          />
        </Field>
        <Field label="Type">
          <select
            value={event.type || 'Other'}
            onChange={(e) => update('type', e.target.value as EventType)}
            className={`salon-select ${inputCls}`}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Link *">
        <input
          value={event.link || ''}
          onChange={(e) => update('link', e.target.value)}
          placeholder="https://…"
          className={inputCls}
        />
      </Field>
      <Field label="Date">
        <input
          type="date"
          value={event.date || ''}
          onChange={(e) => update('date', e.target.value)}
          className={inputCls}
        />
      </Field>
      <Field label="Location">
        <input
          value={event.location || ''}
          onChange={(e) => update('location', e.target.value)}
          placeholder="e.g. New York, NY or Virtual"
          className={inputCls}
        />
      </Field>
      <Field label="Description">
        <textarea
          value={event.description || ''}
          onChange={(e) => update('description', e.target.value)}
          placeholder="A 2-sentence description of the event and audience…"
          rows={3}
          className={`${inputCls} resize-none`}
        />
      </Field>
      <Field label="Audience (comma-separated)">
        <input
          value={localAudience}
          onChange={(e) => setLocalAudience(e.target.value)}
          onBlur={handleAudienceBlur}
          placeholder="e.g. CROs, CMOs, Revenue Leaders"
          className={inputCls}
        />
      </Field>
      {/* Host claim is gated on partner status. We hide the checkbox
          entirely for non-partners (and while the check is still in
          flight) so the option only surfaces when we can honor it.
          Server-side, /api/submit-event also gates host assignment by
          getPartnerUserByEmail — the UI hide is the friendly half. */}
      {isPartner === true && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              id="host-check"
              type="checkbox"
              checked={event.host || false}
              onChange={(e) => update('host', e.target.checked)}
              style={{ accentColor: 'var(--accent)' }}
            />
            <label
              htmlFor="host-check"
              className="text-[13px]"
              style={{ color: 'var(--ink-2)' }}
            >
              I am hosting this event
            </label>
          </div>
        </div>
      )}
      <button
        onClick={onContinue}
        disabled={!event.name || !event.link}
        className="w-full py-2.5 rounded-pill text-[13px] font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        style={{ background: 'var(--accent)' }}
        onMouseEnter={(e) =>
          event.name && event.link && (e.currentTarget.style.background = 'var(--accent-2)')
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
      >
        Submit event
      </button>
    </div>
  )
}

function SubmitterForm({
  email,
  onEmailChange,
  onContinue,
}: {
  email: string
  onEmailChange: (v: string) => void
  onContinue: () => void
}) {
  return (
    <div
      className="rounded-card border p-5 space-y-3"
      style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
    >
      <Field label="Your email">
        <input
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onContinue()
          }}
          placeholder="jane@company.com"
          className={inputCls}
        />
      </Field>
      <button
        onClick={onContinue}
        disabled={!email.trim()}
        className="w-full py-2.5 rounded-pill text-[13px] font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        style={{ background: 'var(--accent)' }}
        onMouseEnter={(e) => email.trim() && (e.currentTarget.style.background = 'var(--accent-2)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
      >
        Continue
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="eyebrow">{label}</label>
      {children}
    </div>
  )
}

const inputCls =
  'w-full rounded-input border border-rule bg-paper-2 text-ink px-3 py-2 text-[13px] placeholder:opacity-60 focus:outline-none focus:border-accent transition-colors'
