'use client'

import { useEffect, useState } from 'react'
import {
  DEFAULT_TOPICS,
  TAXONOMY_GROUPS,
  TaxonomyLabel,
  hasTopic,
  parseTopics,
  toggleTopic,
} from '@/lib/topics'

// Colored chip picker shown above any topics-input field. Clicking a
// chip toggles it into/out of `value` (comma-separated). Free text is
// still allowed in the underlying textarea — chips are an additive UX.
//
// Live chip data is fetched from /api/topics on mount; until the fetch
// resolves we render the in-code DEFAULT_TOPICS so the cloud appears
// immediately on cold loads (no flash of empty content).
//
// Color palette resolves to soft tint background + brand-toned border
// for the resting state, and full-fill + white text when selected.

interface ChipGroup {
  label: TaxonomyLabel
  color: 'burgundy' | 'sage' | 'slate' | 'gold'
  topics: string[]
}

interface ColorTokens {
  border: string
  borderActive: string
  bg: string
  bgActive: string
  text: string
  textActive: string
}

// Tuned for the dark "after-hours" theme — the only surface where the
// chip picker renders today. Unselected uses a saturated tinted fill
// that pops against #1b1814 with dark text inside. Selected darkens
// the fill and flips text to white for a clear pressed state.
const PALETTE: Record<ChipGroup['color'], ColorTokens> = {
  sage: {
    bg: '#C5E0B4',
    bgActive: '#6B8E54',
    border: '#9BC68A',
    borderActive: '#6B8E54',
    text: '#2F4A1F',
    textActive: '#FFFFFF',
  },
  burgundy: {
    bg: '#E8B4BC',
    bgActive: '#8A2A38',
    border: '#C9818C',
    borderActive: '#8A2A38',
    text: '#5A1822',
    textActive: '#FFFFFF',
  },
  slate: {
    bg: '#C4D0E0',
    bgActive: '#4A5A75',
    border: '#8B9AB5',
    borderActive: '#4A5A75',
    text: '#2E3849',
    textActive: '#FFFFFF',
  },
  gold: {
    bg: '#E5CC91',
    bgActive: '#9B7626',
    border: '#BFA055',
    borderActive: '#9B7626',
    text: '#5C4416',
    textActive: '#FFFFFF',
  },
}

function buildFallbackGroups(): ChipGroup[] {
  return TAXONOMY_GROUPS.map((g) => ({
    label: g.label,
    color: g.color,
    topics: DEFAULT_TOPICS.filter((t) => t.taxonomy === g.label).map((t) => t.name),
  }))
}

export default function TopicChips({
  value = '',
  onChange,
  readonly = false,
}: {
  // Editable mode: value is the comma-separated list of currently
  // selected topics; onChange fires on every toggle.
  // Readonly mode (set readonly=true): chips render as static spans
  // in their resting tinted state. Used on the FAQ to show the live
  // topic taxonomy without making it look clickable.
  value?: string
  onChange?: (next: string) => void
  readonly?: boolean
}) {
  const [groups, setGroups] = useState<ChipGroup[]>(() => buildFallbackGroups())

  useEffect(() => {
    let cancelled = false
    fetch('/api/topics', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { groups?: ChipGroup[] } | null) => {
        if (cancelled || !data?.groups) return
        // Only swap if the server actually returned a non-empty topic
        // set — otherwise we'd flash from defaults to an empty cloud.
        const hasAny = data.groups.some((g) => g.topics.length > 0)
        if (hasAny) setGroups(data.groups)
      })
      .catch(() => {
        // Network blip — leave defaults rendered.
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Skip the selected-set computation in readonly mode — every chip
  // renders in the resting state regardless of value.
  const selected: string[] = readonly ? [] : parseTopics(value)

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        if (group.topics.length === 0) return null
        const c = PALETTE[group.color]
        const meta = TAXONOMY_GROUPS.find((g) => g.label === group.label)
        const labelColor = meta?.accentDark ?? c.bg
        return (
          <div key={group.label}>
            <div
              className="mb-1.5"
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: labelColor,
              }}
            >
              {group.label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.topics.map((topic) => {
                if (readonly) {
                  return (
                    <span
                      key={topic}
                      className="px-2.5 py-1 rounded-pill border text-[12.5px]"
                      style={{
                        background: c.bg,
                        borderColor: c.border,
                        color: c.text,
                      }}
                    >
                      {topic}
                    </span>
                  )
                }
                const isSelected = hasTopic(selected, topic)
                return (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => onChange?.(toggleTopic(value, topic))}
                    className="px-2.5 py-1 rounded-pill border text-[12.5px] transition-colors"
                    style={{
                      background: isSelected ? c.bgActive : c.bg,
                      borderColor: isSelected ? c.borderActive : c.border,
                      color: isSelected ? c.textActive : c.text,
                    }}
                  >
                    {topic}
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
