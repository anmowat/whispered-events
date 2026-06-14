'use client'

import { useEffect, useState } from 'react'
import LoginModal from '@/components/LoginModal'
import { AdminTabs } from '@/components/AdminTabs'

interface Topic {
  id: string
  name: string
  sortOrder: number
  createdAt: string
}

export default function AdminTopicsPage() {
  const [topics, setTopics] = useState<Topic[] | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)
  const [newName, setNewName] = useState('')
  const [adding, setAdding] = useState(false)
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
        body: JSON.stringify({ name }),
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
    // Optimistic reorder so the UI doesn't lag behind the click.
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
        // Reload from server on failure to undo the optimistic swap.
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
          <div className="max-w-2xl">
            <div className="mb-6">
              <h1 className="text-2xl font-semibold text-gray-900">Topics</h1>
              <p className="text-xs text-gray-500 mt-1">
                Curated interest tags. {topics.length} {topics.length === 1 ? 'topic' : 'topics'}.
                Shown as chips in the signup flow — order is preserved.
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
                placeholder="e.g. RevOps, GTM, AI, Founders…"
                className="flex-1 bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none transition-colors shadow-sm"
              />
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
              <div className="mb-4 text-xs text-red-600">{actionMsg}</div>
            )}

            {/* Topic chip list */}
            {topics.length === 0 ? (
              <div className="bg-white border border-[#E8DDD0] rounded-2xl p-8 text-center shadow-sm">
                <p className="text-sm text-gray-500">No topics yet. Add your first above.</p>
              </div>
            ) : (
              <ul className="bg-white border border-[#E8DDD0] rounded-2xl shadow-sm overflow-hidden">
                {topics.map((t, idx) => (
                  <li
                    key={t.id}
                    className="flex items-center gap-3 px-4 py-3 border-b border-[#F0E8DC] last:border-b-0 hover:bg-[#FDFAF6] transition-colors"
                  >
                    <span className="text-xs text-gray-400 tabular-nums w-6">{idx + 1}.</span>
                    <span
                      className="inline-flex items-center rounded-full text-sm font-medium px-3 py-1 border"
                      style={{
                        background: '#FBF4E6',
                        borderColor: '#E8D9B4',
                        color: '#6E1F2B',
                      }}
                    >
                      {t.name}
                    </span>
                    <div className="flex-1" />
                    <button
                      onClick={() => moveTopic(idx, -1)}
                      disabled={idx === 0}
                      aria-label="Move up"
                      title="Move up"
                      className="w-7 h-7 rounded-md text-gray-500 hover:bg-[#F5EFE6] hover:text-gray-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => moveTopic(idx, 1)}
                      disabled={idx === topics.length - 1}
                      aria-label="Move down"
                      title="Move down"
                      className="w-7 h-7 rounded-md text-gray-500 hover:bg-[#F5EFE6] hover:text-gray-900 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() => deleteTopic(t.id, t.name)}
                      aria-label="Delete"
                      title="Delete"
                      className="w-7 h-7 rounded-md text-gray-400 hover:bg-red-50 hover:text-red-600 transition-colors"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
