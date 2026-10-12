import { useEffect, useMemo, useRef, useState } from 'react';
import { normaliza } from '../../lib/api.js';
import Icon from '../../components/Icon.jsx';
import { celdasMes, diaCorto, diaLargo, hoyIso, mesDe, nombreMes, sumarMeses } from '../../lib/fechas.js';
import { EditorFases } from './Fases.jsx';
import { ChipEstado, MarcaLeadMagnet, Miniatura, useFases, Modal, esStory, estadoDe, textoTipo, tipoDe } from './comun.jsx';

const MAX_POR_DIA = 4;
const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const ordenDia = (a, b) => (a.hora || '').localeCompare(b.hora || '') || a.id - b.id;

// ---------- Calendario del mes ----------
// Menú que sale al pulsar un día: lo que hay ese día, elegir una pieza ya creada o crear una
function MenuDia({ menu, lista, onCerrar, onAbrir, onElegir, onNuevo }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: menu.x, top: menu.y, visible: false });
  useEffect(() => {
    // Se coloca debajo del día y, si no cabe, encima; nunca fuera de la pantalla
    const el = ref.current;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.max(8, Math.min(menu.x, window.innerWidth - w - 8));
    const top = menu.y + h + 8 > window.innerHeight ? Math.max(8, menu.arriba - h - 6) : menu.y;
    setPos({ left, top, visible: true });
  }, [menu]);
  useEffect(() => {
    const fuera = (e) => { if (!ref.current?.contains(e.target)) onCerrar(); };
    const esc = (e) => e.key === 'Escape' && onCerrar();
    const t = setTimeout(() => document.addEventListener('mousedown', fuera), 0);
    window.addEventListener('keydown', esc);
    window.addEventListener('scroll', onCerrar, true);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', fuera); window.removeEventListener('keydown', esc); window.removeEventListener('scroll', onCerrar, true); };
  }, [onCerrar]);
  return (
    <div ref={ref} className="menu-dia panel" style={{ left: pos.left, top: pos.top, visibility: pos.visible ? 'visible' : 'hidden' }} role="menu">
      <div className="menu-dia-titulo">{diaLargo(menu.fecha)}</div>
      {lista.map((p) => (
        <button key={p.id} className="menu-dia-pieza" onClick={() => { onCerrar(); onAbrir(p); }} role="menuitem">
          <i style={{ background: estadoDe(p.estado).color }} /><span>{p.titulo || 'Sin título'}</span>{p.hora && <small>{p.hora}</small>}
        </button>
      ))}
      {!lista.length && <div className="menu-dia-vacio">Nada planificado este día.</div>}
      <div className="menu-dia-acciones">
        <button className="btn btn-sec" onClick={() => { onCerrar(); onElegir(menu.fecha); }} role="menuitem"><Icon name="book" size={13} />Elegir uno ya creado</button>
        <button className="btn" onClick={() => { onCerrar(); onNuevo(menu.fecha); }} role="menuitem"><Icon name="plus" size={13} />Crear uno nuevo</button>
      </div>
    </div>
  );
}

// Elegir una pieza ya creada para un día: primero las de la biblioteca (sin fecha), o cualquiera
function ElegirPieza({ fecha, piezas, onCerrar, onElegida, onNuevo }) {
  const sinFecha = piezas.filter((p) => !p.fecha);
  const [ambito, setAmbito] = useState(sinFecha.length ? 'biblioteca' : 'todas');
  const [busca, setBusca] = useState('');
  const b = normaliza(busca.trim());
  const lista = (ambito === 'biblioteca' ? sinFecha : piezas.filter((p) => p.fecha !== fecha))
    .filter((p) => !b || normaliza(`${p.titulo}\n${p.caption || ''}`).includes(b))
    .sort((x, y) => y.id - x.id);
  return (
    <Modal titulo={`¿Qué publicas el ${diaLargo(fecha).toLowerCase()}?`} onClose={onCerrar} ancho={760}>
      <div className="elegir-barra">
        <div className="seg">
          <button className={ambito === 'biblioteca' ? 'on' : ''} onClick={() => setAmbito('biblioteca')}><Icon name="book" />Biblioteca · {sinFecha.length}</button>
          <button className={ambito === 'todas' ? 'on' : ''} onClick={() => setAmbito('todas')}><Icon name="layers" />Todas</button>
        </div>
        <div className="buscar-mini"><Icon name="search" size={13} /><input autoFocus placeholder="Buscar por título o caption" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
      </div>
      {ambito === 'todas' && <div className="ayuda" style={{ marginBottom: 10 }}>Si eliges una que ya tiene día, se mueve a este.</div>}
      <div className="elegir-grid">
        {lista.map((p) => (
          <button key={p.id} className="elegir-item" onClick={() => { onCerrar(); onElegida(p, fecha); }}>
            <Miniatura p={p} />
            <span>{p.titulo || 'Sin título'}</span>
            <small>{textoTipo(p.formato)}{p.fecha ? ` · ${diaCorto(p.fecha)}` : ''}</small>
          </button>
        ))}
      </div>
      {!lista.length && <div className="vacio">{b ? 'Nada coincide con la búsqueda.' : ambito === 'biblioteca' ? 'La biblioteca está vacía.' : 'No hay más piezas.'}</div>}
      <div className="modal-pie">
        <span className="ayuda">¿No está? Créala ahora.</span>
        <button className="btn" onClick={() => { onCerrar(); onNuevo(fecha); }}><Icon name="plus" size={13} />Crear uno nuevo</button>
      </div>
    </Modal>
  );
}

