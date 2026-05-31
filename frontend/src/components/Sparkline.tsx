interface Props {
  scores: number[]
  width?: number
  height?: number
}

export function Sparkline({ scores, width = 120, height = 40 }: Props) {
  const n = scores.length
  if (n === 0) return null
  const pad = 4
  const xFn = (i: number) =>
    n === 1 ? width / 2 : pad + (i / (n - 1)) * (width - 2 * pad)
  const yFn = (v: number) => pad + ((5 - v) / 4) * (height - 2 * pad)
  const pts = scores.map((s, i) => `${xFn(i).toFixed(1)},${yFn(s).toFixed(1)}`).join(' ')

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="text-indigo-500"
    >
      {n > 1 && (
        <polyline
          points={pts}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {scores.map((s, i) => (
        <circle key={i} cx={xFn(i)} cy={yFn(s)} r={3} fill="currentColor" />
      ))}
    </svg>
  )
}
