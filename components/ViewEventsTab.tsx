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
  | 'learn'
  | 'interest'
  | 'location'
  | 'linkedin'
  | 'employment'
  | 'size'
  | 'frequency'
  | 'confirm'
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
  learn:
    "👀 **How did you learn about Whispered events?**\n\nKnowing who pointed you our way — the community, partner, post or friend — helps us connect more people with great events.",
  location:
    "**What city are you based in?**\n\nWe'll send events within 100 miles. Pick one primary city — you can change it anytime you travel.",
  linkedin:
    "**What's your LinkedIn profile URL?**\n\nWe'll use your profile to automatically enrich your function and seniority.",
  // Rendered as custom JSX below (see InterestPrompt) so the title can
  // pick up the gold accent. The string here is a plain-text fallback
  // used by the back-button path before the bubble re-renders.
  interest:
    "**What topics are you interested in?**\n\nWe use your topics (plus your location and LinkedIn profile which we'll collect next) to find the best events for you.\nPick from frequently used topics below **AND** also feel free to add your own\nUpdate anytime on your dashboard",
  employment:
    "**What is your current work situation?**\n\nWe ask because some events focus on people in specific roles while others are open to anyone.",
  size:
    "**What is the approximate revenue of your current company?**\n\nSome events are run by vendors who focus on specific company sizes — this information helps us make sure you're matched to events that fit.",
  frequency:
    "Last question — **how often would you like to receive emails with matching events?**",
  confirm: '',
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
    learn: 'learn',
    location: 'location',
    linkedin: 'linkedin',
    interest: 'interest',
    employment: 'employment',
    size: 'companySize',
    frequency: 'frequency',
  }
  return map[step] ?? null
}

function nextStep(current: Step, value: string): Step {
  const order: Step[] = [
    'email',
    'learn',
    'interest',
    'location',
    'linkedin',
    'employment',
    'size',
    'frequency',
    'confirm',
  ]
  // Non-employed users skip the company-size step.
  if (current === 'employment' && value.toLowerCase() !== 'employed') {
    return 'frequency'
  }
  const idx = order.indexOf(current)
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : 'confirm'
}

