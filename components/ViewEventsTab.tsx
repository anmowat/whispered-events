'use client'

import { useState } from 'react'
import { UserProfile } from '@/lib/types'
import TopicChips from './TopicChips'
import {
  BackLink,
  ChatBubble,
  ChatRow,
  Composer,
  StepIndicator,
  parseInline,
} from './chat/ChatShell'

type Step =
  | 'email'
  | 'interest'
  | 'location'
  | 'linkedin'
  | 'employment'
  | 'size'
  | 'frequency'
  | 'submitted'

const EMPLOYMENT_OPTIONS = ['Employed', 'Searching', 'Fractional', 'Other']

// Exact spellings/capitalizations match the Frequency single-select
// options in Airtable Users table — do not change here without also
// updating Airtable.
const FREQUENCY_OPTIONS = ['As they arrive', 'Weekly', 'Monthly', 'Paused']
const DEFAULT_FREQUENCY = 'Monthly'

// Exact spellings match the Size single-select options in the Airtable
// Users table — do not change here without also updating Airtable.
const COMPANY_SIZE_OPTIONS = ['<$5M', '$5-25M', '$25-100M', '$100M-1B', '$1B+', 'Other']

// Display-only relabel for 'Paused'. The value we save (Airtable
// picklist, every backend lookup, the digest cron's frequency check)
// keeps 'Paused' — we just show users a friendlier label that hints
// at the actual behavior (no email; dashboard still shows matches).
function displayFrequency(value: string): string {
  return value === 'Paused' ? 'Dashboard Only' : value
}

const SEARCHING_NOTE =
  "The job market is changing fast — AI is reshaping everything.\n\nFor senior leaders, many of the best roles aren't posted. They're whispered.\n\nFor free playbooks, career strategies, and access to unposted GTM roles + the network to get them, visit [whispered.com](https://www.whispered.com/)."

const QUESTIONS: Record<Step, string> = {
  email:
    "Welcome! Let's get started.\n\n**What's your email address?**\n\nWe use this only to send you events — nothing else.",
  location:
    "**What city are you based in?**\n\nWe'll send events in your metro area (closer to you match higher).\n\nUpdate your location any time you travel!",
  linkedin:
    "**What's your LinkedIn profile URL?**\n\nWe'll use your profile to automatically enrich your function and seniority.",
  // Rendered as custom JSX below (see InterestPrompt) so the title can
  // pick up the gold accent. The string here is a plain-text fallback
  // used by the back-button path before the bubble re-renders.
  interest:
    "**What topics are you interested in?**\n\nWe use your topics (plus your location and LinkedIn profile which we'll collect next) to find the best events for you.\nPick from the topics below — you can update them anytime on your dashboard.",
  employment:
    "**What is your current work situation?**\n\nWe ask because some events focus on people in specific roles while others are open to anyone.",
  size:
    "**What is the approximate revenue of your current company?**\n\nSome events are run by vendors who focus on specific company sizes — this information helps us make sure you're matched to events that fit.",
  frequency:
    "Last question — **how often would you like to receive emails with matching events?**",
  submitted: '',
}

const EMPTY_PROFILE: UserProfile = {
  linkedin: '',
  interest: '',
  employment: '',
  companySize: '',
  email: '',
  location: '',
  learn: '',
  frequency: DEFAULT_FREQUENCY,
}

function profileField(step: Step): keyof UserProfile | null {
  const map: Partial<Record<Step, keyof UserProfile>> = {
    email: 'email',
    location: 'location',
    linkedin: 'linkedin',
    interest: 'interest',
    employment: 'employment',
    size: 'companySize',
    frequency: 'frequency',
  }
  return map[step] ?? null
}

function nextStep(current: Step, value: string): Step | null {
  const order: Step[] = [
    'email',
    'interest',
    'location',
    'linkedin',
    'employment',
    'size',
    'frequency',
  ]
  // Non-employed users skip the company-size step.
  if (current === 'employment' && value.toLowerCase() !== 'employed') {
    return 'frequency'
  }
  const idx = order.indexOf(current)
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : null
}

