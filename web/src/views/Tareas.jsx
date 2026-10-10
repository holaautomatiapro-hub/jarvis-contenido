import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api, useRecurso } from '../lib/api.js';

export const COLUMNAS = [
  { id: 'idea', label: 'Idea', color: 'var(--blue)', icon: 'bulb' },
  { id: 'guion', label: 'Guion', color: 'var(--purple)', icon: 'pen' },
  { id: 'grabar', label: 'Grabar', color: 'var(--orange)', icon: 'mic' },
  { id: 'editar', label: 'Editar', color: 'var(--pink)', icon: 'layers' },
  { id: 'listo', label: 'Listo', color: 'var(--cyan)', icon: 'calendar' },
  { id: 'publicado', label: 'Publicado', color: 'var(--green)', icon: 'checkCircle' },
];
const CATEGORIAS = [
  { id: 'contenido', label: 'Contenido', color: 'var(--purple)' },
  { id: 'ideas', label: 'Ideas', color: 'var(--blue)' },
  { id: 'analisis', label: 'Análisis', color: 'var(--orange)' },
  { id: 'administracion', label: 'Administración', color: 'var(--green)' },
  { id: 'aprendizaje', label: 'Aprendizaje', color: 'var(--cyan)' },
];
const colorCat = (c) => CATEGORIAS.find((x) => x.id === c)?.color || 'var(--muted)';

function PlanDelDia() {
  const [data, recargar] = useRecurso('/api/tareas', { tareas: [], atrasadas: [] });
  const [titulo, setTitulo] = useState('');
  const [categoria, setCategoria] = useState('contenido');
  const [error, setError] = useState('');
  const hechas = data.tareas.filter((t) => t.hecha).length;
  const total = data.tareas.length;

  const añadir = async (e) => {
    e.preventDefault();
    if (!titulo.trim()) return;
    try {
      await api('/api/tareas', { method: 'POST', body: { titulo, categoria } });
      setTitulo('');
      setError('');
      recargar();
    } catch (err) { setError(err.message); }
  };
  const marcar = async (t) => { await api(`/api/tareas/${t.id}`, { method: 'PATCH', body: { hecha: !t.hecha } }); recargar(); };
  const borrar = async (t) => { await api(`/api/tareas/${t.id}`, { method: 'DELETE' }); recargar(); };

  const Fila = ({ t, atrasada }) => (
    <div className={`tarea${t.hecha ? ' hecha' : ''}`}>
      <button className="check" onClick={() => marcar(t)} aria-label={t.hecha ? 'Marcar pendiente' : 'Marcar hecha'}>
        {t.hecha ? <Icon name="check" size={12} stroke={3} /> : null}
      </button>
      <span className="tarea-txt">{t.titulo}</span>
      {atrasada && <span className="tag" style={{ background: 'rgba(239,68,68,.14)', color: '#fca5a5' }}>{t.fecha.slice(5).split('-').reverse().join('/')}</span>}
      {t.origen === 'hermes' && <Icon name="telegram" size={12} color="var(--cyan)" />}
      <span className="dot" style={{ background: colorCat(t.categoria) }} title={t.categoria} />
      <button className="borrar" onClick={() => borrar(t)} aria-label="Borrar tarea">✕</button>
    </div>
  );

  return (
    <div className="panel panel-pad plan">
      <div className="panel-head">
        <span className="label">Plan del día</span>
        <span className="all-online">{hechas}/{total} hechas</span>
      </div>
      <div className="bar" style={{ marginBottom: 14 }}>
        <span style={{ width: `${total ? (hechas / total) * 100 : 0}%`, background: 'var(--accent-2)', boxShadow: '0 0 8px var(--accent-2)' }} />
      </div>
      <form className="fila" onSubmit={añadir}>
        <input className="campo" placeholder="Añadir tarea…" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <select className="campo" value={categoria} onChange={(e) => setCategoria(e.target.value)} style={{ maxWidth: 130 }} aria-label="Categoría">
          {CATEGORIAS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <button className="btn btn-ico" aria-label="Añadir"><Icon name="plus" size={15} /></button>
      </form>
      {error && <div className="aviso-error">{error}</div>}
      <div className="tareas">
        {data.tareas.map((t) => <Fila key={t.id} t={t} />)}
        {!total && <div className="vacio">Nada en el plan de hoy. Añade una tarea o pídesela a JARVIS por Telegram.</div>}
        {data.atrasadas.length > 0 && <div className="label" style={{ margin: '14px 0 4px' }}>Atrasadas</div>}
        {data.atrasadas.map((t) => <Fila key={t.id} t={t} atrasada />)}
      </div>
    </div>
  );
}

function Tarjeta({ p, onMover, onArrastre }) {
  const idx = COLUMNAS.findIndex((c) => c.id === p.estado);
  return (
    <div className="tarjeta" draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(p.id)); onArrastre(p.id); }}>
      <div className="tarjeta-titulo">{p.titulo}</div>
      <div className="tarjeta-meta">
        {p.formato && <span className="tag" style={{ background: 'rgba(47,107,255,.14)', color: '#9cc0ff' }}>{p.formato}</span>}
        {p.plataformas && <span className="mini">{p.plataformas}</span>}
        {p.fecha && <span className="mini"><Icon name="calendar" size={10} /> {p.fecha.slice(5).split('-').reverse().join('/')}</span>}
        {p.origen === 'hermes' && <Icon name="telegram" size={11} color="var(--cyan)" />}
      </div>
      <div className="tarjeta-acciones">
        <button disabled={idx === 0} onClick={() => onMover(p, COLUMNAS[idx - 1].id)} aria-label="Mover a la columna anterior">←</button>
        <button disabled={idx === COLUMNAS.length - 1} onClick={() => onMover(p, COLUMNAS[idx + 1].id)} aria-label="Mover a la columna siguiente">→</button>
      </div>
    </div>
  );
}

function Pipeline({ onNuevaIdea }) {
  const [piezas, recargar, , setPiezas] = useRecurso('/api/piezas', []);
  const [sobre, setSobre] = useState(null);
  const [arrastrando, setArrastrando] = useState(null);

  const mover = async (p, estado) => {
    if (p.estado === estado) return;
    setPiezas((ps) => ps.map((x) => (x.id === p.id ? { ...x, estado } : x))); // respuesta inmediata
    try { await api(`/api/piezas/${p.id}`, { method: 'PATCH', body: { estado } }); } finally { recargar(); }
  };
  const soltar = (estado) => (e) => {
    e.preventDefault();
    setSobre(null);
    const id = Number(e.dataTransfer.getData('text/plain') || arrastrando);
    const p = piezas.find((x) => x.id === id);
    if (p) mover(p, estado);
  };

  return (
    <div className="panel panel-pad pipeline">
      <div className="panel-head">
        <span className="label">Pipeline de contenido</span>
        <button className="chip" onClick={onNuevaIdea}><Icon name="plus" />Nueva idea</button>
      </div>
      <div className="kanban">
        {COLUMNAS.map((c) => {
          const lista = piezas.filter((p) => p.estado === c.id);
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
              {lista.map((p) => <Tarjeta key={p.id} p={p} onMover={mover} onArrastre={setArrastrando} />)}
              {!lista.length && <div className="vacio mini-vacio">Arrastra aquí</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Tareas({ onCaptura }) {
  return (
    <section className="tareas-vista">
      <PlanDelDia />
      <Pipeline onNuevaIdea={() => onCaptura('idea')} />
    </section>
  );
}
