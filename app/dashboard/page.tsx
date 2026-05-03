'use client'

import { useState, useEffect } from 'react'
import { AirtableEvent } from '@/lib/airtable'

interface DashboardUser {
  email: string
  name: string
  interest: string
}

export default function DashboardPage() {
  const [user, setUser] = useState<DashboardUser | null>(null)
  const [events, setEvents] = useState<AirtableEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const meRes = await fetch('/api/auth/me')
      const meData = await meRes.json() as { user: DashboardUser | null }

      if (!meData.user) {
        setLoading(false)
        return
      }

      setUser(meData.user)

      const eventsRes = await fetch('/api/dashboard/events')
      if (eventsRes.ok) {
        const eventsData = await eventsRes.json() as { events: AirtableEvent[] }
        setEvents(eventsData.events)
      }

      setLoading(false)
    }
    load()
  }, [])

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/'
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F5EFE6] flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#F5EFE6] flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <p className="text-gray-800 font-medium">You&apos;re not logged in</p>
          <a href="/" className="text-sm text-gold-600 underline underline-offset-2">Go back to Whispered Events</a>
        </div>
      </div>
    )
  }

  const firstName = user.name && user.name !== 'DEFAULT' ? user.name.split(' ')[0] : null

  return (
    <div className="min-h-screen bg-[#F5EFE6]">
      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/">
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
          </a>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Log out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-10 space-y-10">
        <div>
          <h1 className="text-xl font-serif text-gray-900">
            {firstName ? `Welcome back, ${firstName}` : 'Your dashboard'}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{user.email}</p>
        </div>

        {user.interest && (
          <section className="space-y-2">
            <h2 className="text-xs uppercase tracking-widest text-gray-400 font-medium">Event preferences</h2>
            <p className="text-sm text-gray-700 bg-white border border-[#E8DDD0] rounded-xl px-4 py-3">{user.interest}</p>
          </section>
        )}

        <section className="space-y-4">
          <h2 className="text-xs uppercase tracking-widest text-gray-400 font-medium">Your matched events</h2>
          {events.length === 0 ? (
            <p className="text-sm text-gray-500">No matched events yet — we&apos;ll notify you as new ones are added.</p>
          ) : (
            <div className="space-y-3">
              {events.map((event) => (
                <EventCard key={event.id} event={event} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}

function EventCard({ event }: { event: AirtableEvent }) {
  const dateFormatted = event.date
    ? new Date(event.date).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : ''

  return (
    <div className="bg-white border border-[#E8DDD0] rounded-2xl px-5 py-4 shadow-sm space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium text-gray-900">{event.name}</p>
          <p className="text-xs text-gray-500">
            {event.type}{dateFormatted ? ` · ${dateFormatted}` : ''}{event.location ? ` · ${event.location}` : ''}
          </p>
        </div>
        {event.link && (
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-shrink-0 text-xs bg-gold-600 hover:bg-gold-500 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            View
          </a>
        )}
      </div>
      {event.description && (
        <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">{event.description}</p>
      )}
    </div>
  )
}
