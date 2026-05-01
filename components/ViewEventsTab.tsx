'use client'

import { useState, useRef, useEffect } from 'react'
import { UserProfile } from '@/lib/types'

type Step = 'name' | 'linkedin' | 'function' | 'seniority' | 'companySize' | 'expertise' | 'affiliation' | 'email' | 'confirm' | 'submitted'

interface Message {
  role: 'assistant' | 'user'
  content: string
}

const STEPS: Step[] = ['email', 'function', 'seniority', 'companySize', 'expertise', 'affiliation', 'linkedin', 'confirm']

const QUESTIONS: Record<Step, string> = {
  email: "**What's your email address?** We only use this to send you events that match your profile.",
  function: "**What do you do professionally?** For example: Sales, Marketing, RevOps, Customer Success, Finance...",
  seniority: "**How senior are you?** For example: C-Level, VP, Director, Manager, Founder...",
  companySize: "**What's the revenue of your current company?** Many events are run by vendors who want to focus on specific company sizes.",
  expertise: "**What expertise do you have? What industries do you know well?**",
  affiliation: "**Are you affiliated with any professional communities or organizations?** We have automatic approval for partner communities. Type 'none' if not applicable.",
  linkedin: "**What's your LinkedIn profile URL?**",
  name: '',
  confirm: '',
  submitted: '',
}

const EMPTY_PROFILE: UserProfile = { name: '', linkedin: '', function: '', seniority: '', companySize: '', expertise: '', affiliation: '', email: '' }

function profileField(step: Step): keyof UserProfile | null {
  const map: Partial<Record<Step, keyof UserProfile>> = {
    email: 'email', function: 'function', seniority: 'seniority',
    companySize: 'companySize', expertise: 'expertise', affiliation: 'affiliation', linkedin: 'linkedin',
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
              j % 2 === 1 ? <strong key={j} className="text-gold-700 font-semibold">{part}</strong> : part
            )}
          </p>
        )
      })}
    </div>
  )
}

export default function ViewEventsTab({ eventCount = 0, startAtForm }: { eventCount?: number; startAtForm?: boolean }) {
  const [step, setStep] = useState<Step>('email')
  const [messages, setMessages] = useState<Message[]>([{
    role: 'assistant',
    content: `Welcome! I'll ask you a few quick questions to build your profile${eventCount > 0 ? ` — we have ${eventCount} upcoming events waiting` : ''}. ${QUESTIONS['email']}`,
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
    const nextStep = STEPS[STEPS.indexOf(currentStep) + 1] as Step
    if (nextStep === 'confirm') {
      setStep('confirm')
      addMessage('assistant', buildSummary(updatedProfile))
    } else {
      setStep(nextStep)
      addMessage('assistant', QUESTIONS[nextStep])
    }
  }

  function buildSummary(p: UserProfile): string {
    return [
      `Here's your profile — does everything look right?`,
      '',
      `**Email:** ${p.email}`,
      `**Function:** ${p.function}`,
      `**Seniority:** ${p.seniority}`,
      p.companySize ? `**Company size:** ${p.companySize}` : null,
      p.expertise ? `**Expertise:** ${p.expertise}` : null,
      p.affiliation ? `**Community:** ${p.affiliation}` : null,
      `**LinkedIn:** ${p.linkedin}`,
    ].filter(Boolean).join('\n')
  }

  function handleSend() {
    const value = input.trim()
    if (!value) return
    setInput('')
    addMessage('user', value)
    if (step === 'linkedin' && !value.includes('linkedin.com')) {
      addMessage('assistant', "Please share your LinkedIn profile URL (e.g. https://linkedin.com/in/yourname).")
      return
    }
    if (step === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      addMessage('assistant', "That doesn't look like a valid email. Please try again.")
      return
    }
    advance(step, value)
  }

  async function handleConfirm(confirmed: boolean) {
    if (!confirmed) {
      addMessage('user', 'No, let me make changes')
      setStep('email')
      setProfile(EMPTY_PROFILE)
      setMessages((prev) => [...prev, { role: 'assistant', content: "No problem — let's start over. " + QUESTIONS['email'] }])
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
      const data = await res.json() as { status?: string; error?: string }
      if (!res.ok) throw new Error(data.error || 'Submission failed')
      setStep('submitted')
      addMessage('assistant', `You're all set! Our team will review your profile and email you at ${profile.email} if you're approved. Given the volume of applications, we aren't able to reply to everyone — but we review each one carefully.`)
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

        {step === 'confirm' && !isSubmitting && (
          <div className="flex gap-2 ml-10 animate-slide-up">
            <button onClick={() => handleConfirm(true)} className="px-4 py-2 rounded-lg bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors">
              Submit application
            </button>
            <button onClick={() => handleConfirm(false)} className="px-4 py-2 rounded-lg border border-[#E8DDD0] text-gray-500 hover:text-gray-700 hover:border-gray-300 text-sm transition-colors">
              Make changes
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
              placeholder="Type your answer..."
              className="flex-1 bg-white border border-[#E8DDD0] rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gold-400 transition-colors shadow-sm"
            />
            <button onClick={handleSend} disabled={!input.trim()} className="px-4 py-2 rounded-xl bg-gold-600 hover:bg-gold-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
              Send
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-2 text-center">Press Enter to send</p>
        </div>
      )}
    </div>
  )
}
