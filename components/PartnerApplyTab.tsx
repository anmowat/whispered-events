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
  | 'description'
  | 'submitting'
  | 'submitted'
  | 'error'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FIRST_QUESTION =
  "Partnering is free for people who host great executive events. We'll ask a few quick questions, then our team reviews — typically within 24 hours.\n\n**First, what's your email?**"

const STEP_PROMPTS: Partial<Record<Step, string>> = {
  email: FIRST_QUESTION,
  company: "Thanks. **What's the name of your company / organization?**",
  audience:
    "Great to connect. **To start, can you describe your target audience(s) for your events?** Roles and levels are most useful — e.g. CROs, VPs of Sales, GTM leaders at $50M+ ARR companies.",
  description:
    "Last one — if we approve you, we'll list you on our partner directory. **Can you share a short description of what your company does?**",
}

// Where each step goes when back is pressed. Steps not listed here call onDone.
const PREV_STEP: Partial<Record<Step, Step>> = {
  company: 'email',
  audience: 'company',
  description: 'audience',
}

const STEP_INDEX: Partial<Record<Step, number>> = {
  email: 1,
  company: 2,
  audience: 3,
  description: 4,
  submitting: 4,
  submitted: 4,
  error: 4,
}
const TOTAL_STEPS = 4

export default function PartnerApplyTab({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState<Step>('email')
  const [assistantContent, setAssistantContent] = useState<string>(FIRST_QUESTION)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [form, setForm] = useState({
    email: '',
    company: '',
    audience: '',
    description: '',
  })

  function handleBack() {
    const prev = PREV_STEP[step]
    if (!prev) {
      onDone?.()
      return
    }
    setStep(prev)
    setAssistantContent(STEP_PROMPTS[prev] ?? '')
    setInput('')
  }

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
      setAssistantContent(STEP_PROMPTS.company!)
      setStep('company')
      return
    }

    if (step === 'company') {
      setForm((f) => ({ ...f, company: value }))
      setAssistantContent(STEP_PROMPTS.audience!)
      setStep('audience')
      return
    }

    if (step === 'audience') {
      setForm((f) => ({ ...f, audience: value }))
      setAssistantContent(STEP_PROMPTS.description!)
      setStep('description')
      return
    }

    if (step === 'description') {
      const finalForm = { ...form, description: value }
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

  const placeholder: Partial<Record<Step, string>> = {
    email: 'jane@company.com',
    company: 'Acme Corp',
    audience: 'e.g. CROs, VPs of Sales at $50M+ ARR companies',
    description: 'A 1-2 sentence description of what your company does',
  }

  const inputDisabled =
    step === 'submitting' ||
    step === 'submitted' ||
    step === 'error'

  const showStepIndicator = step !== 'submitted' && step !== 'error'

  const showBackLink = step !== 'submitted' && step !== 'error' && step !== 'submitting'

  return (
    <div className="flex flex-col h-full max-w-[680px] mx-auto">
      {showBackLink && onDone && <BackLink onClick={handleBack} />}
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
          placeholder={placeholder[step] ?? ''}
        />
      )}
    </div>
  )
}
