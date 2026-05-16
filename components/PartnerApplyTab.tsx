'use client'

import { useState, useRef, useEffect } from 'react'
import {
  ChatRow,
  ChatBubble,
  Composer,
  StepIndicator,
  TypingIndicator,
  parseInline,
  type ChatMessage,
} from './chat/ChatShell'

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const LINKEDIN_RE = /(^|\.)linkedin\.com\/(in|company|pub)\//i

const WELCOME: ChatMessage = {
  role: 'assistant',
  content:
    "Welcome to Whispered Events. Partnering with us is free for people who host great executive events. We'll ask a few quick questions, then our team will review and follow up — typically within 24 hours.\n\n**First, can we get your email?**",
}

// 1-based step index used by the StepIndicator. Clarify-steps reuse
// their parent slot so the progress doesn't visually rewind.
const STEP_INDEX: Partial<Record<Step, number>> = {
  email: 1,
  company: 2,
  audience: 3,
  'awaiting-ack': 4,
  volume: 4,
  'volume-clarify': 4,
  description: 5,
  linkedin: 6,
  'linkedin-clarify': 6,
  submitting: 6,
  submitted: 6,
  error: 6,
}
const TOTAL_STEPS = 6

// Accepts "5", "about 5", "5-7", "5 to 7", "10–12 per year". Range →
// midpoint. Returns null on vague answers so the caller can ask one
// clarifying follow-up before giving up.
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
  const [messages, setMessages] = useState<ChatMessage[]>([WELCOME])
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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, step])

  function addAssistant(content: string) {
    setMessages((prev) => [...prev, { role: 'assistant', content }])
  }
  function addUser(content: string) {
    setMessages((prev) => [...prev, { role: 'user', content }])
  }

  // Single dispatcher consuming the input based on the current step.
  // Keeps the UI shape constant — one persistent text input at the
  // bottom — instead of swapping in different forms per step.
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
        const fallback = `That is great. We have ${value} on our platform and look forward to connecting you with the right ones.`
        const ack = data.ack?.trim() || fallback
        addAssistant(
          `${ack}\n\n**How many events do you host or run each year?** A single number is great — even a rough estimate works.`,
        )
      } catch {
        addAssistant(
          `That is great. We have ${value} on our platform and look forward to connecting you with the right ones.\n\n**How many events do you host or run each year?** A single number is great — even a rough estimate works.`,
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
          addAssistant("Could you give me a number? Even a rough estimate works — e.g. 5 or 10-12.")
          setStep('volume-clarify')
          return
        }
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
    linkedin: 'https://www.linkedin.com/in/…',
    'linkedin-clarify': 'https://www.linkedin.com/in/…',
    submitting: '',
    submitted: '',
    error: '',
  }

  const inputDisabled =
    step === 'submitting' ||
    step === 'submitted' ||
    step === 'awaiting-ack' ||
    step === 'error'

  const showStepIndicator = step !== 'submitted' && step !== 'error'

  return (
    <div className="flex flex-col h-full max-w-[680px] mx-auto">
      {showStepIndicator && (
        <StepIndicator
          label="Partner"
          current={STEP_INDEX[step] || 1}
          total={TOTAL_STEPS}
        />
      )}

      <div className="flex-1 overflow-y-auto space-y-4 pb-4">
        {messages.map((msg, i) => (
          <ChatRow key={i} role={msg.role}>
            <ChatBubble role={msg.role}>
              {msg.role === 'assistant' ? (
                <div className="space-y-1">
                  {msg.content.split('\n').map((line, j) => (
                    <p key={j} className="m-0">
                      {line ? parseInline(line) : ' '}
                    </p>
                  ))}
                </div>
              ) : (
                msg.content
              )}
            </ChatBubble>
          </ChatRow>
        ))}

        {isLoading && <TypingIndicator />}

        {(step === 'submitted' || step === 'error') && (
          <div className="ml-10 mt-2 animate-slide-up">
            <button
              onClick={() => onDone?.()}
              className="w-full py-2.5 rounded-pill text-[13px] font-medium text-white transition-colors"
              style={{ background: 'var(--accent)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
            >
              Return home
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {!inputDisabled && (
        <Composer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          placeholder={placeholder[step]}
        />
      )}
    </div>
  )
}
