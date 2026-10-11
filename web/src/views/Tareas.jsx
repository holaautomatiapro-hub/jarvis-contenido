import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api, useRecurso } from '../lib/api.js';
import { diaCorto, finDeMes, hoyIso, lunesDe, mesDe, nombreMes, rangoSemana, sumarDias, sumarMeses, textoPlazo } from '../lib/fechas.js';

export const ESTADOS_TAREA = [
  { id: 'sin_empezar', label: 'Sin empezar', color: 'var(--muted)', icon: 'clock' },
  { id: 'en_proceso', label: 'En proceso', color: 'var(--accent-2)', icon: 'bolt' },
  { id: 'terminada', label: 'Terminada', color: 'var(--green)', icon: 'checkCircle' },
];
export const PRIORIDADES = [
  { id: 'alta', label: 'Alta', color: 'var(--red)' },
  { id: 'media', label: 'Media', color: 'var(--orange)' },
  { id: 'baja', label: 'Baja', color: 'var(--blue)' },
];
const CATEGORIAS = [
  { id: 'contenido', label: 'Contenido', color: 'var(--purple)' },
  { id: 'ideas', label: 'Ideas', color: 'var(--blue)' },
  { id: 'analisis', label: 'Análisis', color: 'var(--orange)' },
  { id: 'administracion', label: 'Administración', color: 'var(--green)' },
  { id: 'aprendizaje', label: 'Aprendizaje', color: 'var(--cyan)' },
];
const PLAZOS = [
  { id: '', label: 'Sin fecha' },
  { id: 'dia', label: 'Día' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
];
const de = (lista, id) => lista.find((x) => x.id === id) || lista[0];

// Filtro de fechas: cada opción es un rango (desde, hasta) o un caso especial
function rangoFiltro(f, h = hoyIso()) {
  const lunes = lunesDe(h), mes = mesDe(h);
  switch (f.fecha) {
    case 'hoy': return { desde: h, hasta: h };
    case 'semana': return { desde: lunes, hasta: sumarDias(lunes, 6) };
    case 'proxima': return { desde: sumarDias(lunes, 7), hasta: sumarDias(lunes, 13) };
    case 'mes': return { desde: `${mes}-01`, hasta: finDeMes(mes) };
    case 'proximo_mes': { const m = sumarMeses(mes, 1); return { desde: `${m}-01`, hasta: finDeMes(m) }; }
    case 'rango': return { desde: f.desde || undefined, hasta: f.hasta || undefined };
    case 'atrasadas': return { atrasadas: '1' };
    case 'sin': return { sinFecha: '1' };
    default: return {};
  }
}
const FILTROS_FECHA = [
  { id: '', label: 'Cualquier fecha' },
  { id: 'atrasadas', label: 'Atrasadas' },
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Esta semana' },
  { id: 'proxima', label: 'La semana que viene' },
  { id: 'mes', label: 'Este mes' },
  { id: 'proximo_mes', label: 'El mes que viene' },
  { id: 'sin', label: 'Sin fecha' },
  { id: 'rango', label: 'Entre dos fechas…' },
];
const FILTRO_VACIO = { estado: [], prioridad: [], fecha: '', desde: '', hasta: '', texto: '' };

const leerLocal = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const guardarLocal = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin localStorage */ } };

function Prioridad({ id, corta }) {
  const p = de(PRIORIDADES, id);
  return (
    <span className="prio" style={{ '--c': p.color }} title={`Prioridad ${p.label.toLowerCase()}`}>
      <i />{corta ? p.label[0] : p.label}
    </span>
  );
}

function Plazo({ t }) {
  if (!t.plazo_tipo) return <span className="plazo apagado"><Icon name="calendar" size={11} />Sin fecha</span>;
  return (
    <span className={`plazo${t.atrasada ? ' atrasada' : ''}`} title={t.atrasada ? 'Atrasada: la fecha límite ya pasó' : 'Fecha límite'}>
      <Icon name="calendar" size={11} />{textoPlazo(t)}
    </span>
  );
}

