'use client'

import { useEffect, useState } from 'react'
import LoginModal from '@/components/LoginModal'
import { AdminTabs } from '@/components/AdminTabs'

interface AnchorEventRow {
  id: string
  slug: string
  title: string
  anchorName: string
  status: 'draft' | 'live'
  createdAt: string
}

export default function AdminAnchorEventsPage() {
  const [items, setItems] = useState<AnchorEventRow[] | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized'>('unknown')
  const [showLogin, setShowLogin] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newSlug, setNewSlug] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  async function fetchItems() {
    const res = await fetch('/api/admin/anchor-events', { cache: 'no-store' })
    if (res.status === 401) { setAuthState('unauthorized'); return }
    if (!res.ok) return
    const data = await res.json() as { items: AnchorEventRow[] }
    setAuthState('authorized')
    setItems(data.items)
  }

  useEffect(() => { fetchItems() }, [])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreateError(null)
    const res = await fetch('/api/admin/anchor-events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: newSlug, title: newTitle }),
    })
    const data = await res.json() as { item?: AnchorEventRow; error?: string }
    if (!res.ok) { setCreateError(data.error ?? 'Error'); return }
    setCreating(false)
    setNewSlug('')
    setNewTitle('')
    if (data.item) window.location.href = `/admin/anchor-events/${data.item.id}`
  }

  if (authState === 'unauthorized') {
    return (
      <>
        <LoginModal onClose={() => setShowLogin(false)} next="/admin/anchor-events" />
      </>
    )
  }

  const containerStyle: React.CSSProperties = {
    maxWidth: 900,
    margin: '0 auto',
    padding: '32px 24px',
    fontFamily: 'system-ui, sans-serif',
    color: '#2c2420',
  }

  return (
    <div style={containerStyle}>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a href="/admin" style={{ color: '#6E1F2B', fontSize: 13 }}>WHISPERED EVENTS</a>
          <span style={{ color: '#aaa' }}>→</span>
          <span style={{ fontSize: 13, color: '#888' }}>ANCHOR EVENTS</span>
        </div>
      </div>

      <AdminTabs active="anchor-events" />

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>Anchor Events</h1>
        <button
          onClick={() => setCreating(true)}
          style={{ background: '#6E1F2B', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}
        >
          + New
        </button>
      </div>

      {creating && (
        <form onSubmit={handleCreate} style={{ background: '#fdf8f4', border: '1px solid #E8DDD0', borderRadius: 10, padding: 20, marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>New Anchor Event</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
            <div>
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>SLUG (URL path)</label>
              <input
                value={newSlug}
                onChange={(e) => setNewSlug(e.target.value)}
                placeholder="dreamforce-26"
                required
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #d5cbc3', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: '#888', display: 'block', marginBottom: 4 }}>TITLE</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Dreamforce '26 Side Events"
                style={{ width: '100%', padding: '8px 10px', border: '1px solid #d5cbc3', borderRadius: 6, fontSize: 14, boxSizing: 'border-box' }}
              />
            </div>
          </div>
          {createError && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{createError}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="submit" style={{ background: '#6E1F2B', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, cursor: 'pointer' }}>Create</button>
            <button type="button" onClick={() => setCreating(false)} style={{ background: 'none', border: '1px solid #d5cbc3', borderRadius: 6, padding: '7px 14px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          </div>
        </form>
      )}

      {items === null ? (
        <div style={{ color: '#888', fontSize: 14 }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ color: '#888', fontSize: 14 }}>No anchor events yet. Create one above.</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #E8DDD0', textAlign: 'left' }}>
              <th style={{ padding: '8px 12px', color: '#888', fontWeight: 500 }}>Slug</th>
              <th style={{ padding: '8px 12px', color: '#888', fontWeight: 500 }}>Title</th>
              <th style={{ padding: '8px 12px', color: '#888', fontWeight: 500 }}>Status</th>
              <th style={{ padding: '8px 12px', color: '#888', fontWeight: 500 }}>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} style={{ borderBottom: '1px solid #F0EAE3' }}>
                <td style={{ padding: '10px 12px' }}>
                  <a href={`/admin/anchor-events/${item.id}`} style={{ color: '#6E1F2B', fontWeight: 500 }}>
                    {item.slug}
                  </a>
                  <a
                    href={`/${item.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ marginLeft: 8, color: '#aaa', fontSize: 11 }}
                  >
                    ↗
                  </a>
                </td>
                <td style={{ padding: '10px 12px', color: '#4a3f38' }}>{item.title || '—'}</td>
                <td style={{ padding: '10px 12px' }}>
                  <span style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    borderRadius: 99,
                    fontSize: 11,
                    fontWeight: 600,
                    background: item.status === 'live' ? '#d4edda' : '#f0e8d4',
                    color: item.status === 'live' ? '#1a6630' : '#7a5c1a',
                  }}>
                    {item.status}
                  </span>
                </td>
                <td style={{ padding: '10px 12px', color: '#888', fontSize: 12 }}>
                  {new Date(item.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
