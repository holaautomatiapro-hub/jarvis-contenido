import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import Sparkline from '../components/Sparkline.jsx';
import Sphere from '../components/Sphere.jsx';
import Mascota from '../components/Mascota.jsx';
import { api, useRecurso } from '../lib/api.js';
import { diaLargo } from '../lib/fechas.js';
import { Plazo, Prioridad } from './Tareas.jsx';
import { BotonCopiar } from './contenido/comun.jsx';

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
      <div className="kpi-spark"><Sparkline data={k.series} color={k.color} /></div>
    </div>
  );
}

// ---------- Qué se publica hoy ----------
const ESTADO_IG = {
  publicado: { label: 'Publicado en IG', color: 'var(--green)' },
  publicando: { label: 'Publicando…', color: 'var(--cyan)' },
  programado: { label: 'Se publica sola', color: 'var(--accent-2)' },
  error: { label: 'Error al publicar', color: 'var(--red)' },
};
const COLOR_ESTADO = { idea: 'var(--blue)', guion: 'var(--purple)', grabar: 'var(--orange)', editar: 'var(--pink)', listo: 'var(--cyan)', publicado: 'var(--green)', pendiente: 'var(--orange)' };

function PublicaHoy({ items = [], ir }) {
  const hechas = items.filter((p) => p.estado === 'publicado').length;
  return (
    <div className="panel panel-pad">
      <div className="panel-head">
        <span className="label">Hoy se publica</span>
        {items.length ? <span className="ayuda">{hechas}/{items.length} publicado</span> : null}
      </div>
      {!items.length && <div className="vacio mini-vacio">Nada programado para hoy. Ponle fecha a una pieza en Contenido.</div>}
      <div className="hoy-lista">
        {items.map((p) => {
          const ig = p.instagram && ESTADO_IG[p.instagram];
          return (
            <div key={`${p.tipo}-${p.id}`} className="hoy-fila" role="button" tabIndex={0} onClick={() => ir?.(p.tipo === 'version' ? 'publicar' : 'contenido')} onKeyDown={(e) => e.key === 'Enter' && ir?.(p.tipo === 'version' ? 'publicar' : 'contenido')} title={p.error || 'Abrir'}>
              <span className="time">{p.hora || '—'}</span>
              <span className="hoy-txt">
                <b>{p.titulo}</b>
                <small>{p.tipo === 'version' ? p.red.replace(/_/g, ' ') : p.formato || 'Pieza'}</small>
              </span>
              <span className="hoy-estados">
                <span className="tag-estado" style={{ '--c': COLOR_ESTADO[p.estado] || 'var(--muted)' }}>{p.etiqueta}</span>
                {ig && <span className="tag-estado" style={{ '--c': ig.color }}>{ig.label}</span>}
                {p.leadmagnet != null && (p.leadmagnet ? <BotonCopiar texto={p.leadmagnet} etiqueta="Copiar lead magnet" className="tag-estado lm-copiar" /> : <span className="tag-estado" style={{ '--c': 'var(--orange)' }}>Lead magnet sin enlace</span>)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------- Tareas: hoy, semana, mes y atrasadas ----------
const PESTANAS_TAREAS = [
  { id: 'hoy', label: 'Hoy' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
  { id: 'atrasadas', label: 'Atrasadas' },
];

function TareasPanel({ tareas, ir, alCambiar }) {
  const t = tareas || { hoy: [], semana: [], mes: [], atrasadas: [] };
  const [pestana, setPestana] = useState('hoy');
  const [error, setError] = useState(null);
  const lista = t[pestana] || [];
  const pendientes = (k) => (t[k] || []).filter((x) => x.estado !== 'terminada').length;
  const marcar = async (x) => {
    setError(null);
    try { await api(`/api/tareas/${x.id}`, { method: 'PATCH', body: { hecha: x.estado !== 'terminada' } }); alCambiar(); } catch (e) { setError(e.message); }
  };
  return (
    <div className="panel panel-pad">
      <div className="panel-head">
        <span className="label">Tareas</span>
        <button className="link-btn" onClick={() => ir?.('tareas')}>Ver todas</button>
      </div>
      <div className="seg seg-ancho seg-mini inicio-seg">
        {PESTANAS_TAREAS.map((p) => (
          <button key={p.id} className={`${pestana === p.id ? 'on' : ''}${p.id === 'atrasadas' && pendientes('atrasadas') ? ' rojo' : ''}`} onClick={() => setPestana(p.id)}>
            {p.label} <span className="seg-n">{pendientes(p.id)}</span>
          </button>
        ))}
      </div>
      {error && <div className="aviso-error">{error}</div>}
      <div className="inicio-tareas">
        {lista.map((x) => {
          const terminada = x.estado === 'terminada';
          return (
            <div key={x.id} className={`tarea-fila tarea-mini${terminada ? ' terminada' : ''}`}>
              <button className="check" onClick={() => marcar(x)} aria-label={terminada ? 'Marcar sin terminar' : 'Marcar terminada'}>
                {terminada ? <Icon name="check" size={12} stroke={3} /> : null}
              </button>
              <div className="tarea-fila-txt"><b>{x.titulo}</b></div>
              <Prioridad id={x.prioridad} corta />
              <Plazo t={x} />
            </div>
          );
        })}
        {!lista.length && <div className="vacio mini-vacio">{pestana === 'atrasadas' ? 'Nada atrasado. ¡Bien!' : 'No hay tareas para este plazo.'}</div>}
      </div>
    </div>
  );
}

// ---------- Recordatorios diarios ----------
const DIAS = [
  { n: 1, l: 'L' }, { n: 2, l: 'M' }, { n: 3, l: 'X' }, { n: 4, l: 'J' }, { n: 5, l: 'V' }, { n: 6, l: 'S' }, { n: 0, l: 'D' },
];
const textoDias = (dias) => {
  const s = [...dias].sort().join(',');
  if (s === '0,1,2,3,4,5,6') return 'Todos los días';
  if (s === '1,2,3,4,5') return 'De lunes a viernes';
  if (s === '0,6') return 'Fines de semana';
  return DIAS.filter((d) => dias.includes(d.n)).map((d) => d.l).join(' ');
};

function ElegirDias({ dias, onChange }) {
  const cambiar = (n) => onChange(dias.includes(n) ? dias.filter((d) => d !== n) : [...dias, n]);
  return (
    <div className="dias-chips" role="group" aria-label="Días">
      {DIAS.map((d) => (
        <button type="button" key={d.n} className={dias.includes(d.n) ? 'on' : ''} onClick={() => cambiar(d.n)} aria-pressed={dias.includes(d.n)}>{d.l}</button>
      ))}
    </div>
  );
}

function EditarRecordatorio({ r, alCambiar, setError }) {
  const [f, setF] = useState({ texto: r.texto, dias: r.dias, hora: r.hora || '' });
  const cambiado = f.texto !== r.texto || f.hora !== (r.hora || '') || [...f.dias].sort().join() !== [...r.dias].sort().join();
  const guardar = async (e) => {
    e.preventDefault();
    try { await api(`/api/recordatorios/${r.id}`, { method: 'PATCH', body: f }); setError(null); alCambiar(); } catch (err) { setError(err.message); }
  };
  const borrar = async () => {
    if (!confirm(`¿Eliminar el recordatorio «${r.texto}»?`)) return;
    try { await api(`/api/recordatorios/${r.id}`, { method: 'DELETE' }); setError(null); alCambiar(); } catch (err) { setError(err.message); }
  };
  return (
    <form className="recordatorio-edit" onSubmit={guardar}>
      <input className="campo" value={f.texto} onChange={(e) => setF({ ...f, texto: e.target.value })} maxLength={200} aria-label="Recordatorio" />
      <div className="recordatorio-edit-fila">
        <ElegirDias dias={f.dias} onChange={(dias) => setF({ ...f, dias })} />
        <input className="campo hora" type="time" value={f.hora} onChange={(e) => setF({ ...f, hora: e.target.value })} aria-label="Hora" />
        {cambiado && <button className="btn btn-sec btn-mini">Guardar</button>}
        <button type="button" className="icon-btn mini" onClick={borrar} aria-label="Eliminar recordatorio" title="Eliminar">✕</button>
      </div>
    </form>
  );
}

function Recordatorios({ hoy = [], alCambiar }) {
  const [editando, setEditando] = useState(false);
  const [todos, recargarTodos] = useRecurso(editando ? '/api/recordatorios' : null, { todos: [] });
  const [nuevo, setNuevo] = useState({ texto: '', dias: [0, 1, 2, 3, 4, 5, 6], hora: '' });
  const [error, setError] = useState(null);
  const cambio = () => { alCambiar(); if (editando) recargarTodos(); };
  const marcar = async (r) => {
    try { await api(`/api/recordatorios/${r.id}/hecho`, { method: 'POST', body: { hecho: !r.hecho } }); setError(null); alCambiar(); } catch (e) { setError(e.message); }
  };
  const crear = async (e) => {
    e.preventDefault();
    if (!nuevo.texto.trim()) return;
    try {
      await api('/api/recordatorios', { method: 'POST', body: { ...nuevo, hora: nuevo.hora || null } });
      setNuevo({ ...nuevo, texto: '', hora: '' });
      setError(null);
      cambio();
    } catch (err) { setError(err.message); }
  };
  const hechos = hoy.filter((r) => r.hecho).length;
  return (
    <div className="panel panel-pad">
      <div className="panel-head">
        <span className="label">Recordatorios de hoy</span>
        <span className="panel-head-der">
          {hoy.length ? <span className="ayuda">{hechos}/{hoy.length}</span> : null}
          <button className="link-btn" onClick={() => setEditando(!editando)}>{editando ? 'Listo' : 'Editar'}</button>
        </span>
      </div>
      {error && <div className="aviso-error">{error}</div>}
      {editando ? (
        <div className="recordatorios-todos">
          {todos.todos.map((r) => <EditarRecordatorio key={`${r.id}-${r.texto}-${r.dias.join()}-${r.hora}`} r={r} alCambiar={cambio} setError={setError} />)}
          {!todos.todos.length && <div className="vacio mini-vacio">Aún no tienes recordatorios.</div>}
        </div>
      ) : (
        <div className="inicio-tareas">
          {hoy.map((r) => (
            <div key={r.id} className={`tarea-fila tarea-mini${r.hecho ? ' terminada' : ''}`}>
              <button className="check" onClick={() => marcar(r)} aria-label={r.hecho ? 'Marcar sin hacer' : 'Marcar hecho'}>
                {r.hecho ? <Icon name="check" size={12} stroke={3} /> : null}
              </button>
              <div className="tarea-fila-txt"><b>{r.texto}</b><small>{textoDias(r.dias)}</small></div>
              {r.hora ? <span className="plazo"><Icon name="clock" size={11} />{r.hora}</span> : <span />}
            </div>
          ))}
          {!hoy.length && <div className="vacio mini-vacio">Nada para hoy. Añade lo que haces cada día: «subir una story», «responder DMs»…</div>}
        </div>
      )}
      <form className="recordatorio-nuevo" onSubmit={crear}>
        <input className="campo" placeholder="Nuevo recordatorio…" value={nuevo.texto} onChange={(e) => setNuevo({ ...nuevo, texto: e.target.value })} maxLength={200} aria-label="Nuevo recordatorio" />
        <div className="recordatorio-edit-fila">
          <ElegirDias dias={nuevo.dias} onChange={(dias) => setNuevo({ ...nuevo, dias })} />
          <input className="campo hora" type="time" value={nuevo.hora} onChange={(e) => setNuevo({ ...nuevo, hora: e.target.value })} aria-label="Hora (opcional)" />
          <button className="btn btn-sec btn-mini" disabled={!nuevo.texto.trim() || !nuevo.dias.length}><Icon name="plus" size={12} />Añadir</button>
        </div>
      </form>
    </div>
  );
}

// ---------- Meta Ads: últimos 7 días ----------
const euro = (v, moneda = 'EUR') => (v == null ? '—' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: moneda || 'EUR', maximumFractionDigits: v < 10 ? 2 : 0 }).format(v));
const num = (v) => (v == null ? '—' : new Intl.NumberFormat('es-ES', { notation: v >= 10000 ? 'compact' : 'standard' }).format(v));
const haceCuanto = (iso) => {
  if (!iso) return '';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `hace ${h} h` : new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function AdsPanel({ ir }) {
  const [r, recargar] = useRecurso('/api/inicio/ads', null);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const actualizar = async () => {
    setCargando(true); setError(null);
    try { await api('/api/ads/actualizar', { method: 'POST', body: { dias: 7 } }); recargar(); } catch (e) { setError(e.message); } finally { setCargando(false); }
  };
  const d = r?.datos;
  const t = d?.totales;
  const moneda = d?.cuenta?.moneda;
  const resultados = d?.campanas?.reduce((a, c) => a + (c.resultados || 0), 0) || 0;
  const activas = d?.campanas?.filter((c) => c.estado === 'ACTIVE').length || 0;
  const cifras = t ? [
    ['Gasto', euro(t.gasto, moneda)],
    ['Resultados', num(resultados)],
    ['Coste/resultado', resultados ? euro(t.gasto / resultados, moneda) : '—'],
    ['Impresiones', num(t.impresiones)],
    ['Clics', num(t.clics)],
    ['CTR', `${t.ctr.toLocaleString('es-ES')} %`],
  ] : [];
  return (
    <div className="panel panel-pad">
      <div className="panel-head">
        <span className="label">Meta Ads · últimos 7 días</span>
        <span className="panel-head-der">
          {d?.actualizado && <span className="ayuda" title={new Date(d.actualizado).toLocaleString('es-ES')}>Actualizado {haceCuanto(d.actualizado)}</span>}
          {r?.cuenta && <button className="icon-btn mini" onClick={actualizar} disabled={cargando} aria-label="Actualizar métricas" title="Actualizar ahora"><span className={cargando ? 'girando' : ''}><Icon name="refresh" /></span></button>}
        </span>
      </div>
      {!r && <div className="vacio mini-vacio">Cargando…</div>}
      {r && !r.cuenta && (
        <div className="vacio mini-vacio">
          {r.conectado ? 'Elige tu cuenta publicitaria' : 'Conecta Meta Ads'} para ver aquí tus anuncios. <button className="link-btn" onClick={() => ir?.('ads')}>Ir a Meta Ads</button>
        </div>
      )}
      {(error || r?.error) && <div className="aviso-error">{error || r.error}</div>}
      {t && (
        <>
          <div className="ads-cifras">
            {cifras.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}
          </div>
          <div className="ads-pie">
            <span className="ayuda">{activas} {activas === 1 ? 'campaña activa' : 'campañas activas'}</span>
            <button className="link-btn" onClick={() => ir?.('ads')}>Ver campañas</button>
          </div>
        </>
      )}
    </div>
  );
}

export default function Inicio({ data, onAsk, acciones = {}, recargar = () => {} }) {
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
          <div className="hero-sub">{data.fecha ? diaLargo(data.fecha) : 'Tu espacio de trabajo inteligente'}</div>
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
          <PublicaHoy items={data.publicaHoy} ir={acciones.ir} />

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
        <TareasPanel tareas={data.tareas} ir={acciones.ir} alCambiar={recargar} />
        {data.conRecordatorios !== false && <Recordatorios hoy={data.recordatorios} alCambiar={recargar} />}
      </section>

      <section className="home-bottom">
        {data.conAds !== false ? <AdsPanel ir={acciones.ir} /> : <div />}

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