export function Calendario({ piezas, dia, setDia, onAbrir, onNuevo, onMover, onProgramar }) {
  const ESTADOS = useFases();
  const [mes, setMes] = useState(() => mesDe(dia));
  const [sobre, setSobre] = useState(null);
  const [eligiendo, setEligiendo] = useState(null); // fecha para la que se elige una pieza
  const [menu, setMenu] = useState(null);
  const abrirMenu = (f, el) => {
    const r = el.getBoundingClientRect();
    setDia(f);
    setMenu({ fecha: f, x: r.left, y: r.bottom + 6, arriba: r.top });
  };
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
                onClick={(e) => abrirMenu(f, e.currentTarget)}
                onDoubleClick={() => { setMenu(null); onNuevo(f); }}
                onKeyDown={(e) => e.key === 'Enter' && abrirMenu(f, e.currentTarget)}
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
                      {(p.publicar_ig || p.ig_estado) ? <span className={`cal-chip-ig ${p.ig_estado || 'pendiente'}`}><Icon name="instagram" size={9} /></span> : null}
                      {p.leadmagnet ? <span className="cal-chip-lm" title="Lleva lead magnet"><Icon name="target" size={9} /></span> : null}
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
            {piezas.length > 0 && <button className="chip" onClick={() => setEligiendo(dia)}><Icon name="book" />Elegir uno ya creado</button>}
            <button className="chip" onClick={() => onNuevo(dia)}><Icon name="plus" />Nuevo</button>
          </div>
        </div>
        {!delDia.length && <div className="vacio">Nada planificado este día.</div>}
        {delDia.map((p) => <FilaDia key={p.id} p={p} onAbrir={onAbrir} />)}
      </div>

      {menu && <MenuDia menu={menu} lista={porDia.get(menu.fecha) || []} onCerrar={() => setMenu(null)} onAbrir={onAbrir} onElegir={setEligiendo} onNuevo={onNuevo} />}
      {eligiendo && <ElegirPieza fecha={eligiendo} piezas={piezas} onCerrar={() => setEligiendo(null)} onElegida={onProgramar} onNuevo={onNuevo} />}
    </>
  );
}

function FilaDia({ p, onAbrir }) {
  const ig = p.ig_estado === 'publicado' ? 'publicado en Instagram' : p.ig_estado === 'error' ? 'error al publicar en Instagram' : p.publicar_ig ? 'se publica sola en Instagram' : null;
  const extra = [textoTipo(p.formato), p.hora, ig, p.archivos.length ? `🎞 ${p.archivos.length}` : null].filter(Boolean).join(' · ');
  return (
    <div className="fila-c" tabIndex={0} onClick={() => onAbrir(p)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(p)}>
      <Miniatura p={p} className="peque" />
      <div className="fila-c-txt"><b>{p.titulo}</b><small>{extra}</small></div>
      <MarcaLeadMagnet p={p} />
      <ChipEstado id={p.estado} />
    </div>
  );
}

// ---------- Lista: próximos, sin fecha y anteriores ----------
export function Lista({ piezas, cargando, onAbrir, onMover }) {
  const ESTADOS = useFases();
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
            {(p.publicar_ig || p.ig_estado) ? (
              p.ig_permalink
                ? <a href={p.ig_permalink} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="ig-ind publicado" title="Publicado en Instagram"><Icon name="instagram" size={13} /></a>
                : <span className={`ig-ind ${p.ig_estado || 'pendiente'}`} title={p.ig_estado === 'error' ? `Error al publicar: ${p.ig_error}` : p.ig_estado === 'procesando' ? 'Publicándose en Instagram…' : 'Se publicará sola en Instagram'}><Icon name="instagram" size={13} /></span>
            ) : null}
            <MarcaLeadMagnet p={p} />
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
  const ESTADOS = useFases();
  const [sobre, setSobre] = useState(null);
  const [editandoFases, setEditandoFases] = useState(false);
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
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="chip" onClick={() => setEditandoFases(true)}><Icon name="layers" />Editar fases</button>
          <button className="chip" onClick={onNuevaIdea}><Icon name="plus" />Nueva idea</button>
        </div>
      </div>
      {editandoFases && <EditorFases piezas={piezas} onClose={() => setEditandoFases(false)} />}
      <div className="kanban" style={{ gridTemplateColumns: `repeat(${ESTADOS.length}, minmax(148px, 1fr))` }}>
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
                    {p.formato && <span className="tag" style={{ background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent-texto)' }}>{textoTipo(p.formato)}</span>}
                    {p.plataformas && <span className="mini">{p.plataformas}</span>}
                    <MarcaLeadMagnet p={p} />
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
