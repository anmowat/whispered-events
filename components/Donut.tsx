// SVG donut chart used by the "Where we run deepest" landing block.
// Plain <path /> per slice — no charting library dependency. Outer +
// inner arcs are joined into a single path so each slice is a true
// ring segment with a center hole.

interface DonutDatum {
  label: string
  value: number
}

interface DonutProps {
  data: DonutDatum[]
  colors: string[]
  size?: number
}

export function Donut({ data, colors, size = 160 }: DonutProps) {
  const total = data.reduce((s, d) => s + d.value, 0)
  if (total === 0) return null

  const cx = size / 2
  const cy = size / 2
  const rOuter = size / 2 - 4
  const rInner = size / 2 - 32

  let acc = 0
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      aria-hidden
    >
      {data.map((d, i) => {
        const start = (acc / total) * Math.PI * 2 - Math.PI / 2
        acc += d.value
        const end = (acc / total) * Math.PI * 2 - Math.PI / 2
        const large = end - start > Math.PI ? 1 : 0
        const xs1 = cx + rOuter * Math.cos(start)
        const ys1 = cy + rOuter * Math.sin(start)
        const xe1 = cx + rOuter * Math.cos(end)
        const ye1 = cy + rOuter * Math.sin(end)
        const xs2 = cx + rInner * Math.cos(end)
        const ys2 = cy + rInner * Math.sin(end)
        const xe2 = cx + rInner * Math.cos(start)
        const ye2 = cy + rInner * Math.sin(start)
        const path = `M ${xs1} ${ys1} A ${rOuter} ${rOuter} 0 ${large} 1 ${xe1} ${ye1} L ${xs2} ${ys2} A ${rInner} ${rInner} 0 ${large} 0 ${xe2} ${ye2} Z`
        return (
          <path
            key={i}
            d={path}
            fill={colors[i % colors.length]}
            stroke="var(--bg)"
            strokeWidth={1.5}
          />
        )
      })}
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        fontSize="11"
        fill="var(--ink-3)"
        style={{
          fontFamily: 'var(--font-geist), sans-serif',
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
        }}
      >
        Total
      </text>
      <text
        x={cx}
        y={cy + 18}
        textAnchor="middle"
        fontSize="22"
        fill="var(--ink)"
        style={{ fontFamily: 'var(--font-instrument-serif), Georgia, serif' }}
      >
        {total}
      </text>
    </svg>
  )
}
