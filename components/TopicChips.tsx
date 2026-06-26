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
// chip picker renders today.
//
// Unselected = faint outline + barely-there tint, so the chip reads as
// "available, not currently picked." Earlier this used a saturated tint
// which was too close in vibrance to the selected state — users
// couldn't tell what they'd clicked.
//
// Selected = full saturated fill + white text — unambiguous "picked"
// state. Same colours we shipped originally, just now with a much
// stronger contrast against the unselected resting state.
const PALETTE: Record<ChipGroup['color'], ColorTokens> = {
  sage: {
    bg: 'rgba(107, 142, 84, 0.12)',
    bgActive: '#6B8E54',
    border: 'rgba(155, 198, 138, 0.55)',
    borderActive: '#6B8E54',
    text: '#9BC68A',
    textActive: '#FFFFFF',
  },
  burgundy: {
    bg: 'rgba(138, 42, 56, 0.12)',
    bgActive: '#8A2A38',
    border: 'rgba(201, 129, 140, 0.55)',
    borderActive: '#8A2A38',
    text: '#E8B4BC',
    textActive: '#FFFFFF',
  },
  slate: {
    bg: 'rgba(74, 90, 117, 0.18)',
    bgActive: '#4A5A75',
    border: 'rgba(139, 154, 181, 0.55)',
    borderActive: '#4A5A75',
    text: '#C4D0E0',
    textActive: '#FFFFFF',
  },
  gold: {
    bg: 'rgba(155, 118, 38, 0.12)',
    bgActive: '#9B7626',
    border: 'rgba(191, 160, 85, 0.55)',
    borderActive: '#9B7626',
    text: '#E5CC91',
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

  // Set of all chip-defined topic names (lowercased) across every group.
  // Used to split `value` into "what the chips know about" vs "what the
  // user typed freely". As the taxonomy grows, previously-custom topics
  // get auto-absorbed into chips here — no data migration, the same
  // string in `value` just gets rendered as a filled chip instead of
  // sitting in the custom box.
  const knownLower = new Set<string>()
  for (const g of groups) {
    for (const t of g.topics) knownLower.add(t.toLowerCase())
  }

  // Free-form "Add your own topics" box. Local state so typing is
  // smooth (no jumpy re-render mid-stroke). Initialized from whatever's
  // in `value` that doesn't match a known chip; re-syncs if the taxonomy
  // changes after the /api/topics fetch resolves and absorbs more
  // tokens into chip territory.
  const [customDraft, setCustomDraft] = useState<string>('')
  useEffect(() => {
    if (readonly) return
    const customFromValue = parseTopics(value).filter((t) => !knownLower.has(t.toLowerCase()))
    setCustomDraft(customFromValue.join(', '))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groups])

  // Recompute value = (chip-matching tokens from current value) +
  // (custom tokens just typed). Case-insensitive dedupe so typing a
  // chip name in the custom box doesn't store the topic twice.
  function rebuildValue(nextCustom: string) {
    const chipPart = parseTopics(value).filter((t) => knownLower.has(t.toLowerCase()))
    const customPart = parseTopics(nextCustom)
    const seen = new Set<string>()
    const combined: string[] = []
    for (const t of [...chipPart, ...customPart]) {
      const k = t.toLowerCase()
      if (seen.has(k)) continue
      seen.add(k)
      combined.push(t)
    }
    onChange?.(combined.join(', '))
  }

  function handleCustomChange(next: string) {
    setCustomDraft(next)
    rebuildValue(next)
  }

  // Chip click toggles in value as before. If the chip is being
  // deselected and the same name also sits in the custom box, strip
  // it from the box too — otherwise the chip un-fills but the word
  // still appears in the textarea, which reads as "did nothing."
  function handleChipClick(topic: string) {
    const wasSelected = hasTopic(selected, topic)
    if (wasSelected) {
      const trimmedDraft = parseTopics(customDraft)
        .filter((t) => t.toLowerCase() !== topic.toLowerCase())
        .join(', ')
      if (trimmedDraft !== customDraft) setCustomDraft(trimmedDraft)
    }
    onChange?.(toggleTopic(value, topic))
  }

  // Neutral header colour for the custom section — distinct from the
  // four brand-toned chip groups so it reads as "free-form, not a
  // taxonomy category."
  const CUSTOM_HEADER_COLOR = 'rgba(255, 255, 255, 0.55)'
  const CUSTOM_INPUT_BG = 'rgba(255, 255, 255, 0.04)'
  const CUSTOM_INPUT_BORDER = 'rgba(255, 255, 255, 0.15)'
  const CUSTOM_INPUT_TEXT = 'rgba(255, 255, 255, 0.85)'

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
                  // FAQ surface — render every chip in the filled
                  // "selected" style so the row reads as solid category
                  // labels, not as unclicked buttons. The new faint
                  // outline used for unselected interactive chips would
                  // look clickable here, which we explicitly don't want.
                  return (
                    <span
                      key={topic}
                      className="px-2.5 py-1 rounded-pill border text-[12.5px]"
                      style={{
                        background: c.bgActive,
                        borderColor: c.borderActive,
                        color: c.textActive,
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
                    onClick={() => handleChipClick(topic)}
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

      {/* Free-form "Add your own topics" section — hidden in readonly
          mode (FAQ surface doesn't need an input). Whatever the user
          types is merged into the same comma-separated value the chips
          drive, deduped case-insensitively. */}
      {!readonly && (
        <div>
          <div
            className="mb-1.5"
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: CUSTOM_HEADER_COLOR,
            }}
          >
            Add your own topics
          </div>
          <textarea
            value={customDraft}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder="e.g. VerticalSaaS, ABM, Quantum Computing"
            rows={2}
            className="w-full rounded-input px-3 py-2 text-[14px] focus:outline-none transition-colors resize-none"
            style={{
              background: CUSTOM_INPUT_BG,
              border: `1px solid ${CUSTOM_INPUT_BORDER}`,
              color: CUSTOM_INPUT_TEXT,
            }}
          />
        </div>
      )}
    </div>
  )
}
