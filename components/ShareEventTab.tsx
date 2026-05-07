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
  | 'error'

type Mode = 'create' | 'duplicate-host'

interface Message {
  role: 'assistant' | 'user'
  content: string
}

const EVENT_TYPES: EventType[] = ['Conference', 'Dinner', 'Virtual', 'Other']

function isValidUrl(str: string) {
  try { new URL(str); return true } catch { return false }
}

const WELCOME_MESSAGE: Message = {
  role: 'assistant',
  content: "Welcome to Whispered Events. To share an event, paste a link to the event page — or type out the event details directly.",
}

export default function ShareEventTab({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState<Step>('input')
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE])
  const [input, setInput] = useState('')
  const [pendingInput, setPendingInput] = useState('')
  const [submitterEmail, setSubmitterEmail] = useState('')
  const [mode, setMode] = useState<Mode>('create')
  const [existingId, setExistingId] = useState<string | undefined>(undefined)
  const [parsed, setParsed] = useState<Partial<EventRecord>>({ type: 'Other', host: false, audience: [], location: '' })
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
    try {
      const res = await fetch('/api/check-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: pendingInput, email }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to look up event')

      if (data.status === 'duplicate-not-host') {
        setStep('duplicate-not-host')
        return
      }

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
        setMode('create')
        setExistingId(undefined)
        addMessage('assistant', "Here's what I found. Review the details below and fill in anything that's missing, then we'll get this submitted.")
        setStep('review')
        return
      }

      // duplicate-host: submitter's email matches the existing host
      const m = data.merged || {}
      setParsed({
        name: m.name || '',
        type: m.type || 'Other',
        date: m.date || '',
        location: m.location || '',
        description: m.description || '',
        link: m.link || '',
        audience: m.audience || [],
        host: true,
      })
      setMode('duplicate-host')
      setExistingId(data.existingId)
      addMessage('assistant', "We already have this event on file with you as the host. Here's everything we have — review and edit anything that needs updating, then save your changes.")
      setStep('review')
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
        body: JSON.stringify({ event: fullEvent, existingId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || data.message || `HTTP ${res.status}`)
      setStep('submitted')
      let msg =
        mode === 'duplicate-host'
          ? "Got it — we've updated this event with your changes. Thank you."
          : "Thank you! The event has been added to our database. We appreciate you helping the community discover exclusive events."
      if (data.hostClaimDenied) {
        msg +=
          "\n\nWe don't have you on file as a Whispered partner yet, so we couldn't list you as the host. If you'd like to partner with us, email team@whisperedevents.com."
      }
      addMessage('assistant', msg)
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
    setMode('create')
    setExistingId(undefined)
    setInput('')
  }

  const audienceInput = parsed.audience?.join(', ') || ''
  const showHostCheckbox = mode === 'create'

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
              showHostCheckbox={showHostCheckbox}
              submitLabel={mode === 'create' ? 'Submit event' : 'Save changes'}
            />
          </div>
        )}

        {step === 'duplicate-not-host' && (
          <div className="animate-slide-up ml-10 space-y-3">
            <div className="bg-white rounded-2xl border border-[#E8DDD0] p-5 text-sm text-gray-700 leading-relaxed shadow-sm">
              Someone beat you to it! We already have this event in our database.
              <br /><br />
              If you&apos;re the host of this event, email <a href="mailto:team@whispered.com" className="text-gold-700 hover:underline">team@whispered.com</a>.
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

function EventReviewForm({ event, onChange, audienceInput, onContinue, showHostCheckbox, submitLabel }: {
  event: Partial<EventRecord>
  onChange: (e: Partial<EventRecord>) => void
  audienceInput: string
  onContinue: () => void
  showHostCheckbox: boolean
  submitLabel: string
}) {
  const [localAudience, setLocalAudience] = useState(audienceInput)
  function update(field: keyof EventRecord, value: unknown) { onChange({ ...event, [field]: value }) }
  function handleAudienceBlur() {
    onChange({ ...event, audience: localAudience.split(',').map(s => s.trim()).filter(Boolean) })
  }
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
      {showHostCheckbox && (
        <div className="flex items-center gap-2">
          <input id="host-check" type="checkbox" checked={event.host || false} onChange={(e) => update('host', e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-gold-600" />
          <label htmlFor="host-check" className="text-sm text-gray-600">I am hosting this event</label>
        </div>
      )}
      <button onClick={onContinue} disabled={!event.name || !event.link} className="w-full py-2.5 rounded-lg bg-gold-600 hover:bg-gold-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
        {submitLabel}
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
