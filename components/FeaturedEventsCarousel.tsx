'use client'

import { useState, useEffect } from 'react'
import { FeaturedEvent } from '@/lib/airtable'

interface Props {
  events: FeaturedEvent[]
  /** Section label shown in the eyebrow. Defaults to the conferences
   *  pitch; the Partner landing card overrides this to 'Recent partner
   *  events'. */
  label?: string
}

// Featured-events block embedded inside each landing card. Auto-advances
// every 4s, pauses on hover. Paging dots below, date on the right.
export default function FeaturedEventsCarousel({
  events,
  label = 'Featured Conference(s)',
}: Props) {
  const [idx, setIdx] = useState(0)
  const [fade, setFade] = useState(true)
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    if (events.length <= 1 || paused) return
    const interval = setInterval(() => {
      setFade(false)
      setTimeout(() => {
        setIdx((i) => (i + 1) % events.length)
        setFade(true)
      }, 200)
    }, 4000)
    return () => clearInterval(interval)
  }, [events.length, paused])

  function goTo(i: number) {
    setFade(false)
    setTimeout(() => {
      setIdx(i)
      setFade(true)
    }, 200)
  }

  if (!events.length) return null

  const event = events[idx]
  const dateText = event.date
    ? new Date(event.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : ''

  return (
    <div
      className="mt-5 pt-4 border-t"
      style={{ borderColor: 'var(--rule-soft)' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="mb-2">
        <span className="eyebrow">{label}</span>
      </div>

      <div
        className="min-h-[64px] transition-opacity duration-200"
        style={{ opacity: fade ? 1 : 0 }}
      >
        <div className="flex items-baseline justify-between gap-3">
          {event.link ? (
            <a
              href={event.link}
              target="_blank"
              rel="noopener noreferrer"
              className="font-serif leading-tight hover:opacity-90 transition-opacity min-w-0 flex-1"
              style={{
                fontSize: 17,
                color: 'var(--accent)',
                textDecoration: 'underline',
                textUnderlineOffset: 3,
              }}
            >
              {event.name}
            </a>
          ) : (
            <p
              className="font-serif m-0 leading-tight min-w-0 flex-1"
              style={{ fontSize: 17, color: 'var(--ink)' }}
            >
              {event.name}
            </p>
          )}
          {dateText && (
            <span
              className="eyebrow num shrink-0"
              style={{ color: 'var(--accent)' }}
            >
              {dateText}
            </span>
          )}
        </div>
        {event.description && (
          <p
            className="mt-1 leading-relaxed line-clamp-2"
            style={{ fontSize: 12.5, color: 'var(--ink-2)' }}
          >
            {event.description}
          </p>
        )}
        {event.location && (
          <p className="mt-1" style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            {event.location}
          </p>
        )}
      </div>

      {events.length > 1 && (
        <div className="flex gap-1.5 mt-2">
          {events.map((_, i) => (
            <button
              key={i}
              onClick={() => goTo(i)}
              aria-label={`Show featured event ${i + 1}`}
              className="rounded-full transition-all"
              style={{
                width: i === idx ? 18 : 6,
                height: 6,
                background: i === idx ? 'var(--accent)' : 'var(--rule)',
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
