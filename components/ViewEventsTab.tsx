'use client'

import { useState, useRef, useEffect } from 'react'
import { UserProfile } from '@/lib/types'

type Step = 'email' | 'location' | 'interest' | 'employment' | 'size' | 'linkedin' | 'frequency' | 'confirm' | 'submitted'

interface Message {
  role: 'assistant' | 'user'
  content: string
}

const EMPLOYMENT_OPTIONS = ['Employed', 'Searching', 'Fractional', 'Other']

// Exact spellings/capitalizations match the Frequency single-select options in Airtable Users table.
const FREQUENCY_OPTIONS = [
  'Each New Event',
  'Weekly When New Events',
  'Monthly When New Events',
  'Dashboard Only',
]
const DEFAULT_FREQUENCY = 'Monthly When New Events'

const SEARCHING_NOTE =
  "The job market is changing fast — AI is reshaping everything.\n\nFor senior leaders, many of the best roles aren't posted. They're whispered.\n\nFor free playbooks, career strategies, and access to unposted GTM roles + the network to get them, visit [whispered.com](https://www.whispered.com/)."

const QUESTIONS: Record<Step, string> = {
  email: "**What's your email address?** We use this only to send you events — nothing else.",
  location: "**What city are you based in?**\n\nWe'll send you events within 100 miles of your location (we limit people to one primary city but update your city anytime you travel to see matches for another location).",
  interest: "**What types of events are you interested in?**\n\nWe'll pull your function and seniority from your LinkedIn, so focus here on anything additional that would help us tailor events to you — industry focus, specific topics, preferred formats, etc.\n\nYou can update these at any time on your profile (Login in top nav).",
  employment: "**What is your current work situation?**\n\nWe ask because some events focus on people in specific roles while others are open to anyone.",
  size: "**What is the approximate revenue of your current company?**\n\nMany events are run by vendors who want to focus on specific company sizes — this helps us make sure you're only seeing events you'd actually qualify for.",
  linkedin: "**What's your LinkedIn profile URL?**",
  frequency: "Last question — **how often would you like to receive emails with matching events?**\n\nYou can change this anytime on your profile.",
  confirm: '',
  submitted: '',
}

const EMPTY_PROFILE: UserProfile = { linkedin: '', interest: '', employment: '', companySize: '', email: '', location: '', frequency: DEFAULT_FREQUENCY }

function profileField(step: Step): keyof UserProfile | null {
  const map: Partial<Record<Step, keyof UserProfile>> = {
    email: 'email',
    location: 'location',
    interest: 'interest',
    employment: 'employment',
    size: 'companySize',
    linkedin: 'linkedin',
    frequency: 'frequency',
  }
  return map[step] ?? null
}

function nextStep(current: Step, value: string): Step {
  const order: Step[] = ['email', 'location', 'interest', 'employment', 'size', 'linkedin', 'frequency', 'confirm']
  if (current === 'employment' && value.toLowerCase() !== 'employed') {
    return 'linkedin'
  }
  const idx = order.indexOf(current)
  return idx >= 0 && idx < order.length - 1 ? order[idx + 1] : 'confirm'
}

function parseInline(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*.+?\*\*|\[.+?\]\(.+?\))/)
  return tokens.map((token, i) => {
    if (/^\*\*.+\*\*$/.test(token)) {
      return <strong key={i} className="text-gold-700 font-semibold">{token.slice(2, -2)}</strong>
    }
    const linkMatch = token.match(/^\[(.+?)\]\((.+?)\)$/)
    if (linkMatch) {
      return <a key={i} href={linkMatch[2]} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-gold-700 hover:text-gold-600">{linkMatch[1]}</a>
    }
    return token
  })
}

function MessageContent({ content }: { content: string }) {
  return (
    <div className="space-y-1 whitespace-pre-line">
      {content.split('\n').map((line, i) => (
        <p key={i}>{parseInline(line)}</p>
      ))}
    </div>
  )
}

