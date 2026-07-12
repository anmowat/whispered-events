'use client'


export type HeaderTab = 'view' | 'contribute' | 'partner'

const TABS: { id: HeaderTab; label: string }[] = [
  { id: 'view', label: 'Find Events' },
  { id: 'contribute', label: 'Contribute Event' },
  { id: 'partner', label: 'Partner' },
]

interface HeaderProps {
  /** Currently active tab pill. Pass `null` to hide the tab row entirely
   *  (used by /dashboard and the magic-link flow). */
  activeTab?: HeaderTab | null
  onTabChange?: (tab: HeaderTab) => void
  /** Slot rendered on the right side. Usually "Log in" or "Log out".
   *  Pass nothing for surfaces (login modal, emails) that need only the
   *  wordmark + tabs. */
  rightSlot?: React.ReactNode
  /** Click handler on the wordmark itself — used as a "home" button
   *  on the main app surfaces. */
  onLogoClick?: () => void
}

// Sticky 64px header. Three-column grid: wordmark / tab pills / right slot.
// Background reaches edge-to-edge so the hairline divider underneath
// reads as part of the page chrome rather than a card boundary.
export default function Header({
  activeTab = null,
  onTabChange,
  rightSlot,
  onLogoClick,
}: HeaderProps) {
  return (
    <header
      className="border-b"
      style={{ borderColor: 'var(--rule)', background: 'var(--bg)' }}
    >
      <div className="max-w-[1100px] mx-auto h-16 px-3 sm:px-8 flex sm:grid sm:grid-cols-[1fr_auto_1fr] items-center justify-between gap-2 sm:gap-6">
        <button
          onClick={onLogoClick}
          aria-label="Whispered Events home"
          className={`${activeTab !== null ? 'hidden sm:block' : 'block'} sm:justify-self-start`}
        >
          <img src="/w-olive-gold-on-black.png" alt="Whispered Events" className="h-10 w-auto" />
        </button>

        {activeTab !== null ? (
          <nav
            className="flex gap-0.5 p-1 rounded-full border min-w-0"
            style={{ background: 'var(--paper)', borderColor: 'var(--rule)' }}
          >
            {TABS.map((t) => {
              const active = activeTab === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => onTabChange?.(t.id)}
                  className="px-2.5 sm:px-4 py-1.5 rounded-full text-[12px] sm:text-[13px] font-medium transition-colors whitespace-nowrap"
                  style={{
                    background: active ? 'var(--ink)' : 'transparent',
                    color: active ? 'var(--paper)' : 'var(--ink-2)',
                  }}
                >
                  {/* Short labels on mobile so the three pills fit. */}
                  <span className="sm:hidden">{t.label.split(' ')[0]}</span>
                  <span className="hidden sm:inline">{t.label}</span>
                </button>
              )
            })}
          </nav>
        ) : (
          <div className="hidden sm:block" />
        )}

        <div className="sm:justify-self-end flex items-center gap-4">{rightSlot}</div>
      </div>
    </header>
  )
}
