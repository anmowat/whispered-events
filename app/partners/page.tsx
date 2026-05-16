'use client'

import { useState, useEffect } from 'react'
import Header from '@/components/Header'
import LoginModal from '@/components/LoginModal'
import { Partner } from '@/lib/airtable'

const TYPES = ['All', 'Community', 'Vendor', 'Investor'] as const

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<(typeof TYPES)[number]>('All')
  const [showLogin, setShowLogin] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    fetch('/api/partners')
      .then((r) => r.json())
      .then((d: { partners: Partner[] }) => setPartners(d.partners ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))

    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { user: unknown }) => setIsLoggedIn(!!d.user))
      .catch(() => {})
  }, [])

  const filtered = (filter === 'All' ? partners : partners.filter((p) => p.type === filter))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))

  const rightSlot = isLoggedIn ? (
    <a
      href="/dashboard"
      className="text-[13px] transition-colors"
      style={{ color: 'var(--ink-2)' }}
    >
      Dashboard
    </a>
  ) : (
    <button
      onClick={() => setShowLogin(true)}
      className="text-[13px] transition-colors"
      style={{ color: 'var(--ink-2)' }}
    >
      Log in
    </button>
  )

  return (
    <div className="min-h-screen">
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}

      <Header
        activeTab="partner"
        onTabChange={(t) => {
          // The Partner pill here links back home with the partner tab
          // active. Other tabs route into the corresponding landing card.
          if (t === 'partner') return
          window.location.href = `/?tab=${t}`
        }}
        rightSlot={rightSlot}
        onLogoClick={() => (window.location.href = '/')}
      />

      <main className="max-w-[1040px] mx-auto px-6 sm:px-8 py-12 pb-20">
        <div className="eyebrow mb-2.5">Our partners</div>
        <h1
          className="font-serif m-0 text-[36px] sm:text-[48px]"
          style={{ lineHeight: 1.05, color: 'var(--ink)', letterSpacing: '-0.01em' }}
        >
          The communities, vendors and
          <br />
          investors that whisper <span className="italic">with us</span>.
        </h1>
        <p
          className="mt-3 max-w-[560px]"
          style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.55 }}
        >
          We partner with the people running the best invitation-only gatherings for
          executives — and bring those events to the right people.
        </p>

        {/* Filter chips */}
        <div className="flex gap-2 mt-8 flex-wrap">
          {TYPES.map((t) => {
            const active = filter === t
            return (
              <button
                key={t}
                onClick={() => setFilter(t)}
                className="rounded-pill border text-[13px] px-4 py-2 transition-colors"
                style={{
                  background: active ? 'var(--ink)' : 'var(--paper)',
                  color: active ? 'var(--paper)' : 'var(--ink-2)',
                  borderColor: active ? 'var(--ink)' : 'var(--rule)',
                }}
              >
                {t}
              </button>
            )
          })}
        </div>

        {/* Partner grid */}
        {loading ? (
          <p
            className="text-center py-12 text-[13px]"
            style={{ color: 'var(--ink-3)' }}
          >
            Loading partners…
          </p>
        ) : filtered.length === 0 ? (
          <p
            className="text-center py-12 text-[13px]"
            style={{ color: 'var(--ink-3)' }}
          >
            No partners found.
          </p>
        ) : (
          <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((partner) => (
              <PartnerCard key={partner.id} partner={partner} />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function PartnerCard({ partner }: { partner: Partner }) {
  return (
    <article
      className="rounded-card border p-5 flex flex-col gap-2.5"
      style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
    >
      {partner.logoUrl && (
        <div className="h-10 flex items-center">
          <img
            src={partner.logoUrl}
            alt={partner.name}
            className="h-full w-auto object-contain max-w-[140px]"
          />
        </div>
      )}
      <div className="font-serif" style={{ fontSize: 20, color: 'var(--ink)', letterSpacing: '-0.01em', lineHeight: 1.15 }}>
        {partner.name}
      </div>
      <div className="flex items-center justify-between gap-2">
        {partner.type && (
          <span
            className="text-[11px] rounded-pill px-2.5 py-1 border"
            style={{
              background: 'var(--accent-soft)',
              color: 'var(--accent)',
              borderColor: 'var(--accent-soft)',
            }}
          >
            {partner.type}
          </span>
        )}
        {partner.website && (
          <a
            href={partner.website}
            target="_blank"
            rel="noopener noreferrer"
            className="eyebrow"
            style={{ color: 'var(--ink-2)' }}
          >
            Visit ↗
          </a>
        )}
      </div>
      {partner.description && (
        <p
          className="m-0 leading-relaxed"
          style={{ fontSize: 12.5, color: 'var(--ink-2)' }}
        >
          {partner.description}
        </p>
      )}
    </article>
  )
}
