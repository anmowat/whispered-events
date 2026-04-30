'use client'

import { useState, useRef, useEffect } from 'react'
import { EventRecord, ParsedEvent, EventType } from '@/lib/types'

type Step = 'input' | 'parsing' | 'review' | 'submitter' | 'preview' | 'submitted' | 'duplicate' | 'error'

interface Message {
  role: 'assistant' | 'user'
  content: string
}

const EVENT_TYPES: EventType[] = ['Conference', 'Dinner', 'Virtual', 'Other']

function isValidUrl(str: string) {
  try {
    new URL(str)
    return true
  } catch {
    return false
  }
}

export default function ShareEventTab() {
  const [step, setStep] = useState<Step>('input')
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        "Welcome to Whispered Events. To share an event, paste a link to the event page — or type out the event details directly.",
    },
  ])
  const [input, setInput] = useState('')
  const [parsed, setParsed] = useState<Partial<EventRecord>>({
    type: 'Other',
    host: false,
    audience: [],
  })
  const [submitterName, setSubmitterName] = useState('')
  const [submitterEmail, setSubmitterEmail] = useState('')
  const [duplicateInfo, setDuplicateInfo] = useState<Partial<EventRecord> | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, step])

  function addMessage(role: 'assistant' | 'user', content: string) {
    setMessages((prev) => [...prev, { role, content }])
  }

  async function handleInputSubmit() {
    if (!input.trim()) return
    const userInput = input.trim()
    setInput('')
    addMessage('user', userInput)

    const isUrl = isValidUrl(userInput)
    setStep('parsing')
    addMessage(
      'assistant',
      isUrl
        ? 'Let me pull the details from that link...'
        : 'Got it — let me extract the event details...'
    )
    setIsLoading(true)

    try {
      const res = await fetch('/api/parse-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUrl ? { url: userInput } : { text: userInput }),
      })
      const data = await res.json() as { event: ParsedEvent }
      const event = data.event

      setParsed({
        name: event.name || '',
        type: event.type || 'Other',
        date: event.date || '',
        description: event.description || '',
        link: event.link || (isUrl ? userInput : ''),
        audience: event.audience || [],
        host: false,
      })

      setStep('review')
      addMessage(
        'assistant',
        "Here's what I found. Review the details below and fill in anything that's missing, then we'll get this submitted."
      )
    } catch {
      setStep('error')
      addMessage('assistant', 'Something went wrong while parsing. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  async function handleReviewContinue() {
    if (!parsed.name || !parsed.link) {
      addMessage('assistant', 'Please add at least a name and link before continuing.')
      return
    }
    setStep('submitter')
    addMessage('assistant', "Looks good. What's your name and email so we can credit you as the submitter?")
  }

  async function handleSubmitterContinue() {
    if (!submitterEmail.trim()) {
      return
    }
    setStep('preview')
    addMessage(
      'assistant',
      "Here's a preview of how this event will be saved. Confirm to add it to our database."
    )
  }

  async function handleConfirmSubmit() {
    setIsLoading(true)
    const fullEvent: EventRecord = {
      name: parsed.name || '',
      type: parsed.type || 'Other',
      date: parsed.date || '',
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
      const data = await res.json() as { status: string; existingRecord?: Partial<EventRecord> }

      if (data.status === 'duplicate') {
        setDuplicateInfo(data.existingRecord || null)
        setStep('duplicate')
        addMessage('assistant', "This event is already in our database. If you had any new details, we've added them to the existing record.")
      } else {
        setStep('submitted')
        addMessage(
          'assistant',
          `Thank you${submitterName ? ', ' + submitterName : ''}! The event has been added to our database. We appreciate you helping the community discover exclusive events.`
        )
      }
    } catch {
      setStep('error')
      addMessage('assistant', 'Something went wrong while submitting. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  function handleReset() {
    setStep('input')
    setMessages([
      {
        role: 'assistant',
        content: "Welcome to Whispered Events. To share an event, paste a link to the event page — or type out the event details directly.",
      },
    ])
    setParsed({ type: 'Other', host: false, audience: [] })
    setSubmitterName('')
    setSubmitterEmail('')
    setDuplicateInfo(null)
    setInput('')
  }

  const audienceInput = parsed.audience?.join(', ') || ''

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto">
      {/* Chat messages */}
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex animate-slide-up ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-gold-600/20 border border-gold-600/30 flex items-center justify-center mr-3 mt-1 flex-shrink-0">
                <span className="text-gold-400 text-xs">W</span>
              </div>
            )}
            <div
              className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'assistant'
                  ? 'bg-charcoal-800 text-gray-200 rounded-tl-sm'
                  : 'bg-gold-700/20 border border-gold-600/30 text-gold-100 rounded-tr-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex justify-start animate-fade-in">
            <div className="w-7 h-7 rounded-full bg-gold-600/20 border border-gold-600/30 flex items-center justify-center mr-3 mt-1 flex-shrink-0">
              <span className="text-gold-400 text-xs">W</span>
            </div>
            <div className="bg-charcoal-800 rounded-2xl rounded-tl-sm px-4 py-3">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce [animation-delay:-0.3s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce [animation-delay:-0.15s]" />
                <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-bounce" />
              </div>
            </div>
          </div>
        )}

        {/* Step-specific UI */}
        {step === 'review' && !isLoading && (
          <div className="animate-slide-up">
            <EventReviewForm
              event={parsed}
              onChange={setParsed}
              audienceInput={audienceInput}
              onContinue={handleReviewContinue}
            />
          </div>
        )}

        {step === 'submitter' && !isLoading && (
          <div className="animate-slide-up ml-10">
            <SubmitterForm
              name={submitterName}
              email={submitterEmail}
              onNameChange={setSubmitterName}
              onEmailChange={setSubmitterEmail}
              onContinue={handleSubmitterContinue}
            />
          </div>
        )}

        {step === 'preview' && !isLoading && (
          <div className="animate-slide-up">
            <EventPreview
              event={{ ...parsed, submitter: submitterEmail } as EventRecord}
              onConfirm={handleConfirmSubmit}
              onEdit={() => setStep('review')}
            />
          </div>
        )}

        {(step === 'submitted' || step === 'duplicate') && (
          <div className="animate-slide-up ml-10">
            <button
              onClick={handleReset}
              className="mt-2 px-4 py-2 rounded-lg bg-gold-700/20 border border-gold-600/30 text-gold-300 text-sm hover:bg-gold-700/30 transition-colors"
            >
              Share another event
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      {step === 'input' && (
        <div className="pt-4 border-t border-white/5">
          <div className="flex gap-2">
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleInputSubmit()
                }
              }}
              placeholder="Paste a link or type event details..."
              rows={2}
              className="flex-1 bg-charcoal-800 border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 resize-none focus:outline-none focus:border-gold-600/50 transition-colors"
            />
            <button
              onClick={handleInputSubmit}
              disabled={!input.trim()}
              className="px-4 py-2 rounded-xl bg-gold-700 hover:bg-gold-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors self-end"
            >
              Send
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-2 text-center">
            Shift+Enter for new line &middot; Enter to send
          </p>
        </div>
      )}
    </div>
  )
}

