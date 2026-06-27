'use client'

import { useState, useEffect } from 'react'
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
  | 'partnershipType'
  | 'description'
  | 'submitting'
  | 'submitted'
  | 'error'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const FIRST_QUESTION =
  "Partnering is free for people who host great executive events. We'll ask a few quick questions, then our team reviews — typically within 24 hours.\n\n**First, what's your email?**"

const EMAIL_NOT_FOUND =
  "Before applying to be a partner, take a moment to [create a user profile](/?tab=view) — we find it helps prospective partners understand the model … and discover events for themselves.\n\nOnce you've created a profile, come back here to apply."

const STEP_PROMPTS: Partial<Record<Step, string>> = {
  email: FIRST_QUESTION,
  company: "**What's the name of your company / organization?**",
  audience:
    "We look forward to collaborating. **Can you describe your audience(s)?** e.g. CROs, VPs of Sales, GTM leaders at $50M+ ARR companies, NYC events….",
  partnershipType: '**What type of partnership are you interested in?**',
  description:
    "Last one — **can you share a short description of what your company does?**",
}

const PREV_STEP: Partial<Record<Step, Step>> = {
  company: 'email',
  audience: 'company',
  partnershipType: 'audience',
  description: 'partnershipType',
}

const STEP_INDEX: Partial<Record<Step, number>> = {
  email: 1,
  company: 2,
  audience: 3,
  partnershipType: 4,
  description: 5,
  submitting: 5,
  submitted: 5,
  error: 5,
}
const TOTAL_STEPS = 5

export default function PartnerApplyTab({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState<Step>('email')
  const [assistantContent, setAssistantContent] = useState<string>(FIRST_QUESTION)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [form, setForm] = useState({
    email: '',
    company: '',
    audience: '',
    partnershipType: '',
    description: '',
  })

  // If already logged in, skip the email step.
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { user?: { email?: string } | null }) => {
        if (d.user?.email) {
          setForm((f) => ({ ...f, email: d.user!.email! }))
          setAssistantContent(STEP_PROMPTS.company!)
          setStep('company')
        }
      })
      .catch(() => {})
  }, [])

  function handleBack() {
    const prev = PREV_STEP[step]
    // If on company and email was pre-filled (logged in), skip back past email
    if (step === 'company' && form.email && !PREV_STEP.company) {
      onDone?.()
      return
    }
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
      // Check if this email exists in the user database.
      setIsLoading(true)
      try {
        const res = await fetch(`/api/check-user-email?email=${encodeURIComponent(value)}`)
        const data = (await res.json()) as { exists: boolean }
        if (!data.exists) {
          setAssistantContent(EMAIL_NOT_FOUND)
          return
        }
      } catch {
        // Network error — let them proceed rather than blocking
      } finally {
        setIsLoading(false)
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
      setAssistantContent(STEP_PROMPTS.partnershipType!)
      setStep('partnershipType')
      return
    }

    if (step === 'partnershipType') {
      setForm((f) => ({ ...f, partnershipType: value }))
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
        setStep('submitted')
        setShowSuccess(true)
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
    partnershipType: 'e.g. Community, Sponsor, Co-host…',
    description: 'A 1-2 sentence description of what your company does',
  }

  const inputDisabled =
    step === 'submitting' ||
    step === 'submitted' ||
    step === 'error'

  const showStepIndicator = step !== 'submitted' && step !== 'error'

  const showBackLink = step !== 'submitted' && step !== 'error' && step !== 'submitting'

  return (
    <>
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

          {(step === 'error') && (
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

      {/* Success dialog */}
      {showSuccess && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={() => { setShowSuccess(false); onDone?.() }}
        >
          <div
            className="rounded-card border w-full max-w-sm p-7 text-center"
            style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p
              className="font-serif m-0"
              style={{ fontSize: 22, color: 'var(--ink)', lineHeight: 1.2, letterSpacing: '-0.01em' }}
            >
              Thank you for your interest in partnering
            </p>
            <p
              className="mt-4 m-0"
              style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}
            >
              We are reviewing your partner application and will reach out — typically within 24 hours.
            </p>
            <p
              className="mt-2 m-0"
              style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.6 }}
            >
              We look forward to collaborating.
            </p>
            <button
              onClick={() => { setShowSuccess(false); onDone?.() }}
              className="mt-6 w-full py-2.5 rounded-pill text-[13px] font-medium transition-colors"
              style={{ background: 'var(--accent)', color: 'var(--paper)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--accent-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </>
  )
}
