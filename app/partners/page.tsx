'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Partner } from '@/lib/airtable'

const TYPES = ['All', 'Community', 'Vendor', 'Investor']

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([])
  const [filter, setFilter] = useState('All')

  useEffect(() => {
    fetch('/api/partners')
      .then((r) => r.json())
      .then((d: { partners: Partner[] }) => setPartners(d.partners ?? []))
      .catch(() => {})
  }, [])

  const filtered = filter === 'All' ? partners : partners.filter((p) => p.type === filter)

  return (
    <div className="min-h-screen bg-[#F5EFE6]">
      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-lg" aria-hidden="true">🤫</span>
            <span className="font-serif text-gray-900 tracking-wide text-sm hidden sm:inline">Whispered Events</span>
          </Link>
          <Link href="/" className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Back
          </Link>
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
                filter === t
                  ? 'bg-gold-600 text-white border-gold-600'
                  : 'bg-white text-gold-700 border-gold-200 hover:bg-gold-50'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Partner grid */}
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-12">No partners found.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((partner) => (
              <div key={partner.id} className="bg-white rounded-2xl border border-[#E8DDD0] p-6 shadow-sm flex flex-col gap-4">
                <div className="h-10 flex items-center">
                  <img src={partner.logoUrl} alt={partner.name} className="h-full w-auto object-contain max-w-[140px]" />
                </div>
                <div className="flex-1 space-y-1">
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
                    <span className="inline-block text-xs text-gold-700 bg-gold-50 border border-gold-200 rounded-full px-2 py-0.5">
                      {partner.type}
                    </span>
                  )}
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