function EventReviewForm({
  event,
  onChange,
  audienceInput,
  onContinue,
}: {
  event: Partial<EventRecord>
  onChange: (e: Partial<EventRecord>) => void
  audienceInput: string
  onContinue: () => void
}) {
  const [localAudience, setLocalAudience] = useState(audienceInput)

  function update(field: keyof EventRecord, value: unknown) {
    onChange({ ...event, [field]: value })
  }

  function handleAudienceBlur() {
    const arr = localAudience
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    onChange({ ...event, audience: arr })
  }

  return (
    <div className="bg-charcoal-800 rounded-2xl border border-white/10 p-5 ml-10 space-y-4">
      <h3 className="text-xs uppercase tracking-widest text-gold-500 font-medium">Event Details</h3>

      <div className="grid grid-cols-2 gap-3">
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
            className={inputCls}
          >
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </Field>
      </div>

      <Field label="Link *">
        <input
          value={event.link || ''}
          onChange={(e) => update('link', e.target.value)}
          placeholder="https://..."
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

      <Field label="Description">
        <textarea
          value={event.description || ''}
          onChange={(e) => update('description', e.target.value)}
          placeholder="A 2-sentence description of the event and audience..."
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

      <div className="flex items-center gap-2">
        <input
          id="host-check"
          type="checkbox"
          checked={event.host || false}
          onChange={(e) => update('host', e.target.checked)}
          className="w-4 h-4 rounded border-white/20 bg-charcoal-900 text-gold-500"
        />
        <label htmlFor="host-check" className="text-sm text-gray-400">
          I am hosting this event
        </label>
      </div>

      <button
        onClick={onContinue}
        disabled={!event.name || !event.link}
        className="w-full py-2.5 rounded-lg bg-gold-700 hover:bg-gold-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
      >
        Continue
      </button>
    </div>
  )
}

