import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api, normaliza, useRecurso } from '../lib/api.js';
import { hoyIso } from '../lib/fechas.js';
import { ESTADOS, TIPOS, tipoDe } from './contenido/comun.jsx';
import { Calendario, Lista, Pipeline } from './contenido/Vistas.jsx';
import { Biblioteca } from './contenido/Biblioteca.jsx';
import { EditorContenido, ProgramarContenido, Visor } from './contenido/Editor.jsx';

const VISTAS = [
  { id: 'calendario', label: 'Calendario', icon: 'calendar' },
  { id: 'lista', label: 'Lista', icon: 'tasks' },
  { id: 'biblioteca', label: 'Biblioteca', icon: 'book' },
  { id: 'pipeline', label: 'Pipeline', icon: 'skills' },
];
const vistaGuardada = () => { try { const v = localStorage.getItem('contenido_vista'); return VISTAS.some((x) => x.id === v) ? v : 'calendario'; } catch { return 'calendario'; } };

// Todo el contenido en un sitio: guárdalo en la biblioteca, ponle día en el calendario y muévelo por el pipeline.
export default function Contenido({ onCaptura }) {
  const [data, recargar, errorCarga, setData] = useRecurso('/api/contenido', null);
  const [vista, setVistaEstado] = useState(vistaGuardada);
  const [dia, setDia] = useState(hoyIso);
  const [filtro, setFiltro] = useState({ estado: '', tipo: '', texto: '' });
  const [editando, setEditando] = useState(null);
  const [programando, setProgramando] = useState(null);
  const [visor, setVisor] = useState(null);
  const [aviso, setAviso] = useState('');
  const [girando, setGirando] = useState(false);

  const setVista = (v) => { setVistaEstado(v); try { localStorage.setItem('contenido_vista', v); } catch { /* sin localStorage */ } };
  const piezas = useMemo(() => data?.piezas || [], [data]);
  const carpetas = data?.carpetas || [];
  const biblioteca = useMemo(() => piezas.filter((p) => !p.fecha), [piezas]);
  const cuenta = (e) => piezas.filter((p) => p.estado === e).length;

  // Cambio optimista (estado o fecha): se ve al momento y, si falla, se deshace
  const mover = useCallback(async (p, cambios) => {
    setData((d) => ({ ...d, piezas: d.piezas.map((x) => (x.id === p.id ? { ...x, ...cambios } : x)) }));
    try { await api(`/api/piezas/${p.id}`, { method: 'PATCH', body: cambios }); setAviso(''); }
    catch (e) { setData((d) => ({ ...d, piezas: d.piezas.map((x) => (x.id === p.id ? p : x)) })); setAviso(`No se pudo guardar el cambio. ${e.message}`); }
  }, [setData]);

  const actualizar = () => { setGirando(true); recargar(); setTimeout(() => setGirando(false), 700); };
  const nuevo = (fecha = vista === 'calendario' ? dia : '') => setEditando({ fecha, estado: 'idea', archivos: [] });
  const abrirVisor = useCallback((archivos, inicio) => setVisor({ archivos, inicio }), []);

  const filtradas = useMemo(() => {
    const t = normaliza(filtro.texto.trim());
    return piezas.filter((p) =>
      (!filtro.estado || p.estado === filtro.estado) &&
      (!filtro.tipo || tipoDe(p.formato)?.id === filtro.tipo) &&
      (!t || normaliza(`${p.titulo}\n${p.caption || ''}`).includes(t)));
  }, [piezas, filtro]);

  useEffect(() => { if (vista !== 'lista' && filtro.estado) setFiltro((f) => ({ ...f, estado: '' })); }, [vista]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="contenido-vista">
      <div className="panel panel-pad contenido-cabecera">
        <div>
          <div className="label">Contenido</div>
          <h1 className="vista-titulo">Todo tu contenido en un sitio</h1>
          <p className="ayuda">Guárdalo en la biblioteca, ponle día en el calendario y muévelo por el pipeline. JARVIS lo prepara; tú publicas.</p>
        </div>
        <div className="cabecera-acciones">
          <button className="btn btn-sec" onClick={actualizar}><span className={girando ? 'girar' : ''}><Icon name="refresh" size={14} /></span><span className="hide-sm">Actualizar</span></button>
          <button className="btn" onClick={() => nuevo()}><Icon name="plus" size={14} />Nuevo contenido</button>
        </div>
      </div>

      {(aviso || errorCarga) && <div className="aviso error">{aviso || `No se pudo cargar el contenido. ${errorCarga}`}</div>}

      <div className="estados-kpis">
        {ESTADOS.map((e) => {
          const on = filtro.estado === e.id;
          return (
            <button
              key={e.id}
              className={`estado-kpi${on ? ' on' : ''}${filtro.estado && !on ? ' apagado' : ''}`}
              style={{ '--c': e.color }}
              onClick={() => { setFiltro((f) => ({ ...f, estado: on ? '' : e.id })); setVista('lista'); }}
              title={`Ver solo ${e.label.toLowerCase()}`}
            >
              <div className="estado-kpi-top"><span className="kpi-icon peque" style={{ background: `color-mix(in srgb, ${e.color} 16%, transparent)` }}><Icon name={e.icon} size={14} color={e.color} /></span>{e.label}</div>
              <b>{data ? cuenta(e.id) : '—'}</b>
              <small>{e.ayuda}</small>
            </button>
          );
        })}
      </div>

      <div className="contenido-barra">
        <div className="seg">
          {VISTAS.map((v) => (
            <button key={v.id} className={vista === v.id ? 'on' : ''} onClick={() => setVista(v.id)}>
              <Icon name={v.icon} />{v.label}{v.id === 'biblioteca' && biblioteca.length > 0 && <span className="seg-n">· {biblioteca.length}</span>}
            </button>
          ))}
        </div>
        {vista === 'lista' && (
          <div className="contenido-filtros">
            <div className="buscar-mini"><Icon name="search" size={13} /><input placeholder="Buscar título o caption" value={filtro.texto} onChange={(e) => setFiltro({ ...filtro, texto: e.target.value })} /></div>
            <select className="campo" value={filtro.tipo} onChange={(e) => setFiltro({ ...filtro, tipo: e.target.value })} aria-label="Tipo">
              <option value="">Todos los tipos</option>
              {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.id}</option>)}
            </select>
            <select className="campo" value={filtro.estado} onChange={(e) => setFiltro({ ...filtro, estado: e.target.value })} aria-label="Estado">
              <option value="">Todos los estados</option>
              {ESTADOS.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
            </select>
          </div>
        )}
      </div>

      {vista === 'calendario' && <Calendario piezas={piezas} biblioteca={biblioteca} dia={dia} setDia={setDia} onAbrir={setEditando} onNuevo={nuevo} onMover={mover} onProgramar={(p, f) => setProgramando({ p, f })} />}
      {vista === 'lista' && <Lista piezas={filtradas} cargando={!data} onAbrir={setEditando} onMover={mover} />}
      {vista === 'biblioteca' && <Biblioteca piezas={biblioteca} carpetas={carpetas} onAbrir={setEditando} onProgramar={(p) => setProgramando({ p })} recargar={recargar} />}
      {vista === 'pipeline' && <Pipeline piezas={piezas} onAbrir={setEditando} onMover={mover} onNuevaIdea={() => onCaptura('idea')} />}

      {editando && <EditorContenido key={editando.id || 'nuevo'} pieza={editando} carpetas={carpetas} onClose={() => setEditando(null)} onGuardado={recargar} onVisor={abrirVisor} />}
      {programando && <ProgramarContenido pieza={programando.p} fecha={programando.f} onClose={() => setProgramando(null)} onGuardado={recargar} />}
      {visor && <Visor archivos={visor.archivos} inicio={visor.inicio} onClose={() => setVisor(null)} />}
    </section>
  );
}
