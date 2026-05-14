'use client'

import { useState, useRef, useEffect } from 'react'
import { EventRecord, EventType } from '@/lib/types'

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

interface Message {
  role: 'assistant' | 'user'
  content: string
}

const EVENT_TYPES: EventType[] = ['Conference', 'Dinner', 'Virtual', 'Other']

const WELCOME_MESSAGE: Message = {
  role: 'assistant',
  content: "Welcome to Whispered Events. To share an event, paste a link to the event page — or type out the event details directly.",
}

export default function ShareEventTab({ onDone, onShowPartner }: { onDone?: () => void; onShowPartner?: () => void }) {
  const [step, setStep] = useState<Step>('input')
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [pendingInput, setPendingInput] = useState('')
  const [submitterEmail, setSubmitterEmail] = useState('')
  // null = unknown (still loading or check failed). The inline host notice
  // shows for false AND null — safer to over-warn than to let a non-partner
  // think they'll be auto-linked.
  const [isPartner, setIsPartner] = useState<boolean | null>(null)
  const [parsed, setParsed] = useState<Partial<EventRecord>>({ type: 'Other', host: false, audience: [], location: '' })
  // Set when check-event returns one of the duplicate-* statuses; used by
  // the claim flow to call /api/claim-host.
  const [existingId, setExistingId] = useState<string | undefined>(undefined)
  const [claimMessage, setClaimMessage] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, step])

  function addMessage(role: 'assistant' | 'user', content: string) {
    setMessages((prev) => [...prev, { role, content }])
  }

  function handleInputSubmit() {
    if (!input.trim()) return
    const userInput = input.trim()
    setInput('')
    setPendingInput(userInput)
    addMessage('user', userInput)
    addMessage('assistant', "Got it. What's your email? We'll check whether this event is already in our database.")
    setStep('submitter')
  }

  async function handleSubmitterContinue() {
    const email = submitterEmail.trim()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      addMessage('assistant', "That doesn't look like a valid email — please try again.")
      return
    }
    addMessage('user', email)
    setStep('parsing')
    addMessage('assistant', "Thanks. Let me look this up...")
    setIsLoading(true)

    // Kick off the partner check in parallel — we want to know by the time
    // the user reaches the review step (where the host checkbox lives) so
    // the inline notice can render or be suppressed instantly.
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
        body: JSON.stringify({ input: pendingInput, email }),
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
        })
        setExistingId(undefined)
        addMessage('assistant', "Here's what I found. Review the details below and fill in anything that's missing, then we'll get this submitted.")
        setStep('review')
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
      // duplicate-not-host (or any unknown duplicate flavor)
      setStep('duplicate-not-host')
    } catch (err) {
      setStep('error')
      addMessage('assistant', `Something went wrong: ${err instanceof Error ? err.message : 'Please try again.'}`)
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
      addMessage('assistant', `Something went wrong: ${err instanceof Error ? err.message : 'Please try again.'}`)
    } finally {
      setIsLoading(false)
    }
  }

  async function handleReviewContinue() {
    if (!parsed.name || !parsed.link) {
      addMessage('assistant', 'Please add at least a name and link before continuing.')
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
      addMessage(
        'assistant',
        "Thank you! The event has been added to our database. We appreciate you helping the community discover exclusive events.",
      )
    } catch (err) {
      setStep('error')
      addMessage('assistant', `Something went wrong: ${err instanceof Error ? err.message : 'Please try again.'}`)
    } finally {
      setIsLoading(false)
    }
  }

  function handleReset() {
    setStep('input')
    setMessages([WELCOME_MESSAGE])
    setParsed({ type: 'Other', host: false, audience: [], location: '' })
    setSubmitterEmail('')
    setPendingInput('')
    setExistingId(undefined)
    setIsPartner(null)
    setClaimMessage('')
    setInput('')
  }

  const audienceInput = parsed.audience?.join(', ') || ''

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto">
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex animate-slide-up ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-gold-100 border border-gold-200 flex items-center justify-center mr-3 mt-1 flex-shrink-0">
                <span className="text-gold-700 text-xs font-medium">W</span>
              </div>
            )}
            <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
              msg.role === 'assistant'
                ? 'bg-white border border-[#E8DDD0] text-gray-800 rounded-tl-sm shadow-sm'
                : 'bg-gold-600 text-white rounded-tr-sm'
            }`}>
              {msg.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start animate-fade-in">
            <div className="w-7 h-7 rounded-full bg-gold-100 border border-gold-200 flex items-center justify-center mr-3 mt-1 flex-shrink-0">
              <span className="text-gold-700 text-xs font-medium">W</span>
            </div>
            <div className="bg-white border border-[#E8DDD0] rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-gold-400 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gold-400 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gold-400 animate-bounce" />
              </div>
            </div>
          </div>
        )}

        {step === 'submitter' && !isLoading && (
          <div className="animate-slide-up ml-10">
            <SubmitterForm email={submitterEmail} onEmailChange={setSubmitterEmail} onContinue={handleSubmitterContinue} />
          </div>
        )}

        {step === 'review' && !isLoading && (
          <div className="animate-slide-up">
            <EventReviewForm
              event={parsed}
              onChange={setParsed}
              audienceInput={audienceInput}
              onContinue={handleReviewContinue}
              isPartner={isPartner}
              onShowPartner={onShowPartner}
            />
          </div>
        )}

        {step === 'duplicate-existing-host' && (
          <div className="animate-slide-up ml-10 space-y-3">
            <div className="bg-white rounded-2xl border border-[#E8DDD0] p-5 text-sm text-gray-700 leading-relaxed shadow-sm">
              This event is already in Whispered Events with you listed as a host.
              <br /><br />
              Log in to your <a href="/host" className="text-gold-700 underline hover:text-gold-600">/host page</a> to edit the event details and see who matches.
              <br /><br />
              We&apos;ve also credited a contribution to your account for re-sharing.
            </div>
            <a
              href="/host"
              className="block text-center w-full py-2.5 rounded-lg bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors"
            >
              Go to /host
            </a>
          </div>
        )}

        {step === 'duplicate-claim-available' && !isLoading && (
          <div className="animate-slide-up ml-10 space-y-3">
            <div className="bg-white rounded-2xl border border-[#E8DDD0] p-5 text-sm text-gray-700 leading-relaxed shadow-sm">
              This event is already in Whispered Events but doesn&apos;t have a host on file yet.
              <br /><br />
              Are you hosting this event? If so, we can list you as the host so you can edit it and see the matching audience.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleClaimHost("You're now listed as the host. Edit the event and see your matches in /host.")}
                className="flex-1 py-2.5 rounded-lg bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors"
              >
                Yes, claim as host
              </button>
              <button
                onClick={() => setStep('duplicate-not-host')}
                className="flex-1 py-2.5 rounded-lg bg-white border border-[#E8DDD0] text-gray-600 text-sm hover:border-gold-300 hover:text-gold-700 transition-colors shadow-sm"
              >
                No
              </button>
            </div>
          </div>
        )}

        {step === 'duplicate-claim-additional' && !isLoading && (
          <div className="animate-slide-up ml-10 space-y-3">
            <div className="bg-white rounded-2xl border border-[#E8DDD0] p-5 text-sm text-gray-700 leading-relaxed shadow-sm">
              This event is already in Whispered Events with another host listed.
              <br /><br />
              Are you also a host of this event? If so, we&apos;ll add you as a co-host. Our team will confirm — you&apos;ll be able to edit at /host once we do.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => handleClaimHost("Added as a co-host. Our team will confirm — you'll be able to edit at /host.")}
                className="flex-1 py-2.5 rounded-lg bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors"
              >
                Yes, I&apos;m also a host
              </button>
              <button
                onClick={() => setStep('duplicate-not-host')}
                className="flex-1 py-2.5 rounded-lg bg-white border border-[#E8DDD0] text-gray-600 text-sm hover:border-gold-300 hover:text-gold-700 transition-colors shadow-sm"
              >
                No
              </button>
            </div>
          </div>
        )}

        {step === 'claim-success' && (
          <div className="animate-slide-up ml-10 space-y-3">
            <div className="bg-white rounded-2xl border border-[#E8DDD0] p-5 text-sm text-gray-700 leading-relaxed shadow-sm">
              {claimMessage}
            </div>
            <div className="flex gap-2">
              <a
                href="/host"
                className="flex-1 text-center py-2.5 rounded-lg bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors"
              >
                Go to /host
              </a>
              <button
                onClick={() => onDone?.()}
                className="flex-1 py-2.5 rounded-lg bg-white border border-[#E8DDD0] text-gray-600 text-sm hover:border-gold-300 hover:text-gold-700 transition-colors shadow-sm"
              >
                Return Home
              </button>
            </div>
          </div>
        )}

        {step === 'duplicate-not-host' && (
          <div className="animate-slide-up ml-10 space-y-3">
            <div className="bg-white rounded-2xl border border-[#E8DDD0] p-5 text-sm text-gray-700 leading-relaxed shadow-sm">
              Someone beat you to it! We already have this event in our database.
              <br /><br />
              Thank you for contributing — we&apos;ve credited a contribution to your account for sharing this event.
            </div>
            <button
              onClick={() => onDone?.()}
              className="w-full py-2.5 rounded-lg bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors"
            >
              Return Home
            </button>
          </div>
        )}

        {(step === 'submitted' || step === 'error') && (
          <div className="animate-slide-up ml-10 flex gap-2 mt-2">
            <button
              onClick={() => onDone?.()}
              className="flex-1 py-2.5 rounded-lg bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors"
            >
              Return Home
            </button>
            <button
              onClick={handleReset}
              className="flex-1 py-2.5 rounded-lg bg-white border border-[#E8DDD0] text-gray-600 text-sm hover:border-gold-300 hover:text-gold-700 transition-colors shadow-sm"
            >
              Share another event
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {step === 'input' && (
        <div className="pt-4 border-t border-[#E8DDD0]">
          <div className="flex gap-2">
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleInputSubmit() } }}
              placeholder="Paste a link or type event details..."
              rows={2}
              className="flex-1 bg-white border border-[#E8DDD0] rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 resize-none focus:outline-none focus:border-gold-400 transition-colors shadow-sm"
            />
            <button
              onClick={handleInputSubmit}
              disabled={!input.trim()}
              className="px-4 py-2 rounded-xl bg-gold-600 hover:bg-gold-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors self-end"
            >
              Send
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">Shift+Enter for new line &middot; Enter to send</p>
        </div>
      )}
    </div>
  )
}

function EventReviewForm({ event, onChange, audienceInput, onContinue, isPartner, onShowPartner }: {
  event: Partial<EventRecord>
  onChange: (e: Partial<EventRecord>) => void
  audienceInput: string
  onContinue: () => void
  isPartner: boolean | null
  onShowPartner?: () => void
}) {
  const [localAudience, setLocalAudience] = useState(audienceInput)
  function update(field: keyof EventRecord, value: unknown) { onChange({ ...event, [field]: value }) }
  function handleAudienceBlur() {
    onChange({ ...event, audience: localAudience.split(',').map(s => s.trim()).filter(Boolean) })
  }
  // Inline notice shows when host is checked AND we don't have positive
  // confirmation the submitter is a Partner. Unknown (null) still warns —
  // safer than misleading a non-partner.
  const showHostWarning = !!event.host && isPartner !== true
  return (
    <div className="bg-white rounded-2xl border border-[#E8DDD0] p-5 ml-10 space-y-4 shadow-sm">
      <h3 className="text-xs uppercase tracking-widest text-gold-600 font-medium">Event Details</h3>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name *">
          <input value={event.name || ''} onChange={(e) => update('name', e.target.value)} placeholder="e.g. GTM Summit 2025" className={inputCls} />
        </Field>
        <Field label="Type">
          <select value={event.type || 'Other'} onChange={(e) => update('type', e.target.value as EventType)} className={inputCls}>
            {EVENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Link *">
        <input value={event.link || ''} onChange={(e) => update('link', e.target.value)} placeholder="https://..." className={inputCls} />
      </Field>
      <Field label="Date">
        <input type="date" value={event.date || ''} onChange={(e) => update('date', e.target.value)} className={inputCls} />
      </Field>
      <Field label="Location">
        <input value={event.location || ''} onChange={(e) => update('location', e.target.value)} placeholder="e.g. New York, NY or Virtual" className={inputCls} />
      </Field>
      <Field label="Description">
        <textarea value={event.description || ''} onChange={(e) => update('description', e.target.value)} placeholder="A 2-sentence description of the event and audience..." rows={3} className={`${inputCls} resize-none`} />
      </Field>
      <Field label="Audience (comma-separated)">
        <input value={localAudience} onChange={(e) => setLocalAudience(e.target.value)} onBlur={handleAudienceBlur} placeholder="e.g. CROs, CMOs, Revenue Leaders" className={inputCls} />
      </Field>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <input id="host-check" type="checkbox" checked={event.host || false} onChange={(e) => update('host', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-gold-600" />
          <label htmlFor="host-check" className="text-sm text-gray-600">I am hosting this event</label>
        </div>
        {showHostWarning && (
          <div className="bg-gold-50 border border-gold-200 rounded-lg px-3 py-2.5 text-xs text-gold-800 leading-relaxed">
            Only Whispered Partners can claim Host status on an event. If you&apos;d like to partner with us,{' '}
            {onShowPartner ? (
              <button onClick={onShowPartner} className="font-medium underline hover:text-gold-900">
                head to the Partner tab
              </button>
            ) : (
              <span className="font-medium">head to the Partner tab</span>
            )}{' '}
            to get in touch.
          </div>
        )}
      </div>
      <button onClick={onContinue} disabled={!event.name || !event.link} className="w-full py-2.5 rounded-lg bg-gold-600 hover:bg-gold-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
        Submit event
      </button>
    </div>
  )
}

function SubmitterForm({ email, onEmailChange, onContinue }: {
  email: string; onEmailChange: (v: string) => void; onContinue: () => void
}) {
  return (
    <div className="bg-white rounded-2xl border border-[#E8DDD0] p-5 space-y-3 shadow-sm">
      <Field label="Your email">
        <input
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') onContinue() }}
          placeholder="jane@company.com"
          className={inputCls}
        />
      </Field>
      <button onClick={onContinue} disabled={!email.trim()} className="w-full py-2.5 rounded-lg bg-gold-600 hover:bg-gold-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
        Continue
      </button>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-500">{label}</label>
      {children}
    </div>
  )
}

const inputCls = 'w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gold-400 transition-colors'
