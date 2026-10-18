import { useEffect, useMemo, useRef, useState } from 'react';
import { normaliza, useRecurso } from '../../lib/api.js';
import { num } from '../../lib/formato.js';
import Icon from '../../components/Icon.jsx';
import { celdasMes, diaCorto, diaLargo, hoyIso, mesDe, nombreMes, sumarMeses } from '../../lib/fechas.js';
import { EditorFases } from './Fases.jsx';
import { redDe } from '../../lib/redes.js';
import { ChipEstado, MarcaLeadMagnet, Miniatura, useFases, Modal, esStory, estadoDe, objetivoDe, textoTipo, tipoDe } from './comun.jsx';

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

// Elegir una pieza ya creada para un día: primero las de la biblioteca (sin fecha), o cualquiera.
// Se navega por las carpetas de la biblioteca (con sus subcarpetas) para encontrarla antes.
const enCarpeta = (p, c) => c === null || (c === '' ? !p.carpeta : p.carpeta === c || String(p.carpeta || '').startsWith(`${c}/`));
function ElegirPieza({ fecha, piezas, carpetas = [], onCerrar, onElegida, onNuevo }) {
  const sinFecha = piezas.filter((p) => !p.fecha);
  const [ambito, setAmbito] = useState(sinFecha.length ? 'biblioteca' : 'todas');
  const [carpeta, setCarpeta] = useState(null); // null = todas · '' = sin carpeta · ruta
  const [busca, setBusca] = useState('');
  const b = normaliza(busca.trim());
  const base = ambito === 'biblioteca' ? sinFecha : piezas.filter((p) => p.fecha !== fecha);
  const lista = base
    .filter((p) => enCarpeta(p, carpeta))
    .filter((p) => !b || normaliza(`${p.titulo}\n${p.caption || ''}\n${p.carpeta || ''}`).includes(b))
    .sort((x, y) => y.id - x.id);
  const cuenta = (c) => base.filter((p) => enCarpeta(p, c)).length;
  // Las carpetas que se enseñan: las de arriba o, dentro de una, sus subcarpetas (solo las que tienen algo)
  const visibles = carpetas.filter((c) => (carpeta ? c.padre === carpeta : !c.padre)).filter((c) => cuenta(c.nombre));
  const migas = carpeta ? carpeta.split('/').map((_, i, l) => l.slice(0, i + 1).join('/')) : [];
  const hayCarpetas = carpetas.some((c) => cuenta(c.nombre));
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
      {hayCarpetas && (
        <div className="elegir-carpetas">
          {carpeta ? (
            <nav className="carpeta-migas" aria-label="Carpeta">
              <button className="link-btn" onClick={() => setCarpeta(null)}>Todas</button><i>›</i>
              {migas.map((m, i) => (i === migas.length - 1
                ? <b key={m}>{m.split('/').at(-1)}</b>
                : <span key={m}><button className="link-btn" onClick={() => setCarpeta(m)}>{m.split('/').at(-1)}</button><i>›</i></span>))}
            </nav>
          ) : (
            <>
              <button className={`chip${carpeta === null ? ' on' : ''}`} onClick={() => setCarpeta(null)}>Todas <span className="cuenta">{base.length}</span></button>
              {cuenta('') > 0 && <button className="chip" onClick={() => setCarpeta('')}>Sin carpeta <span className="cuenta">{cuenta('')}</span></button>}
            </>
          )}
          {visibles.map((c) => (
            <button key={c.nombre} className="chip" onClick={() => setCarpeta(c.nombre)}><Icon name="folder" />{c.etiqueta || c.nombre} <span className="cuenta">{cuenta(c.nombre)}</span></button>
          ))}
        </div>
      )}
      <div className="elegir-grid">
        {lista.map((p) => (
          <button key={p.id} className="elegir-item" onClick={() => { onCerrar(); onElegida(p, fecha); }}>
            <Miniatura p={p} />
            <span>{p.titulo || 'Sin título'}</span>
            <small>{textoTipo(p.formato)}{p.fecha ? ` · ${diaCorto(p.fecha)}` : ''}{p.carpeta && p.carpeta !== carpeta ? ` · ${p.carpeta.split('/').at(-1)}` : ''}</small>
          </button>
        ))}
      </div>
      {!lista.length && <div className="vacio">{b ? 'Nada coincide con la búsqueda.' : carpeta !== null ? 'No hay nada en esta carpeta.' : ambito === 'biblioteca' ? 'La biblioteca está vacía.' : 'No hay más piezas.'}</div>}
      <div className="modal-pie">
        <span className="ayuda">¿No está? Créala ahora.</span>
        <button className="btn" onClick={() => { onCerrar(); onNuevo(fecha); }}><Icon name="plus" size={13} />Crear uno nuevo</button>
      </div>
    </Modal>
  );
}

