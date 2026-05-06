'use client'

import { useState } from 'react'

type State = 'idle' | 'loading' | 'sent' | 'not_found' | 'inactive' | 'error'

export default function LoginModal({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<State>('idle')
  const [email, setEmail] = useState('')

  async function handleSubmit() {
    if (!email.trim()) return
    setState('loading')
    try {
      const res = await fetch('/api/auth/dev-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (res.ok) {
        window.location.href = '/dashboard'
        return
      }
      const data = await res.json() as { error: string }
      if (data.error === 'not_found') setState('not_found')
      else if (data.error === 'inactive') setState('inactive')
      else setState('error')
    } catch {
      setState('error')
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl border border-[#E8DDD0]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-serif text-gray-900 text-lg">Log in</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {state === 'idle' || state === 'loading' ? (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">Enter your email and we&apos;ll send you a login link.</p>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="you@company.com"
              autoFocus
              className="w-full bg-[#FDFAF6] border border-[#E8DDD0] rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-gold-400 transition-colors"
            />
            <button
              onClick={handleSubmit}
              disabled={state === 'loading' || !email.trim()}
              className="w-full py-3 rounded-xl bg-gold-600 hover:bg-gold-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              {state === 'loading' ? 'Sending…' : 'Send login link'}
            </button>
          </div>
        ) : state === 'sent' ? (
          <div className="space-y-3 text-center py-2">
            <p className="text-2xl">📬</p>
            <p className="text-sm font-medium text-gray-900">Check your email</p>
            <p className="text-sm text-gray-500">We sent a login link to <strong>{email}</strong>. It expires in 15 minutes.</p>
          </div>
        ) : state === 'not_found' ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-800">Hi — this email doesn&apos;t exist yet.</p>
            <p className="text-sm text-gray-500">Head over to the <strong>Find Events</strong> tab to share your profile and apply for access.</p>
            <button onClick={onClose} className="w-full py-3 rounded-xl bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors">Got it</button>
          </div>
        ) : state === 'inactive' ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-800">Your account isn&apos;t active yet.</p>
            <p className="text-sm text-gray-500">New profiles are reviewed manually — if you&apos;ve just applied, you&apos;ll hear from us soon. If your access has lapsed, contribute an event from the <strong>Partner</strong> tab to reactivate.</p>
            <button onClick={onClose} className="w-full py-3 rounded-xl bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors">Got it</button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-800">Something went wrong. Please try again.</p>
            <button onClick={() => setState('idle')} className="w-full py-3 rounded-xl bg-gold-600 hover:bg-gold-500 text-white text-sm font-medium transition-colors">Try again</button>
          </div>
        )}
      </div>
    </div>
  )
}
