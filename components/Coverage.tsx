'use client'

import { useState } from 'react'
import { Donut } from './Donut'

// "Where we run deepest" — donut chart with a Location/Function toggle.
// Numbers are mocked for v1; the design doc flags these as aggregations
// we'll build off Airtable in a later pass. Keep the shape (label/value)
// stable so swapping in a real API just replaces these arrays.
const LOCATIONS = [
  { label: 'New York', value: 38 },
  { label: 'San Francisco', value: 31 },
  { label: 'London', value: 18 },
  { label: 'Austin', value: 14 },
  { label: 'Los Angeles', value: 11 },
  { label: 'Other', value: 9 },
]

const FUNCTIONS = [
  { label: 'CROs', value: 34 },
  { label: 'CMOs', value: 22 },
  { label: 'Founders / CEOs', value: 16 },
  { label: 'Heads of Sales', value: 12 },
  { label: 'VP Marketing', value: 9 },
  { label: 'Other', value: 8 },
]

// Oxblood-family palette, light → dark in the same hue.
const COLORS = ['#6E1F2B', '#8E2E3B', '#AC4854', '#C5707A', '#DB9CA1', '#EAC4C7']

export default function Coverage() {
  const [mode, setMode] = useState<'location' | 'function'>('location')
  const data = mode === 'location' ? LOCATIONS : FUNCTIONS

  return (
    <div>
      <div className="flex items-center justify-between mb-3.5 min-h-[32px]">
        <span className="eyebrow">Where we run deepest</span>
        <div
          className="flex p-[3px] rounded-full border"
          style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
        >
          {([
            { id: 'location', label: 'Location' },
            { id: 'function', label: 'Function' },
          ] as const).map((t) => {
            const active = mode === t.id
            return (
              <button
                key={t.id}
                onClick={() => setMode(t.id)}
                className="px-3 py-1 rounded-full text-[11.5px] font-medium transition-colors"
                style={{
                  background: active ? 'var(--ink)' : 'transparent',
                  color: active ? 'var(--paper)' : 'var(--ink-2)',
                }}
              >
                {t.label}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid grid-cols-[160px_1fr] gap-5 items-center">
        <Donut data={data} colors={COLORS} size={160} />
        <ul className="m-0 p-0 list-none flex flex-col gap-[7px]">
          {data.map((d, i) => (
            <li key={d.label} className="flex items-center gap-2 text-[12.5px]">
              <span
                className="shrink-0 rounded-[2px]"
                style={{ width: 9, height: 9, background: COLORS[i] }}
              />
              <span className="flex-1 min-w-0" style={{ color: 'var(--ink)' }}>
                {d.label}
              </span>
              <span className="num text-[11.5px]" style={{ color: 'var(--ink-3)' }}>
                {d.value}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