// versiones: las de otras redes. Salen con su pieza (se cuentan en su chip) o, si tienen otro día, con su propio chip.
export function Calendario({ piezas, versiones = [], carpetas = [], dia, setDia, onAbrir, onNuevo, onMover, onProgramar }) {
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
  // Redes de cada pieza que salen con ella, y versiones con un día propio
  const { conPieza, aparte } = useMemo(() => {
    const porId = new Map(piezas.map((p) => [p.id, p]));
    const conPieza = new Map(), aparte = new Map();
    for (const v of versiones) {
      const p = porId.get(v.pieza_id);
      if (!p) continue;
      if (!v.fecha || v.fecha === p.fecha) conPieza.set(p.id, [...(conPieza.get(p.id) || []), v]);
      else aparte.set(v.fecha, [...(aparte.get(v.fecha) || []), { ...v, pieza: p }]);
    }
    return { conPieza, aparte };
  }, [piezas, versiones]);
  const redesTxt = (p) => (conPieza.get(p.id) || []).map((v) => `${redDe(v.red).corto}${v.estado === 'publicado' ? ' ✓' : ''}`).join(', ');
  const delDia = porDia.get(dia) || [];
  // La estrategia: de qué tipo es cada semana y qué toca cada día (Estrategia)
  const celdas = celdasMes(mes);
  const [plan] = useRecurso(`/api/estrategia/plan?desde=${celdas[0]}&dias=${celdas.length}`, null);
  const planDe = useMemo(() => new Map((Array.isArray(plan) ? plan : []).map((d) => [d.fecha, d])), [plan]);
  const toca = planDe.get(dia);

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
          {celdas.map((f) => {
            const lista = porDia.get(f) || [];
            const pl = planDe.get(f);
            const clase = ['cal-celda', mesDe(f) !== mes && 'fuera', f === dia && 'sel', sobre === f && 'sobre', pl && !pl.porDefecto && 'con-sem'].filter(Boolean).join(' ');
            return (
              <div
                key={f} className={clase} tabIndex={0} style={pl ? { '--sem': pl.color } : undefined}
                title={pl ? `${pl.semana}${pl.post ? ` · Post: ${pl.post}` : ''}${pl.stories ? ` · Stories: ${pl.stories}` : ''}${pl.directo ? ` · Directo: ${pl.directo}` : ''}` : undefined}
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
                      {conPieza.get(p.id)?.length ? <span className="cal-chip-redes" title={`También en: ${redesTxt(p)}`}>+{conPieza.get(p.id).length}</span> : null}
                    </button>
                  ))}
                  {lista.length > MAX_POR_DIA && <span className="cal-mas-n">+{lista.length - MAX_POR_DIA} más</span>}
                  {(aparte.get(f) || []).slice(0, 2).map((v) => (
                    <button key={`v${v.id}`} className={`cal-chip cal-chip-version${v.estado === 'publicado' ? ' hecha' : ''}`} style={{ '--c': redDe(v.red).color }} onClick={(e) => { e.stopPropagation(); onAbrir(v.pieza); }} title={`${redDe(v.red).nombre} · ${v.pieza.titulo}`}>
                      <span className="cal-chip-tipo">{redDe(v.red).corto}</span>{v.pieza.titulo}
                    </button>
                  ))}
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
        {toca && (toca.post || toca.stories || toca.directo) && (
          <a className="cal-toca" href="#estrategia" style={{ '--sem': toca.color }} title="Según tu estrategia (pestaña Estrategia)">
            <b>Toca · {toca.semana}{toca.objetivo ? ` (${toca.objetivo}${toca.detalle ? `: ${toca.detalle}` : ''})` : ''}</b>
            <span>{[toca.directo && `Directo: ${toca.directo}`, toca.post && `Post: ${toca.post}`, toca.stories && `Stories: ${toca.stories}`].filter(Boolean).join(' · ')}</span>
          </a>
        )}
        {!delDia.length && !(aparte.get(dia) || []).length && <div className="vacio">Nada planificado este día.</div>}
        {delDia.map((p) => <FilaDia key={p.id} p={p} redes={redesTxt(p)} onAbrir={onAbrir} />)}
        {(aparte.get(dia) || []).map((v) => (
          <div key={`v${v.id}`} className="fila-c" tabIndex={0} onClick={() => onAbrir(v.pieza)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(v.pieza)}>
            <span className="insignia" style={{ width: 28, height: 28, '--c': redDe(v.red).color }}>{redDe(v.red).corto.slice(0, 2).toUpperCase()}</span>
            <div className="fila-c-txt"><b>{v.pieza.titulo}</b><small>Versión para {redDe(v.red).nombre}{v.hora ? ` · ${v.hora}` : ''}</small></div>
            <span className="tag-estado" style={{ '--c': v.estado === 'publicado' ? 'var(--green)' : 'var(--orange)' }}>{v.estado === 'publicado' ? 'Publicada' : 'Pendiente'}</span>
          </div>
        ))}
      </div>

      {menu && <MenuDia menu={menu} lista={porDia.get(menu.fecha) || []} onCerrar={() => setMenu(null)} onAbrir={onAbrir} onElegir={setEligiendo} onNuevo={onNuevo} />}
      {eligiendo && <ElegirPieza fecha={eligiendo} piezas={piezas} carpetas={carpetas} onCerrar={() => setEligiendo(null)} onElegida={onProgramar} onNuevo={onNuevo} />}
    </>
  );
}

