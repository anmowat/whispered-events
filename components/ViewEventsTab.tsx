'use client'

import { useState, useRef, useEffect } from 'react'
import { UserProfile } from '@/lib/types'

type Step =
  | 'name'
  | 'linkedin'
  | 'function'
  | 'seniority'
  | 'companySize'
  | 'expertise'
  | 'affiliation'
  | 'email'
  | 'confirm'
  | 'submitted'

interface Message {
  role: 'assistant' | 'user'
  content: string
}

const STEPS: Step[] = [
  'name', 'linkedin', 'function', 'seniority',
  'companySize', 'expertise', 'affiliation', 'email', 'confirm',
]

const QUESTIONS: Record<Step, string> = {
  name: "Let's start with your full name.",
  linkedin: "What's your LinkedIn profile URL?",
  function: "What do you do professionally? For example: Sales, Marketing, RevOps, Customer Success, Finance...",
  seniority: "How would you describe your seniority level? For example: C-Level, VP, Director, Manager, Founder...",
  companySize: "What's the approximate revenue of your current company? Many events are run by vendors who focus on specific company sizes — so this helps us match you accurately.",
  expertise: "What expertise or industries do you know well? The more specific, the better.",
  affiliation: "Are you affiliated with any professional communities or organizations? (e.g. GTM Council, Pavilion, RevGenius) — we have automatic approval for some partner communities. Type 'none' if not applicable.",
  email: "Last one — what's your email address? We only use this to send you events that match your profile.",
  confirm: '',
  submitted: '',
}

const EMPTY_PROFILE: UserProfile = {
  name: '', linkedin: '', function: '', seniority: '',
  companySize: '', expertise: '', affiliation: '', email: '',
}

function profileField(step: Step): keyof UserProfile | null {
  const map: Partial<Record<Step, keyof UserProfile>> = {
    name: 'name', linkedin: 'linkedin', function: 'function',
    seniority: 'seniority', companySize: 'companySize',
    expertise: 'expertise', affiliation: 'affiliation', email: 'email',
  }
  return map[step] ?? null
}

function MessageContent({ content }: { content: string }) {
  return (
    <div className="space-y-1 whitespace-pre-line">
      {content.split('\n').map((line, i) => {
        const parts = line.split(/\*\*(.+?)\*\*/)
        return (
          <p key={i}>
            {parts.map((part, j) =>
              j % 2 === 1 ? <strong key={j} className="text-white font-semibold">{part}</strong> : part
            )}
          </p>
        )
      })}
    </div>
  )
}

export default function ViewEventsTab({
  eventCount = 0,
  startAtForm,
}: {
  eventCount?: number
  startAtForm?: boolean
}) {
  const [step, setStep] = useState<Step>('name')
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: `Welcome! I'll ask you a few quick questions to build your profile${
        eventCount > 0 ? ` — we have ${eventCount} upcoming events waiting` : ''
      }. ${QUESTIONS['name']}`,
    },
  ])
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
    const normalized = value.toLowerCase().trim() === 'skip' || value.toLowerCase().trim() === 'none'
      ? ''
      : value.trim()

    const updatedProfile = field
      ? { ...profile, [field]: normalized }
      : profile
    setProfile(updatedProfile)

    const currentIndex = STEPS.indexOf(currentStep)
    const nextStep = STEPS[currentIndex + 1] as Step

    if (nextStep === 'confirm') {
      setStep('confirm')
      addMessage('assistant', buildSummary(updatedProfile))
    } else {
      setStep(nextStep)
      addMessage('assistant', QUESTIONS[nextStep])
    }
  }

  function buildSummary(p: UserProfile): string {
    const lines = [
      `Here's your profile — does everything look right?`,
      '',
      `**Name:** ${p.name}`,
      p.linkedin ? `**LinkedIn:** ${p.linkedin}` : null,
      `**Function:** ${p.function}`,
      `**Seniority:** ${p.seniority}`,
      p.companySize ? `**Company size:** ${p.companySize}` : null,
      p.expertise ? `**Expertise:** ${p.expertise}` : null,
      p.affiliation ? `**Community:** ${p.affiliation}` : null,
      `**Email:** ${p.email}`,
    ].filter(Boolean)
    return lines.join('\n')
  }

  function handleSend() {
    const value = input.trim()
    if (!value) return
    setInput('')
    addMessage('user', value)

    if (step === 'linkedin') {
      if (!value.includes('linkedin.com')) {
        addMessage('assistant', "Please share your LinkedIn profile URL (e.g. https://linkedin.com/in/yourname).")
        return
      }
    }

    if (step === 'email') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        addMessage('assistant', "That doesn't look like a valid email. Please try again.")
        return
      }
    }

    advance(step, value)
  }

  async function handleConfirm(confirmed: boolean) {
    if (!confirmed) {
      addMessage('user', 'No, let me make changes')
      setStep('name')
      setProfile(EMPTY_PROFILE)
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: "No problem — let's start over. " + QUESTIONS['name'] },
      ])
      return
    }

    addMessage('user', 'Yes, submit my application')
    setIsSubmitting(true)

    try {
      const res = await fetch('/api/submit-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      })
      if (!res.ok) throw new Error('Failed')
      setStep('submitted')
      addMessage(
        'assistant',
        `You're all set, ${profile.name}! Our team will review your profile and email you at ${profile.email} if you're approved. Given the volume of applications, we aren't able to reply to everyone — but we review each one carefully.`
      )
    } catch {
      addMessage('assistant', 'Something went wrong submitting your application. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

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
              <MessageContent content={msg.content} />
            </div>
          </div>
        ))}

        {/* Confirm buttons */}
        {step === 'confirm' && !isSubmitting && (
          <div className="flex gap-2 ml-10 animate-slide-up">
            <button
              onClick={() => handleConfirm(true)}
              className="px-4 py-2 rounded-lg bg-gold-700 hover:bg-gold-600 text-white text-sm font-medium transition-colors"
            >
              Submit application
            </button>
            <button
              onClick={() => handleConfirm(false)}
              className="px-4 py-2 rounded-lg border border-white/10 text-gray-400 hover:text-gray-200 hover:border-white/20 text-sm transition-colors"
            >
              Make changes
            </button>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Text input */}
      {step !== 'confirm' && step !== 'submitted' && (
        <div className="pt-4 border-t border-white/5">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
              placeholder="Type your answer..."
              className="flex-1 bg-charcoal-800 border border-white/10 rounded-xl px-4 py-3 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gold-600/50 transition-colors"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-2 rounded-xl bg-gold-700 hover:bg-gold-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              Send
            </button>
          </div>
          <p className="text-xs text-gray-600 mt-2 text-center">Press Enter to send</p>
        </div>
      )}
    </div>
  )
}
