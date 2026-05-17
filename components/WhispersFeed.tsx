// Whispers this week — anonymized activity ticker on the landing page.
// Hardcoded for v1; in a later pass we'll plumb real counts from
// Airtable/Supabase (new events this week, recent partner joins, etc).
const WHISPERS = [
  '15 new events in SF',
  '8 new VP+ marketers',
  'New intimate dinner in NYC',
  'Added GTM Fund & Sendoso as partners',
  'Demand & Expand conference featured',
]

export default function WhispersFeed() {
  return (
    <div className="flex flex-col gap-2.5">
      {WHISPERS.map((w, i) => (
        <div key={i} className="flex items-baseline gap-2.5">
          <span
            className="num shrink-0 text-[11px] w-8"
            style={{ color: 'var(--ink-3)' }}
          >
            {String(i + 1).padStart(2, '0')}
          </span>
          <span className="text-[14px]" style={{ color: 'var(--ink-2)' }}>
            {w}
          </span>
        </div>
      ))}
    </div>
  )
}