function FilaDia({ p, redes, onAbrir }) {
  const ig = p.ig_estado === 'publicado' ? 'publicado en Instagram' : p.ig_estado === 'error' ? 'error al publicar en Instagram' : p.publicar_ig ? 'se publica sola en Instagram' : null;
  const extra = [textoTipo(p.formato), p.hora, ig, p.archivos.length ? `🎞 ${p.archivos.length}` : null, redes && `también en ${redes}`].filter(Boolean).join(' · ');
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
// metricas: { piezaId: { alcance, … } } de las que están unidas a su publicación de Instagram
export function Lista({ piezas, metricas = {}, cargando, onAbrir, onMover }) {
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
          {p.pilar ? <span className="chip-pilar hide-sm" title="Pilar">{p.pilar}</span> : <span className="hide-sm" />}
          <span className="tipo-pildora">{textoTipo(p.formato)}</span>
          <span className="fila-fecha">{p.fecha ? `${diaCorto(p.fecha)}${p.hora ? ` · ${p.hora}` : ''}` : 'Sin fecha'}</span>
          <span className="fila-ind">
            {metricas[p.id]?.alcance != null && <span className="ind-alcance" title={`Alcance en Instagram · ${metricas[p.id].guardados ?? 0} guardados · ${metricas[p.id].compartidos ?? 0} compartidos`}><Icon name="eye" size={11} /> {num(metricas[p.id].alcance)}</span>}
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
                    {p.pilar && <span className="chip-pilar">{p.pilar}</span>}
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

// ---------- Banco de ideas: lo que aún es solo una idea, agrupado por pilar ----------
export function BancoIdeas({ piezas, onAbrir, onMover, onNuevaIdea }) {
  const ESTADOS = useFases();
  const [busca, setBusca] = useState('');
  const siguiente = ESTADOS[ESTADOS.findIndex((e) => e.id === 'idea') + 1];
  const ideas = useMemo(() => {
    const b = normaliza(busca.trim());
    return piezas.filter((p) => p.estado === 'idea' && (!b || normaliza(`${p.titulo}\n${p.pilar || ''}\n${p.gancho || ''}`).includes(b)))
      .sort((a, b2) => b2.id - a.id);
  }, [piezas, busca]);
  const grupos = useMemo(() => {
    const m = new Map();
    for (const p of ideas) { const k = p.pilar || ''; if (!m.has(k)) m.set(k, []); m.get(k).push(p); }
    return [...m.entries()].sort(([a, x], [b, y]) => (!a) - (!b) || y.length - x.length || a.localeCompare(b, 'es'));
  }, [ideas]);
  return (
    <div className="panel panel-pad banco-ideas">
      <div className="panel-head">
        <span className="label">Banco de ideas <span className="cuenta">{ideas.length}</span></span>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <div className="buscar-mini"><Icon name="search" size={13} /><input placeholder="Buscar idea" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
          <button className="chip" onClick={onNuevaIdea}><Icon name="plus" />Nueva idea</button>
        </div>
      </div>
      <p className="ayuda">Ideas sin desarrollar, separadas de lo que ya tiene archivos. Ponles pilar y objetivo y, cuando vayas a trabajarlas, pásalas a {siguiente?.label || 'la siguiente fase'}.</p>
      {!ideas.length && <div className="vacio">{busca ? 'Ninguna idea con ese texto.' : 'No hay ideas pendientes. Apúntalas desde aquí, desde el chat o por Telegram.'}</div>}
      {grupos.map(([pilar, lista]) => (
        <div key={pilar || '-'} className="banco-grupo">
          <div className="banco-grupo-head">{pilar || 'Sin pilar'} <span className="cuenta">{lista.length}</span></div>
          {lista.map((p) => {
            const o = objetivoDe(p.objetivo);
            return (
              <div key={p.id} className="banco-idea" tabIndex={0} onClick={() => onAbrir(p)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(p)}>
                <div className="fila-c-txt"><b>{p.titulo}</b>{p.gancho && <small>«{p.gancho}»</small>}</div>
                {o ? <span className="tag-estado" style={{ '--c': o.color }}>{o.label}</span> : <span />}
                {p.formato ? <span className="tipo-pildora">{textoTipo(p.formato)}</span> : <span />}
                {siguiente && <button className="btn btn-sec btn-mini" onClick={(e) => { e.stopPropagation(); onMover(p, { estado: siguiente.id }); }}>→ {siguiente.label}</button>}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
