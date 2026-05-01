'use client'

import { useState, useEffect } from 'react'
import ShareEventTab from '@/components/ShareEventTab'
import ViewEventsTab from '@/components/ViewEventsTab'
import { Partner } from '@/lib/airtable'

type Tab = 'view' | 'contribute' | 'partner'
type Mode = 'landing' | 'active'

export default function Home() {
  const [tab, setTab] = useState<Tab>('contribute')
  const [mode, setMode] = useState<Mode>('landing')
  const [eventCount, setEventCount] = useState(0)
  const [partners, setPartners] = useState<Partner[]>([])

  useEffect(() => {
    fetch('/api/events-count')
      .then((r) => r.json())
      .then((d: { count: number }) => setEventCount(d.count))
      .catch(() => {})

    fetch('/api/partners')
      .then((r) => r.json())
      .then((d: { partners: Partner[] }) => setPartners(d.partners ?? []))
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
    <div className="min-h-screen flex flex-col bg-[#F5EFE6]">
      {/* Header */}
      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden="true">🤫</span>
            <span className="font-serif text-gray-900 tracking-wide text-sm">Whispered Events</span>
          </div>
          {mode === 'active' && (
            <button
              onClick={handleBack}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
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
          <Landing tab={tab} setTab={setTab} eventCount={eventCount} partners={partners} onCTA={handleCTA} />
        ) : (
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
            {tab === 'view' ? <ViewEventsTab startAtForm /> : <ShareEventTab />}
          </div>
        )}
      </main>

      <footer className="border-t border-[#E8DDD0] py-4">
        <p className="text-center text-xs text-gray-400">Whispered Events &mdash; For executives only</p>
        <p className="text-center text-xs text-gray-300 mt-1">
          Released {new Date(process.env.NEXT_PUBLIC_BUILD_TIME!).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      </footer>
    </div>
  )
}

function Landing({
  tab, setTab, eventCount, partners, onCTA,
}: {
  tab: Tab
  setTab: (t: Tab) => void
  eventCount: number
  partners: Partner[]
  onCTA: () => void
}) {
  return (
    <div className="flex flex-col items-center px-4 sm:px-6 pt-4 pb-20 animate-fade-in">
      {/* Hero */}
      <div className="text-center max-w-xl space-y-3 mb-10">
        <p className="text-gray-900 text-lg leading-relaxed font-medium">
          In-person events are the best way to build real relationships.
        </p>
        <p className="text-gray-500 text-sm leading-relaxed">
          Whispered Events is a free platform that allows executives to contribute and see exclusive events.
        </p>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-1.5 bg-white border border-[#E8DDD0] rounded-xl p-1.5 mb-8 shadow-sm">
        <TabPill active={tab === 'view'} onClick={() => setTab('view')}>Find Events</TabPill>
        <TabPill active={tab === 'contribute'} onClick={() => setTab('contribute')}>Contribute Event</TabPill>
        <TabPill active={tab === 'partner'} onClick={() => setTab('partner')}>Partner</TabPill>
      </div>

      {/* Info card */}
      <div className="w-full max-w-md animate-slide-up" key={tab}>
        {tab === 'view' && <ViewCard onCTA={onCTA} />}
        {tab === 'contribute' && <ContributeCard onCTA={onCTA} />}
        {tab === 'partner' && <PartnerCard />}
      </div>

      {/* Partner logos carousel — only shown if partners loaded */}
      {partners.length > 0 && (
        <div className="w-full max-w-2xl mt-14">
          <p className="text-center text-xs uppercase tracking-widest text-gray-400 mb-6">
            We partner with the following communities and companies
          </p>
          <div className="relative overflow-hidden">
            <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-[#F5EFE6] to-transparent z-10 pointer-events-none" />
            <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-[#F5EFE6] to-transparent z-10 pointer-events-none" />
            <div className="flex gap-16 animate-marquee whitespace-nowrap">
              {[...partners, ...partners].map((p, i) => (
                <a
                  key={i}
                  href={p.website || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 flex items-center justify-center h-10 opacity-75 hover:opacity-100 transition-opacity"
                >
                  <img src={p.logoUrl} alt={p.name} className="h-full w-auto object-contain max-w-[140px]" />
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ViewCard({ onCTA }: { onCTA: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E8DDD0] p-7 space-y-6 shadow-sm">
      <div className="space-y-3">
        <h3 className="text-xs uppercase tracking-widest text-gray-400 font-medium">How it works</h3>
        <ol className="space-y-3">
          {[
            'Apply — members of partner communities are automatically approved.',
            'Share your profile so we can match you to the right events.',
            'Get notified when events matching your profile are added.',
          ].map((text, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-gold-50 border border-gold-200 text-gold-700 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-medium">{i + 1}</span>
              <span className="text-sm text-gray-600">{text}</span>
            </li>
          ))}
        </ol>
      </div>
      <button onClick={onCTA} className="w-full py-3 rounded-xl bg-gold-600 hover:bg-gold-500 text-white font-medium transition-colors">
        Apply for access
      </button>
      <p className="text-center text-xs text-gray-400">
        Given the volume of requests, we may not reply to everyone who applies.
      </p>
    </div>
  )
}

function ContributeCard({ onCTA }: { onCTA: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-[#E8DDD0] p-7 space-y-6 shadow-sm">
      <div className="space-y-3">
        <h3 className="text-xs uppercase tracking-widest text-gray-400 font-medium">How it works</h3>
        <ol className="space-y-3">
          {[
            'Share an event link or paste in details.',
            'Our AI extracts the information for you to confirm.',
            'Event shared just with executives whose profiles fit.',
          ].map((text, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="w-5 h-5 rounded-full bg-gold-50 border border-gold-200 text-gold-700 text-xs flex items-center justify-center flex-shrink-0 mt-0.5 font-medium">{i + 1}</span>
              <span className="text-sm text-gray-600">{text}</span>
            </li>
          ))}
        </ol>
      </div>
      <button onClick={onCTA} className="w-full py-3 rounded-xl bg-gold-600 hover:bg-gold-500 text-white font-medium transition-colors">
        Start contributing
      </button>
      <p className="text-center text-xs text-gray-400 leading-relaxed">
        You can share an event you are running or just one you are aware of.{' '}
        Partners get more control of how their events are shared.
      </p>
    </div>
  )
}

function PartnerCard() {
  return (
    <div className="bg-white rounded-2xl border border-[#E8DDD0] p-7 space-y-6 shadow-sm">
      <div className="space-y-4">
        <h3 className="text-xs uppercase tracking-widest text-gray-400 font-medium">Partner with us</h3>
        <p className="text-sm text-gray-700 leading-relaxed">
          We partner with <span className="text-gray-900 font-medium">Communities</span>,{' '}
          <span className="text-gray-900 font-medium">Vendors</span> and{' '}
          <span className="text-gray-900 font-medium">Investors</span> to bring exclusive events to the right executives.
        </p>
        <p className="text-sm text-gray-500 leading-relaxed">
          A chatbot to explore partnerships is coming soon. In the meantime, reach out directly.
        </p>
      </div>
      <a
        href="mailto:team@whispered.com"
        className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-gold-600 hover:bg-gold-500 text-white font-medium transition-colors"
      >
        Email team@whispered.com
      </a>
    </div>
  )
}

function TabPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
        active
          ? 'bg-gold-600 text-white shadow-sm'
          : 'bg-gold-50 text-gold-700 border border-gold-200 hover:bg-gold-100'
      }`}
    >
      {children}
    </button>
  )
}