// ---------- Ventana para ver, modificar o eliminar una tarea ----------
function opcionesSemana(actual) {
  const h = hoyIso(), lunes = lunesDe(h);
  const lista = Array.from({ length: 30 }, (_, i) => sumarDias(lunes, (i - 3) * 7));
  if (actual && !lista.includes(actual)) lista.unshift(actual);
  return lista.map((l) => ({ id: l, label: `${rangoSemana(l)}${l === lunes ? ' (esta semana)' : l === sumarDias(lunes, 7) ? ' (la que viene)' : ''}` }));
}
function opcionesMes(actual) {
  const m = mesDe(hoyIso());
  const lista = Array.from({ length: 16 }, (_, i) => sumarMeses(m, i - 2));
  if (actual && !lista.includes(actual)) lista.unshift(actual);
  return lista.map((x) => ({ id: x, label: `${nombreMes(x)}${x === m ? ' (este mes)' : ''}` }));
}

function EditorTarea({ tarea, onClose, onGuardada }) {
  const nueva = !tarea.id;
  const [t, setT] = useState(() => ({
    titulo: tarea.titulo || '',
    descripcion: tarea.descripcion || '',
    estado: tarea.estado || 'sin_empezar',
    prioridad: tarea.prioridad || 'media',
    categoria: tarea.categoria || 'contenido',
    plazo_tipo: tarea.plazo_tipo ?? (nueva ? 'dia' : ''),
    dia: tarea.plazo_tipo === 'dia' ? tarea.plazo_desde : hoyIso(),
    semana: tarea.plazo_tipo === 'semana' ? tarea.plazo_desde : lunesDe(hoyIso()),
    mes: tarea.plazo_tipo === 'mes' ? mesDe(tarea.plazo_desde) : mesDe(hoyIso()),
  }));
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [editando, setEditando] = useState(nueva);
  const titulo = useRef(null);
  const cambia = (k) => (e) => setT((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));

  useEffect(() => {
    if (editando) titulo.current?.focus();
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [editando, onClose]);

  const guardar = async (e) => {
    e.preventDefault();
    if (enviando) return;
    if (!t.titulo.trim()) return setError('Ponle un título.');
    setEnviando(true); setError('');
    const plazo = { dia: t.dia, semana: t.semana, mes: t.mes }[t.plazo_tipo];
    const body = { titulo: t.titulo, descripcion: t.descripcion, estado: t.estado, prioridad: t.prioridad, categoria: t.categoria, plazo_tipo: t.plazo_tipo || null, plazo };
    try {
      const r = nueva ? await api('/api/tareas', { method: 'POST', body }) : await api(`/api/tareas/${tarea.id}`, { method: 'PATCH', body });
      onGuardada(r); onClose();
    } catch (err) { setError(err.message); setEnviando(false); }
  };
  const eliminar = async () => {
    if (!window.confirm(`¿Eliminar la tarea «${tarea.titulo}»?`)) return;
    try { await api(`/api/tareas/${tarea.id}`, { method: 'DELETE' }); onGuardada(null); onClose(); }
    catch (err) { setError(err.message); }
  };

  // Ver: la tarea tal cual, con botones para modificarla o eliminarla
  if (!editando) {
    const est = de(ESTADOS_TAREA, tarea.estado);
    return (
      <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        <div className="panel modal tarea-ficha" role="dialog" aria-modal="true" aria-label="Tarea">
          <div className="panel-head">
            <span className="estado-tarea" style={{ '--c': est.color }}><Icon name={est.icon} size={12} />{est.label}</span>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
          </div>
          <h2 className="ficha-titulo">{tarea.titulo}</h2>
          {tarea.descripcion ? <p className="ficha-desc">{tarea.descripcion}</p> : <p className="ficha-desc apagado">Sin descripción.</p>}
          <dl className="ficha-datos">
            <div><dt>Prioridad</dt><dd><Prioridad id={tarea.prioridad} /></dd></div>
            <div><dt>Fecha límite</dt><dd><Plazo t={tarea} />{tarea.plazo_tipo === 'semana' && <small>{rangoSemana(tarea.plazo_desde)}</small>}{tarea.plazo_tipo === 'dia' && <small>{diaCorto(tarea.plazo_desde)}</small>}</dd></div>
            <div><dt>Categoría</dt><dd><span className="dot" style={{ background: de(CATEGORIAS, tarea.categoria).color }} /> {de(CATEGORIAS, tarea.categoria).label}</dd></div>
            <div><dt>Creada</dt><dd>{tarea.creado?.slice(0, 16).replace(' ', ' · ')}{tarea.origen === 'hermes' && <> · <Icon name="telegram" size={11} color="var(--cyan)" /> Telegram</>}</dd></div>
            {tarea.completada && <div><dt>Terminada</dt><dd>{tarea.completada.slice(0, 16).replace(' ', ' · ')}</dd></div>}
          </dl>
          {error && <div className="aviso-error">{error}</div>}
          <div className="modal-pie">
            <button type="button" className="btn btn-sec peligro" onClick={eliminar}>Eliminar</button>
            <button type="button" className="btn" onClick={() => setEditando(true)}><Icon name="pen" size={13} />Modificar</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-fondo" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="panel modal tarea-editor" onSubmit={guardar} role="dialog" aria-modal="true" aria-label={nueva ? 'Nueva tarea' : 'Modificar tarea'}>
        <div className="panel-head">
          <span className="label">{nueva ? 'Nueva tarea' : 'Modificar tarea'}</span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <label className="campo-et">Título</label>
        <input ref={titulo} className="campo" value={t.titulo} onChange={cambia('titulo')} placeholder="Grabar el reel de los 3 errores" maxLength={200} />
        <label className="campo-et">Descripción</label>
        <textarea className="campo" rows={3} value={t.descripcion} onChange={cambia('descripcion')} placeholder="Detalles, enlaces, lo que haga falta…" />

        <label className="campo-et">Estado</label>
        <div className="seg seg-ancho">
          {ESTADOS_TAREA.map((e) => <button type="button" key={e.id} className={t.estado === e.id ? 'on' : ''} onClick={() => cambia('estado')(e.id)}><Icon name={e.icon} />{e.label}</button>)}
        </div>

        <label className="campo-et">Prioridad</label>
        <div className="seg seg-ancho">
          {PRIORIDADES.map((p) => (
            <button type="button" key={p.id} className={t.prioridad === p.id ? 'on' : ''} style={t.prioridad === p.id ? { background: p.color, color: '#fff' } : undefined} onClick={() => cambia('prioridad')(p.id)}>
              <span className="punto" style={{ background: t.prioridad === p.id ? '#fff' : p.color }} />{p.label}
            </button>
          ))}
        </div>

        <label className="campo-et">Fecha de finalización</label>
        <div className="seg seg-ancho">
          {PLAZOS.map((p) => <button type="button" key={p.id || 'sin'} className={t.plazo_tipo === p.id ? 'on' : ''} onClick={() => cambia('plazo_tipo')(p.id)}>{p.label}</button>)}
        </div>
        {t.plazo_tipo === 'dia' && (
          <div className="fila plazo-fila">
            <input type="date" className="campo" value={t.dia} onChange={cambia('dia')} required aria-label="Día" />
            <button type="button" className="chip" onClick={() => cambia('dia')(hoyIso())}>Hoy</button>
            <button type="button" className="chip" onClick={() => cambia('dia')(sumarDias(hoyIso(), 1))}>Mañana</button>
          </div>
        )}
        {t.plazo_tipo === 'semana' && (
          <select className="campo plazo-fila" value={t.semana} onChange={cambia('semana')} aria-label="Semana">
            {opcionesSemana(t.semana).map((o) => <option key={o.id} value={o.id}>Semana del {o.label}</option>)}
          </select>
        )}
        {t.plazo_tipo === 'mes' && (
          <select className="campo plazo-fila" value={t.mes} onChange={cambia('mes')} aria-label="Mes">
            {opcionesMes(t.mes).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        {!t.plazo_tipo && <div className="ayuda plazo-fila">Sin fecha límite: la verás en «Sin fecha» y en el tablero.</div>}

        <label className="campo-et">Categoría</label>
        <select className="campo" value={t.categoria} onChange={cambia('categoria')}>
          {CATEGORIAS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>

        {error && <div className="aviso-error" style={{ marginTop: 10 }}>{error}</div>}
        <div className="modal-pie">
          {nueva ? <span /> : <button type="button" className="btn btn-sec peligro" onClick={eliminar}>Eliminar</button>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-sec" onClick={nueva ? onClose : () => setEditando(false)}>Cancelar</button>
            <button className="btn" disabled={enviando}>{enviando ? 'Guardando…' : nueva ? 'Crear tarea' : 'Guardar'}</button>
          </div>
        </div>
      </form>
    </div>
  );
}

// ---------- Tarjeta (tablero) y fila (lista) ----------
function TarjetaTarea({ t, onAbrir, onMover, onArrastre }) {
  const idx = ESTADOS_TAREA.findIndex((e) => e.id === t.estado);
  return (
    <div
      className={`tarjeta tarjeta-tarea${t.estado === 'terminada' ? ' terminada' : ''}`}
      draggable
      tabIndex={0}
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(t.id)); onArrastre(t.id); }}
      onClick={() => onAbrir(t)}
      onKeyDown={(e) => e.key === 'Enter' && onAbrir(t)}
      style={{ '--c': de(PRIORIDADES, t.prioridad).color }}
    >
      <div className="tarjeta-titulo">{t.titulo}</div>
      {t.descripcion && <div className="tarjeta-desc">{t.descripcion}</div>}
      <div className="tarjeta-meta">
        <Prioridad id={t.prioridad} />
        <Plazo t={t} />
        <span className="dot" style={{ background: de(CATEGORIAS, t.categoria).color }} title={de(CATEGORIAS, t.categoria).label} />
        {t.origen === 'hermes' && <Icon name="telegram" size={11} color="var(--cyan)" />}
      </div>
      <div className="tarjeta-acciones" onClick={(e) => e.stopPropagation()}>
        <button disabled={idx === 0} onClick={() => onMover(t, ESTADOS_TAREA[idx - 1].id)} aria-label="Mover al estado anterior">←</button>
        <button disabled={idx === ESTADOS_TAREA.length - 1} onClick={() => onMover(t, ESTADOS_TAREA[idx + 1].id)} aria-label="Mover al estado siguiente">→</button>
      </div>
    </div>
  );
}

function FilaTarea({ t, onAbrir, onMover }) {
  const terminada = t.estado === 'terminada';
  return (
    <div className={`tarea-fila${terminada ? ' terminada' : ''}`} tabIndex={0} onClick={() => onAbrir(t)} onKeyDown={(e) => e.key === 'Enter' && onAbrir(t)}>
      <button className="check" onClick={(e) => { e.stopPropagation(); onMover(t, terminada ? 'sin_empezar' : 'terminada'); }} aria-label={terminada ? 'Marcar sin terminar' : 'Marcar terminada'}>
        {terminada ? <Icon name="check" size={12} stroke={3} /> : null}
      </button>
      <div className="tarea-fila-txt">
        <b>{t.titulo}</b>
        {t.descripcion && <small>{t.descripcion}</small>}
      </div>
      <Prioridad id={t.prioridad} />
      <Plazo t={t} />
      <select
        className="estado-select"
        value={t.estado}
        style={{ '--c': de(ESTADOS_TAREA, t.estado).color }}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onMover(t, e.target.value)}
        aria-label="Estado"
      >
        {ESTADOS_TAREA.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
      </select>
      <span className="dot" style={{ background: de(CATEGORIAS, t.categoria).color }} title={de(CATEGORIAS, t.categoria).label} />
    </div>
  );
}

// ---------- Vista ----------
export default function Tareas() {
  const [filtro, setFiltro] = useState(() => ({ ...FILTRO_VACIO, ...leerLocal('tareas_filtro', {}) }));
  const [vista, setVista] = useState(() => leerLocal('tareas_vista', 'tablero'));
  useEffect(() => guardarLocal('tareas_filtro', filtro), [filtro]);
  useEffect(() => guardarLocal('tareas_vista', vista), [vista]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (filtro.estado.length) p.set('estado', filtro.estado.join(','));
    if (filtro.prioridad.length) p.set('prioridad', filtro.prioridad.join(','));
    for (const [k, v] of Object.entries(rangoFiltro(filtro))) if (v) p.set(k, v);
    if (filtro.texto.trim()) p.set('texto', filtro.texto.trim());
    return p.toString();
  }, [filtro]);
  const [data, recargar, errorCarga, setData] = useRecurso(`/api/tareas/lista${qs ? `?${qs}` : ''}`, { tareas: [], resumen: null });
  const [abierta, setAbierta] = useState(null);
  const [rapida, setRapida] = useState({ titulo: '', prioridad: 'media', plazo: 'hoy' });
  const [error, setError] = useState('');
  const [sobre, setSobre] = useState(null);
  const arrastrando = useRef(null);

  const toggle = (k, id) => setFiltro((f) => ({ ...f, [k]: f[k].includes(id) ? f[k].filter((x) => x !== id) : [...f[k], id] }));
  const hayFiltro = filtro.estado.length || filtro.prioridad.length || filtro.fecha || filtro.texto;

  const mover = useCallback(async (t, estado) => {
    if (t.estado === estado) return;
    setData((d) => ({ ...d, tareas: d.tareas.map((x) => (x.id === t.id ? { ...x, estado, atrasada: estado !== 'terminada' && x.atrasada } : x)) }));
    try { await api(`/api/tareas/${t.id}`, { method: 'PATCH', body: { estado } }); setError(''); }
    catch (e) { setError(e.message); }
    finally { recargar(); }
  }, [recargar, setData]);

  const anadir = async (e) => {
    e.preventDefault();
    if (!rapida.titulo.trim()) return;
    const h = hoyIso();
    const plazo = {
      hoy: { plazo_tipo: 'dia', plazo: h },
      manana: { plazo_tipo: 'dia', plazo: sumarDias(h, 1) },
      semana: { plazo_tipo: 'semana', plazo: h },
      mes: { plazo_tipo: 'mes', plazo: mesDe(h) },
      sin: { plazo_tipo: null },
    }[rapida.plazo];
    try {
      await api('/api/tareas', { method: 'POST', body: { titulo: rapida.titulo, prioridad: rapida.prioridad, ...plazo } });
      setRapida((r) => ({ ...r, titulo: '' }));
      setError('');
      recargar();
    } catch (err) { setError(err.message); }
  };

  const soltar = (estado) => (e) => {
    e.preventDefault();
    setSobre(null);
    const id = Number(e.dataTransfer.getData('text/plain') || arrastrando.current);
    const t = data.tareas.find((x) => x.id === id);
    if (t) mover(t, estado);
  };

  const r = data.resumen;
  const contadores = r ? [
    { label: 'Pendientes', valor: r.pendientes, color: 'var(--accent-2)', icon: 'tasks', filtro: { estado: ['sin_empezar', 'en_proceso'] } },
    { label: 'En proceso', valor: r.porEstado.en_proceso, color: 'var(--cyan)', icon: 'bolt', filtro: { estado: ['en_proceso'] } },
    { label: 'Para hoy', valor: r.hoy, color: 'var(--orange)', icon: 'calendar', filtro: { estado: ['sin_empezar', 'en_proceso'], fecha: 'hoy' } },
    { label: 'Atrasadas', valor: r.atrasadas, color: 'var(--red)', icon: 'clock', filtro: { fecha: 'atrasadas' } },
    { label: 'Prioridad alta', valor: r.altas, color: 'var(--pink)', icon: 'target', filtro: { estado: ['sin_empezar', 'en_proceso'], prioridad: ['alta'] } },
    { label: 'Terminadas', valor: r.porEstado.terminada, color: 'var(--green)', icon: 'checkCircle', filtro: { estado: ['terminada'] } },
  ] : [];

  return (
    <section className="tareas2">
      <div className="panel panel-pad tareas-cabecera">
        <div>
          <div className="label">Tareas</div>
          <h1 className="vista-titulo">Lo que tienes que hacer</h1>
        </div>
        <div className="tareas-kpis">
          {contadores.map((c) => (
            <button key={c.label} className="tarea-kpi" style={{ '--c': c.color }} onClick={() => setFiltro({ ...FILTRO_VACIO, ...c.filtro })} title={`Ver ${c.label.toLowerCase()}`}>
              <Icon name={c.icon} size={14} color={c.color} />
              <b>{c.valor}</b>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
        <button className="btn" onClick={() => setAbierta({})}><Icon name="plus" size={14} />Nueva tarea</button>
      </div>

      <div className="panel panel-pad">
        <form className="rapida" onSubmit={anadir}>
          <Icon name="plus" size={15} color="var(--muted)" />
          <input className="rapida-input" placeholder="Añade una tarea y pulsa Enter…" value={rapida.titulo} onChange={(e) => setRapida({ ...rapida, titulo: e.target.value })} maxLength={200} aria-label="Nueva tarea rápida" />
          <select className="campo" value={rapida.plazo} onChange={(e) => setRapida({ ...rapida, plazo: e.target.value })} aria-label="Fecha límite">
            <option value="hoy">Hoy</option>
            <option value="manana">Mañana</option>
            <option value="semana">Esta semana</option>
            <option value="mes">Este mes</option>
            <option value="sin">Sin fecha</option>
          </select>
          <select className="campo" value={rapida.prioridad} onChange={(e) => setRapida({ ...rapida, prioridad: e.target.value })} aria-label="Prioridad">
            {PRIORIDADES.map((p) => <option key={p.id} value={p.id}>Prioridad {p.label.toLowerCase()}</option>)}
          </select>
          <button className="btn btn-sec">Añadir</button>
        </form>

        <div className="filtros">
          <div className="filtro-grupo">
            <span className="label">Estado</span>
            {ESTADOS_TAREA.map((e) => (
              <button key={e.id} className={`chip filtro-chip${filtro.estado.includes(e.id) ? ' on' : ''}`} style={{ '--c': e.color }} onClick={() => toggle('estado', e.id)}>
                <span className="punto" style={{ background: e.color }} />{e.label}
              </button>
            ))}
          </div>
          <div className="filtro-grupo">
            <span className="label">Prioridad</span>
            {PRIORIDADES.map((p) => (
              <button key={p.id} className={`chip filtro-chip${filtro.prioridad.includes(p.id) ? ' on' : ''}`} style={{ '--c': p.color }} onClick={() => toggle('prioridad', p.id)}>
                <span className="punto" style={{ background: p.color }} />{p.label}
              </button>
            ))}
          </div>
          <div className="filtro-grupo">
            <span className="label">Fecha</span>
            <select className="campo filtro-select" value={filtro.fecha} onChange={(e) => setFiltro({ ...filtro, fecha: e.target.value })} aria-label="Filtrar por fecha">
              {FILTROS_FECHA.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
            {filtro.fecha === 'rango' && (
              <>
                <input type="date" className="campo filtro-select" value={filtro.desde} onChange={(e) => setFiltro({ ...filtro, desde: e.target.value })} aria-label="Desde" />
                <span className="ayuda">a</span>
                <input type="date" className="campo filtro-select" value={filtro.hasta} onChange={(e) => setFiltro({ ...filtro, hasta: e.target.value })} aria-label="Hasta" />
              </>
            )}
          </div>
          <div className="filtro-grupo filtro-derecha">
            <div className="buscar-mini">
              <Icon name="search" size={13} />
              <input placeholder="Buscar" value={filtro.texto} onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} aria-label="Buscar tareas" />
            </div>
            {hayFiltro ? <button className="link-btn" onClick={() => setFiltro(FILTRO_VACIO)}>Quitar filtros</button> : null}
            <div className="seg">
              <button className={vista === 'tablero' ? 'on' : ''} onClick={() => setVista('tablero')}><Icon name="skills" />Tablero</button>
              <button className={vista === 'lista' ? 'on' : ''} onClick={() => setVista('lista')}><Icon name="tasks" />Lista</button>
            </div>
          </div>
        </div>
        {(error || errorCarga) && <div className="aviso-error">{error || errorCarga}</div>}

        {vista === 'tablero' ? (
          <div className="kanban kanban-3">
            {ESTADOS_TAREA.map((c) => {
              const lista = data.tareas.filter((t) => t.estado === c.id);
              const oculta = filtro.estado.length && !filtro.estado.includes(c.id);
              return (
                <div
                  key={c.id}
                  className={`columna${sobre === c.id ? ' sobre' : ''}${oculta ? ' apagada' : ''}`}
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
                  {lista.map((t) => <TarjetaTarea key={t.id} t={t} onAbrir={setAbierta} onMover={mover} onArrastre={(id) => { arrastrando.current = id; }} />)}
                  {!lista.length && <div className="vacio mini-vacio">{oculta ? 'Oculto por el filtro' : 'Arrastra aquí'}</div>}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="tareas-lista">
            {data.tareas.map((t) => <FilaTarea key={t.id} t={t} onAbrir={setAbierta} onMover={mover} />)}
            {!data.tareas.length && <div className="vacio">{hayFiltro ? 'Ninguna tarea coincide con los filtros.' : 'No hay tareas. Añade una arriba o pídesela a JARVIS por Telegram.'}</div>}
          </div>
        )}
      </div>

      {abierta && <EditorTarea key={abierta.id || 'nueva'} tarea={abierta} onClose={() => setAbierta(null)} onGuardada={() => recargar()} />}
    </section>
  );
}
