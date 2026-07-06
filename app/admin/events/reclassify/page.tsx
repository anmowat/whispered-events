'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AdminTabs } from '@/components/AdminTabs'
import LoginModal from '@/components/LoginModal'

interface Change {
  id: string
  name: string
  currentType: string
  proposedType: string
  date: string
  location: string
}

interface ReclassifyResult {
  changes: Change[]
  unchanged: { id: string; name: string; type: string }[]
  stats: { total: number; changed: number; byNewType: Record<string, number> }
}

const TYPE_COLORS: Record<string, string> = {
  Conference: '#7c6faa',
  Dinner: '#c9a86a',
  'Happy Hour': '#e07b54',
  Panel: '#5b8db8',
  Workshop: '#6aaa7c',
  Activity: '#b85b8d',
  Other: '#6b7280',
  Virtual: '#888',
}

function TypePill({ label }: { label: string }) {
  const color = TYPE_COLORS[label] ?? '#888'
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 10px',
      borderRadius: 99,
      background: color + '22',
      border: `1px solid ${color}66`,
      color,
      fontSize: 12,
      fontWeight: 600,
      whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  )
}

export default function ReclassifyPage() {
  const [authState, setAuthState] = useState<'loading' | 'admin' | 'out'>('loading')
  const [fetchState, setFetchState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [applyState, setApplyState] = useState<'idle' | 'applying' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<ReclassifyResult | null>(null)
  const [applyResult, setApplyResult] = useState<{ applied: number; errors: string[] } | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { user?: { role?: string } }) => {
        setAuthState(d.user?.role === 'admin' ? 'admin' : 'out')
      })
      .catch(() => setAuthState('out'))
  }, [])

  async function runPreview() {
    setFetchState('loading')
    setResult(null)
    setErrorMsg('')
    try {
      const r = await fetch('/api/admin/events/reclassify')
      const data = await r.json() as ReclassifyResult & { error?: string }
      if (!r.ok) { setErrorMsg(data.error ?? 'Unknown error'); setFetchState('error'); return }
      setResult(data)
      setSelected(new Set(data.changes.map((c) => c.id)))
      setFetchState('done')
    } catch (e) {
      setErrorMsg(String(e))
      setFetchState('error')
    }
  }

  async function applyChanges() {
    if (!result) return
    const toApply = result.changes.filter((c) => selected.has(c.id))
    if (!toApply.length) return
    setApplyState('applying')
    try {
      const r = await fetch('/api/admin/events/reclassify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: toApply.map((c) => ({ id: c.id, proposedType: c.proposedType })) }),
      })
      const data = await r.json() as { applied: number; errors: string[]; error?: string }
      if (!r.ok) { setErrorMsg(data.error ?? 'Apply failed'); setApplyState('error'); return }
      setApplyResult(data)
      setApplyState('done')
    } catch (e) {
      setErrorMsg(String(e))
      setApplyState('error')
    }
  }

  function toggleAll(checked: boolean) {
    if (!result) return
    setSelected(checked ? new Set(result.changes.map((c) => c.id)) : new Set())
  }

  if (authState === 'loading') return null
  if (authState === 'out') return <LoginModal next="/admin/events/reclassify" onClose={() => { window.location.href = '/admin' }} />

  const ink = '#ece6da'
  const muted = '#9c8b7e'
  const gold = '#c9a86a'
  const bg = '#1b1814'
  const card = '#251e19'

  const groupedByFrom: Record<string, Change[]> = {}
  for (const c of result?.changes ?? []) {
    if (!groupedByFrom[c.currentType]) groupedByFrom[c.currentType] = []
    groupedByFrom[c.currentType].push(c)
  }

  return (
    <div style={{ minHeight: '100vh', background: bg, color: ink, fontFamily: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif` }}>
      <AdminTabs active="events" />
      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 20px' }}>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
          <Link href="/admin/events" style={{ color: muted, textDecoration: 'none', fontSize: 13 }}>← Events</Link>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: ink }}>Re-classify Event Types</h1>
        </div>

        <div style={{ background: card, border: '1px solid rgba(201,168,106,0.15)', borderRadius: 12, padding: '20px 24px', marginBottom: 24 }}>
          <p style={{ margin: '0 0 16px', color: muted, fontSize: 14, lineHeight: 1.6 }}>
            This tool fetches all events and re-classifies each using the new 7-category rubric
            (Conference, Dinner, Happy Hour, Panel, Workshop, Activity, Other).
            Preview the proposed changes below, deselect any you want to skip, then confirm.
          </p>
          {fetchState === 'idle' && (
            <button
              onClick={runPreview}
              style={{ background: gold, color: '#1b1814', border: 'none', borderRadius: 8, padding: '10px 22px', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              Run preview
            </button>
          )}
          {fetchState === 'loading' && (
            <div style={{ color: muted, fontSize: 14 }}>
              Classifying events with Claude… this may take 30–60 seconds.
            </div>
          )}
          {fetchState === 'error' && (
            <div style={{ color: '#e07b54', fontSize: 14 }}>{errorMsg}</div>
          )}
        </div>

        {fetchState === 'done' && result && applyState !== 'done' && (
          <>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 20 }}>
              {[
                { label: 'Total events', value: result.stats.total },
                { label: 'Proposed changes', value: result.stats.changed },
                { label: 'No change', value: result.stats.total - result.stats.changed },
              ].map((s) => (
                <div key={s.label} style={{ background: card, border: '1px solid rgba(201,168,106,0.15)', borderRadius: 10, padding: '12px 18px', minWidth: 120 }}>
                  <div style={{ fontSize: 22, fontWeight: 700, color: gold }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: muted }}>{s.label}</div>
                </div>
              ))}
            </div>

            {result.changes.length === 0 ? (
              <div style={{ color: muted, fontSize: 15, padding: '20px 0' }}>
                No changes proposed — all events already match the new rubric.
              </div>
            ) : (
              <>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 13, color: muted }}>
                    <label style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={selected.size === result.changes.length}
                        onChange={(e) => toggleAll(e.target.checked)}
                        style={{ marginRight: 6 }}
                      />
                      Select all ({result.changes.length})
                    </label>
                  </div>
                  <button
                    onClick={applyChanges}
                    disabled={selected.size === 0 || applyState === 'applying'}
                    style={{
                      background: selected.size > 0 ? gold : 'rgba(201,168,106,0.3)',
                      color: '#1b1814', border: 'none', borderRadius: 8,
                      padding: '9px 20px', fontSize: 13, fontWeight: 600,
                      cursor: selected.size > 0 ? 'pointer' : 'default',
                    }}
                  >
                    {applyState === 'applying' ? 'Applying…' : `Apply ${selected.size} change${selected.size !== 1 ? 's' : ''}`}
                  </button>
                </div>

                {Object.entries(groupedByFrom).sort(([a], [b]) => a.localeCompare(b)).map(([from, changes]) => (
                  <div key={from} style={{ marginBottom: 24 }}>
                    <div style={{ fontSize: 12, color: muted, letterSpacing: '.06em', textTransform: 'uppercase', marginBottom: 8 }}>
                      Currently: <TypePill label={from || 'unset'} />
                    </div>
                    <div style={{ background: card, border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, overflow: 'hidden' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
                            <th style={{ width: 32, padding: '8px 12px', textAlign: 'left', color: muted, fontWeight: 500 }}></th>
                            <th style={{ padding: '8px 12px', textAlign: 'left', color: muted, fontWeight: 500 }}>Event</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left', color: muted, fontWeight: 500, width: 100 }}>Date</th>
                            <th style={{ padding: '8px 12px', textAlign: 'left', color: muted, fontWeight: 500, width: 140 }}>New type</th>
                          </tr>
                        </thead>
                        <tbody>
                          {changes.map((c, i) => (
                            <tr key={c.id} style={{ borderTop: i > 0 ? '1px solid rgba(255,255,255,0.05)' : undefined }}>
                              <td style={{ padding: '8px 12px' }}>
                                <input
                                  type="checkbox"
                                  checked={selected.has(c.id)}
                                  onChange={(e) => {
                                    const next = new Set(selected)
                                    if (e.target.checked) next.add(c.id); else next.delete(c.id)
                                    setSelected(next)
                                  }}
                                />
                              </td>
                              <td style={{ padding: '8px 12px', color: ink }}>
                                <Link href={`/admin/events/${c.id}`} style={{ color: ink, textDecoration: 'none' }}
                                  target="_blank" rel="noreferrer">
                                  {c.name}
                                </Link>
                                {c.location && <span style={{ color: muted, marginLeft: 6 }}>· {c.location}</span>}
                              </td>
                              <td style={{ padding: '8px 12px', color: muted }}>{c.date || '—'}</td>
                              <td style={{ padding: '8px 12px' }}><TypePill label={c.proposedType} /></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {applyState === 'error' && (
                  <div style={{ color: '#e07b54', fontSize: 13, marginTop: 8 }}>{errorMsg}</div>
                )}
              </>
            )}
          </>
        )}

        {applyState === 'done' && applyResult && (
          <div style={{ background: 'rgba(106,170,124,0.1)', border: '1px solid rgba(106,170,124,0.3)', borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#6aaa7c', marginBottom: 8 }}>
              Done — {applyResult.applied} event{applyResult.applied !== 1 ? 's' : ''} updated
            </div>
            {applyResult.errors.length > 0 && (
              <div style={{ color: '#e07b54', fontSize: 13, marginTop: 8 }}>
                {applyResult.errors.length} error{applyResult.errors.length !== 1 ? 's' : ''}:
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {applyResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
            <Link href="/admin/events" style={{ color: gold, fontSize: 13, textDecoration: 'none', display: 'inline-block', marginTop: 16 }}>
              ← Back to events
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
