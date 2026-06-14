'use client'

import { useState } from 'react'
import {
  ChatRow,
  ChatBubble,
  Composer,
  BackLink,
  StepIndicator,
  TypingIndicator,
  parseInline,
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

const FIRST_QUESTION =
  "Partnering is free for people who host great executive events. We'll ask a few quick questions, then our team reviews — typically within 24 hours.\n\n**First, what's your email?**"

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
  const [assistantContent, setAssistantContent] = useState<string>(FIRST_QUESTION)
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

  // Single dispatcher consuming the input based on the current step.
  // Replaces the previous question/answer in place so the user always
  // sees only the current prompt — no scrolling history.
  async function handleSend() {
    const value = input.trim()
    if (!value) return
    setInput('')

    if (step === 'email') {
      if (!EMAIL_RE.test(value)) {
        setAssistantContent(
          `That doesn't look like a valid email — please try again.\n\n${FIRST_QUESTION}`,
        )
        return
      }
      setForm((f) => ({ ...f, email: value }))
      setAssistantContent("Thanks. **What's the name of your company / organization?**")
      setStep('company')
      return
    }

    if (step === 'company') {
      setForm((f) => ({ ...f, company: value }))
      setAssistantContent(
        "Great to connect. **To start, can you describe your target audience(s) for your events?** Roles and levels are most useful — e.g. CROs, VPs of Sales, GTM leaders at $50M+ ARR companies.",
      )
      setStep('audience')
      return
    }

    if (step === 'audience') {
      setForm((f) => ({ ...f, audience: value }))
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
        setAssistantContent(
          `${ack}\n\n**How many events do you host or run each year?** A single number is great — even a rough estimate works.`,
        )
      } catch {
        setAssistantContent(
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
      if (parsed === null) {
        if (step === 'volume') {
          setAssistantContent(
            "Could you give me a number? Even a rough estimate works — e.g. 5 or 10-12.",
          )
          setStep('volume-clarify')
          return
        }
        setForm((f) => ({ ...f, volume: value }))
      } else {
        setForm((f) => ({ ...f, volume: String(parsed) }))
      }
      setAssistantContent(
        "If we approve you, we'll list you on our partner directory. **Can you share a short description of what your company does?**",
      )
      setStep('description')
      return
    }

    if (step === 'description') {
      setForm((f) => ({ ...f, description: value }))
      setAssistantContent("Last one — **what's your LinkedIn profile URL?**")
      setStep('linkedin')
      return
    }

    if (step === 'linkedin' || step === 'linkedin-clarify') {
      const normalized = normalizeLinkedin(value)
      if (!LINKEDIN_RE.test(normalized)) {
        setAssistantContent(
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
        setAssistantContent(
          "**Great — your application is in.** Our team will review and follow up within 24 hours.\n\nPartnership is free. While you wait, two things that really help: (a) share events you're hosting or hear about, and (b) tell top execs in your network about Whispered Events.",
        )
        setStep('submitted')
      } catch (err) {
        setAssistantContent(
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

  const showBackLink = step !== 'submitted'

  return (
    <div className="flex flex-col h-full max-w-[680px] mx-auto">
      {showBackLink && onDone && <BackLink onClick={onDone} />}
      {showStepIndicator && (
        <StepIndicator
          label="Partner"
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

        {(step === 'submitted' || step === 'error') && (
          <div className="mt-2 animate-slide-up">
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