// Map each step to a 1-based index used by the StepIndicator. Employment
// (#6) and its conditional follow-up Size share the same slot so the
// progress reads as one logical step regardless of whether Size shows.
const STEP_INDEX: Record<Step, number> = {
  email: 1,
  interest: 2,
  location: 3,
  linkedin: 4,
  employment: 5,
  size: 5,
  frequency: 6,
  submitted: 6,
}
const TOTAL_STEPS = 6

export default function ViewEventsTab({
  eventCount = 0,
  // startAtForm kept for API compatibility with callers — the flow now
  // always starts at the first question, so the flag is a no-op.
  startAtForm: _startAtForm,
  onReturnHome,
}: {
  eventCount?: number
  startAtForm?: boolean
  onReturnHome?: () => void
}) {
  const [step, setStep] = useState<Step>('email')
  // No welcome preamble in the first bubble — the landing hero already
  // explained what this is, and on mobile the extra paragraphs forced
  // people to scroll just to see the input. The eventCount nudge survives
  // in the page hero, not here.
  const _eventCount = eventCount
  const [assistantContent, setAssistantContent] = useState<string>(QUESTIONS['email'])
  const [input, setInput] = useState('')
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE)
  const [isSubmitting, setIsSubmitting] = useState(false)
  // Stack of steps the user has already passed through. Pushed on every
  // forward advance, popped on Back. Avoids needing to hard-code which
  // step precedes which (the employment->skip-size case would otherwise
  // need its own branch).
  const [stepHistory, setStepHistory] = useState<Step[]>([])
  // Set when the interest-check endpoint rejects the user's answer.
  // While non-null we render a "keep what you wrote" button so they
  // can opt out of the coaching nudge without re-typing.
  const [pendingInterestOverride, setPendingInterestOverride] = useState<string | null>(null)
  // Same coaching pattern for location — see /api/check-location.
  // pendingLocationOverride holds the original text so the user can
  // dismiss the nudge; pendingLocationSuggestion is the cleaned value
  // we offer as a one-click correction (typo fix / noise stripped).
  // Returned by submit-profile. Authorises the contact writes below, since
  // there's no session at this point - the member is Pending until approved.
  const [signupToken, setSignupToken] = useState<string | null>(null)
  const [shareEmail, setShareEmail] = useState('')
  const [shareContacts, setShareContacts] = useState<string[]>([])
  const [shareBusy, setShareBusy] = useState(false)
  const [shareError, setShareError] = useState<string | null>(null)

  const [pendingLocationOverride, setPendingLocationOverride] = useState<string | null>(null)
  const [pendingLocationSuggestion, setPendingLocationSuggestion] = useState<string | null>(null)

  function advance(currentStep: Step, value: string, prelude?: string) {
    const field = profileField(currentStep)
    const normalized = ['skip', 'none'].includes(value.toLowerCase().trim())
      ? ''
      : value.trim()
    const updatedProfile = field ? { ...profile, [field]: normalized } : profile
    setProfile(updatedProfile)

    const next = nextStep(currentStep, normalized)
    setPendingInterestOverride(null)
    setPendingLocationOverride(null)
    setPendingLocationSuggestion(null)

    if (!next) {
      // Last step — submit immediately without a review screen.
      handleSubmit(updatedProfile)
      return
    }

    const isSearching =
      currentStep === 'employment' && normalized.toLowerCase() === 'searching'
    const base = QUESTIONS[next]
    const withSearchNote = isSearching ? `${SEARCHING_NOTE}\n\n${base}` : base
    const final = prelude ? `${prelude}\n\n${withSearchNote}` : withSearchNote

    setStepHistory((prev) => [...prev, currentStep])
    setStep(next)
    setAssistantContent(final)
  }

  function goBack() {
    if (stepHistory.length === 0) return
    const prev = stepHistory[stepHistory.length - 1]
    setStepHistory((s) => s.slice(0, -1))
    setStep(prev)
    setPendingInterestOverride(null)
    setPendingLocationOverride(null)
    setPendingLocationSuggestion(null)
    setAssistantContent(QUESTIONS[prev])
    setInput('')
    // Re-populate the input with their previous typed answer where
    // applicable (free-text steps). Picklist steps will just re-show
    // chips so no pre-fill needed.
    const field = profileField(prev)
    if (field && profile[field]) {
      setInput(profile[field])
    }
  }

  async function handleSend(value?: string) {
    const val = (value ?? input).trim()
    if (!val) return
    setInput('')
    if (step === 'linkedin' && !val.includes('linkedin.com')) {
      setAssistantContent(
        `Please share your LinkedIn profile URL (e.g. https://linkedin.com/in/yourname).\n\n${QUESTIONS['linkedin']}`,
      )
      return
    }
    if (step === 'frequency' && !FREQUENCY_OPTIONS.includes(val)) {
      setAssistantContent(`Please pick one of the options above.\n\n${QUESTIONS['frequency']}`)
      return
    }
    // Location quality check — see /api/check-location. Catches
    // typos, ambiguity, and noisy free-text so the downstream
    // Nominatim geocoder lands on the right city. User can either
    // accept a one-click suggestion or keep what they typed.
    if (step === 'location' && val !== pendingLocationOverride) {
      try {
        const res = await fetch('/api/check-location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ location: val }),
        })
        const data = (await res.json()) as {
          ok?: boolean
          message?: string
          suggestion?: string
          hardFail?: boolean
        }
        if (data.ok === false && data.message) {
          // hardFail means the geocoder itself couldn't place it. No override
          // button: letting someone force an un-geocodable location through
          // would silently break their matching, which is the whole reason
          // this check exists.
          if (data.hardFail) {
            setAssistantContent(data.message)
            setInput(val)
            setPendingLocationOverride(null)
            setPendingLocationSuggestion(null)
            return
          }
          setAssistantContent(
            `${data.message}\n\nUse the suggestion below, or keep what you wrote.`,
          )
          setInput(val)
          setPendingLocationOverride(val)
          setPendingLocationSuggestion(data.suggestion || null)
          return
        }
      } catch {
        // Fail open — never block signup on a flaky check.
      }
    }

    // Interest evaluation: when the user submits something vague (e.g.
    // "Flexible", "All types", "Networking") the matching algorithm
    // won't find much. Pause the flow and coach them on better
    // keywords before advancing.
    if (step === 'interest') {
      try {
        const res = await fetch('/api/check-interests', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ interest: val }),
        })
        const data = (await res.json()) as {
          ok?: boolean
          message?: string
          suggestions?: string[]
        }
        if (data.ok === false && data.message) {
          const suggestionLine =
            data.suggestions && data.suggestions.length
              ? `\n\nA few examples that would match more events:\n• ${data.suggestions.join('\n• ')}`
              : ''
          setAssistantContent(
            `${data.message}${suggestionLine}\n\nType a new answer below, or keep what you wrote.`,
          )
          setInput(val)
          setPendingInterestOverride(val)
          return
        }
      } catch {
        // Fail open — if the check endpoint blips, don't block signup.
      }
    }

    let prelude: string | undefined
    if (step === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        setAssistantContent(
          `That doesn't look like a valid email. Please try again.\n\n${QUESTIONS['email']}`,
        )
        return
      }
      try {
        const res = await fetch('/api/check-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: val }),
        })
        const data = (await res.json()) as { contributions?: number }
        const n = data.contributions ?? 0
        if (n > 0) {
          prelude = `Welcome back — we see you've already contributed ${n} ${n === 1 ? 'event' : 'events'}. Let's get you activated.`
        }
      } catch {}
    }
    advance(step, val, prelude)
  }

  async function addShareContact() {
    const value = shareEmail.trim()
    if (!value || !signupToken || shareBusy) return
    setShareBusy(true)
    setShareError(null)
    try {
      const res = await fetch('/api/signup/contacts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: signupToken, email: value }),
      })
      const data = (await res.json()) as { contacts?: string[]; error?: string }
      if (!res.ok) {
        setShareError(data.error || 'Could not add that contact.')
        return
      }
      setShareContacts(data.contacts ?? [])
      setShareEmail('')
    } catch {
      setShareError('Could not add that contact.')
    } finally {
      setShareBusy(false)
    }
  }

  async function removeShareContact(email: string) {
    if (!signupToken || shareBusy) return
    setShareBusy(true)
    setShareError(null)
    try {
      const res = await fetch('/api/signup/contacts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: signupToken, email }),
      })
      const data = (await res.json()) as { contacts?: string[]; error?: string }
      if (!res.ok) {
        setShareError(data.error || 'Could not remove that contact.')
        return
      }
      setShareContacts(data.contacts ?? [])
    } catch {
      setShareError('Could not remove that contact.')
    } finally {
      setShareBusy(false)
    }
  }

  async function handleSubmit(submittedProfile: UserProfile) {
    setIsSubmitting(true)
    setStep('submitted')
    setAssistantContent('Submitting…')
    try {
      const res = await fetch('/api/submit-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile: submittedProfile }),
      })
      const data = (await res.json()) as {
        status?: string
        error?: string
        signupToken?: string
      }
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      if (data.signupToken) setSignupToken(data.signupToken)
      setAssistantContent(
        `You're all set. As long as your LinkedIn checks out, you're approved — we'll send matching events to ${submittedProfile.email}.`,
      )
    } catch (err) {
      setStep('frequency')
      setAssistantContent(
        `Something went wrong: ${err instanceof Error ? err.message : 'Please try again.'}`,
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const showStepIndicator = step !== 'submitted'
  // Employment + frequency are picklist-only. A text composer beneath
  // the chips reads as "you can type here too" and confuses people, even
  // though we accept anything. Drop it for those two steps.
  const isPicklistStep = step === 'employment' || step === 'frequency' || step === 'size'
  const showComposer = step !== 'submitted' && !isPicklistStep
  const canGoBack = stepHistory.length > 0 && step !== 'submitted'

  // Single top-of-surface back link. While there's form history we
  // step backward one question; from the first step we return to the
  // landing surface. The bottom in-flow back link has been removed —
  // one entry point keeps it consistent with the other chat tabs.
  function handleTopBack() {
    if (canGoBack) {
      goBack()
    } else if (onReturnHome) {
      onReturnHome()
    }
  }
  const showBackLink = step !== 'submitted'

  return (
    <div className="flex flex-col h-full max-w-[680px] mx-auto">
      {showBackLink && <BackLink onClick={handleTopBack} />}
      {showStepIndicator && (
        <StepIndicator label="Sign up" current={STEP_INDEX[step]} total={TOTAL_STEPS} />
      )}

      <div className="flex-1 space-y-4 pb-4">
        <ChatRow role="assistant">
          <ChatBubble role="assistant">
            {step === 'interest' ? (
              <InterestPrompt />
            ) : (
              <div className="space-y-1">
                {assistantContent.split('\n').map((line, j) => (
                  <p key={j} className="m-0">
                    {line ? parseInline(line) : ' '}
                  </p>
                ))}
              </div>
            )}
          </ChatBubble>
        </ChatRow>

        {step === 'interest' && pendingInterestOverride && (
          <div className="animate-slide-up">
            <button
              onClick={() => {
                const val = pendingInterestOverride
                setPendingInterestOverride(null)
                setInput('')
                advance('interest', val)
              }}
              className="px-3.5 py-1.5 rounded-pill border text-[13px] transition-colors"
              style={{
                background: 'var(--paper)',
                borderColor: 'var(--rule)',
                color: 'var(--ink-2)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--accent-soft)'
                e.currentTarget.style.borderColor = 'var(--accent)'
                e.currentTarget.style.color = 'var(--accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--paper)'
                e.currentTarget.style.borderColor = 'var(--rule)'
                e.currentTarget.style.color = 'var(--ink-2)'
              }}
            >
              Keep &ldquo;{pendingInterestOverride}&rdquo; →
            </button>
          </div>
        )}

        {step === 'location' && pendingLocationOverride && (
          <div className="flex flex-wrap gap-2 animate-slide-up">
            {pendingLocationSuggestion && (
              <button
                onClick={() => {
                  const val = pendingLocationSuggestion
                  setPendingLocationOverride(null)
                  setPendingLocationSuggestion(null)
                  setInput('')
                  advance('location', val)
                }}
                className="px-3.5 py-1.5 rounded-pill border text-[13px] font-medium transition-colors"
                style={{
                  background: 'var(--accent)',
                  borderColor: 'var(--accent)',
                  color: 'white',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'var(--accent-2)'
                  e.currentTarget.style.borderColor = 'var(--accent-2)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'var(--accent)'
                  e.currentTarget.style.borderColor = 'var(--accent)'
                }}
              >
                Use &ldquo;{pendingLocationSuggestion}&rdquo; →
              </button>
            )}
            <button
              onClick={() => {
                const val = pendingLocationOverride
                setPendingLocationOverride(null)
                setPendingLocationSuggestion(null)
                setInput('')
                advance('location', val)
              }}
              className="px-3.5 py-1.5 rounded-pill border text-[13px] transition-colors"
              style={{
                background: 'var(--paper)',
                borderColor: 'var(--rule)',
                color: 'var(--ink-2)',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'var(--accent-soft)'
                e.currentTarget.style.borderColor = 'var(--accent)'
                e.currentTarget.style.color = 'var(--accent)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'var(--paper)'
                e.currentTarget.style.borderColor = 'var(--rule)'
                e.currentTarget.style.color = 'var(--ink-2)'
              }}
            >
              Keep &ldquo;{pendingLocationOverride}&rdquo; →
            </button>
          </div>
        )}

        {step === 'employment' && (
          <ChipRow options={EMPLOYMENT_OPTIONS} onPick={(opt) => handleSend(opt)} />
        )}

        {step === 'size' && (
          <ChipRow options={COMPANY_SIZE_OPTIONS} onPick={(opt) => handleSend(opt)} />
        )}

        {step === 'frequency' && (
          <ChipRow
            options={FREQUENCY_OPTIONS}
            labelOf={displayFrequency}
            onPick={(opt) => handleSend(opt)}
          />
        )}

        {/* Sharing, offered on the finish screen rather than as a step: the
            profile is already saved, so there is nothing to abandon and no
            reason to make anyone pass through it. Email only - name search
            stays behind a session on the dashboard. */}
        {step === 'submitted' && signupToken && (
          <div
            className="mt-4 pt-4 border-t animate-slide-up"
            style={{ borderColor: 'var(--rule)' }}
          >
            <p className="m-0 font-semibold" style={{ color: 'var(--accent)' }}>
              See/Share Events with your contacts
            </p>
            <p className="m-0 mt-1.5" style={{ fontSize: 14, lineHeight: 1.6 }}>
              Share which events you&rsquo;re attending with select contacts — and see which
              events they&rsquo;re attending.
            </p>

            <div className="mt-3 flex items-center gap-2">
              <input
                type="text"
                inputMode="email"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                name="whispered-signup-contact"
                data-1p-ignore
                data-lpignore="true"
                data-bwignore
                data-form-type="other"
                value={shareEmail}
                disabled={shareBusy}
                placeholder="name@company.com"
                onChange={(e) => setShareEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void addShareContact()
                  }
                }}
                className="flex-1 rounded-input border px-3 py-2 text-[13px] focus:outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--paper-2)',
                  borderColor: 'var(--rule)',
                  color: 'var(--ink)',
                }}
              />
              <button
                onClick={() => void addShareContact()}
                disabled={shareBusy || !shareEmail.trim()}
                className="shrink-0 px-4 py-2 rounded-pill text-[13px] font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                style={{ background: 'var(--accent)' }}
              >
                Add
              </button>
            </div>

            {shareError && (
              <p className="m-0 mt-2" style={{ fontSize: 13, color: 'var(--accent)' }}>
                {shareError}
              </p>
            )}

            {shareContacts.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-2">
                {shareContacts.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-pill border"
                    style={{
                      borderColor: 'var(--rule)',
                      background: 'var(--paper-2)',
                      fontSize: 13,
                      color: 'var(--ink)',
                    }}
                  >
                    {email}
                    <button
                      onClick={() => void removeShareContact(email)}
                      disabled={shareBusy}
                      aria-label={`Remove ${email}`}
                      className="leading-none disabled:opacity-40"
                      style={{ color: 'var(--ink-3)' }}
                    >
                      &times;
                    </button>
                  </span>
                ))}
              </div>
            )}

            <p className="m-0 mt-2.5" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              We&rsquo;ll share your events with them once you are approved. You can add more at
              anytime on your Dashboard.
            </p>

            {/* Only once they've actually added someone - explaining the rules
                to a person who skipped would be noise on a finish screen. */}
            {shareContacts.length > 0 && (
              <div className="mt-3 space-y-1.5" style={{ fontSize: 13, color: 'var(--ink-2)' }}>
                <p className="m-0">
                  • They&rsquo;ll only see events you mark <strong>Interested</strong> — rating is
                  what drives this. It also unlocks more matches and teaches the algorithm what
                  fits you.
                </p>
                <p className="m-0">• They can share the events they&rsquo;re attending with you too.</p>
                <p className="m-0">• Change or turn off sharing any time from your dashboard.</p>
              </div>
            )}
          </div>
        )}

        {step === 'submitted' && onReturnHome && (
          <div className="mt-2 animate-slide-up">
            <button
              onClick={onReturnHome}
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

      {step === 'interest' && (
        <div className="mt-4 animate-slide-up">
          <TopicChips value={input} onChange={setInput} />
        </div>
      )}

      {step === 'interest' ? (
        <div className="pt-3 sm:pt-4 border-t" style={{ borderColor: 'var(--rule-soft)' }}>
          <button
            onClick={() => handleSend()}
            disabled={!input.trim()}
            className="rounded-pill px-3.5 sm:px-4 py-2.5 text-[13px] font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'var(--accent)' }}
            onMouseEnter={(e) =>
              input.trim() && (e.currentTarget.style.background = 'var(--accent-2)')
            }
            onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
          >
            Send
          </button>
        </div>
      ) : showComposer && (
        <Composer
          value={input}
          onChange={setInput}
          onSend={() => handleSend()}
        />
      )}
    </div>
  )
}

