'use client'

import { useEffect, useState } from 'react'

// The hero match counter, as a mechanical odometer: white wheels, dark digits.
//
// `value` is the real all-time notified-match count from /api/match-stats. Each
// page load anchors the display at value - START_OFFSET and ticks upward from
// there at a random 3-5s cadence, forever: it passes the true count after about
// 80 seconds and keeps climbing. Re-anchoring on every load (and on every fresh
// value) is what keeps the number close to reality for anyone arriving at the
// page, since a long-lived tab will drift above it.
//
// Only the digits that actually change spin, so a +1 tick usually turns the
// ones wheel alone and a boundary crossing turns several at once.

const START_OFFSET = 20
const MIN_GAP_MS = 3000
const MAX_GAP_MS = 5000
// Fast enough that a wheel is never caught resting between two digits. The
// whole point of the cadence is the pause BETWEEN turns, not during one.
const ROLL_MS = 320

// Wheel height, in ems of the counter's own font size. Every box in here is
// pinned to it - height, line-height and the slide distance alike - because the
// three must agree exactly or the wheel stops mid-digit. The surrounding
// paragraph sets line-height 1.65, which is what this overrides.
const H = '1.25em'

interface Reading {
  value: number
  /** The formatted number we were showing before this tick, to spin up from. */
  prevText: string
}

function Wheel({ from, to, spinKey }: { from: string | null; to: string; spinKey: number }) {
  const cell = {
    display: 'block',
    height: H,
    lineHeight: H,
    textAlign: 'center' as const,
  }
  return (
    <span
      style={{
        display: 'inline-block',
        height: H,
        lineHeight: H,
        overflow: 'hidden',
        verticalAlign: 'top',
        minWidth: '0.68em',
        background: '#fdfcfa',
        color: '#1b1814',
        borderRadius: 2,
        margin: '0 0.5px',
        boxShadow: 'inset 0 -2px 3px rgba(0,0,0,0.18), inset 0 2px 3px rgba(0,0,0,0.10)',
      }}
    >
      {/* A wheel that didn't change renders one static cell. Giving it a stack
          too would replay the keyframe and spin it from a digit to itself. */}
      {from === null ? (
        <span style={cell}>{to}</span>
      ) : (
        // Remounting restarts the animation - a changed key is the only
        // reliable way to replay a CSS keyframe.
        <span key={spinKey} className="odo-stack" style={{ display: 'block' }}>
          <span style={cell}>{from}</span>
          <span style={cell}>{to}</span>
        </span>
      )}
    </span>
  )
}

export default function MatchOdometer({ value }: { value: number }) {
  const anchor = Math.max(value - START_OFFSET, 0)
  // One piece of state, so the outgoing digits are always exactly the ones we
  // last painted. Deriving `prev` during render instead would mutate on every
  // pass React happens to make.
  const [reading, setReading] = useState<Reading>(() => ({
    value: anchor,
    prevText: anchor.toLocaleString(),
  }))

  useEffect(() => {
    const start = Math.max(value - START_OFFSET, 0)
    setReading({ value: start, prevText: start.toLocaleString() })

    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      timer = setTimeout(() => {
        setReading((r) => ({ value: r.value + 1, prevText: r.value.toLocaleString() }))
        schedule()
      }, MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS))
    }
    schedule()
    return () => clearTimeout(timer)
  }, [value])

  const text = reading.value.toLocaleString()
  const prev = reading.prevText

  return (
    <span style={{ display: 'inline-block', fontVariantNumeric: 'tabular-nums', lineHeight: H }}>
      {text.split('').map((ch, i) => {
        // Commas aren't wheels - a real odometer has none, and boxing them
        // would read as a digit.
        if (ch === ',') {
          return (
            <span key={i} style={{ display: 'inline-block', height: H, lineHeight: H, verticalAlign: 'top', margin: '0 0.5px' }}>
              ,
            </span>
          )
        }
        // Compare from the right, so gaining a digit doesn't spin every wheel.
        const from = prev[prev.length - text.length + i]
        const changed = from !== undefined && from !== ch
        return <Wheel key={i} from={changed ? from : null} to={ch} spinKey={reading.value} />
      })}
      <style>{`
        @keyframes odo-roll {
          from { transform: translateY(0); }
          to   { transform: translateY(-${H}); }
        }
        .odo-stack {
          /* forwards, and an ease that spends no time near either end: a wheel
             is either turning or settled, never loitering half-way. */
          animation: odo-roll ${ROLL_MS}ms cubic-bezier(0.45, 0.05, 0.2, 1) forwards;
        }
        @media (prefers-reduced-motion: reduce) {
          .odo-stack { animation: none; transform: translateY(-${H}); }
        }
      `}</style>
    </span>
  )
}
