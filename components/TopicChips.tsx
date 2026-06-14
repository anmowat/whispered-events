'use client'

import { TOPIC_TAXONOMY, TopicGroup, hasTopic, parseTopics, toggleTopic } from '@/lib/topics'

// Colored chip picker shown above any topics-input field. Clicking a
// chip toggles it into/out of `value` (comma-separated). Free text is
// still allowed in the underlying textarea — chips are an additive UX.
//
// Color palette resolves to soft tint background + brand-toned border
// for the resting state, and full-fill + white text when selected.

interface ColorTokens {
  border: string
  borderActive: string
  bg: string
  bgActive: string
  text: string
  textActive: string
}

const PALETTE: Record<TopicGroup['color'], ColorTokens> = {
  burgundy: {
    border: '#D9BFC2',
    borderActive: '#6E1F2B',
    bg: '#F8EFEF',
    bgActive: '#6E1F2B',
    text: '#6E1F2B',
    textActive: '#FFFFFF',
  },
  sage: {
    border: '#C5D0BC',
    borderActive: '#5E7A50',
    bg: '#EEF2EA',
    bgActive: '#5E7A50',
    text: '#3F5436',
    textActive: '#FFFFFF',
  },
  slate: {
    border: '#C7CCD3',
    borderActive: '#4A5568',
    bg: '#EEF0F3',
    bgActive: '#4A5568',
    text: '#3B4451',
    textActive: '#FFFFFF',
  },
  gold: {
    border: '#E0CCA0',
    borderActive: '#9B7626',
    bg: '#F6EFDD',
    bgActive: '#9B7626',
    text: '#7A5C1F',
    textActive: '#FFFFFF',
  },
}

export default function TopicChips({
  value,
  onChange,
}: {
  value: string
  onChange: (next: string) => void
}) {
  const selected = parseTopics(value)
  return (
    <div className="space-y-3">
      {TOPIC_TAXONOMY.map((group) => {
        const c = PALETTE[group.color]
        return (
          <div key={group.label}>
            <div
              className="mb-1.5"
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                color: c.text,
              }}
            >
              {group.label}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {group.topics.map((topic) => {
                const isSelected = hasTopic(selected, topic)
                return (
                  <button
                    key={topic}
                    type="button"
                    onClick={() => onChange(toggleTopic(value, topic))}
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
