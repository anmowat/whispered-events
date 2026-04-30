'use client'

import { useState, useEffect } from 'react'
import { UserProfile } from '@/lib/types'

type Step = 'welcome' | 'form' | 'submitted'

const SENIORITY_OPTIONS = [
  'C-Level (CEO, CRO, CMO, CFO, etc.)',
  'VP / SVP',
  'Director',
  'Manager',
  'Individual Contributor',
  'Founder / Owner',
]

const FUNCTION_OPTIONS = [
  'Sales',
  'Marketing',
  'Revenue Operations',
  'Customer Success',
  'Finance',
  'Product',
  'Engineering',
  'Operations',
  'Partnerships',
  'Other',
]

const COMPANY_SIZE_OPTIONS = [
  'Under $1M ARR',
  '$1M–$10M ARR',
  '$10M–$50M ARR',
  '$50M–$100M ARR',
  '$100M–$500M ARR',
  '$500M+ ARR',
]

const EMPTY_PROFILE: UserProfile = {
  name: '',
  linkedin: '',
  function: '',
  seniority: '',
  companySize: '',
  expertise: '',
  affiliation: '',
  email: '',
}

export default function ViewEventsTab({ eventCount }: { eventCount: number }) {
  const [step, setStep] = useState<Step>('welcome')
  const [profile, setProfile] = useState<UserProfile>(EMPTY_PROFILE)
  const [errors, setErrors] = useState<Partial<Record<keyof UserProfile, string>>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  function update(field: keyof UserProfile, value: string) {
    setProfile((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  function validate(): boolean {
    const newErrors: Partial<Record<keyof UserProfile, string>> = {}
    if (!profile.name.trim()) newErrors.name = 'Required'
    if (!profile.email.trim()) newErrors.email = 'Required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email))
      newErrors.email = 'Enter a valid email'
    if (!profile.function) newErrors.function = 'Required'
    if (!profile.seniority) newErrors.seniority = 'Required'
    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  async function handleSubmit() {
    if (!validate()) return
    setIsSubmitting(true)
    setSubmitError('')

    try {
      const res = await fetch('/api/submit-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile }),
      })

      if (!res.ok) throw new Error('Submission failed')

      setStep('submitted')
    } catch {
      setSubmitError('Something went wrong. Please try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (step === 'welcome') {
    return (
      <div className="max-w-xl mx-auto space-y-8 animate-fade-in">
        <div className="text-center space-y-4">
          <div className="inline-flex items-center gap-2 bg-gold-700/10 border border-gold-600/20 rounded-full px-4 py-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse-slow" />
            <span className="text-gold-400 text-xs tracking-widest uppercase">
              {eventCount > 0
                ? `${eventCount} upcoming event${eventCount === 1 ? '' : 's'}`
                : 'Curated events'}
            </span>
          </div>

          <h2 className="text-3xl font-serif text-white leading-tight">
            Exclusive events,<br />
            <span className="text-gold-400">curated for you.</span>
          </h2>

          <p className="text-gray-400 text-sm leading-relaxed max-w-md mx-auto">
            Whispered Events is a free, invite-only platform that connects executives
            with private and exclusive events that match their profile. We currently have{' '}
            <span className="text-gold-400 font-medium">
              {eventCount > 0 ? eventCount : 'a growing collection of'} upcoming events
            </span>{' '}
            in our database.
          </p>
        </div>

        <div className="bg-charcoal-800 rounded-2xl border border-white/10 p-6 space-y-4">
          <h3 className="text-sm font-medium text-gray-200">How it works</h3>
          <div className="space-y-3">
            {[
              { n: '1', text: 'Share your profile so we understand your role and interests.' },
              { n: '2', text: 'Our team reviews your application manually.' },
              { n: '3', text: "You'll receive an email if you're approved." },
              { n: '4', text: 'Get notified when new matching events are added.' },
            ].map((item) => (
              <div key={item.n} className="flex items-start gap-3">
                <span className="w-5 h-5 rounded-full bg-gold-700/20 border border-gold-600/30 text-gold-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">
                  {item.n}
                </span>
                <p className="text-sm text-gray-400">{item.text}</p>
              </div>
            ))}
          </div>
        </div>

        <button
          onClick={() => setStep('form')}
          className="w-full py-3 rounded-xl bg-gold-700 hover:bg-gold-600 text-white font-medium transition-colors"
        >
          Apply for access
        </button>

        <p className="text-center text-xs text-gray-600">
          Given the volume of requests, we may not be able to reply to everyone who applies.
        </p>
      </div>
    )
  }

  if (step === 'submitted') {
    return (
      <div className="max-w-xl mx-auto text-center space-y-6 animate-fade-in py-8">
        <div className="w-16 h-16 mx-auto rounded-full bg-gold-700/10 border border-gold-600/20 flex items-center justify-center">
          <svg className="w-7 h-7 text-gold-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>

        <div className="space-y-3">
          <h2 className="text-2xl font-serif text-white">Application received</h2>
          <p className="text-gray-400 text-sm leading-relaxed">
            Thank you, <span className="text-gray-200">{profile.name}</span>. Our team will review your
            profile and you'll receive an email at{' '}
            <span className="text-gold-400">{profile.email}</span> if you're approved.
          </p>
          <p className="text-gray-500 text-xs">
            Given the volume of applications, we aren't able to reply to everyone — but we review each one carefully.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-xl mx-auto animate-fade-in">
      <div className="mb-6 flex items-center gap-3">
        <button
          onClick={() => setStep('welcome')}
          className="text-gray-500 hover:text-gray-300 transition-colors"
          aria-label="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        <h2 className="text-sm font-medium text-gray-300">Your Profile</h2>
      </div>

      <div className="space-y-5">
        {/* Personal */}
        <Section title="About you">
          <Field label="Full name *" error={errors.name}>
            <input
              value={profile.name}
              onChange={(e) => update('name', e.target.value)}
              placeholder="Jane Smith"
              className={inputCls(!!errors.name)}
            />
          </Field>

          <Field label="LinkedIn profile URL">
            <input
              value={profile.linkedin}
              onChange={(e) => update('linkedin', e.target.value)}
              placeholder="https://linkedin.com/in/janesmith"
              className={inputCls(false)}
            />
          </Field>
        </Section>

        {/* Professional */}
        <Section title="Professional info">
          <Field label="Function / Role *" error={errors.function}>
            <select
              value={profile.function}
              onChange={(e) => update('function', e.target.value)}
              className={inputCls(!!errors.function)}
            >
              <option value="">Select your function...</option>
              {FUNCTION_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Field>

          <Field label="Seniority *" error={errors.seniority}>
            <select
              value={profile.seniority}
              onChange={(e) => update('seniority', e.target.value)}
              className={inputCls(!!errors.seniority)}
            >
              <option value="">Select your level...</option>
              {SENIORITY_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Field>

          <Field
            label="Company revenue"
            hint="Many events are hosted by vendors who target specific company sizes."
          >
            <select
              value={profile.companySize}
              onChange={(e) => update('companySize', e.target.value)}
              className={inputCls(false)}
            >
              <option value="">Select revenue range...</option>
              {COMPANY_SIZE_OPTIONS.map((o) => (
                <option key={o} value={o}>{o}</option>
              ))}
            </select>
          </Field>
        </Section>

        {/* Expertise */}
        <Section title="Expertise &amp; community">
          <Field
            label="Expertise &amp; industries"
            hint="What do you know well? What industries have you worked in?"
          >
            <textarea
              value={profile.expertise}
              onChange={(e) => update('expertise', e.target.value)}
              placeholder="e.g. SaaS, fintech, B2B sales, demand generation..."
              rows={2}
              className={`${inputCls(false)} resize-none`}
            />
          </Field>

          <Field
            label="Professional communities"
            hint="We have automatic approval for members of partner communities (e.g. GTM Council)."
          >
            <input
              value={profile.affiliation}
              onChange={(e) => update('affiliation', e.target.value)}
              placeholder="e.g. GTM Council, RevGenius, Pavilion..."
              className={inputCls(false)}
            />
          </Field>
        </Section>

        {/* Contact */}
        <Section title="Contact">
          <Field
            label="Email address *"
            error={errors.email}
            hint="We only use this to send you approved events that match your profile."
          >
            <input
              type="email"
              value={profile.email}
              onChange={(e) => update('email', e.target.value)}
              placeholder="jane@company.com"
              className={inputCls(!!errors.email)}
            />
          </Field>
        </Section>

        {submitError && (
          <p className="text-red-400 text-sm text-center">{submitError}</p>
        )}

        <button
          onClick={handleSubmit}
          disabled={isSubmitting}
          className="w-full py-3 rounded-xl bg-gold-700 hover:bg-gold-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
        >
          {isSubmitting ? 'Submitting...' : 'Submit application'}
        </button>

        <p className="text-center text-xs text-gray-600">
          Our team will review your profile. Given the volume of requests, we may not reply to everyone.
        </p>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-charcoal-800 rounded-2xl border border-white/10 p-5 space-y-4">
      <h3
        className="text-xs uppercase tracking-widest text-gold-500 font-medium"
        dangerouslySetInnerHTML={{ __html: title }}
      />
      {children}
    </div>
  )
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string
  error?: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-gray-400">{label}</label>
      {hint && <p className="text-xs text-gray-600">{hint}</p>}
      {children}
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  )
}

function inputCls(hasError: boolean) {
  return `w-full bg-charcoal-900 border ${
    hasError ? 'border-red-500/50' : 'border-white/10'
  } rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-gold-600/50 transition-colors`
}
