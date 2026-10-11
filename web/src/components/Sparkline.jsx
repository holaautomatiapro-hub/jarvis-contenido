import { useId } from 'react';

// Minigráfica de línea con relleno degradado (SVG puro).
export default function Sparkline({ data, color = 'var(--accent-2)', height = 30, dots = false }) {
  const id = useId().replace(/:/g, '');
  const w = 200;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * w, height - 3 - ((v - min) / span) * (height - 8)]);
  // Curva suave (Catmull-Rom → Bézier)
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`;
  }
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" style={{ width: '100%', height }}>
      <defs>
        <linearGradient id={`g${id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" style={{ stopColor: color }} stopOpacity="0.35" />
          <stop offset="1" style={{ stopColor: color }} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L${w},${height} L0,${height} Z`} fill={`url(#g${id})`} />
      <path d={d} fill="none" strokeWidth="1.6" vectorEffect="non-scaling-stroke" style={{ stroke: color, filter: `drop-shadow(0 0 3px ${color})` }} />
      {dots && pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="1.6" style={{ fill: color }} />)}
    </svg>
  );
}
