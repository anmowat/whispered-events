'use client'

import { useEffect, useState } from 'react'
import LoginModal from '@/components/LoginModal'
import { AdminTabs } from '@/components/AdminTabs'
import { TAXONOMY_LABELS, TaxonomyLabel } from '@/lib/topics'

interface Topic {
  id: string
  name: string
  taxonomy: string
  sortOrder: number
  createdAt: string
}

// Manage the chip-picker topic list. Rows are inline-editable: rename
// in the text input, switch taxonomy via the dropdown. Add new at the
// top, reorder via up/down arrows (global ordering — sort_order is a
// single index across all topics, but chips are rendered grouped on
// the public side). "Seed defaults" appears only when the table is
// empty; one click writes the 28 in-code DEFAULT_TOPICS.

export default function AdminTopicsPage() {
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [newName, setNewName] = useState('')
  const [newTaxonomy, setNewTaxonomy] = useState<TaxonomyLabel>('Functions')
  const [adding, setAdding] = useState(false)
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

  async function addTopic() {
    const name = newName.trim()
    if (!name || adding) return
    setAdding(true)
    setActionMsg(null)
    try {
      const res = await fetch('/api/admin/topics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, taxonomy: newTaxonomy }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setActionMsg(`Error: ${data.error || `HTTP ${res.status}`}`)
        return
      }
      setNewName('')
      await fetchTopics()
    } catch (e) {
      setActionMsg(`Error: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setAdding(false)
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

  async function patchTopic(id: string, patch: { name?: string; taxonomy?: string }) {
    try {
      const res = await fetch(`/api/admin/topics/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setActionMsg(`Error: ${data.error || `HTTP ${res.status}`}`)
        await fetchTopics()
        return
      }
      // Optimistic UI already reflected the change; nothing else to do.
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

  async function moveTopic(idx: number, dir: -1 | 1) {
    if (!topics) return
    const target = idx + dir
    if (target < 0 || target >= topics.length) return
    const next = [...topics]
    const [moved] = next.splice(idx, 1)
    next.splice(target, 0, moved)
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
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
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
                Curated chip-picker tags shown on signup. {topics.length}{' '}
                {topics.length === 1 ? 'topic' : 'topics'}. Each topic
                belongs to a taxonomy (Industries / Functions / Themes /
                Communities); chip group colors are fixed by taxonomy.
              </p>
            </div>

            {/* Add row */}
            <div className="flex items-center gap-2 mb-5">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addTopic()
                  }
                }}
                placeholder="New topic name…"
                className="flex-1 bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none transition-colors shadow-sm"
              />
              <select
                value={newTaxonomy}
                onChange={(e) => setNewTaxonomy(e.target.value as TaxonomyLabel)}
                className="bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 shadow-sm focus:outline-none"
              >
                {TAXONOMY_LABELS.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                onClick={addTopic}
                disabled={adding || !newName.trim()}
                className="px-4 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ background: '#6E1F2B' }}
                onMouseEnter={(e) => !adding && newName.trim() && (e.currentTarget.style.background = '#8E2E3B')}
                onMouseLeave={(e) => (e.currentTarget.style.background = '#6E1F2B')}
              >
                {adding ? 'Adding…' : 'Add topic'}
              </button>
            </div>

            {actionMsg && (
              <div className="mb-4 text-xs" style={{ color: actionMsg.startsWith('Error') ? '#B91C1C' : '#374151' }}>
                {actionMsg}
              </div>
            )}

            {/* Empty state with seed button */}
            {topics.length === 0 ? (
              <div className="bg-white border border-[#E8DDD0] rounded-2xl p-8 text-center shadow-sm">
                <p className="text-sm text-gray-600 mb-4">
                  No topics yet. Seed the curated 28-chip default list, or add your own above.
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
            ) : (
              <ul className="bg-white border border-[#E8DDD0] rounded-2xl shadow-sm overflow-hidden">
                {topics.map((t, idx) => (
                  <TopicRow
                    key={t.id}
                    topic={t}
                    isFirst={idx === 0}
                    isLast={idx === topics.length - 1}
                    onMoveUp={() => moveTopic(idx, -1)}
                    onMoveDown={() => moveTopic(idx, 1)}
                    onPatch={(patch) => {
                      setTopics((prev) =>
                        prev ? prev.map((x) => (x.id === t.id ? { ...x, ...patch } : x)) : prev,
                      )
                      patchTopic(t.id, patch)
                    }}
                    onDelete={() => deleteTopic(t.id, t.name)}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  )
}

function TopicRow({
  topic,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onPatch,
  onDelete,
}: {
  topic: Topic
  isFirst: boolean
  isLast: boolean
  onMoveUp: () => void
  onMoveDown: () => void
  onPatch: (patch: { name?: string; taxonomy?: string }) => void
  onDelete: () => void
}) {
  const [name, setName] = useState(topic.name)

  // Keep the local input in sync if the parent rewrites topics from
  // the server (e.g. after an error).
  useEffect(() => {
    setName(topic.name)
  }, [topic.name])

  function commitName() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === topic.name) {
      setName(topic.name)
      return
    }
    onPatch({ name: trimmed })
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
      <select
        value={topic.taxonomy}
        onChange={(e) => onPatch({ taxonomy: e.target.value })}
        className="bg-white border border-[#E8DDD0] rounded-lg px-2 py-1 text-xs text-gray-700 shadow-sm focus:outline-none"
      >
        {TAXONOMY_LABELS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
        {!TAXONOMY_LABELS.includes(topic.taxonomy as TaxonomyLabel) && (
          // Surface any orphaned taxonomy value so admin can fix it.
          <option value={topic.taxonomy}>{topic.taxonomy} (unknown)</option>
        )}
      </select>
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
