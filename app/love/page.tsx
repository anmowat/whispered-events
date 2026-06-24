'use client'

import { useEffect, useState } from 'react'
import Header from '@/components/Header'
import LoginModal from '@/components/LoginModal'

interface LovePost {
  id: string
  author: string
  role: string
  imageUrl: string
  linkedinUrl: string
}

const POSTS: LovePost[] = [
  {
    id: 'dan-ahmadi',
    author: 'Dan Ahmadi',
    role: 'Building Upside — the data layer for agentic GTM',
    imageUrl: '/love/dan-ahmadi.png',
    linkedinUrl:
      'https://www.linkedin.com/posts/dahmadi_whispered-events-activity-7473518191915335680-hg5Q',
  },
  {
    id: 'melissa-moody',
    author: 'Melissa Moody',
    role: 'GTM leader & investor',
    imageUrl: '/love/melissa-moody.png',
    linkedinUrl:
      'https://www.linkedin.com/posts/melissammoody_in-person-events-are-so-hot-right-now-activity-7472416088685801472-W4X3',
  },
]

export default function LovePage() {
  const [showLogin, setShowLogin] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    document.body.classList.add('theme-after-hours')
    return () => document.body.classList.remove('theme-after-hours')
  }, [])

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d: { user: unknown }) => setIsLoggedIn(!!d.user))
      .catch(() => {})
  }, [])

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
        activeTab={null}
        rightSlot={rightSlot}
        onLogoClick={() => (window.location.href = '/')}
      />

      <main className="max-w-[1040px] mx-auto px-6 sm:px-8 py-12 pb-24">
        <div className="eyebrow mb-2.5">From the community</div>
        <h1
          className="font-serif m-0 text-[36px] sm:text-[48px]"
          style={{ lineHeight: 1.05, color: 'var(--ink)', letterSpacing: '-0.01em' }}
        >
          What people are saying about{' '}
          <span className="italic">Whispered Events</span>.
        </h1>
        <p
          className="mt-3 max-w-[560px]"
          style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.6 }}
        >
          Real words from executives and partners.
        </p>

        <div className="mt-10 columns-1 sm:columns-2 gap-5">
          {POSTS.map((post) => (
            <PostCard key={post.id} post={post} />
          ))}
        </div>
      </main>
    </div>
  )
}

function PostCard({ post }: { post: LovePost }) {
  const [imgError, setImgError] = useState(false)

  return (
    <a
      href={post.linkedinUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-card border overflow-hidden mb-5 break-inside-avoid transition-opacity hover:opacity-90"
      style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
    >
      {!imgError ? (
        <img
          src={post.imageUrl}
          alt={`LinkedIn post by ${post.author}`}
          className="w-full block"
          onError={() => setImgError(true)}
        />
      ) : (
        <div
          className="flex items-center justify-center"
          style={{ height: 200, background: 'var(--paper2, var(--bg))' }}
        >
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Screenshot unavailable</span>
        </div>
      )}

      <div
        className="flex items-center justify-between gap-3 px-4 py-3 border-t"
        style={{ borderColor: 'var(--rule)' }}
      >
        <div>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.3 }}>
            {post.author}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 2, lineHeight: 1.4 }}>
            {post.role}
          </div>
        </div>
        <span
          className="eyebrow shrink-0"
          style={{ color: 'var(--ink-3)', fontSize: 10, letterSpacing: '0.12em' }}
        >
          LinkedIn ↗
        </span>
      </div>
    </a>
  )
}