// Custom prompt for the Topics step. Title is rendered in the gold
// accent so the "What topics..." line pops the same way the section
// labels of the chip groups below do.
function InterestPrompt() {
  return (
    <div className="space-y-2.5">
      <p className="m-0 font-semibold" style={{ color: 'var(--accent)' }}>
        What topics are you interested in?
      </p>
      <p className="m-0">
        We use your topics (plus your location and LinkedIn profile which we&rsquo;ll collect next) to find the best events for you.
      </p>
      <p className="m-0">
        Pick from the topics below — you can update them anytime on your dashboard.
      </p>
    </div>
  )
}

// Inline chip row used for employment + frequency steps. labelOf lets
// us display a friendly label (e.g. 'Dashboard Only') while still
// passing the underlying value (e.g. 'Paused') to onPick.
function ChipRow({
  options,
  onPick,
  labelOf,
}: {
  options: string[]
  onPick: (opt: string) => void
  labelOf?: (opt: string) => string
}) {
  return (
    <div className="flex flex-wrap gap-2 animate-slide-up">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onPick(o)}
          className="px-3.5 py-1.5 rounded-pill border text-[13px] transition-colors"
          style={{
            background: 'var(--paper)',
            borderColor: 'var(--rule)',
            color: 'var(--ink-2)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--accent-soft)'
            e.currentTarget.style.borderColor = 'var(--accent)'
            e.currentTarget.style.color = 'var(--accent)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--paper)'
            e.currentTarget.style.borderColor = 'var(--rule)'
            e.currentTarget.style.color = 'var(--ink-2)'
          }}
        >
          {labelOf ? labelOf(o) : o}
        </button>
      ))}
    </div>
  )
}

