'use client'

import { useEffect, useState } from 'react'

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
            <img src="/logo.svg" alt="Whispered Events" className="h-7 w-auto" />
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

              <label className="block">
                <span className="text-xs uppercase tracking-widest text-gold-700 font-medium">
                  Body
                </span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Write the message. Empty lines become paragraph breaks. Markdown isn't parsed — keep it plain."
                  rows={10}
                  className="mt-1 w-full bg-white border border-[#E8DDD0] rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-gold-400 transition-colors shadow-sm resize-y"
                />
                <p className="mt-1 text-[11px] text-gray-500">
                  Each recipient sees their first name where you write{' '}
                  <code className="bg-[#F5EFE6] px-1 rounded">{'{{firstName}}'}</code>.
                </p>
              </label>
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
                  className="ml-auto px-5 py-2 rounded-lg bg-gold-700 hover:bg-gold-600 text-white text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
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
