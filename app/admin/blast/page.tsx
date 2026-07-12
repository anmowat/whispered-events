'use client'

import { useEffect, useRef, useState } from 'react'

interface Recipient {
  id: string
  email: string
  name: string
  firstName: string
}

interface SendResult {
  ok: number
  failed: { email: string; error: string }[]
}

export default function BlastPage() {
  const [recipientIds, setRecipientIds] = useState<string[] | null>(null)
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<SendResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const stored = sessionStorage.getItem('blastRecipientIds')
    if (!stored) {
      setRecipientIds([])
      return
    }
    try {
      const ids = JSON.parse(stored) as string[]
      setRecipientIds(Array.isArray(ids) ? ids : [])
    } catch {
      setRecipientIds([])
    }
  }, [])

  // Resolve IDs to email + name for display. Reuses dashboard-counts so
  // we don't need a new lookup endpoint for the blast picker.
  useEffect(() => {
    if (!recipientIds) return
    if (recipientIds.length === 0) return
    fetch('/api/admin/dashboard-counts', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { users?: Recipient[] }) => {
        const idSet = new Set(recipientIds)
        const matched = (d.users || []).filter((u) => idSet.has(u.id))
        setRecipients(matched)
      })
      .catch(() => {})
  }, [recipientIds])

  async function handleSend() {
    if (!recipientIds || recipientIds.length === 0) return
    if (!subject.trim() || !body.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/send-blast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userIds: recipientIds,
          subject: subject.trim(),
          body: body.trim(),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as Partial<SendResult> & { error?: string }
      if (!res.ok) {
        setError(data.error || `HTTP ${res.status}`)
      } else {
        setResult({ ok: data.ok ?? 0, failed: data.failed ?? [] })
        // Clear the recipient list so a refresh doesn't double-send.
        sessionStorage.removeItem('blastRecipientIds')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSending(false)
      setConfirming(false)
    }
  }

  const displayName = (r: Recipient) =>
    r.name && r.name !== 'DEFAULT' ? r.name :
    r.firstName && r.firstName !== 'DEFAULT' ? r.firstName : r.email

  return (
    <div className="min-h-screen bg-[#F5EFE6] flex flex-col">
      <header className="border-b border-[#E8DDD0] bg-[#F5EFE6]/90 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <a href="/admin" className="flex items-center gap-3">
            <img src="/w-olive-gold.svg" alt="Whispered Events" className="h-10 w-auto" />
            <span className="text-xs uppercase tracking-widest text-gray-500">← Admin</span>
          </a>
          <div className="text-xs uppercase tracking-widest text-gray-500">Send blast</div>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 py-8">
        {recipientIds === null && (
          <p className="text-sm text-gray-500">Loading…</p>
        )}

        {recipientIds && recipientIds.length === 0 && !result && (
          <div className="rounded-2xl border border-[#E8DDD0] bg-white p-6 shadow-sm">
            <p className="text-sm text-gray-700">
              No recipients selected. Head back to{' '}
              <a href="/admin" className="text-gold-700 underline">
                /admin
              </a>{' '}
              and tick the rows you want to email.
            </p>
          </div>
        )}

        {result && (
          <div className="rounded-2xl border border-[#E8DDD0] bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Blast sent — {result.ok} of {result.ok + result.failed.length}
            </h2>
            {result.failed.length > 0 && (
              <div>
                <p className="text-sm text-gray-700 mb-2">Failed:</p>
                <ul className="text-xs text-red-600 list-disc ml-5 space-y-0.5">
                  {result.failed.map((f) => (
                    <li key={f.email}>
                      {f.email}: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <a
              href="/admin"
              className="inline-block mt-2 px-4 py-2 rounded-lg border border-[#E8DDD0] bg-white text-sm text-gray-700 hover:bg-[#F5EFE6] transition-colors"
            >
              ← Back to admin
            </a>
          </div>
        )}

        {recipientIds && recipientIds.length > 0 && !result && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Compose blast</h1>
              <p className="mt-1 text-sm text-gray-600">
                Sending to {recipientIds.length} user
                {recipientIds.length === 1 ? '' : 's'}. Body renders as plain
                paragraphs inside the standard Whispered email shell.
              </p>
            </div>

            <div className="rounded-2xl border border-[#E8DDD0] bg-white p-5 shadow-sm">
              <details className="text-sm">
                <summary className="cursor-pointer text-gold-700 underline">
                  {recipients.length || recipientIds.length} recipient
                  {recipientIds.length === 1 ? '' : 's'} — show list
                </summary>
                <ul className="mt-3 max-h-48 overflow-y-auto text-xs text-gray-600 space-y-1 pl-4">
                  {recipients.map((r) => (
                    <li key={r.id}>
                      <span className="text-gray-800">{displayName(r)}</span>{' '}
                      <span className="text-gray-400">&lt;{r.email}&gt;</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="text-xs uppercase tracking-widest text-gold-700 font-medium">
                  Subject
                </span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="e.g. Three new SF events this week"
                  className="mt-1 w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-gold-400 transition-colors shadow-sm"
                />
              </label>

              <div>
                <span className="block text-xs uppercase tracking-widest text-gray-600 font-medium mb-1">
                  Body
                </span>
                <Wysiwyg value={body} onChange={setBody} />
                <p className="mt-1 text-[11px] text-gray-500">
                  Tokens get substituted per recipient at send time. Use the
                  Token menu in the toolbar to insert{' '}
                  <code className="bg-[#F5EFE6] px-1 rounded">{'{{firstName}}'}</code>,{' '}
                  <code className="bg-[#F5EFE6] px-1 rounded">{'{{location}}'}</code>, or{' '}
                  <code className="bg-[#F5EFE6] px-1 rounded">{'{{interests}}'}</code> at
                  your cursor position. Sent from{' '}
                  <code className="bg-[#F5EFE6] px-1 rounded">team@whisperedevents.com</code>
                  . No BCC — view the audit in the Resend dashboard.
                </p>
              </div>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-white p-4 text-sm text-red-600">
                {error}
              </div>
            )}

            <div className="flex items-center gap-3">
              <a
                href="/admin"
                className="px-4 py-2 rounded-lg border border-[#E8DDD0] bg-white text-sm text-gray-700 hover:bg-[#F5EFE6] transition-colors"
              >
                Cancel
              </a>

              {!confirming ? (
                <button
                  onClick={() => setConfirming(true)}
                  disabled={!subject.trim() || !body.trim() || sending}
                  className="ml-auto px-5 py-2 rounded-lg text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ background: '#6E1F2B' }}
                  onMouseEnter={(e) => !e.currentTarget.disabled && (e.currentTarget.style.background = '#8E2E3B')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '#6E1F2B')}
                >
                  Send to {recipientIds.length} user{recipientIds.length === 1 ? '' : 's'}
                </button>
              ) : (
                <div className="ml-auto flex items-center gap-2">
                  <span className="text-sm text-gray-700">
                    Confirm send to {recipientIds.length}?
                  </span>
                  <button
                    onClick={() => setConfirming(false)}
                    disabled={sending}
                    className="px-3 py-1.5 rounded-lg border border-[#E8DDD0] bg-white text-xs text-gray-700 hover:bg-[#F5EFE6] transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleSend}
                    disabled={sending}
                    className="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 text-white text-xs font-medium transition-colors disabled:opacity-50"
                  >
                    {sending ? 'Sending…' : `Confirm — send ${recipientIds.length}`}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  )
}

// Inline rich text editor — contenteditable + a small toolbar. Bold,
// italic, bullet, ordered, link. document.execCommand is deprecated
// but still works in every shipping browser and avoids adding a
// dependency (~80kb for Tiptap+StarterKit). Output is HTML stored in
// the parent's `value` prop and rendered server-side inside the Salon
// email shell.
// Personalization tokens. Backend substitutes per-recipient at send time
// (see lib/email.ts sendBlast). The dropdown inserts the raw token at
// the cursor so the admin doesn't have to remember the exact syntax.
const TOKENS: { token: string; label: string; preview: string }[] = [
  { token: '{{firstName}}', label: 'First name', preview: 'Andy' },
  { token: '{{location}}', label: 'Location', preview: 'San Francisco' },
  { token: '{{interests}}', label: 'Interests', preview: 'RevOps events' },
]

function Wysiwyg({
  value,
  onChange,
}: {
  value: string
  onChange: (html: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [showTokens, setShowTokens] = useState(false)

  // Seed innerHTML once on mount. We deliberately don't re-sync from
  // `value` on every render — that would reset the caret on every
  // keystroke and prevent typing entirely.
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value) {
      ref.current.innerHTML = value
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function exec(command: string, arg?: string) {
    document.execCommand(command, false, arg)
    if (ref.current) onChange(ref.current.innerHTML)
    ref.current?.focus()
  }

  function handleLink() {
    const url = prompt('Link URL', 'https://')
    if (!url) return
    const trimmed = url.trim()
    if (!trimmed) return
    const normalised = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
    exec('createLink', normalised)
  }

  function insertToken(token: string) {
    // Restore focus to the editor before inserting so the token lands
    // at the previous cursor position rather than at the end.
    ref.current?.focus()
    document.execCommand('insertText', false, token)
    if (ref.current) onChange(ref.current.innerHTML)
    setShowTokens(false)
  }

  return (
    <div className="rounded-lg border border-[#E8DDD0] bg-white overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-[#E8DDD0] bg-[#FDFAF6]">
        <ToolbarButton onMouseDown={(e) => { e.preventDefault(); exec('bold') }} title="Bold">
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton onMouseDown={(e) => { e.preventDefault(); exec('italic') }} title="Italic">
          <em>I</em>
        </ToolbarButton>
        <span className="w-px h-4 bg-[#E8DDD0] mx-1" />
        <ToolbarButton onMouseDown={(e) => { e.preventDefault(); exec('insertUnorderedList') }} title="Bullet list">
          • List
        </ToolbarButton>
        <ToolbarButton onMouseDown={(e) => { e.preventDefault(); exec('insertOrderedList') }} title="Numbered list">
          1. List
        </ToolbarButton>
        <span className="w-px h-4 bg-[#E8DDD0] mx-1" />
        <ToolbarButton onMouseDown={(e) => { e.preventDefault(); handleLink() }} title="Insert link">
          🔗 Link
        </ToolbarButton>
        <ToolbarButton onMouseDown={(e) => { e.preventDefault(); exec('unlink') }} title="Remove link">
          ✕ Link
        </ToolbarButton>
        <span className="w-px h-4 bg-[#E8DDD0] mx-1" />
        <div className="relative">
          <ToolbarButton
            onMouseDown={(e) => { e.preventDefault(); setShowTokens((v) => !v) }}
            title="Insert personalization token"
          >
            {'{{ }}'} Token ▾
          </ToolbarButton>
          {showTokens && (
            <div
              className="absolute z-10 mt-1 left-0 w-[260px] rounded-lg border border-[#E8DDD0] bg-white shadow-lg py-1"
            >
              {TOKENS.map((t) => (
                <button
                  key={t.token}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); insertToken(t.token) }}
                  className="block w-full text-left px-3 py-2 hover:bg-[#FDFAF6] transition-colors"
                >
                  <div className="text-sm text-gray-800">{t.label}</div>
                  <div className="text-[11px] text-gray-500">
                    <code>{t.token}</code> · e.g. "{t.preview}"
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        onBlur={(e) => onChange((e.target as HTMLDivElement).innerHTML)}
        className="px-3 py-3 text-sm text-gray-800 min-h-[220px] focus:outline-none"
        style={{ lineHeight: 1.6 }}
      />
    </div>
  )
}

function ToolbarButton({
  children,
  onMouseDown,
  title,
}: {
  children: React.ReactNode
  onMouseDown: (e: React.MouseEvent) => void
  title?: string
}) {
  return (
    <button
      type="button"
      onMouseDown={onMouseDown}
      title={title}
      className="px-2 py-1 rounded text-xs text-gray-700 hover:bg-white border border-transparent hover:border-[#E8DDD0] transition-colors"
    >
      {children}
    </button>
  )
}
