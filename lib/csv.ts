// RFC 4180-correct CSV builder. Pure and dependency-free so callers can
// run it client-side (e.g. the admin Users export button) without
// shipping a Papa-Parse-sized dependency.

export interface CsvColumn<R> {
  id: string
  header: string
  format: (row: R) => string | number | boolean | null | undefined
}

// Per RFC 4180: any cell containing a comma, double-quote, or newline
// must be wrapped in double quotes; internal double quotes are doubled.
// We're conservative and also quote anything starting with whitespace
// so the round-trip survives editors that trim leading spaces.
function escapeCell(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return ''
  const s = String(raw)
  if (s === '') return ''
  const needsQuoting = /[",\r\n]/.test(s) || /^\s|\s$/.test(s)
  if (!needsQuoting) return s
  return `"${s.replace(/"/g, '""')}"`
}

export function toCsv<R>(rows: R[], columns: CsvColumn<R>[]): string {
  const headerLine = columns.map((c) => escapeCell(c.header)).join(',')
  const dataLines = rows.map((row) =>
    columns.map((c) => escapeCell(c.format(row))).join(','),
  )
  return [headerLine, ...dataLines].join('\r\n')
}