function SubmitterForm({
  name,
  email,
  onNameChange,
  onEmailChange,
  onContinue,
}: {
  name: string
  email: string
  onNameChange: (v: string) => void
  onEmailChange: (v: string) => void
  onContinue: () => void
}) {
  return (
    <div className="bg-charcoal-800 rounded-2xl border border-white/10 p-5 space-y-3">
      <Field label="Your name">
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="Jane Smith"
          className={inputCls}
        />
      </Field>
      <Field label="Your email *">
        <input
          type="email"
          value={email}
          onChange={(e) => onEmailChange(e.target.value)}
          placeholder="jane@company.com"
          className={inputCls}
        />
      </Field>
      <button
        onClick={onContinue}
        disabled={!email.trim()}
        className="w-full py-2.5 rounded-lg bg-gold-700 hover:bg-gold-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
      >
        Preview submission
      </button>
    </div>
  )
}

function EventPreview({
  event,
  onConfirm,
  onEdit,
}: {
  event: EventRecord
  onConfirm: () => void
  onEdit: () => void
}) {
  return (
    <div className="bg-charcoal-800 rounded-2xl border border-gold-600/20 p-5 ml-10 space-y-3">
      <h3 className="text-xs uppercase tracking-widest text-gold-500 font-medium">Preview</h3>
      <dl className="space-y-2 text-sm">
        <Row label="Name" value={event.name} />
        <Row label="Type" value={event.type} />
        <Row label="Date" value={event.date} />
        <Row label="Link" value={event.link} isLink />
        <Row label="Description" value={event.description} />
        <Row label="Audience" value={event.audience?.join(', ')} />
        <Row label="Host" value={event.host ? 'Yes' : 'No'} />
        <Row label="Submitter" value={event.submitter} />
      </dl>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onEdit}
          className="flex-1 py-2 rounded-lg border border-white/10 text-gray-400 text-sm hover:border-white/20 hover:text-gray-200 transition-colors"
        >
          Edit
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-2 rounded-lg bg-gold-700 hover:bg-gold-600 text-white text-sm font-medium transition-colors"
        >
          Confirm &amp; Submit
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, isLink }: { label: string; value?: string; isLink?: boolean }) {
  if (!value) return null
  return (
    <div className="flex gap-3">
      <dt className="text-gray-500 w-24 flex-shrink-0">{label}</dt>
      <dd className="text-gray-200 break-all">
        {isLink ? (
          <a href={value} target="_blank" rel="noopener noreferrer" className="text-gold-400 hover:underline">
            {value}
          </a>
        ) : (
          value
        )}
      </dd>
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

const inputCls =
  'w-full bg-charcoal-900 border border-white/10 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gold-600/50 transition-colors'
