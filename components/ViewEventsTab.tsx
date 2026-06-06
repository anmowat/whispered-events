'use client'

import { useState } from 'react'
import { UserProfile } from '@/lib/types'
import {
  ChatBubble,
  ChatRow,
  Composer,
  StepIndicator,
  parseInline,
} from './chat/ChatShell'

type Step =
  | 'email'
  | 'location'
  | 'linkedin'
  | 'interest'
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

const SEARCHING_NOTE =
  "The job market is changing fast — AI is reshaping everything.\n\nFor senior leaders, many of the best roles aren't posted. They're whispered.\n\nFor free playbooks, career strategies, and access to unposted GTM roles + the network to get them, visit [whispered.com](https://www.whispered.com/)."

const QUESTIONS: Record<Step, string> = {
  email:
    "**What's your email address?** We use this only to send you events — nothing else.",
  location:
    "**What city are you based in?**\n\nWe'll send you events within 100 miles of your location (we limit people to one primary city but update your city anytime you travel to see matches for another location).",
  linkedin: "**What's your LinkedIn profile URL?**",
  interest:
    "**What types of events are you interested in?**\n\nWe'll pull your function and seniority from your LinkedIn, so focus here on anything additional that would help us tailor events to you — industry focus, specific topics, preferred formats, etc.\n\nYou can update these at any time on your profile (Login in top nav).",
  employment:
    "**What is your current work situation?**\n\nWe ask because some events focus on people in specific roles while others are open to anyone.",
  size:
    "**What is the approximate revenue of your current company?**\n\nMany events are run by vendors who want to focus on specific company sizes — this helps us make sure you're only seeing events you'd actually qualify for.",
  frequency:
    "Last question — **how often would you like to receive emails with matching events?**\n\nYou can change this anytime on your profile.",
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

function nextStep(current: Step, value: string): Step {
  const order: Step[] = [
    'email',
    'location',
    'linkedin',
    'interest',
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

// Map each step to a 1-based index used by the StepIndicator. We use the
// total step count assuming the size step is included (worst case 7
// distinct user-answered steps before confirm); skipping size early
// just means the progress jumps a slot — acceptable.
const STEP_INDEX: Record<Step, number> = {
  email: 1,
  location: 2,
  linkedin: 3,
  interest: 4,
  employment: 5,
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

    setStep(next === 'confirm' ? 'confirm' : next)
    setAssistantContent(final)
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
  const showComposer = step !== 'confirm' && step !== 'submitted'

  return (
    <div className="flex flex-col h-full max-w-[680px] mx-auto">
      {showStepIndicator && (
        <StepIndicator label="Sign up" current={STEP_INDEX[step]} total={TOTAL_STEPS} />
      )}

      <div className="flex-1 space-y-4 pb-4">
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

        {step === 'employment' && (
          <ChipRow options={EMPLOYMENT_OPTIONS} onPick={(opt) => handleSend(opt)} />
        )}

        {step === 'frequency' && (
          <ChipRow options={FREQUENCY_OPTIONS} onPick={(opt) => handleSend(opt)} />
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
          <div className="ml-10 mt-2 animate-slide-up">
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
          placeholder={
            step === 'employment' || step === 'frequency'
              ? 'Or pick an option above…'
              : 'Type your answer…'
          }
        />
      )}
    </div>
  )
}

// Inline chip row used for employment + frequency steps.
function ChipRow({
  options,
  onPick,
}: {
  options: string[]
  onPick: (opt: string) => void
}) {
  return (
    <div className="ml-10 flex flex-wrap gap-2 animate-slide-up">
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
          {o}
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
    { key: 'location', label: 'City' },
    { key: 'linkedin', label: 'LinkedIn' },
    { key: 'interest', label: 'Interests' },
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
    onUpdate(editingField, val)
    setEditingField(null)
    setEditError('')
  }

  return (
    <div className="ml-10 animate-slide-up">
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
                  {editingField === 'frequency' ? (
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
                      {FREQUENCY_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : (
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
                  )}
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
                      {value || (
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
