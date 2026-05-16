'use client'

import { useState, useEffect } from 'react'
import { FeaturedEvent } from '@/lib/airtable'

interface Props {
  events: FeaturedEvent[]
  /** Section label shown in the eyebrow. Defaults to 'Featured Events';
   *  the Partner landing card overrides this to 'Recent partner events'. */
  label?: string
}

// Featured-events block embedded inside each landing card. Auto-advances
// every 4s, pauses on hover. Numbered "1 / 4" indicator on the right,
// paging dots below.
export default function FeaturedEventsCarousel({
  events,
  label = 'Featured Events',
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
      <div className="flex items-center justify-between mb-2">
        <span className="eyebrow">{label}</span>
        <span className="eyebrow num" style={{ color: 'var(--ink-3)' }}>
          {idx + 1} / {events.length}
        </span>
      </div>

      <div
        className="min-h-[64px] transition-opacity duration-200"
        style={{ opacity: fade ? 1 : 0 }}
      >
        {event.link ? (
          <a
            href={event.link}
            target="_blank"
            rel="noopener noreferrer"
            className="font-serif block leading-tight"
            style={{ fontSize: 17, color: 'var(--ink)' }}
          >
            {event.name}
          </a>
        ) : (
          <p
            className="font-serif m-0 leading-tight"
            style={{ fontSize: 17, color: 'var(--ink)' }}
          >
            {event.name}
          </p>
        )}
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

      <div className="flex items-center justify-between mt-2">
        {events.length > 1 ? (
          <div className="flex gap-1.5">
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
        ) : (
          <div />
        )}
        {dateText && (
          <span className="eyebrow num" style={{ color: 'var(--accent)' }}>
            {dateText}
          </span>
        )}
      </div>
    </div>
  )
}
