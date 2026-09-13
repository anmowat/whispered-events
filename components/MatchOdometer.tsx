'use client'

import { useEffect, useRef, useState } from 'react'

// The hero match counter, as a mechanical odometer.
//
// `value` is the real all-time notified-match count from /api/match-stats. Each
// page load anchors the display at value - START_OFFSET and ticks upward from
// there at a random 3-5s cadence, forever: it passes the true count after about
// 80 seconds and keeps climbing. Re-anchoring on every load (and on every fresh
// value) is what keeps the number close to reality for anyone arriving at the
// page, since a long-lived tab will drift above it.
//
// Only the digits that actually change animate, so a +1 tick usually rolls just
// the ones column and a boundary crossing rolls several at once.

const START_OFFSET = 20
const MIN_GAP_MS = 3000
const MAX_GAP_MS = 5000
const ROLL_MS = 400

export default function MatchOdometer({ value }: { value: number }) {
  const [display, setDisplay] = useState(() => Math.max(value - START_OFFSET, 0))
  // The string we last rendered, so a tick can diff old glyphs against new.
  // A ref rather than state: it must update in the same commit as `display`
  // without scheduling a second render.
  const prevRef = useRef<string>(Math.max(value - START_OFFSET, 0).toLocaleString())

  useEffect(() => {
    const start = Math.max(value - START_OFFSET, 0)
    setDisplay(start)
    prevRef.current = start.toLocaleString()

    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => {
        setDisplay((n) => n + 1)
        schedule()
      }, MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS))
    }
    schedule()
    return () => clearTimeout(timer)
  }, [value])

  const text = display.toLocaleString()
  const prev = prevRef.current
  prevRef.current = text

  return (
    <span style={{ fontVariantNumeric: 'tabular-nums' }}>
      {text.split('').map((ch, i) => {
        // Compare from the right: leading digits keep their meaning when the
        // number gains a character, so a rollover doesn't animate every column.
        const from = prev[prev.length - text.length + i]
        if (from === undefined || from === ch) return <span key={i}>{ch}</span>
        return (
          <span
            key={i}
            className="odo-window"
            // Keying the stack on the pair restarts the CSS animation each time
            // this position changes.
            style={{ display: 'inline-block', height: '1em', overflow: 'hidden', verticalAlign: 'bottom' }}
          >
            <span key={`${from}-${ch}`} className="odo-stack" style={{ display: 'block' }}>
              <span style={{ display: 'block', height: '1em' }}>{from}</span>
              <span style={{ display: 'block', height: '1em' }}>{ch}</span>
            </span>
          </span>
        )
      })}
      <style>{`
        @keyframes odo-roll {
          from { transform: translateY(0); }
          to   { transform: translateY(-1em); }
        }
        .odo-stack {
          animation: odo-roll ${ROLL_MS}ms cubic-bezier(0.2, 0.8, 0.3, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .odo-stack { animation: none; transform: translateY(-1em); }
        }
      `}</style>
    </span>
  )
}
