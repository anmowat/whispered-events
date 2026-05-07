'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import LoginModal from '@/components/LoginModal'
import { Partner } from '@/lib/airtable'

const TYPE_STYLES: Record<string, string> = {
  Community: 'text-white bg-blue-600 border-blue-600',
  Vendor:    'text-white bg-purple-600 border-purple-600',
  Investor:  'text-white bg-emerald-600 border-emerald-600',
}

const FILTER_ACTIVE: Record<string, string> = {
  All:       'bg-gold-700 text-white border-gold-700',
  Community: 'bg-blue-700 text-white border-blue-700',
  Vendor:    'bg-purple-700 text-white border-purple-700',
  Investor:  'bg-emerald-700 text-white border-emerald-700',
}

const FILTER_INACTIVE: Record<string, string> = {
  All:       'bg-gold-500 text-white border-gold-500 hover:bg-gold-600',
  Community: 'bg-blue-500 text-white border-blue-500 hover:bg-blue-600',
  Vendor:    'bg-purple-500 text-white border-purple-500 hover:bg-purple-600',
  Investor:  'bg-emerald-500 text-white border-emerald-500 hover:bg-emerald-600',
}

const TYPES = ['All', 'Community', 'Vendor', 'Investor']

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('All')
  const [showLogin, setShowLogin] = useState(false)

  useEffect(() => {
    fetch('/api/partners')
      .then((r) => r.json())
      .then((d: { partners: Partner[] }) => setPartners(d.partners ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const filtered = (filter === 'All' ? partners : partners.filter((p) => p.type === filter))
    .slice().sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="min-h-screen bg-[#F5EFE6]">
      {showLogin && <LoginModal onClose={() => setShowLogin(false)} />}
      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 grid grid-cols-[1fr_auto_1fr] items-center gap-4">
          <Link href="/">
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
          </Link>
          <div className="flex gap-1 bg-white border border-[#E8DDD0] rounded-xl p-1 shadow-sm">
            <Link href="/?tab=view" className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-[#F5EFE6] transition-colors">Find Events</Link>
            <Link href="/?tab=contribute" className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-[#F5EFE6] transition-colors">Contribute Event</Link>
            <Link href="/partners" className="px-3 py-1.5 rounded-lg text-xs font-medium bg-gold-600 text-white transition-colors">Partner</Link>
          </div>
          <div className="flex justify-end">
            <button onClick={() => setShowLogin(true)} className="text-sm text-gray-500 hover:text-gray-800 transition-colors">Log in</button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="mb-8">
          <h1 className="font-serif text-2xl text-gray-900 mb-1">Our Partners</h1>
          <p className="text-sm text-gray-500">Communities, vendors and investors we work with to bring exclusive events to the right executives.</p>
        </div>

        {/* Type filter */}
        <div className="flex gap-2 mb-8 flex-wrap">
          {TYPES.map((t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-all border ${
                filter === t ? FILTER_ACTIVE[t] : FILTER_INACTIVE[t]
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Partner grid */}
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-12">Loading partners…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No partners found.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((partner) => (
              <div key={partner.id} className="bg-white rounded-2xl border border-[#E8DDD0] p-6 shadow-sm flex flex-col gap-4">
                <div className="h-10 flex items-center">
                  <img src={partner.logoUrl} alt={partner.name} className="h-full w-auto object-contain max-w-[140px]" />
                </div>
                <div className="flex-1 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    {partner.website ? (
                      <a
                        href={partner.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-gray-900 hover:text-gold-600 transition-colors underline underline-offset-2"
                      >
                        {partner.name}
                      </a>
                    ) : (
                      <p className="font-medium text-gray-900">{partner.name}</p>
                    )}
                    {partner.type && (
                      <span className={`flex-shrink-0 text-xs rounded-full px-2 py-0.5 border font-medium ${TYPE_STYLES[partner.type] || 'text-gold-700 bg-gold-50 border-gold-200'}`}>
                        {partner.type}
                      </span>
                    )}
                  </div>
                  {partner.description && (
                    <p className="text-sm text-gray-500 leading-relaxed pt-1">{partner.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
