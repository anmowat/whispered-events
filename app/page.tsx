'use client'

import { useState, useEffect } from 'react'
import ShareEventTab from '@/components/ShareEventTab'
import ViewEventsTab from '@/components/ViewEventsTab'

type Tab = 'share' | 'view'

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>('view')
  const [eventCount, setEventCount] = useState(0)

  useEffect(() => {
    fetch('/api/events-count')
      .then((r) => r.json())
      .then((d: { count: number }) => setEventCount(d.count))
      .catch(() => {})
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#0a0a14]/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden="true">🤫</span>
            <span className="font-serif text-white tracking-wide text-sm">
              Whispered Events
            </span>
          </div>

          {/* Tab nav */}
          <nav className="flex gap-1 bg-charcoal-800 rounded-lg p-1">
            <TabButton
              active={activeTab === 'view'}
              onClick={() => setActiveTab('view')}
            >
              View Events
            </TabButton>
            <TabButton
              active={activeTab === 'share'}
              onClick={() => setActiveTab('share')}
            >
              Share Event
            </TabButton>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 max-w-3xl mx-auto w-full px-4 sm:px-6 py-8">
        {activeTab === 'view' ? (
          <ViewEventsTab eventCount={eventCount} />
        ) : (
          <ShareEventTab />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-4">
        <p className="text-center text-xs text-gray-700">
          Whispered Events &mdash; For executives only
        </p>
      </footer>
    </div>
  )
}

function TabButton({
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
      className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
        active
          ? 'bg-gold-700 text-white shadow-sm'
          : 'text-gray-400 hover:text-gray-200'
      }`}
    >
      {children}
    </button>
  )
}
