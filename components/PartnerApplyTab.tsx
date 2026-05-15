'use client'

import { Fragment, useState, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'

type Step =
  | 'email'
  | 'company'
  | 'audience'
  | 'awaiting-ack'
  | 'volume'
  | 'volume-clarify'
  | 'description'
  | 'linkedin'
  | 'linkedin-clarify'
  | 'submitting'
  | 'submitted'
  | 'error'

interface Message {
  role: 'assistant' | 'user'
  content: string
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LINKEDIN_RE = /(^|\.)linkedin\.com\/(in|company|pub)\//i

const WELCOME: Message = {
  role: 'assistant',
  content:
    "Welcome to Whispered Events. Partnering with us is free for people who host great executive events. We'll ask a few quick questions, then our team will review and follow up — typically within 24 hours.\n\n**First, can we get your email?**",
}

// Tiny `**bold**` parser used only for assistant messages. We do this rather
// than send rich nodes through state so the message history stays plain
// string and is easy to debug / log. Bolded segments use the gold accent
// to make the actual ask pop visually in a long chat thread.
function renderAssistant(content: string): ReactNode {
  const parts = content.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="text-gold-700 font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  )
}

// Pulls the first one or two digit-groups out of a free-text answer so we
// can accept "5", "about 5", "5-7", "5 to 7", "10–12 per year" without an
// extra round-trip. Range → midpoint. Returns null when the user said
// something vague like "a lot" so the caller can ask one clarifying
// follow-up before giving up.
function parseVolume(input: string): number | null {
  const numbers = input.match(/\d+/g)?.map(Number) ?? []
  if (numbers.length === 0) return null
  if (numbers.length === 1) return numbers[0]
  return Math.round((numbers[0] + numbers[1]) / 2)
}

function normalizeLinkedin(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `https://${trimmed}`
}

export default function PartnerApplyTab({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState<Step>('email')
  const [messages, setMessages] = useState<Message[]>([WELCOME])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [form, setForm] = useState({
    email: '',
    company: '',
    audience: '',
    volume: '',
    description: '',
    linkedin: '',
  })
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, step])

  useEffect(() => {
    if (step !== 'submitting' && step !== 'submitted' && step !== 'awaiting-ack') {
      inputRef.current?.focus()
    }
  }, [step])

  function addAssistant(content: string) {
    setMessages((prev) => [...prev, { role: 'assistant', content }])
  }
  function addUser(content: string) {
    setMessages((prev) => [...prev, { role: 'user', content }])
  }

  // Single dispatcher that consumes the input field based on which step
  // we're on. Keeps the UI shape constant — one persistent text input at
  // the bottom — instead of swapping in different forms per step.
  async function handleSend() {
    const value = input.trim()
    if (!value) return

    if (step === 'email') {
      if (!EMAIL_RE.test(value)) {
        addUser(value)
        setInput('')
        addAssistant("That doesn't look like a valid email — please try again.")
        return
      }
      setForm((f) => ({ ...f, email: value }))
      addUser(value)
      setInput('')
      addAssistant("Thanks. **What's the name of your company / organization?**")
      setStep('company')
      return
    }

    if (step === 'company') {
      setForm((f) => ({ ...f, company: value }))
      addUser(value)
      setInput('')
      addAssistant(
        "Its great to connect. **To start, can you describe your target audience(s) for your events?** Roles and levels are most useful — e.g. CROs, VPs of Sales, GTM leaders at $50M+ ARR companies.",
      )
      setStep('audience')
      return
    }

    if (step === 'audience') {
      setForm((f) => ({ ...f, audience: value }))
      addUser(value)
      setInput('')
      setStep('awaiting-ack')
      setIsLoading(true)
      try {
        const res = await fetch('/api/audience-ack', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audience: value }),
        })
        const data = (await res.json().catch(() => ({}))) as { ack?: string }
        const fallback =
          'That is great. We have the right people on our platform and look forward to connecting you with them.'
        const ack = data.ack?.trim() || fallback
        addAssistant(
          `${ack}\n\n**How many events do you host or run each year?** A single number is great — even a rough estimate works.`,
        )
      } catch {
        addAssistant(
          'That is great. We have the right people on our platform and look forward to connecting you with them.\n\n**How many events do you host or run each year?** A single number is great — even a rough estimate works.',
        )
      } finally {
        setIsLoading(false)
        setStep('volume')
      }
      return
    }

    if (step === 'volume' || step === 'volume-clarify') {
      const parsed = parseVolume(value)
      addUser(value)
      setInput('')
      if (parsed === null) {
        if (step === 'volume') {
          addAssistant(
            "Could you give me a number? Even a rough estimate works — e.g. 5 or 10-12.",
          )
          setStep('volume-clarify')
          return
        }
        // Second time around — accept whatever they wrote so we don't loop.
        setForm((f) => ({ ...f, volume: value }))
      } else {
        setForm((f) => ({ ...f, volume: String(parsed) }))
      }
      addAssistant(
        "If we approve you, we'll list you on our partner directory. **Can you share a short description of what your company does?**",
      )
      setStep('description')
      return
    }

    if (step === 'description') {
      setForm((f) => ({ ...f, description: value }))
      addUser(value)
      setInput('')
      addAssistant("Last one — **what's your LinkedIn profile URL?**")
      setStep('linkedin')
      return
    }

    if (step === 'linkedin' || step === 'linkedin-clarify') {
      const normalized = normalizeLinkedin(value)
      addUser(value)
      setInput('')
      if (!LINKEDIN_RE.test(normalized)) {
        addAssistant(
          "That doesn't look like a LinkedIn URL. Please paste a link that starts with linkedin.com/in/ or linkedin.com/company/.",
        )
        setStep('linkedin-clarify')
        return
      }
      const finalForm = { ...form, linkedin: normalized }
      setForm(finalForm)
      setStep('submitting')
      setIsLoading(true)
      try {
        const res = await fetch('/api/submit-partner', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(finalForm),
        })
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
        addAssistant(
          "**Great — your application is in.** Our team will review and follow up within 24 hours.\n\nPartnership is free. While you wait, two things that really help: (a) share events you're hosting or hear about, and (b) tell top execs in your network about Whispered Events.",
        )
        setStep('submitted')
      } catch (err) {
        addAssistant(
          `Something went wrong submitting your application: ${err instanceof Error ? err.message : 'please try again.'}`,
        )
        setStep('error')
      } finally {
        setIsLoading(false)
      }
      return
    }
  }

  const placeholder: Record<Step, string> = {
    email: 'jane@company.com',
    company: 'Acme Corp',
    audience: 'e.g. CROs, VPs of Sales at $50M+ ARR companies',
    'awaiting-ack': '',
    volume: 'e.g. 6',
    'volume-clarify': 'A number works — e.g. 5 or 10-12',
    description: 'A 1-2 sentence description of what your company does',
    linkedin: 'https://www.linkedin.com/in/...',
    'linkedin-clarify': 'https://www.linkedin.com/in/...',
    submitting: '',
    submitted: '',
    error: '',
  }

  const inputDisabled =
    step === 'submitting' || step === 'submitted' || step === 'awaiting-ack' || step === 'error'

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto">
      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex animate-slide-up ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {msg.role === 'assistant' && (
              <div className="w-7 h-7 rounded-full bg-gold-100 border border-gold-200 flex items-center justify-center mr-3 mt-1 flex-shrink-0">
                <span className="text-gold-700 text-xs font-medium">W</span>
              </div>
            )}
            <div
              className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-line ${
                msg.role === 'assistant'
                  ? 'bg-white border border-[#E8DDD0] text-gray-800 rounded-tl-sm shadow-sm'
                  : 'bg-gold-600 text-white rounded-tr-sm'
              }`}
            >
              {msg.role === 'assistant' ? renderAssistant(msg.content) : msg.content}
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

        {(step === 'submitted' || step === 'error') && (
          <div className="animate-slide-up ml-10 mt-2">
            <button
              onClick={() => onDone?.()}
              className="w-full py-2.5 rounded-lg bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors"
            >
              Return Home
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {!inputDisabled && (
        <div className="pt-4 border-t border-[#E8DDD0]">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type={step === 'email' ? 'email' : 'text'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder={placeholder[step]}
              className="flex-1 bg-white border border-[#E8DDD0] rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gold-400 transition-colors shadow-sm"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-2 rounded-xl bg-gold-600 hover:bg-gold-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
