// Airtable stores event/user dates as bare ISO calendar strings ('2026-06-23').
// `new Date(iso)` parses those as UTC midnight, so any locale-formatter that
// renders in local time will shift the calendar day in negative-UTC-offset
// zones (the entire Americas, half the year). Force the formatter to UTC so
// the displayed day matches the stored day verbatim. Accepts the same options
// shape as toLocaleDateString — call sites keep full control of month/day
// style.
export function formatEventDate(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions,
): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })
}
