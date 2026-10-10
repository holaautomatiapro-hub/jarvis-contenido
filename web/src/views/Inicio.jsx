import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import Sparkline from '../components/Sparkline.jsx';
import Sphere from '../components/Sphere.jsx';
import Mascota from '../components/Mascota.jsx';
import { TAG_COLORS } from '../lib/demo.js';

function Kpi({ k }) {
  const up = k.delta >= 0;
  return (
    <div className="panel kpi">
      <div className="kpi-icon" style={{ background: `color-mix(in srgb, ${k.color} 16%, transparent)`, color: k.color }}>
        <Icon name={k.icon} />
      </div>
      <div className="kpi-top">
        <span className="label">{k.label}</span>
        <Icon name="chevron" style={{ width: 13, height: 13, color: 'var(--dim)' }} />
      </div>
      <div className="kpi-value">
        {k.value}
        <span className={`delta ${up ? 'up' : 'down'}`}>{up ? '▲' : '▼'} {Math.abs(k.delta)}%</span>
      </div>
      <div className="kpi-spark"><Sparkline data={k.series} color={k.color.startsWith('var') ? getVar(k.color) : k.color} /></div>
    </div>
  );
}

// Los SVG necesitan el color resuelto para el degradado
function getVar(v) {
  const name = v.slice(4, -1);
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#3d8bff';
}

export default function Inicio({ data, onAsk, acciones = {} }) {
  const [q, setQ] = useState('');
  const submit = (text) => {
    const t = (text ?? q).trim();
    if (!t) return;
    onAsk?.(t);
    setQ('');
  };
  const allOn = data.sistema.every((s) => s.estado === 'on');

  return (
    <>
      <section className="home">
        <div className="col">
          {data.kpis.map((k) => <Kpi key={k.id} k={k} />)}
        </div>

        <div className="panel hero">
          <div className="sphere-wrap"><Sphere /></div>
          <Mascota pose="saludando" size={150} className="hero-mascota" />
          <div className="hero-title">JARVIS</div>
          <div className="hero-sub">Tu espacio de trabajo inteligente</div>
          <form className="ask" onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Icon name="search" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pregúntale a JARVIS lo que quieras…" aria-label="Pregúntale a JARVIS" />
            <button className="ask-send" type="submit" aria-label="Enviar"><Icon name="send" size={15} /></button>
          </form>
          <div className="chips">
            <button className="chip" onClick={() => submit('Resume mi día')}><Icon name="sparkle" />Resume mi día</button>
            <button className="chip" onClick={() => submit('Analiza mi último reel')}><Icon name="chart" />Analiza mi último reel</button>
            <button className="chip" onClick={() => submit('Planifica mi semana de contenido')}><Icon name="calendar" />Planifica mi semana</button>
          </div>
        </div>

        <div className="col">
          <div className="panel panel-pad">
            <div className="panel-head">
              <span className="label">Distribución del foco</span>
              <span className="select-mini">Esta semana <Icon name="chevronDown" size={10} /></span>
            </div>
            {data.foco.map((f) => (
              <div className="bar-row" key={f.label}>
                <Icon name={f.icon} color={f.color} />
                <span>{f.label}</span>
                <div className="bar"><span style={{ width: `${f.pct}%`, background: f.color, boxShadow: `0 0 8px ${f.color}` }} /></div>
                <span className="bar-pct">{f.pct}%</span>
              </div>
            ))}
          </div>

          <div className="panel panel-pad" style={{ flex: 1 }}>
            <div className="panel-head">
              <span className="label">Estado del sistema</span>
              <span className="all-online"><span className={`dot ${allOn ? 'on' : 'warn'}`} />{allOn ? 'Todos online' : 'Revisar'}</span>
            </div>
            {data.sistema.map((s) => (
              <div className="status-row" key={s.label}>
                <Icon name={s.icon} />
                <span>{s.label}</span>
                <span className="status"><span className={`dot ${s.estado}`} />{s.estado === 'on' ? 'Online' : s.estado === 'warn' ? 'Sin conectar' : 'Offline'}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="home-bottom">
        <div className="panel panel-pad">
          <div className="panel-head">
            <span className="label">Actividad reciente</span>
            <button className="link" style={{ background: 'none', border: 0 }}>Ver todo</button>
          </div>
          {!data.actividad.length && <div className="vacio">Todavía no hay actividad. Captura tu primera idea.</div>}
          {data.actividad.map((a, i) => {
            const [bg, fg] = TAG_COLORS[a.tag] || TAG_COLORS.Nota;
            return (
              <div className="activity-row" key={i}>
                <span className="time">{a.hora}</span>
                <Icon name={a.icon} color={a.color} />
                <span>{a.texto}</span>
                <span className="tag" style={{ background: bg, color: fg }}>{a.tag}</span>
              </div>
            );
          })}
        </div>

        <div className="panel panel-pad">
          <div className="panel-head"><span className="label">Acciones rápidas</span></div>
          <div className="quick">
            <button className="quick-btn" onClick={acciones.idea}><Icon name="bulb" /><b>Nueva idea</b><small>Al pipeline</small></button>
            <button className="quick-btn" onClick={acciones.nota}><Icon name="doc" /><b>Nueva nota</b><small>En tu vault</small></button>
            <button className="quick-btn" onClick={acciones.dictar}><Icon name="mic" /><b>Dictar</b><small>Habla con JARVIS</small></button>
            <button className="quick-btn" onClick={acciones.vault}><Icon name="obsidian" /><b>Abrir vault</b><small>En Obsidian</small></button>
          </div>
        </div>
      </section>
    </>
  );
}
