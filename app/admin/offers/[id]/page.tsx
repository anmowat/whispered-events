'use client'

import { useEffect, useState } from 'react'
import LoginModal from '@/components/LoginModal'
import { AdminTabs } from '@/components/AdminTabs'

interface Offer {
  id: string
  name: string
  logoUrl: string
  bannerUrl: string
  ctaText: string
  url: string
  status: 'active' | 'inactive'
}

export default function AdminOfferDetailPage({ params }: { params: { id: string } }) {
  const [offer, setOffer] = useState<Offer | null>(null)
  const [authState, setAuthState] = useState<'unknown' | 'authorized' | 'unauthorized'>('unknown')
  const [showLogin, setShowLogin] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const [name, setName] = useState('')
  const [logoUrl, setLogoUrl] = useState('')
  const [bannerUrl, setBannerUrl] = useState('')
  const [ctaText, setCtaText] = useState('')
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState<'active' | 'inactive'>('active')

  async function fetchOffer() {
    const res = await fetch(`/api/admin/offers/${params.id}`, { cache: 'no-store' })
    if (res.status === 401) { setAuthState('unauthorized'); return }
    if (!res.ok) return
    const d = await res.json() as { item: Offer }
    setAuthState('authorized')
    setOffer(d.item)
    setName(d.item.name)
    setLogoUrl(d.item.logoUrl)
    setBannerUrl(d.item.bannerUrl)
    setCtaText(d.item.ctaText)
    setUrl(d.item.url)
    setStatus(d.item.status)
  }

  useEffect(() => { fetchOffer() }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setSaveError(null)
    const res = await fetch(`/api/admin/offers/${params.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, logoUrl, bannerUrl, ctaText, url, status }),
    })
    setSaving(false)
    if (!res.ok) {
      const d = await res.json() as { error?: string }
      setSaveError(d.error ?? 'Save failed')
      return
    }
    setSaved(true)
    window.setTimeout(() => setSaved(false), 2000)
  }

  if (authState === 'unauthorized') return <LoginModal onClose={() => setShowLogin(false)} next={`/admin/offers/${params.id}`} />

  const s: React.CSSProperties = { fontFamily: 'system-ui, sans-serif', maxWidth: 900, margin: '0 auto', padding: '32px 24px', color: '#2c2420' }
  const label: React.CSSProperties = { fontSize: 11, letterSpacing: '.07em', textTransform: 'uppercase', color: '#888', display: 'block', marginBottom: 4 }
  const inp: React.CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid #d5cbc3', borderRadius: 6, fontSize: 14, boxSizing: 'border-box', background: '#fff' }
  const card: React.CSSProperties = { background: '#fdf8f4', border: '1px solid #E8DDD0', borderRadius: 12, padding: 20, marginBottom: 20 }

  return (
    <div style={s}>
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
        <a href="/admin" style={{ color: '#6E1F2B', fontSize: 13 }}>WHISPERED EVENTS</a>
        <span style={{ color: '#aaa' }}>→</span>
        <a href="/admin/offers" style={{ color: '#6E1F2B', fontSize: 13 }}>OFFERS</a>
        <span style={{ color: '#aaa' }}>→</span>
        <span style={{ fontSize: 13, color: '#888' }}>{offer?.name ?? params.id}</span>
      </div>

      <AdminTabs active="offers" />

      {offer === null ? (
        <div style={{ color: '#888' }}>Loading…</div>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600 }}>{offer.name}</h1>
          </div>

          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#888', letterSpacing: '.06em', marginBottom: 16 }}>SETTINGS</div>
            <form onSubmit={handleSave}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 14 }}>
                <div>
                  <label style={label}>Name</label>
                  <input style={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp Promo" required />
                </div>
                <div>
                  <label style={label}>Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value as 'active' | 'inactive')}
                    style={{ ...inp, cursor: 'pointer' }}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label style={label}>CTA Button Text</label>
                  <input style={inp} value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder="Claim your discount →" />
                </div>
                <div>
                  <label style={label}>Destination URL</label>
                  <input style={inp} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
                </div>
                <div>
                  <label style={label}>Logo URL</label>
                  <input style={inp} value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} placeholder="https://..." />
                  {logoUrl && (
                    <img src={logoUrl} alt="Logo preview" style={{ height: 40, marginTop: 6, objectFit: 'contain' }} />
                  )}
                </div>
                <div>
                  <label style={label}>Banner URL</label>
                  <input style={inp} value={bannerUrl} onChange={(e) => setBannerUrl(e.target.value)} placeholder="https://..." />
                  {bannerUrl && (
                    <img src={bannerUrl} alt="Banner preview" style={{ width: '100%', marginTop: 6, objectFit: 'cover', borderRadius: 6 }} />
                  )}
                </div>
              </div>
              {saveError && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{saveError}</div>}
              <button
                type="submit"
                disabled={saving}
                style={{ background: saved ? '#1a6630' : '#6E1F2B', color: '#fff', border: 'none', borderRadius: 8, padding: '9px 20px', fontSize: 13, cursor: 'pointer' }}
              >
                {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  )
}
