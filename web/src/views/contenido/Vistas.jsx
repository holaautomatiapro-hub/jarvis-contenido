import { useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { celdasMes, diaCorto, diaLargo, hoyIso, mesDe, nombreMes, sumarMeses } from '../../lib/fechas.js';
import { ChipEstado, ESTADOS, Miniatura, Modal, esStory, estadoDe, textoTipo, tipoDe } from './comun.jsx';

const MAX_POR_DIA = 4;
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const ordenDia = (a, b) => (a.hora || '').localeCompare(b.hora || '') || a.id - b.id;

// ---------- Calendario del mes ----------
export function Calendario({ piezas, biblioteca, dia, setDia, onAbrir, onNuevo, onMover, onProgramar }) {
  const [mes, setMes] = useState(() => mesDe(dia));
  const [sobre, setSobre] = useState(null);
  const [eligiendo, setEligiendo] = useState(false);
  const arrastrando = useRef(null);
  const h = hoyIso();
  const porDia = useMemo(() => {
    const m = new Map();
    for (const p of piezas) if (p.fecha) m.set(p.fecha, [...(m.get(p.fecha) || []), p]);
    for (const l of m.values()) l.sort(ordenDia);
    return m;
  }, [piezas]);
  const delDia = porDia.get(dia) || [];

  const soltar = (f) => (e) => {
    e.preventDefault();
    setSobre(null);
    const id = Number(e.dataTransfer.getData('text/plain') || arrastrando.current);
    const p = piezas.find((x) => x.id === id);
    if (p && p.fecha !== f) onMover(p, { fecha: f });
  };

  return (
    <>
      <div className="panel panel-pad">
        <div className="cal-cabecera">
          <button className="icon-btn" onClick={() => setMes(sumarMeses(mes, -1))} aria-label="Mes anterior">‹</button>
          <button className="icon-btn" onClick={() => setMes(sumarMeses(mes, 1))} aria-label="Mes siguiente">›</button>
          <h2>{nombreMes(mes)}</h2>
          <button className="chip" onClick={() => { setMes(mesDe(h)); setDia(h); }}>Hoy</button>
          <span className="ayuda cal-ayuda">Arrastra una pieza a otro día para cambiarla de fecha</span>
        </div>
        <div className="cal-grid">
          {DIAS.map((d) => <div key={d} className="cal-dia-nombre">{d}</div>)}
          {celdasMes(mes).map((f) => {
            const lista = porDia.get(f) || [];
            const clase = ['cal-celda', mesDe(f) !== mes && 'fuera', f === dia && 'sel', sobre === f && 'sobre'].filter(Boolean).join(' ');
            return (
              <div
                key={f} className={clase} tabIndex={0}
                onClick={() => setDia(f)}
                onDoubleClick={() => onNuevo(f)}
                onKeyDown={(e) => e.key === 'Enter' && setDia(f)}
                onDragOver={(e) => { e.preventDefault(); setSobre(f); }}
                onDragLeave={() => setSobre(null)}
                onDrop={soltar(f)}
              >
                <div className="cal-num-fila">
                  <span className={`cal-num${f === h ? ' hoy' : ''}`}>{Number(f.slice(8))}</span>
                  <button className="cal-mas" onClick={(e) => { e.stopPropagation(); onNuevo(f); }} aria-label="Añadir contenido este día" title="Añadir contenido este día">+</button>
                </div>
                <div className="cal-puntos">{lista.slice(0, 4).map((p) => <i key={p.id} style={{ background: estadoDe(p.estado).color }} />)}</div>
                <div className="cal-chips">
                  {lista.slice(0, MAX_POR_DIA).map((p) => (
                    <button
                      key={p.id}
                      className={`cal-chip${esStory(p) ? ' story' : ''}`}
                      style={{ '--c': estadoDe(p.estado).color }}
                      draggable
                      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(p.id)); arrastrando.current = p.id; }}
                      onClick={(e) => { e.stopPropagation(); onAbrir(p); }}
                      title={`${textoTipo(p.formato)} · ${p.titulo} — ${estadoDe(p.estado).label}`}
                    >
                      <span className="cal-chip-tipo">{tipoDe(p.formato)?.corto || ''}</span>{p.titulo || 'Sin título'}
                    </button>
                  ))}
                  {lista.length > MAX_POR_DIA && <span className="cal-mas-n">+{lista.length - MAX_POR_DIA} más</span>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="cal-leyenda">
          {ESTADOS.map((e) => <span key={e.id}><i style={{ background: e.color }} />{e.label}</span>)}
          <span><i className="story-marca" />Story</span>
        </div>
      </div>

      <div className="panel panel-pad">
        <div className="panel-head">
          <span className="dia-titulo">{diaLargo(dia)}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            {biblioteca.length > 0 && <button className="chip" onClick={() => setEligiendo(true)}><Icon name="book" />De la biblioteca</button>}
            <button className="chip" onClick={() => onNuevo(dia)}><Icon name="plus" />Nuevo</button>
          </div>
        </div>
        {!delDia.length && <div className="vacio">Nada planificado este día.</div>}
        {delDia.map((p) => <FilaDia key={p.id} p={p} onAbrir={onAbrir} />)}
      </div>

      {eligiendo && (
        <Modal titulo={`¿Qué publicas el ${diaLargo(dia).toLowerCase()}?`} onClose={() => setEligiendo(false)} ancho={720}>
          <div className="elegir-grid">
            {biblioteca.map((p) => (
              <button key={p.id} className="elegir-item" onClick={() => { setEligiendo(false); onProgramar(p, dia); }}>
                <Miniatura p={p} />
                <span>{p.titulo}</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

function FilaDia({ p, onAbrir }) {
  const extra = [textoTipo(p.formato), p.hora, p.archivos.length ? `🎞 ${p.archivos.length}` : null].filter(Boolean).join(' · ');
  return (
    <div className="fila-c" tabIndex={0} onClick={() => onAbrir(p)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(p)}>
      <Miniatura p={p} className="peque" />
      <div className="fila-c-txt"><b>{p.titulo}</b><small>{extra}</small></div>
      <ChipEstado id={p.estado} />
    </div>
  );
}

// ---------- Lista: próximos, sin fecha y anteriores ----------
export function Lista({ piezas, cargando, onAbrir, onMover }) {
  const h = hoyIso();
  const orden = (a, b) => a.fecha.localeCompare(b.fecha) || ordenDia(a, b);
  const grupos = [
    { titulo: 'Próximos', lista: piezas.filter((p) => p.fecha && p.fecha >= h).sort(orden), vacio: 'Nada planificado a partir de hoy.' },
    { titulo: 'Sin fecha', lista: piezas.filter((p) => !p.fecha).sort((a, b) => b.id - a.id), vacio: 'Ninguna idea sin fecha.' },
    { titulo: 'Anteriores', lista: piezas.filter((p) => p.fecha && p.fecha < h).sort(orden).reverse(), vacio: 'Nada anterior a hoy.' },
  ];
  return grupos.map((g) => (
    <div key={g.titulo} className="panel panel-pad">
      <div className="panel-head"><span className="label">{g.titulo}</span><span className="cuenta">{g.lista.length}</span></div>
      {!g.lista.length && <div className="vacio">{cargando ? 'Cargando…' : g.vacio}</div>}
      {g.lista.map((p) => (
        <div key={p.id} className="fila-lista" tabIndex={0} onClick={() => onAbrir(p)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(p)}>
          <Miniatura p={p} className="media" />
          <div className="fila-c-txt"><b>{p.titulo || 'Sin título'}</b><small>{p.caption?.split('\n')[0] || 'Sin caption'}</small></div>
          <span className="tipo-pildora">{textoTipo(p.formato)}</span>
          <span className="fila-fecha">{p.fecha ? `${diaCorto(p.fecha)}${p.hora ? ` · ${p.hora}` : ''}` : 'Sin fecha'}</span>
          <span className="fila-ind">
            {p.archivos.length > 0 && <span title="Archivos subidos">🎞 {p.archivos.length}</span>}
            {p.video_url && <a href={p.video_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Abrir URL del vídeo"><Icon name="link" size={13} /></a>}
            {p.origen === 'hermes' && <Icon name="telegram" size={12} color="var(--cyan)" />}
          </span>
          <select
            className="estado-select" value={p.estado} style={{ '--c': estadoDe(p.estado).color }}
            onClick={(e) => e.stopPropagation()} onChange={(e) => onMover(p, { estado: e.target.value })} aria-label="Estado"
          >
            {ESTADOS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
        </div>
      ))}
    </div>
  ));
}

// ---------- Pipeline (tablero por estados) ----------
export function Pipeline({ piezas, onAbrir, onMover, onNuevaIdea }) {
  const [sobre, setSobre] = useState(null);
  const arrastrando = useRef(null);
  const soltar = (estado) => (e) => {
    e.preventDefault();
    setSobre(null);
    const id = Number(e.dataTransfer.getData('text/plain') || arrastrando.current);
    const p = piezas.find((x) => x.id === id);
    if (p && p.estado !== estado) onMover(p, { estado });
  };
  return (
    <div className="panel panel-pad pipeline">
      <div className="panel-head">
        <span className="label">Pipeline de contenido</span>
        <button className="chip" onClick={onNuevaIdea}><Icon name="plus" />Nueva idea</button>
      </div>
      <div className="kanban">
        {ESTADOS.map((c, idx) => {
          const lista = piezas.filter((p) => p.estado === c.id).sort((a, b) => b.orden - a.orden || b.id - a.id);
          return (
            <div
              key={c.id}
              className={`columna${sobre === c.id ? ' sobre' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setSobre(c.id); }}
              onDragLeave={() => setSobre(null)}
              onDrop={soltar(c.id)}
            >
              <div className="columna-head">
                <Icon name={c.icon} size={13} color={c.color} />
                <span>{c.label}</span>
                <span className="cuenta">{lista.length}</span>
              </div>
              <div className="columna-linea" style={{ background: c.color, boxShadow: `0 0 10px ${c.color}` }} />
              {lista.map((p) => (
                <div
                  key={p.id} className="tarjeta" draggable tabIndex={0}
                  onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(p.id)); arrastrando.current = p.id; }}
                  onClick={() => onAbrir(p)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(p)}
                >
                  {p.archivos[0] && <Miniatura p={p} className="tarjeta-mini" />}
                  <div className="tarjeta-titulo">{p.titulo}</div>
                  <div className="tarjeta-meta">
                    {p.formato && <span className="tag" style={{ background: 'rgba(47,107,255,.14)', color: '#9cc0ff' }}>{textoTipo(p.formato)}</span>}
                    {p.plataformas && <span className="mini">{p.plataformas}</span>}
                    {p.fecha && <span className="mini"><Icon name="calendar" size={10} /> {p.fecha.slice(5).split('-').reverse().join('/')}</span>}
                    {p.origen === 'hermes' && <Icon name="telegram" size={11} color="var(--cyan)" />}
                  </div>
                  <div className="tarjeta-acciones" onClick={(e) => e.stopPropagation()}>
                    <button disabled={idx === 0} onClick={() => onMover(p, { estado: ESTADOS[idx - 1].id })} aria-label="Mover a la columna anterior">←</button>
                    <button disabled={idx === ESTADOS.length - 1} onClick={() => onMover(p, { estado: ESTADOS[idx + 1].id })} aria-label="Mover a la columna siguiente">→</button>
                  </div>
                </div>
              ))}
              {!lista.length && <div className="vacio mini-vacio">Arrastra aquí</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
