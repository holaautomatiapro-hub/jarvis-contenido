import { useEffect, useId, useRef, useState } from 'react';
import { fechaCorta, num, numLargo } from '../../lib/formato.js';

// Línea de una sola serie con área suave, cuadrícula discreta y tooltip con cruceta al pasar el ratón.
export default function LineChart({ datos, campo, color = '#3987e5', alto = 210, etiqueta }) {
  const ref = useRef(null);
  const [ancho, setAncho] = useState(600);
  const [hover, setHover] = useState(null);
  const id = useId().replace(/:/g, '');

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(260, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const m = { t: 10, r: 10, b: 24, l: 44 };
  const w = ancho - m.l - m.r, h = alto - m.t - m.b;
  const valores = datos.map((d) => d[campo] || 0);
  const max = Math.max(1, ...valores);
  // Marcas "redondas": el paso es 1, 2, 2,5 o 5 × 10^n y el techo son 4 pasos
  const bruto = max / 4;
  const pot = Math.pow(10, Math.floor(Math.log10(bruto)));
  const paso = [1, 2, 2.5, 5, 10].map((f) => f * pot).find((p) => p >= bruto);
  const techo = paso * 4;
  const x = (i) => m.l + (datos.length > 1 ? (i / (datos.length - 1)) * w : w / 2);
  const y = (v) => m.t + h - (v / techo) * h;
  const pts = valores.map((v, i) => [x(i), y(v)]);
  const linea = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('');
  const area = `${linea} L${x(datos.length - 1)},${m.t + h} L${x(0)},${m.t + h} Z`;
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => techo * f);
  // Etiquetas de fecha repartidas según el ancho disponible (una cada ~90 px), siempre con la primera y la última
  const nEtiquetas = Math.max(2, Math.min(datos.length, Math.floor(w / 90)));
  const indicesX = new Set(Array.from({ length: nEtiquetas }, (_, k) => Math.round((k / (nEtiquetas - 1)) * (datos.length - 1))));

  const mover = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = e.clientX - r.left;
    const i = Math.round(((px - m.l) / w) * (datos.length - 1));
    setHover(i >= 0 && i < datos.length ? i : null);
  };

  return (
    <div ref={ref} className="grafico" onMouseMove={mover} onMouseLeave={() => setHover(null)} role="img" aria-label={`${etiqueta} por día`}>
      <svg width={ancho} height={alto}>
        <defs>
          <linearGradient id={`a${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticksY.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + w} y1={y(t)} y2={y(t)} className="eje-linea" />
            <text x={m.l - 8} y={y(t) + 3} className="eje-texto" textAnchor="end">{num(t)}</text>
          </g>
        ))}
        {datos.map((d, i) => indicesX.has(i) && (
          <text key={d.fecha} x={x(i)} y={alto - 6} className="eje-texto" textAnchor={i === datos.length - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>{fechaCorta(d.fecha)}</text>
        ))}
        <path d={area} fill={`url(#a${id})`} />
        <path d={linea} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + h} className="cruceta" />
            <circle cx={pts[hover][0]} cy={pts[hover][1]} r="4.5" fill={color} stroke="var(--panel)" strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: Math.min(Math.max(pts[hover][0], 70), ancho - 70), top: Math.max(pts[hover][1] - 52, 0) }}>
          <b>{numLargo(valores[hover])}</b>
          <span>{etiqueta} · {fechaCorta(datos[hover].fecha)}</span>
        </div>
      )}
    </div>
  );
}
