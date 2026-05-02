'use client'

import { useState, useEffect } from 'react'
import { FeaturedEvent } from '@/lib/airtable'

export default function FeaturedEventsCarousel({ events }: { events: FeaturedEvent[] }) {
  const [index, setIndex] = useState(0)
  const [fade, setFade] = useState(true)

  useEffect(() => {
    if (events.length <= 1) return
    const interval = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setIndex((i) => (i + 1) % events.length)
        setFade(true)
      }, 200)
    }, 4000)
    return () => clearInterval(interval)
  }, [events.length])

  function goTo(i: number) {
    setFade(false)
    setTimeout(() => { setIndex(i); setFade(true) }, 200)
  }

  if (!events.length) return null

  const event = events[index]

  return (
    <div className="mt-4 border-t border-[#F0E8DC] pt-4 space-y-3">
      <p className="text-xs uppercase tracking-widest text-gray-400 font-medium">Featured Events</p>
      <div
        className="space-y-1 transition-opacity duration-200"
        style={{ opacity: fade ? 1 : 0 }}
      >
        {event.link ? (
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-gold-700 hover:text-gold-500 underline underline-offset-2 transition-colors line-clamp-1"
          >
            {event.name}
          </a>
        ) : (
          <p className="text-sm font-medium text-gold-700 line-clamp-1">{event.name}</p>
        )}
        {event.description && (
          <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{event.description}</p>
        )}
        {(event.location || event.date) && (
          <div className="flex justify-between items-center pt-1">
            <span className="text-xs text-gray-400">{event.location}</span>
            <span className="text-xs text-gray-400">
              {event.date ? new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
            </span>
          </div>
        )}
      </div>
      {events.length > 1 && (
        <div className="flex gap-1.5 items-center">
          {events.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              className={`h-1.5 rounded-full transition-all ${i === index ? 'w-4 bg-gold-500' : 'w-1.5 bg-gold-200'}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}
