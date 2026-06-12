'use client'

// Tab nav shared between the two admin top-level pages (/admin and
// /admin/events). Lives in components/ so the pages don't have to
// cross-import each other.
export function AdminTabs({ active }: { active: 'users' | 'events' }) {
  const tabs: Array<{ id: 'users' | 'events'; label: string; href: string }> = [
    { id: 'users', label: 'Users', href: '/admin' },
    { id: 'events', label: 'Events', href: '/admin/events' },
  ]
  return (
    <nav className="flex gap-1 mb-6 border-b border-[#E8DDD0]">
      {tabs.map((t) => {
        const isActive = active === t.id
        return (
          <a
            key={t.id}
            href={t.href}
            className="px-4 py-2 text-sm font-medium transition-colors -mb-px border-b-2"
            style={{
              color: isActive ? '#6E1F2B' : '#6B6356',
              borderColor: isActive ? '#6E1F2B' : 'transparent',
            }}
          >
            {t.label}
          </a>
        )
      })}
    </nav>
  )
}
