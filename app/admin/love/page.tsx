'use client'

import { useEffect, useRef, useState } from 'react'
import LoginModal from '@/components/LoginModal'
import { AdminTabs } from '@/components/AdminTabs'

const MAX_IMAGE_BYTES = 4 * 1024 * 1024

interface LoveEntry {
  id: string
  author: string
  role: string
  image_url: string
  linkedin_url: string
  sort_order: number
}

export default function AdminLovePage() {
  const [entries, setEntries] = useState<LoveEntry[]>([])
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized' | 'error'>('unknown')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [showLogin, setShowLogin] = useState(false)

  // Add form
  const [adding, setAdding] = useState(false)
  const [newAuthor, setNewAuthor] = useState('')
  const [newRole, setNewRole] = useState('')
  const [newLinkedin, setNewLinkedin] = useState('')
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  // Per-row upload state
  const [uploadingId, setUploadingId] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<{ id: string; msg: string } | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [revalidating, setRevalidating] = useState(false)

  // File input refs keyed by entry id
  const fileInputRefs = useRef<Map<string, HTMLInputElement>>(new Map())

  async function fetchEntries() {
    try {
      const res = await fetch('/api/admin/love', { cache: 'no-store' })
      if (res.status === 401) { setAuthState('unauthorized'); return }
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setAuthState('error')
        setErrorMsg(data.error || `HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { entries: LoveEntry[] }
      setEntries(data.entries ?? [])
      setAuthState('authorized')
    } catch (e) {
      setAuthState('error')
      setErrorMsg(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => { fetchEntries() }, [])

  async function handleAdd() {
    const author = newAuthor.trim()
    if (!author) return
    setAddBusy(true)
    setAddError(null)
    try {
      const res = await fetch('/api/admin/love', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ author, role: newRole.trim(), linkedinUrl: newLinkedin.trim() }),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setAddError(data.error || `HTTP ${res.status}`)
        return
      }
      const data = (await res.json()) as { entry: LoveEntry }
      setEntries((prev) => [...prev, data.entry])
      setNewAuthor(''); setNewRole(''); setNewLinkedin('')
      setAdding(false)
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e))
    } finally {
      setAddBusy(false)
    }
  }

  async function handleFieldSave(id: string, field: 'author' | 'role' | 'linkedinUrl', value: string) {
    const entry = entries.find((e) => e.id === id)
    if (!entry) return
    const original =
      field === 'author' ? entry.author
      : field === 'role' ? entry.role
      : entry.linkedin_url
    if (value.trim() === original.trim()) return
    setSavingId(id)
    try {
      const res = await fetch(`/api/admin/love/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: value.trim() }),
      })
      if (!res.ok) return
      const data = (await res.json()) as { entry: LoveEntry }
      if (data.entry) setEntries((prev) => prev.map((e) => e.id === id ? data.entry : e))
    } catch {
      // ignore
    } finally {
      setSavingId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this love entry?')) return
    const res = await fetch(`/api/admin/love/${id}`, { method: 'DELETE' })
    if (res.ok) setEntries((prev) => prev.filter((e) => e.id !== id))
  }

  async function handleImageUpload(id: string, file: File) {
    if (file.size > MAX_IMAGE_BYTES) {
      setUploadError({ id, msg: `File too large (max ${MAX_IMAGE_BYTES / 1024 / 1024}MB)` })
      return
    }
    setUploadError(null)
    setUploadingId(id)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch(`/api/admin/love/${id}/image`, { method: 'POST', body: form })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string }
        setUploadError({ id, msg: data.error || `HTTP ${res.status}` })
        return
      }
      const data = (await res.json()) as { imageUrl: string }
      setEntries((prev) => prev.map((e) => e.id === id ? { ...e, image_url: data.imageUrl } : e))
    } catch (e) {
      setUploadError({ id, msg: e instanceof Error ? e.message : String(e) })
    } finally {
      setUploadingId(null)
      const input = fileInputRefs.current.get(id)
      if (input) input.value = ''
    }
  }

  function handleMove(index: number, dir: -1 | 1) {
    const neighbor = entries[index + dir]
    const me = entries[index]
    if (!me || !neighbor) return
    const next = [...entries]
    next[index] = neighbor
    next[index + dir] = me
    setEntries(next)
    fetch('/api/admin/love', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderedIds: next.map((e) => e.id) }),
    }).catch(console.error)
  }

  const input =
    'w-full bg-transparent border border-transparent rounded px-1.5 py-1 text-sm hover:border-[#E8DDD0] focus:border-[#6E1F2B] focus:outline-none transition-colors disabled:opacity-50'

  return (
    <div className="min-h-screen bg-[#F5EFE6]">
      {showLogin && <LoginModal onClose={() => { setShowLogin(false); fetchEntries() }} />}

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <AdminTabs active="love" />

        {authState === 'unknown' && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}

        {authState === 'unauthorized' && (
          <div className="bg-white border border-[#E8DDD0] rounded-2xl p-8 text-center shadow-sm">
            <h2 className="text-base font-semibold text-gray-800 mb-3">Not authorized</h2>
            <button
              onClick={() => setShowLogin(true)}
              className="px-4 py-2 rounded-xl text-white text-sm font-medium"
              style={{ background: '#6E1F2B' }}
            >
              Log in
            </button>
          </div>
        )}

        {authState === 'error' && (
          <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-sm">
            <p className="text-sm text-red-600">Error: {errorMsg}</p>
            <button onClick={fetchEntries} className="mt-2 text-xs underline text-red-500">Retry</button>
          </div>
        )}

        {authState === 'authorized' && (
          <>
            <div className="flex items-center justify-between mb-5">
              <h1 className="text-xl font-semibold text-gray-900">
                Love Page
                {entries.length > 0 && (
                  <span className="ml-2 text-sm font-normal text-gray-400">· {entries.length}</span>
                )}
              </h1>
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    setRevalidating(true)
                    try {
                      await fetch('/api/admin/love/revalidate', { method: 'POST' })
                    } catch { /* ignore */ }
                    setRevalidating(false)
                  }}
                  disabled={revalidating}
                  className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] disabled:opacity-50 transition-colors shadow-sm"
                >
                  {revalidating ? 'Refreshing…' : 'Refresh Love'}
                </button>
                {!adding && (
                  <button
                    onClick={() => setAdding(true)}
                    className="px-3 py-1.5 rounded-lg text-white text-xs font-medium transition-opacity hover:opacity-80"
                    style={{ background: '#6E1F2B' }}
                  >
                    + Add
                  </button>
                )}
              </div>
            </div>

            {/* Add form */}
            {adding && (
              <div className="bg-white border border-[#E8DDD0] rounded-2xl p-5 shadow-sm mb-6">
                <h3 className="text-[11px] uppercase tracking-widest text-gray-500 font-medium mb-3">New Entry</h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                  <input
                    type="text"
                    placeholder="Name *"
                    value={newAuthor}
                    onChange={(e) => setNewAuthor(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                    disabled={addBusy}
                    autoFocus
                    className="bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#6E1F2B] disabled:opacity-50 transition-colors"
                  />
                  <input
                    type="text"
                    placeholder="Role / Title"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                    disabled={addBusy}
                    className="bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#6E1F2B] disabled:opacity-50 transition-colors"
                  />
                  <input
                    type="url"
                    placeholder="LinkedIn URL"
                    value={newLinkedin}
                    onChange={(e) => setNewLinkedin(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
                    disabled={addBusy}
                    className="bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#6E1F2B] disabled:opacity-50 transition-colors"
                  />
                </div>
                {addError && <p className="text-xs text-red-600 mb-2">{addError}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={handleAdd}
                    disabled={addBusy || !newAuthor.trim()}
                    className="px-3 py-1.5 rounded-lg text-white text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-opacity hover:opacity-80"
                    style={{ background: '#6E1F2B' }}
                  >
                    {addBusy ? 'Saving…' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setAdding(false); setAddError(null)
                      setNewAuthor(''); setNewRole(''); setNewLinkedin('')
                    }}
                    disabled={addBusy}
                    className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] disabled:opacity-50 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Entry table */}
            <div className="bg-white border border-[#E8DDD0] rounded-2xl overflow-hidden shadow-sm">
              {entries.length === 0 ? (
                <p className="px-6 py-10 text-sm text-gray-400 text-center italic">
                  No entries yet. Click + Add to create one.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-[#FDFAF6] border-b border-[#E8DDD0]">
                    <tr>
                      <th className="w-12 px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium text-center">Order</th>
                      <th className="w-14 px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium text-left">Photo</th>
                      <th className="px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium text-left">Name</th>
                      <th className="px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium text-left">Role</th>
                      <th className="px-3 py-3 text-[11px] uppercase tracking-widest text-gray-500 font-medium text-left">LinkedIn URL</th>
                      <th className="w-8 px-3 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry, i) => {
                      const isFirst = i === 0
                      const isLast = i === entries.length - 1
                      const isUploading = uploadingId === entry.id
                      const imgErr = uploadError?.id === entry.id ? uploadError.msg : null

                      return (
                        <tr
                          key={entry.id}
                          className="border-b border-[#F0E8DC] last:border-b-0 hover:bg-[#FDFAF6] transition-colors"
                        >
                          {/* Order arrows */}
                          <td className="px-2 py-2 text-center">
                            <div className="flex flex-col items-center gap-0.5">
                              <button
                                onClick={() => handleMove(i, -1)}
                                disabled={isFirst}
                                title="Move up"
                                className="text-gray-400 hover:text-[#6E1F2B] disabled:opacity-20 disabled:cursor-not-allowed text-[11px] leading-none transition-colors"
                              >
                                ▲
                              </button>
                              <button
                                onClick={() => handleMove(i, 1)}
                                disabled={isLast}
                                title="Move down"
                                className="text-gray-400 hover:text-[#6E1F2B] disabled:opacity-20 disabled:cursor-not-allowed text-[11px] leading-none transition-colors"
                              >
                                ▼
                              </button>
                            </div>
                          </td>

                          {/* Photo */}
                          <td className="px-3 py-2">
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              ref={(el) => {
                                if (el) fileInputRefs.current.set(entry.id, el)
                                else fileInputRefs.current.delete(entry.id)
                              }}
                              onChange={(e) => {
                                const f = e.target.files?.[0]
                                if (f) handleImageUpload(entry.id, f)
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => fileInputRefs.current.get(entry.id)?.click()}
                              disabled={isUploading}
                              title={entry.image_url ? 'Click to replace image' : 'Click to upload image'}
                              className={`w-10 h-10 rounded-lg border border-[#E8DDD0] overflow-hidden flex items-center justify-center bg-[#FDFAF6] hover:border-[#6E1F2B] transition-colors ${isUploading ? 'opacity-50' : ''}`}
                            >
                              {entry.image_url ? (
                                <img
                                  src={entry.image_url}
                                  alt=""
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-gray-300 text-xl leading-none">+</span>
                              )}
                            </button>
                            {imgErr && (
                              <p className="text-[10px] text-red-500 mt-0.5 max-w-[80px]">{imgErr}</p>
                            )}
                          </td>

                          {/* Name */}
                          <td className="px-2 py-2 min-w-[140px]">
                            <input
                              type="text"
                              defaultValue={entry.author}
                              disabled={savingId === entry.id}
                              onBlur={(e) => handleFieldSave(entry.id, 'author', e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                              className={`${input} text-gray-800 font-medium`}
                            />
                          </td>

                          {/* Role */}
                          <td className="px-2 py-2 min-w-[160px]">
                            <input
                              type="text"
                              defaultValue={entry.role}
                              disabled={savingId === entry.id}
                              onBlur={(e) => handleFieldSave(entry.id, 'role', e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                              className={`${input} text-gray-600`}
                            />
                          </td>

                          {/* LinkedIn */}
                          <td className="px-2 py-2 min-w-[200px]">
                            <input
                              type="url"
                              defaultValue={entry.linkedin_url}
                              disabled={savingId === entry.id}
                              placeholder="https://linkedin.com/…"
                              onBlur={(e) => handleFieldSave(entry.id, 'linkedinUrl', e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
                              className={`${input} text-gray-400`}
                            />
                          </td>

                          {/* Delete */}
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => handleDelete(entry.id)}
                              title="Delete entry"
                              className="text-gray-300 hover:text-red-500 transition-colors text-lg leading-none"
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
