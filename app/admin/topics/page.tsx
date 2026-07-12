'use client'

import { useEffect, useState } from 'react'
import LoginModal from '@/components/LoginModal'
import { AdminTabs } from '@/components/AdminTabs'
import { TAXONOMY_GROUPS, TAXONOMY_LABELS, TaxonomyLabel } from '@/lib/topics'

interface Topic {
  id: string
  name: string
  taxonomy: string
  sortOrder: number
  createdAt: string
}

// Manage the chip-picker topic list. Topics are grouped by taxonomy
// (Industries / Functions / Themes / Communities) and rows can be
// reordered within their group. Taxonomy is set once at creation —
// each section has its own add-row, so picking a section IS picking
// the taxonomy.

export default function AdminTopicsPage() {
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [seeding, setSeeding] = useState(false)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  async function fetchTopics() {
    try {
      const res = await fetch('/api/admin/topics', { cache: 'no-store' })
      if (res.status === 401) {
        setAuthState('unauthorized')
        return
      }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setAuthState('error')
        setErrorMsg(data.error || `HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { topics: Topic[] }
      setTopics(data.topics)
      setAuthState('authorized')
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    fetchTopics()
  }, [])

  async function addTopic(name: string, taxonomy: TaxonomyLabel) {
    const trimmed = name.trim()
    if (!trimmed) return false
    setActionMsg(null)
    try {
      const res = await fetch('/api/admin/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, taxonomy }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setActionMsg(`Error: ${data.error || `HTTP ${res.status}`}`)
        return false
      }
      await fetchTopics()
      return true
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
      return false
    }
  }

  async function seedDefaults() {
    if (seeding) return
    setSeeding(true)
    setActionMsg(null)
    try {
      const res = await fetch('/api/admin/topics/seed', { method: 'POST' })
      const data = (await res.json().catch(() => ({}))) as { inserted?: number; error?: string }
      if (!res.ok) {
        setActionMsg(`Error: ${data.error || `HTTP ${res.status}`}`)
        return
      }
      setActionMsg(`Seeded ${data.inserted ?? 0} topics.`)
      await fetchTopics()
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSeeding(false)
    }
  }

  async function patchTopicName(id: string, name: string) {
    try {
      const res = await fetch(`/api/admin/topics/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setActionMsg(`Error: ${data.error || `HTTP ${res.status}`}`)
        await fetchTopics()
      }
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
      await fetchTopics()
    }
  }

  async function deleteTopic(id: string, name: string) {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/admin/topics/${id}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setActionMsg(`Error: ${data.error || `HTTP ${res.status}`}`)
        return
      }
      await fetchTopics()
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // Swap two topics in the full list by their full-list indices. The
  // PATCH still takes the entire orderedIds[] so positions across
  // taxonomies stay consistent.
  async function swapInFullList(idxA: number, idxB: number) {
    if (!topics) return
    if (idxA < 0 || idxB < 0 || idxA >= topics.length || idxB >= topics.length) return
    const next = [...topics]
    ;[next[idxA], next[idxB]] = [next[idxB], next[idxA]]
    setTopics(next)
    try {
      const res = await fetch('/api/admin/topics', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderedIds: next.map((t) => t.id) }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setActionMsg(`Error: ${data.error || `HTTP ${res.status}`}`)
        await fetchTopics()
      }
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
      await fetchTopics()
    }
  }

  return (
    <div className="min-h-screen bg-[#F5EFE6] flex flex-col">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchTopics() }} />}

      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/" className="flex items-center">
            <img src="/lockup-horizontal-gold.svg" alt="Whispered Events" className="h-10 w-auto" />
          </a>
          <div className="text-xs uppercase tracking-widest text-gray-500">Admin</div>
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-4 sm:px-6 py-8">
        <AdminTabs active="topics" />

        {authState === 'unknown' && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}

        {authState === 'unauthorized' && (
          <div className="bg-white border border-[#E8DDD0] rounded-2xl p-8 text-center shadow-sm">
            <h2 className="text-lg font-semibold text-gray-800 mb-2">Not authorized</h2>
            <p className="text-sm text-gray-500 mb-6">
              You need to be logged in as an admin email to view this page.
            </p>
            <button
              onClick={() => setShowLogin(true)}
              className="px-4 py-2 rounded-xl text-white text-sm font-medium transition-colors"
              style={{ background: '#6E1F2B' }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#8E2E3B')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#6E1F2B')}
            >
              Log in
            </button>
          </div>
        )}

        {authState === 'error' && (
          <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm">
            <p className="text-sm text-red-600">Error loading data: {errorMsg}</p>
            <button onClick={fetchTopics} className="mt-3 text-xs underline">Retry</button>
          </div>
        )}

        {authState === 'authorized' && topics && (
          <div className="max-w-3xl">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-gray-900">Topics</h1>
              <p className="text-xs text-gray-500 mt-1">
                Curated chip-picker tags shown on signup, grouped by
                taxonomy. {topics.length} {topics.length === 1 ? 'topic' : 'topics'} total.
                Taxonomy is set on creation — add a topic to a section to put it there.
              </p>
            </div>

            {actionMsg && (
              <div
                className="mb-4 text-xs"
                style={{ color: actionMsg.startsWith('Error') ? '#B91C1C' : '#374151' }}
              >
                {actionMsg}
              </div>
            )}

            {/* Empty state: seed CTA + per-section adds still appear below */}
            {topics.length === 0 && (
              <div className="bg-white border border-[#E8DDD0] rounded-2xl p-6 text-center shadow-sm mb-6">
                <p className="text-sm text-gray-600 mb-3">
                  No topics yet. Seed the curated 28-chip default list, or add your own per section below.
                </p>
                <button
                  onClick={seedDefaults}
                  disabled={seeding}
                  className="px-4 py-2 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-50"
                  style={{ background: '#6E1F2B' }}
                  onMouseEnter={(e) => !seeding && (e.currentTarget.style.background = '#8E2E3B')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#6E1F2B')}
                >
                  {seeding ? 'Seeding…' : 'Seed defaults'}
                </button>
              </div>
            )}

            <div className="space-y-6">
              {TAXONOMY_GROUPS.map((group) => {
                const rows = topics
                  .map((t, fullIdx) => ({ t, fullIdx }))
                  .filter(({ t }) => t.taxonomy === group.label)
                return (
                  <TaxonomySection
                    key={group.label}
                    label={group.label}
                    rows={rows}
                    onAdd={(name) => addTopic(name, group.label)}
                    onRename={patchTopicName}
                    onDelete={deleteTopic}
                    onMoveWithinGroup={(rowIdxInGroup, dir) => {
                      const me = rows[rowIdxInGroup]
                      const neighbor = rows[rowIdxInGroup + dir]
                      if (!me || !neighbor) return
                      swapInFullList(me.fullIdx, neighbor.fullIdx)
                    }}
                  />
                )
              })}

              {/* Surface topics with an unknown taxonomy so admin can spot them. */}
              {(() => {
                const orphans = topics
                  .map((t, fullIdx) => ({ t, fullIdx }))
                  .filter(({ t }) => !TAXONOMY_LABELS.includes(t.taxonomy as TaxonomyLabel))
                if (orphans.length === 0) return null
                return (
                  <div className="bg-white border border-amber-300 rounded-2xl shadow-sm p-4">
                    <h3 className="text-sm font-semibold text-amber-700 mb-2">
                      Unknown taxonomy ({orphans.length})
                    </h3>
                    <p className="text-xs text-gray-500 mb-3">
                      These rows have a taxonomy value that doesn&apos;t match
                      any of the four groups. Delete and re-add them in the
                      correct section.
                    </p>
                    <ul className="text-xs text-gray-700 space-y-1">
                      {orphans.map(({ t }) => (
                        <li key={t.id} className="flex items-center justify-between gap-2">
                          <span>
                            <span className="font-medium">{t.name}</span>
                            <span className="text-gray-400 ml-2">(taxonomy: {t.taxonomy})</span>
                          </span>
                          <button
                            onClick={() => deleteTopic(t.id, t.name)}
                            className="text-red-600 hover:underline"
                          >
                            Delete
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })()}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

function TaxonomySection({
  label,
  rows,
  onAdd,
  onRename,
  onDelete,
  onMoveWithinGroup,
}: {
  label: TaxonomyLabel
  rows: { t: Topic; fullIdx: number }[]
  onAdd: (name: string) => Promise<boolean>
  onRename: (id: string, name: string) => Promise<void>
  onDelete: (id: string, name: string) => Promise<void>
  onMoveWithinGroup: (rowIdxInGroup: number, dir: -1 | 1) => void
}) {
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)

  async function handleAdd() {
    if (adding || !newName.trim()) return
    setAdding(true)
    const ok = await onAdd(newName)
    if (ok) setNewName('')
    setAdding(false)
  }

  return (
    <section>
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-800 uppercase tracking-wider">
          {label}
        </h2>
        <span className="text-xs text-gray-400">
          {rows.length} {rows.length === 1 ? 'topic' : 'topics'}
        </span>
      </div>

      <div className="bg-white border border-[#E8DDD0] rounded-2xl shadow-sm overflow-hidden">
        {rows.length === 0 ? (
          <div className="px-4 py-3 text-xs text-gray-400 italic border-b border-[#F0E8DC]">
            No topics yet in {label}.
          </div>
        ) : (
          <ul>
            {rows.map(({ t }, idx) => (
              <TopicRow
                key={t.id}
                topic={t}
                isFirst={idx === 0}
                isLast={idx === rows.length - 1}
                onMoveUp={() => onMoveWithinGroup(idx, -1)}
                onMoveDown={() => onMoveWithinGroup(idx, 1)}
                onRename={(name) => onRename(t.id, name)}
                onDelete={() => onDelete(t.id, t.name)}
              />
            ))}
          </ul>
        )}

        {/* Per-section add row */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-[#FDFAF6] border-t border-[#F0E8DC]">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                handleAdd()
              }
            }}
            placeholder={`Add a topic to ${label}…`}
            className="flex-1 bg-white border border-[#E8DDD0] rounded-lg px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none transition-colors"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className="px-3 py-1.5 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ background: '#6E1F2B' }}
            onMouseEnter={(e) => !adding && newName.trim() && (e.currentTarget.style.background = '#8E2E3B')}
            onMouseLeave={(e) => (e.currentTarget.style.background = '#6E1F2B')}
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </div>
      </div>
    </section>
  )
}

function TopicRow({
  topic,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onRename,
  onDelete,
}: {
  topic: Topic
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(topic.name)

  useEffect(() => {
    setName(topic.name)
  }, [topic.name])

  function commitName() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === topic.name) {
      setName(topic.name)
      return
    }
    onRename(trimmed)
  }

  return (
    <li className="flex items-center gap-2 px-4 py-2.5 border-b border-[#F0E8DC] last:border-b-0 hover:bg-[#FDFAF6] transition-colors">
      <div className="flex flex-col gap-0.5">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          aria-label="Move up"
          className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed leading-none"
        >
          ▲
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          aria-label="Move down"
          className="text-xs text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed leading-none"
        >
          ▼
        </button>
      </div>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            ;(e.target as HTMLInputElement).blur()
          } else if (e.key === 'Escape') {
            setName(topic.name)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="flex-1 bg-transparent border border-transparent rounded px-2 py-1 text-sm text-gray-800 hover:border-[#E8DDD0] focus:border-[#6E1F2B] focus:outline-none transition-colors"
      />
      <button
        onClick={onDelete}
        aria-label={`Delete ${topic.name}`}
        className="text-xs text-gray-400 hover:text-red-600 px-2 py-1 transition-colors"
      >
        Delete
      </button>
    </li>
  )
}
