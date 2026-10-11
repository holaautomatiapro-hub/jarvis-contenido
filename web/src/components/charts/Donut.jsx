import { useState } from 'react';
import { num } from '../../lib/formato.js';

// Donut con separación entre segmentos, total en el centro, leyenda con etiquetas directas y tooltip.
export default function Donut({ datos, colores, total, etiquetaTotal = 'Total', tam = 150 }) {
  const [hover, setHover] = useState(null);
  const r = tam / 2 - 10, c = 2 * Math.PI * r;
  const suma = datos.reduce((a, d) => a + d.valor, 0) || 1;
  let acumulado = 0;
  const hueco = 2.5; // px de separación entre segmentos

  return (
    <div className="donut">
      <div className="donut-svg" style={{ width: tam, height: tam }}>
        <svg width={tam} height={tam} viewBox={`0 0 ${tam} ${tam}`} role="img" aria-label="Distribución por formato">
          <circle cx={tam / 2} cy={tam / 2} r={r} fill="none" style={{ stroke: 'color-mix(in srgb, var(--tinta) 6%, transparent)' }} strokeWidth="16" />
          {datos.map((d, i) => {
            const largo = (d.valor / suma) * c;
            const seg = (
              <circle
                key={d.etiqueta}
                cx={tam / 2} cy={tam / 2} r={r} fill="none"
                stroke={colores[i]} strokeWidth={hover === i ? 19 : 16}
                strokeDasharray={`${Math.max(0, largo - hueco)} ${c}`}
                strokeDashoffset={-acumulado}
                transform={`rotate(-90 ${tam / 2} ${tam / 2})`}
                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                style={{ transition: 'stroke-width .12s', cursor: 'default' }}
              />
            );
            acumulado += largo;
            return seg;
          })}
        </svg>
        <div className="donut-centro">
          <b>{hover != null ? `${datos[hover].pct}%` : num(total ?? suma)}</b>
          <span>{hover != null ? datos[hover].etiqueta : etiquetaTotal}</span>
        </div>
      </div>
      <ul className="leyenda">
        {datos.map((d, i) => (
          <li key={d.etiqueta} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className={hover === i ? 'on' : ''}>
            <span className="leyenda-marca" style={{ background: colores[i] }} />
            <span>{d.etiqueta}</span>
            <b>{d.pct}%</b>
            <small>{d.detalle}</small>
          </li>
        ))}
      </ul>
    </div>
  );
}