// Map each step to a 1-based index used by the StepIndicator. Employment
// (#6) and its conditional follow-up Size share the same slot so the
// progress reads as one logical step regardless of whether Size shows.
const STEP_INDEX: Record<Step, number> = {
  email: 1,
  learn: 2,
  interest: 3,
  location: 4,
  linkedin: 5,
  employment: 6,
  size: 6,
  frequency: 7,
  confirm: 7,
  submitted: 7,
}
const TOTAL_STEPS = 7

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

  function advance(currentStep: Step, value: string, prelude?: string) {
    const field = profileField(currentStep)
    const normalized = ['skip', 'none'].includes(value.toLowerCase().trim())
      ? ''
      : value.trim()
    const updatedProfile = field ? { ...profile, [field]: normalized } : profile
    setProfile(updatedProfile)

    const next = nextStep(currentStep, normalized)
    const isSearching =
      currentStep === 'employment' && normalized.toLowerCase() === 'searching'
    const base =
      next === 'confirm'
        ? "Here's your profile — review each field and edit anything before submitting."
        : QUESTIONS[next]
    const withSearchNote = isSearching ? `${SEARCHING_NOTE}\n\n${base}` : base
    const final = prelude ? `${prelude}\n\n${withSearchNote}` : withSearchNote

    setStepHistory((prev) => [...prev, currentStep])
    setStep(next === 'confirm' ? 'confirm' : next)
    setAssistantContent(final)
    setPendingInterestOverride(null)
  }

  function goBack() {
    if (stepHistory.length === 0) return
    const prev = stepHistory[stepHistory.length - 1]
    setStepHistory((s) => s.slice(0, -1))
    setStep(prev)
    setPendingInterestOverride(null)
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
    if (step === 'learn') {
      // Required field — we want this for attribution. Reject empties
      // and the typical 'skip'/'none' bypass we accept everywhere else.
      const lower = val.toLowerCase()
      if (!val || lower === 'skip' || lower === 'none') {
        setAssistantContent(
          `Please share how you heard about us — even a few words is enough.\n\n${QUESTIONS['learn']}`,
        )
        setInput(val)
        return
      }
    }
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

  async function handleSubmit() {
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/submit-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      })
      const data = (await res.json()) as { status?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setStep('submitted')
      setAssistantContent(
        `You're all set. As long as your LinkedIn checks out, you're approved — we'll send matching events to ${profile.email}.\n\nLove what we are doing? Tag [Whispered Events](https://www.linkedin.com/company/whispered-events/about/?viewAsMember=true) on a LinkedIn post to help us grow.`,
      )
    } catch (err) {
      setAssistantContent(
        `Something went wrong: ${err instanceof Error ? err.message : 'Please try again.'}`,
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  const showStepIndicator = step !== 'submitted' && step !== 'confirm'
  // Employment + frequency are picklist-only. A text composer beneath
  // the chips reads as "you can type here too" and confuses people, even
  // though we accept anything. Drop it for those two steps.
  const isPicklistStep = step === 'employment' || step === 'frequency' || step === 'size'
  const showComposer = step !== 'confirm' && step !== 'submitted' && !isPicklistStep
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

        {step === 'confirm' && (
          <ProfileSummary
            profile={profile}
            onUpdate={(field, value) => setProfile((p) => ({ ...p, [field]: value }))}
            onSubmit={handleSubmit}
            isSubmitting={isSubmitting}
          />
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

      {showComposer && (
        <Composer
          value={input}
          onChange={setInput}
          onSend={() => handleSend()}
          placeholder="Type your answer…"
        />
      )}

      {step === 'interest' && (
        <div className="mt-4 animate-slide-up">
          <TopicChips value={input} onChange={setInput} />
        </div>
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
        Pick from frequently used topics below <strong>AND</strong>{' '}
        <strong className="underline" style={{ color: 'var(--accent)' }}>
          also feel free to add your own
        </strong>
      </p>
      <p className="m-0">Update anytime on your dashboard</p>
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

// Review card with per-field inline edit + Submit button.
function ProfileSummary({
  profile,
  onUpdate,
  onSubmit,
  isSubmitting,
}: {
  profile: UserProfile
  onUpdate: (field: keyof UserProfile, value: string) => void
  onSubmit: () => void
  isSubmitting: boolean
}) {
  const [editingField, setEditingField] = useState<keyof UserProfile | null>(null)
  const [editValue, setEditValue] = useState('')
  const [editError, setEditError] = useState('')

  const fields: { key: keyof UserProfile; label: string }[] = [
    { key: 'email', label: 'Email' },
    { key: 'learn', label: 'How you heard about us' },
    { key: 'interest', label: 'Topics' },
    { key: 'location', label: 'City' },
    { key: 'linkedin', label: 'LinkedIn' },
    { key: 'employment', label: 'Employment' },
    ...(profile.employment.toLowerCase() === 'employed'
      ? [{ key: 'companySize' as keyof UserProfile, label: 'Company size' }]
      : []),
    { key: 'frequency', label: 'Email frequency' },
  ]

  function startEdit(field: keyof UserProfile) {
    setEditingField(field)
    setEditValue(profile[field])
    setEditError('')
  }

  function saveEdit() {
    if (!editingField) return
    const val = editValue.trim()
    if (editingField === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      setEditError('Please enter a valid email address.')
      return
    }
    if (editingField === 'linkedin' && val && !val.includes('linkedin.com')) {
      setEditError('Please enter a valid LinkedIn URL.')
      return
    }
    if (editingField === 'learn' && !val) {
      setEditError('This field is required — even a few words is enough.')
      return
    }
    onUpdate(editingField, val)
    setEditingField(null)
    setEditError('')
  }

  return (
    <div className="animate-slide-up">
      <div
        className="rounded-card border overflow-hidden"
        style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
      >
        {fields.map(({ key, label }, idx) => {
          const value = profile[key]
          const isEditing = editingField === key
          const isLast = idx === fields.length - 1
          return (
            <div
              key={key}
              className="px-4 py-3"
              style={{
                borderBottom: isLast ? 'none' : '1px solid var(--rule-soft)',
              }}
            >
              {isEditing ? (
                <div className="space-y-2">
                  <p className="eyebrow" style={{ color: 'var(--accent)' }}>
                    {label}
                  </p>
                  {(() => {
                    const picklist =
                      editingField === 'frequency'
                        ? FREQUENCY_OPTIONS
                        : editingField === 'employment'
                          ? EMPLOYMENT_OPTIONS
                          : editingField === 'companySize'
                            ? COMPANY_SIZE_OPTIONS
                            : null
                    if (picklist) {
                      return (
                        <select
                          autoFocus
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                              setEditingField(null)
                              setEditError('')
                            }
                          }}
                          className="salon-select w-full rounded-input border px-3 py-2 text-[13px]"
                          style={{ background: 'var(--paper-2)', borderColor: 'var(--accent)' }}
                        >
                          {picklist.map((opt) => (
                            <option key={opt} value={opt}>
                              {editingField === 'frequency' ? displayFrequency(opt) : opt}
                            </option>
                          ))}
                        </select>
                      )
                    }
                    return (
                      <input
                        autoFocus
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit()
                          if (e.key === 'Escape') {
                            setEditingField(null)
                            setEditError('')
                          }
                        }}
                        className="w-full rounded-input border px-3 py-2 text-[13px]"
                        style={{ background: 'var(--paper-2)', borderColor: 'var(--accent)' }}
                      />
                    )
                  })()}
                  {editError && (
                    <p className="text-[11.5px]" style={{ color: 'var(--accent)' }}>
                      {editError}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={saveEdit}
                      className="px-3 py-1.5 rounded-pill text-[12px] text-white font-medium"
                      style={{ background: 'var(--accent)' }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => {
                        setEditingField(null)
                        setEditError('')
                      }}
                      className="px-3 py-1.5 rounded-pill text-[12px] border"
                      style={{ borderColor: 'var(--rule)', color: 'var(--ink-2)' }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="eyebrow" style={{ color: 'var(--accent)' }}>
                      {label}
                    </p>
                    <p
                      className="text-[13.5px] truncate"
                      style={{ color: 'var(--ink)' }}
                    >
                      {value ? (
                        key === 'frequency' ? displayFrequency(value) : value
                      ) : (
                        <span className="italic" style={{ color: 'var(--ink-3)' }}>
                          not provided
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    onClick={() => startEdit(key)}
                    className="shrink-0 eyebrow underline"
                    style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <button
        onClick={onSubmit}
        disabled={isSubmitting}
        className="mt-4 w-full py-2.5 rounded-pill text-[13px] font-medium text-white transition-colors disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
        onMouseEnter={(e) => !isSubmitting && (e.currentTarget.style.background = 'var(--accent-2)')}
        onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
      >
        {isSubmitting ? 'Submitting…' : 'Submit application'}
      </button>
    </div>
  )
}
