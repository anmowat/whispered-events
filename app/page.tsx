'use client'

import { useState, useEffect } from 'react'
import ShareEventTab from '@/components/ShareEventTab'
import ViewEventsTab from '@/components/ViewEventsTab'

type Tab = 'view' | 'contribute'
type Mode = 'landing' | 'active'

export default function Home() {
  const [tab, setTab] = useState<Tab>('view')
  const [mode, setMode] = useState<Mode>('landing')
  const [eventCount, setEventCount] = useState(0)

  useEffect(() => {
    fetch('/api/events-count')
      .then((r) => r.json())
      .then((d: { count: number }) => setEventCount(d.count))
      .catch(() => {})
  }, [])

  function handleCTA() {
    setMode('active')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleBack() {
    setMode('landing')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header — brand only */}
      <header className="border-b border-white/5 bg-[#0a0a14]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden="true">🤫</span>
            <span className="font-serif text-white tracking-wide text-sm">
              Whispered Events
            </span>
          </div>

          {mode === 'active' && (
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              Back
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 w-full">
        {mode === 'landing' ? (
          <Landing
            tab={tab}
            setTab={setTab}
            eventCount={eventCount}
            onCTA={handleCTA}
          />
        ) : (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            {tab === 'view' ? (
              <ViewEventsTab startAtForm />
            ) : (
              <ShareEventTab />
            )}
          </div>
        )}
      </main>

      <footer className="border-t border-white/5 py-4">
        <p className="text-center text-xs text-gray-700">
          Whispered Events &mdash; For executives only
        </p>
      </footer>
    </div>
  )
}

function Landing({
  tab,
  setTab,
  eventCount,
  onCTA,
}: {
  tab: Tab
  setTab: (t: Tab) => void
  eventCount: number
  onCTA: () => void
}) {
  return (
    <div className="flex flex-col items-center px-4 sm:px-6 pt-14 pb-20 animate-fade-in">
      {/* Hero text */}
      <div className="text-center max-w-xl space-y-3 mb-10">
        <p className="text-gray-300 text-base leading-relaxed">
          In-person events are one of the best places to build real relationships.
        </p>
        <p className="text-gray-500 text-sm leading-relaxed">
          Whispered Events is a free platform that allows executives to contribute and see exclusive events.
        </p>
      </div>

      {/* Centered tab switcher */}
      <div className="flex gap-0 bg-charcoal-800 border border-white/10 rounded-xl p-1 mb-8">
        <TabPill active={tab === 'view'} onClick={() => setTab('view')}>
          View Events
        </TabPill>
        <TabPill active={tab === 'contribute'} onClick={() => setTab('contribute')}>
          Contribute Event
        </TabPill>
      </div>

      {/* Info card — changes per tab */}
      <div className="w-full max-w-md animate-slide-up" key={tab}>
        {tab === 'view' ? (
          <ViewCard eventCount={eventCount} onCTA={onCTA} />
        ) : (
          <ContributeCard onCTA={onCTA} />
        )}
      </div>
    </div>
  )
}

function ViewCard({ eventCount, onCTA }: { eventCount: number; onCTA: () => void }) {
  return (
    <div className="bg-charcoal-800 rounded-2xl border border-white/10 p-7 space-y-6">
      {eventCount > 0 && (
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-gold-500 animate-pulse-slow" />
          <span className="text-gold-400 text-xs tracking-widest uppercase">
            {eventCount} upcoming event{eventCount === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <div className="space-y-3">
        <h3 className="text-xs uppercase tracking-widest text-gray-500 font-medium">How it works</h3>
        <ol className="space-y-3">
          {[
            'Share your professional profile with us.',
            'Our team reviews your application.',
            "You'll receive an email if you're approved.",
            'Get notified when new matching events are added.',
          ].map((text, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-gold-700/20 border border-gold-600/30 text-gold-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-medium">
                {i + 1}
              </span>
              <span className="text-sm text-gray-400">{text}</span>
            </li>
          ))}
        </ol>
      </div>

      <button
        onClick={onCTA}
        className="w-full py-3 rounded-xl bg-gold-700 hover:bg-gold-600 text-white font-medium transition-colors"
      >
        Apply for access
      </button>

      <p className="text-center text-xs text-gray-600">
        Given the volume of requests, we may not reply to everyone who applies.
      </p>
    </div>
  )
}

function ContributeCard({ onCTA }: { onCTA: () => void }) {
  return (
    <div className="bg-charcoal-800 rounded-2xl border border-white/10 p-7 space-y-6">
      <div className="space-y-3">
        <h3 className="text-xs uppercase tracking-widest text-gray-500 font-medium">How it works</h3>
        <ol className="space-y-3">
          {[
            'Share a link to the event or paste in the details.',
            'Our AI pulls out the key information automatically.',
            'Review, fill in anything missing, and confirm.',
            'The event is added to our database where executives with the appropriate profiles can view it.',
          ].map((text, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-gold-700/20 border border-gold-600/30 text-gold-400 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-medium">
                {i + 1}
              </span>
              <span className="text-sm text-gray-400">{text}</span>
            </li>
          ))}
        </ol>
      </div>

      <button
        onClick={onCTA}
        className="w-full py-3 rounded-xl bg-gold-700 hover:bg-gold-600 text-white font-medium transition-colors"
      >
        Start contributing
      </button>
    </div>
  )
}

function TabPill({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-gold-700 text-white shadow-sm'
          : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  )
}
