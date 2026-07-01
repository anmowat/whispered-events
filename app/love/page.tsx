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
    role: 'Building Upside (the data layer for agentic GTM)',
    imageUrl: '/love/dan-ahmadi.png',
    linkedinUrl:
      'https://www.linkedin.com/posts/dahmadi_whispered-events-activity-7473518191915335680-hg5Q',
  },
  {
    id: 'melissa-moody',
    author: 'Melissa Moody',
    role: 'Founder @ Wednesday Women',
    imageUrl: '/love/melissa-moody.png',
    linkedinUrl:
      'https://www.linkedin.com/posts/melissammoody_in-person-events-are-so-hot-right-now-activity-7472416088685801472-W4X3',
  },
  {
    id: 'kathleen-booth',
    author: 'Kathleen Booth',
    role: 'VP Marketing @ Sequel.io',
    imageUrl: '/love/kathleen-booth.png',
    linkedinUrl:
      'https://www.linkedin.com/posts/kathleenslatterybooth_marketing-executiveevents-kathleenhq-activity-7476239553054461952-7GDO',
  },
  {
    id: 'nick-zecket',
    author: 'Nick Zeckets',
    role: 'Founder @ Smoke Signals AI',
    imageUrl: '/love/nick zeckets.png',
    linkedinUrl:
      'https://www.linkedin.com/posts/nzeckets_whispered-events-activity-7476750915476054017-RV4a',
  },
  {
    id: 'chris-schwass',
    author: 'Chris Schwass',
    role: 'GTM Operations and Strategy',
    imageUrl: '/love/chris-schwass.png',
    linkedinUrl:
      'https://www.linkedin.com/posts/chrisschwass_i-want-to-attend-live-events-but-its-hard-share-7477568588988444673-Ymn0/',
  },
  {
    id: 'mollie-bodensteiner',
    author: 'Mollie Bodensteiner',
    role: 'RevOps Leader',
    imageUrl: '/love/mollie-bodensteiner.png',
    linkedinUrl:
      'https://www.linkedin.com/posts/molliebodensteiner_whispered-events-share-7477690356273168385-xFgS/',
  },
]

export default function LovePage() {
  const [showLogin, setShowLogin] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [posts, setPosts] = useState<LovePost[]>(POSTS)

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

  useEffect(() => {
    fetch('/api/love')
      .then((r) => r.json())
      .then((d: { entries?: LovePost[] }) => { if (d.entries?.length) setPosts(d.entries) })
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
        <h1
          className="font-serif m-0 text-[36px] sm:text-[48px]"
          style={{ lineHeight: 1.05, color: 'var(--ink)', letterSpacing: '-0.01em' }}
        >
          Some of our favorite <span className="italic">'whispers'</span>
        </h1>
        <p
          className="mt-3 max-w-[560px]"
          style={{ fontSize: 14.5, color: 'var(--ink-2)', lineHeight: 1.6 }}
        >
          Tag our{' '}
          <a
            href="https://www.linkedin.com/company/whispered-events/?viewAsMember=true"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            LinkedIn Company Page
          </a>
          {' '}and{' '}
          <a
            href="https://www.linkedin.com/in/amowat/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold"
            style={{ color: 'var(--accent)' }}
          >
            Founder
          </a>
          {' '}on a post to help connect even more people
        </p>

        {/* Mobile: single column in order */}
        <div className="mt-10 flex flex-col gap-5 sm:hidden">
          {posts.map((post) => <PostCard key={post.id} post={post} />)}
        </div>
        {/* Desktop: two natural-height columns, left gets 1,3,5… right gets 2,4,6… */}
        <div className="mt-10 hidden sm:flex gap-5">
          <div className="flex-1 flex flex-col gap-5">
            {posts.filter((_, i) => i % 2 === 0).map((post) => <PostCard key={post.id} post={post} />)}
          </div>
          <div className="flex-1 flex flex-col gap-5">
            {posts.filter((_, i) => i % 2 === 1).map((post) => <PostCard key={post.id} post={post} />)}
          </div>
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
      className="block rounded-card border overflow-hidden transition-opacity hover:opacity-90"
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
