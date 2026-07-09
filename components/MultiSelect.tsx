'use client'

import { useEffect, useRef, useState } from 'react'

interface MultiSelectProps {
  options: string[]
  selected: string[]
  onChange: (next: string[]) => void
  /** Label shown when every option is selected (e.g. "All types"). */
  allLabel?: string
  /** Optional display labels keyed by option value. Falls back to the value itself. */
  labelMap?: Record<string, string>
}

// Multi-select with a button trigger + a click-outside popover. Used on
// the dashboard Type filter. Label rules:
//   all selected → allLabel
//   none         → "None"
//   one          → that option
//   N>1          → "N selected"
export default function MultiSelect({
  options,
  selected,
  onChange,
  allLabel = 'All',
  labelMap,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  const label = (o: string) => labelMap?.[o] ?? o
  const all = selected.length === options.length
  const display =
    all
      ? allLabel
      : selected.length === 0
        ? 'None'
        : selected.length === 1
          ? label(selected[0])
          : `${selected.length} selected`

  function toggle(opt: string) {
    if (selected.includes(opt)) onChange(selected.filter((x) => x !== opt))
    else onChange([...selected, opt])
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left rounded-input border text-[13px] py-2 pl-3 pr-8"
        style={{
          background: 'var(--paper)',
          borderColor: 'var(--rule)',
          color: 'var(--ink)',
        }}
      >
        {display}
      </button>
      <span
        className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-[11px]"
        style={{ color: 'var(--ink-3)' }}
      >
        ▾
      </span>
      {open && (
        <div
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 rounded-card border p-1.5"
          style={{
            background: 'var(--paper)',
            borderColor: 'var(--rule)',
            boxShadow: '0 12px 28px -10px rgba(0,0,0,0.18)',
          }}
        >
          <button
            onClick={() => onChange(all ? [] : options)}
            className="block w-full text-left px-2.5 py-1.5 rounded-input text-[12px] mb-1 border-b"
            style={{ color: 'var(--ink-2)', borderColor: 'var(--rule-soft)' }}
          >
            {all ? 'Clear all' : 'Select all'}
          </button>
          {options.map((o) => (
            <label
              key={o}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-input cursor-pointer text-[13px]"
              style={{ color: 'var(--ink)' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--paper-2)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={() => toggle(o)}
                style={{ accentColor: 'var(--accent)' }}
              />
              {label(o)}
            </label>
          ))}
        </div>
      )}
    </div>
  )
}
