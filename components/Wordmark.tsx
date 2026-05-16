// "Whispered Events" wordmark — Newsreader 500, color contrast only.
// "Whispered" muted to 30% black, "Events" in ink. The only logo
// treatment used across header, dashboard, login, and email.
//
// Inline so it can sit beside any other inline element on the same
// baseline without a CSS hack.

interface WordmarkProps {
  size?: number
  className?: string
}

export function Wordmark({ size = 22, className = '' }: WordmarkProps) {
  return (
    <span
      className={`inline-flex items-baseline gap-2 leading-none ${className}`}
      style={{ fontFamily: 'var(--font-newsreader), Georgia, serif' }}
    >
      <span
        style={{
          fontSize: size,
          color: 'rgba(0,0,0,0.30)',
          fontWeight: 500,
          letterSpacing: '-0.012em',
        }}
      >
        Whispered
      </span>
      <span
        style={{
          fontSize: size,
          color: 'var(--ink)',
          fontWeight: 500,
          letterSpacing: '-0.012em',
        }}
      >
        Events
      </span>
    </span>
  )
}
