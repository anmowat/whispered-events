'use client'

import { Fragment } from 'react'

// Shared chat primitives used by ViewEventsTab, ShareEventTab, and
// PartnerApplyTab. The three flows have distinct state machines but
// identical visual chrome — extracting these primitives keeps the
// Salon look in sync across all three.

export interface ChatMessage {
  role: 'assistant' | 'user'
  content: string
}

// Tiny markdown subset: **bold** + [text](href). Used by every chat
// surface to render inline emphasis in bot prompts.
export function parseInline(text: string): React.ReactNode[] {
  const tokens = text.split(/(\*\*.+?\*\*|\[.+?\]\(.+?\))/)
  return tokens.map((token, i) => {
    if (/^\*\*.+\*\*$/.test(token)) {
      return (
        <strong
          key={i}
          className="font-semibold"
          style={{ color: 'var(--accent)' }}
        >
          {token.slice(2, -2)}
        </strong>
      )
    }
    const linkMatch = token.match(/^\[(.+?)\]\((.+?)\)$/)
    if (linkMatch) {
      return (
        <a
          key={i}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="underline"
          style={{ color: 'var(--accent)', textUnderlineOffset: 3 }}
        >
          {linkMatch[1]}
        </a>
      )
    }
    return <Fragment key={i}>{token}</Fragment>
  })
}

// Single chat row. User bubbles are right-aligned, assistant bubbles
// left-aligned. The old W avatar has been retired — these flows are
// question/answer cards rather than a true chat, and the avatar mostly
// stole horizontal space (especially on mobile).
export function ChatRow({
  role,
  children,
}: {
  role: 'assistant' | 'user'
  children: React.ReactNode
}) {
  return (
    <div
      className={`flex animate-slide-up ${role === 'user' ? 'justify-end' : 'justify-start'}`}
    >
      {children}
    </div>
  )
}

export function ChatBubble({
  role,
  children,
}: {
  role: 'assistant' | 'user'
  children: React.ReactNode
}) {
  if (role === 'user') {
    return (
      <div
        className="max-w-[80%] px-4 py-3 text-[14px] leading-[1.55] whitespace-pre-line"
        style={{
          background: 'var(--accent)',
          color: 'var(--paper)',
          borderRadius: 16,
          borderTopRightRadius: 4,
        }}
      >
        {children}
      </div>
    )
  }
  return (
    <div
      className="max-w-[80%] px-4 py-3 text-[14px] leading-[1.55] border whitespace-pre-line"
      style={{
        background: 'var(--paper)',
        borderColor: 'var(--rule)',
        color: 'var(--ink)',
        borderRadius: 16,
        borderTopLeftRadius: 4,
      }}
    >
      {children}
    </div>
  )
}

// Renders a list of plain-string messages with inline-markdown parsing.
// Components that need to embed forms or custom elements between messages
// should map messages themselves and use ChatRow/ChatBubble directly.
export function MessageList({ messages }: { messages: ChatMessage[] }) {
  return (
    <>
      {messages.map((msg, i) => (
        <ChatRow key={i} role={msg.role}>
          <ChatBubble role={msg.role}>
            {msg.role === 'assistant' ? (
              <div className="space-y-1">
                {msg.content.split('\n').map((line, j) => (
                  <p key={j} className="m-0">
                    {line ? parseInline(line) : ' '}
                  </p>
                ))}
              </div>
            ) : (
              msg.content
            )}
          </ChatBubble>
        </ChatRow>
      ))}
    </>
  )
}

// Three pulsing dots — shown while a network round-trip is in flight.
export function TypingIndicator() {
  return (
    <div className="flex justify-start animate-fade-in">
      <div
        className="px-4 py-3 border"
        style={{
          background: 'var(--paper)',
          borderColor: 'var(--rule)',
          borderRadius: 16,
          borderTopLeftRadius: 4,
        }}
      >
        <div className="flex gap-1 items-center">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="w-1.5 h-1.5 rounded-full animate-bounce"
              style={{
                background: 'var(--accent)',
                opacity: 0.6,
                animationDelay: `${-0.3 + i * 0.15}s`,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// "Find Events · Step 3 of 5" eyebrow + 3px progress bar at the top of
// each chat surface. Hide entirely (return null) when not applicable.
// Single "← Back" link rendered at the top of every chat surface
// (signup, contribute, partner apply). Tabs own the click behavior —
// ViewEventsTab steps backward through its form history, the others
// return straight to the landing surface. Keeping the link in one
// shared component means a single visual treatment everywhere.
export function BackLink({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="text-[12px] mb-3 self-start transition-colors"
      style={{ color: 'var(--ink-3)' }}
      onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--accent)')}
      onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--ink-3)')}
    >
      ← Back
    </button>
  )
}

export function StepIndicator({
  label,
  current,
  total,
}: {
  label: string
  current: number
  total: number
}) {
  const percent = Math.round((current / total) * 100)
  return (
    <div className="mb-5">
      <div
        className="eyebrow mb-1.5"
        style={{ color: 'var(--ink-3)' }}
      >
        {label} · Step {current} of {total}
      </div>
      <div
        className="rounded-full overflow-hidden"
        style={{ height: 3, background: 'var(--rule-soft)' }}
      >
        <div
          className="h-full transition-[width] duration-300"
          style={{
            width: `${Math.max(0, Math.min(100, percent))}%`,
            background: 'var(--accent)',
          }}
        />
      </div>
    </div>
  )
}

// Persistent composer used by chat surfaces with a single text input.
// ShareEventTab uses a textarea-based variant inline; the rest use this.
export function Composer({
  value,
  onChange,
  onSend,
  placeholder = 'Type your answer…',
  disabled,
  helper = 'Press Enter to send',
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  placeholder?: string
  disabled?: boolean
  helper?: string
}) {
  return (
    <div className="pt-3 sm:pt-4 border-t" style={{ borderColor: 'var(--rule-soft)' }}>
      {/* Stack vertically on mobile (Send full-width below input) so the
          button is never clipped by a narrow viewport. Side-by-side on
          desktop where there's room. */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onSend()
            }
          }}
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 min-w-0 rounded-input border px-3 py-2 sm:px-3.5 sm:py-2.5 text-[14px] focus:outline-none transition-colors"
          style={{
            background: 'var(--paper-2)',
            borderColor: 'var(--rule)',
            color: 'var(--ink)',
          }}
        />
        <button
          onClick={onSend}
          disabled={disabled || !value.trim()}
          className="shrink-0 w-full sm:w-auto rounded-pill px-3.5 sm:px-4 py-2.5 text-[13px] font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--accent)' }}
          onMouseEnter={(e) =>
            !disabled && value.trim() && (e.currentTarget.style.background = 'var(--accent-2)')
          }
          onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--accent)')}
        >
          Send
        </button>
      </div>
      {/* Helper text is desktop-only; mobile has no visible Enter key to label. */}
      <p
        className="hidden sm:block mt-2 text-center text-[11px]"
        style={{ color: 'var(--ink-3)' }}
      >
        {helper.split(/(Enter|Shift\+Enter)/).map((part, i) =>
          part === 'Enter' || part === 'Shift+Enter' ? (
            <kbd
              key={i}
              className="rounded-[4px] border mx-0.5 px-1.5"
              style={{
                background: 'var(--paper-2)',
                borderColor: 'var(--rule)',
                fontFamily: 'ui-monospace, monospace',
                fontSize: 10.5,
              }}
            >
              {part}
            </kbd>
          ) : (
            <span key={i}>{part}</span>
          ),
        )}
      </p>
    </div>
  )
}