function ProfileSummary({ profile, onUpdate, onSubmit, isSubmitting }: {
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
    { key: 'interest', label: 'Interests' },
    { key: 'employment', label: 'Employment' },
    ...(profile.employment.toLowerCase() === 'employed' ? [{ key: 'companySize' as keyof UserProfile, label: 'Company size' }] : []),
    { key: 'linkedin', label: 'LinkedIn' },
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
      <div className="bg-white border border-[#E8DDD0] rounded-2xl shadow-sm overflow-hidden">
        {fields.map(({ key, label }) => {
          const value = profile[key]
          const isEditing = editingField === key
          return (
            <div key={key} className="px-4 py-3 border-b border-[#F0E8DC] last:border-b-0">
              {isEditing ? (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-gold-700 uppercase tracking-wide">{label}</p>
                  {editingField === 'frequency' ? (
                    <select
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') { setEditingField(null); setEditError('') } }}
                      className="w-full bg-[#FDFAF6] border border-gold-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-gold-500 transition-colors"
                    >
                      {FREQUENCY_OPTIONS.map((opt) => (
                        <option key={opt} value={opt}>{opt}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') { setEditingField(null); setEditError('') } }}
                      className="w-full bg-[#FDFAF6] border border-gold-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-gold-500 transition-colors"
                    />
                  )}
                  {editError && <p className="text-xs text-red-500">{editError}</p>}
                  <div className="flex gap-2">
                    <button onClick={saveEdit} className="px-3 py-1.5 rounded-lg bg-gold-600 hover:bg-gold-500 text-white text-xs font-medium transition-colors">Save</button>
                    <button onClick={() => { setEditingField(null); setEditError('') }} className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] text-gray-500 hover:text-gray-700 text-xs transition-colors">Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gold-700 uppercase tracking-wide">{label}</p>
                    <p className="text-sm text-gray-700 truncate">{value || <span className="text-gray-400 italic">not provided</span>}</p>
                  </div>
                  <button onClick={() => startEdit(key)} className="text-xs text-gray-400 hover:text-gold-600 transition-colors flex-shrink-0 underline underline-offset-2">
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
        className="mt-4 w-full py-3 rounded-xl bg-gold-600 hover:bg-gold-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
      >
        {isSubmitting ? 'Submitting…' : 'Submit application'}
      </button>
    </div>
  )
}

export default function ViewEventsTab({ eventCount = 0, startAtForm, onReturnHome }: { eventCount?: number; startAtForm?: boolean; onReturnHome?: () => void }) {
  const [step, setStep] = useState<Step>('email')
  const [messages, setMessages] = useState<Message[]>([{
    role: 'assistant',
    content: `Welcome! Whispered Events is a free platform where executives discover and share exclusive, invitation-only events${eventCount > 0 ? ` — we have ${eventCount} upcoming events waiting` : ''}.\n\nI'll ask you a few questions to complete your profile. As long as your LinkedIn matches what you share, you're approved.\n\n${QUESTIONS['email']}`,
  }])
  const [input, setInput] = useState('')
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    inputRef.current?.focus()
  }, [messages, step])

  function addMessage(role: 'assistant' | 'user', content: string) {
    setMessages((prev) => [...prev, { role, content }])
  }

  function advance(currentStep: Step, value: string) {
    const field = profileField(currentStep)
    const normalized = ['skip', 'none'].includes(value.toLowerCase().trim()) ? '' : value.trim()
    const updatedProfile = field ? { ...profile, [field]: normalized } : profile
    setProfile(updatedProfile)
    if (currentStep === 'employment' && normalized.toLowerCase() === 'searching') {
      addMessage('assistant', SEARCHING_NOTE)
    }
    const next = nextStep(currentStep, normalized)
    if (next === 'confirm') {
      setStep('confirm')
      addMessage('assistant', "Here's your profile — review each field and edit anything before submitting.")
    } else {
      setStep(next)
      addMessage('assistant', QUESTIONS[next])
    }
  }

  async function handleSend(value?: string) {
    const val = (value ?? input).trim()
    if (!val) return
    setInput('')
    addMessage('user', val)
    if (step === 'linkedin' && !val.includes('linkedin.com')) {
      addMessage('assistant', "Please share your LinkedIn profile URL (e.g. https://linkedin.com/in/yourname).")
      return
    }
    if (step === 'frequency' && !FREQUENCY_OPTIONS.includes(val)) {
      addMessage('assistant', 'Please pick one of the options above.')
      return
    }
    if (step === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
        addMessage('assistant', "That doesn't look like a valid email. Please try again.")
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
          addMessage(
            'assistant',
            `Welcome! We've noticed you've already contributed ${n} ${n === 1 ? 'event' : 'events'}. We're excited to have you activate your profile.`,
          )
        }
      } catch {}
    }
    advance(step, val)
  }

  async function handleSubmit() {
    addMessage('user', 'Submit my application')
    setIsSubmitting(true)
    try {
      const res = await fetch('/api/submit-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      })
      const data = await res.json() as { status?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Submission failed')

      setStep('submitted')
      addMessage('assistant', `You're all set! As long as your LinkedIn checks out, you're approved — we'll send matching events to ${profile.email}.\n\nLove what we are doing? Tag [Whispered Events](https://www.linkedin.com/company/whispered-events/about/?viewAsMember=true) on a LinkedIn post to help us grow.`)
    } catch (err) {
      addMessage('assistant', `Something went wrong: ${err instanceof Error ? err.message : 'Please try again.'}`)
    } finally {
      setIsSubmitting(false)
    }
  }

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
              <MessageContent content={msg.content} />
            </div>
          </div>
        ))}

        {step === 'employment' && (
          <div className="ml-10 flex flex-wrap gap-2 animate-slide-up">
            {EMPLOYMENT_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => handleSend(opt)}
                className="px-4 py-2 rounded-xl border border-[#E8DDD0] bg-white text-sm text-gray-700 hover:bg-[#F5EFE6] hover:border-gold-400 transition-colors shadow-sm"
              >
                {opt}
              </button>
            ))}
          </div>
        )}

        {step === 'frequency' && (
          <div className="ml-10 flex flex-wrap gap-2 animate-slide-up">
            {FREQUENCY_OPTIONS.map((opt) => (
              <button
                key={opt}
                onClick={() => handleSend(opt)}
                className="px-4 py-2 rounded-xl border border-[#E8DDD0] bg-white text-sm text-gray-700 hover:bg-[#F5EFE6] hover:border-gold-400 transition-colors shadow-sm"
              >
                {opt}
              </button>
            ))}
          </div>
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
          <div className="ml-10 animate-slide-up">
            <button
              onClick={onReturnHome}
              className="w-full py-3 rounded-xl bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors"
            >
              Return Home
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {step !== 'confirm' && step !== 'submitted' && (
        <div className="pt-4 border-t border-[#E8DDD0]">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
              placeholder={step === 'employment' || step === 'frequency' ? 'Or pick an option above…' : 'Type your answer...'}
              className="flex-1 bg-white border border-[#E8DDD0] rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gold-400 transition-colors shadow-sm"
            />
            <button onClick={() => handleSend()} disabled={!input.trim()} className="px-4 py-2 rounded-xl bg-gold-600 hover:bg-gold-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
              Send
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">Press Enter to send</p>
        </div>
      )}
    </div>
  )
}
