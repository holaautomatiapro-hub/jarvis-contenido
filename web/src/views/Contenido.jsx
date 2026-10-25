import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import { api, useRecurso } from '../lib/api.js';
import { hoyIso } from '../lib/fechas.js';
import { useIr } from '../lib/ir.js';
import { useFases, enPipeline } from './contenido/comun.jsx';
import { BancoIdeas, Calendario, Pipeline } from './contenido/Vistas.jsx';
import { Biblioteca } from './contenido/Biblioteca.jsx';
import { EditorContenido, ProgramarContenido, Visor } from './contenido/Editor.jsx';
import { FichaReferencia, esReferencia } from './contenido/FichaReferencia.jsx';
import { LeadMagnetsBiblioteca } from './contenido/LeadMagnetsBiblioteca.jsx';
import ProgramarStories from './contenido/ProgramarStories.jsx';

const VISTAS = [
  { id: 'calendario', label: 'Calendario', icon: 'calendar' },
  { id: 'biblioteca', label: 'Biblioteca', icon: 'book' },
  { id: 'ideas', label: 'Ideas', icon: 'bulb' },
  { id: 'pipeline', label: 'Pipeline', icon: 'skills' },
];
const vistaGuardada = () => { try { const v = localStorage.getItem('contenido_vista'); return VISTAS.some((x) => x.id === v) ? v : 'calendario'; } catch { return 'calendario'; } };

// Todo el contenido en un sitio: guárdalo en la biblioteca, ponle día en el calendario y muévelo por el pipeline.
export default function Contenido({ onCaptura }) {
  const ESTADOS = useFases();
  const [data, recargar, errorCarga, setData] = useRecurso('/api/contenido', null);
  const [vista, setVistaEstado] = useState(vistaGuardada);
  const [dia, setDia] = useState(hoyIso);
  const [editando, setEditando] = useState(null);
  const [programando, setProgramando] = useState(null);
  const [visor, setVisor] = useState(null);
  const [subiendoStories, setSubiendoStories] = useState(false);
  const [aviso, setAviso] = useState('');
  const [girando, setGirando] = useState(false);

  const setVista = (v) => { setVistaEstado(v); try { localStorage.setItem('contenido_vista', v); } catch { /* sin localStorage */ } };
  const piezas = useMemo(() => data?.piezas || [], [data]);
  // Desde «Trabajando en…»: abrir la pieza (p. ej. la de la portada que se acaba de hacer)
  useIr((d) => {
    if (d.tab !== 'contenido' || !d.pieza) return d.tab === 'contenido';
    const p = piezas.find((x) => x.id === d.pieza);
    if (!p) return false;
    setEditando(p);
    return true;
  });
  const carpetas = data?.carpetas || [];
  // Biblioteca: lo que tiene archivos o ya está en marcha y aún no tiene día. Las ideas sin archivos van a «Ideas».
  const biblioteca = useMemo(() => piezas.filter((p) => !p.fecha && p.estado !== 'publicado' && (p.estado !== 'idea' || p.archivos.length)), [piezas]);
  const ideas = useMemo(() => piezas.filter((p) => p.estado === 'idea').length, [piezas]);
  const publicados = useMemo(() => piezas.filter((p) => p.estado === 'publicado' || p.ig_estado === 'publicado'), [piezas]);
  // Lo que se está publicando ahora, lo que falló y lo recién publicado (últimos 30 min)
  const enCurso = piezas.filter((p) => p.ig_estado === 'procesando');
  const fallidas = piezas.filter((p) => p.ig_estado === 'error');
  const recientes = piezas.filter((p) => p.ig_estado === 'publicado' && p.ig_publicado_en && Date.now() - new Date(p.ig_publicado_en).getTime() < 30 * 60000);
  const pasoDe = (p) => { try { return JSON.parse(p.ig_contenedor || '{}').paso || 'empezando…'; } catch { return 'empezando…'; } };

  // Volver a publicar: copia con los mismos archivos y caption, y se elige el día
  const republicar = useCallback(async (p) => {
    try { const copia = await api(`/api/piezas/${p.id}/duplicar`, { method: 'POST' }); setProgramando({ p: copia }); recargar(); }
    catch (e) { setAviso(`No se pudo copiar la pieza. ${e.message}`); }
  }, [recargar]);
  const cuenta = (e) => piezas.filter((p) => p.estado === e && enPipeline(p)).length;

  // Cambio optimista (estado o fecha): se ve al momento y, si falla, se deshace
  const mover = useCallback(async (p, cambios) => {
    setData((d) => ({ ...d, piezas: d.piezas.map((x) => (x.id === p.id ? { ...x, ...cambios } : x)) }));
    try { await api(`/api/piezas/${p.id}`, { method: 'PATCH', body: cambios }); setAviso(''); }
    catch (e) { setData((d) => ({ ...d, piezas: d.piezas.map((x) => (x.id === p.id ? p : x)) })); setAviso(`No se pudo guardar el cambio. ${e.message}`); }
  }, [setData]);

  // Eliminar ideas (una desde su tarjeta o varias marcadas en el banco de ideas): desaparecen al momento
  const borrar = useCallback(async (lista) => {
    if (!lista.length) return false;
    if (!window.confirm(lista.length === 1 ? `¿Eliminar la idea «${lista[0].titulo}»?` : `¿Eliminar ${lista.length} ideas?`)) return false;
    const ids = lista.map((p) => p.id);
    setData((d) => ({ ...d, piezas: d.piezas.filter((x) => !ids.includes(x.id)) }));
    try { await api('/api/contenido/borrar', { method: 'POST', body: { ids } }); setAviso(''); return true; }
    catch (e) { setAviso(`No se pudieron eliminar. ${e.message}`); recargar(); return false; }
  }, [setData, recargar]);

  const actualizar = () => { setGirando(true); recargar(); setTimeout(() => setGirando(false), 700); };
  const nuevo = (fecha = vista === 'calendario' ? dia : '') => setEditando({ fecha, estado: 'idea', archivos: [] });
  const abrirVisor = useCallback((archivos, inicio) => setVisor({ archivos, inicio }), []);

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
          <button className="btn btn-sec" onClick={() => setSubiendoStories(true)} title="Sube tus stories (fotos o vídeos) y prográmalas para que se publiquen solas en Instagram"><Icon name="calendar" size={14} /><span className="hide-sm">Subir stories</span></button>
          <button className="btn" onClick={() => nuevo()}><Icon name="plus" size={14} />Nuevo contenido</button>
        </div>
      </div>

      {(aviso || errorCarga) && <div className="aviso error">{aviso || `No se pudo cargar el contenido. ${errorCarga}`}</div>}
      {enCurso.map((p) => <div key={`c${p.id}`} className="aviso ig-aviso"><Icon name="instagram" size={14} />Publicando en Instagram «{p.titulo}»: {pasoDe(p)}</div>)}
      {data?.instagram?.caducada && <div className="aviso error ig-aviso"><Icon name="instagram" size={14} /><span>Meta ha cortado la conexión con Instagram: no se publicará nada hasta que la vuelvas a conectar.</span><a className="link-btn" href="#instagram">Volver a conectar</a></div>}
      {fallidas.map((p) => <div key={`e${p.id}`} className="aviso error ig-aviso"><Icon name="instagram" size={14} /><span>No se pudo publicar «{p.titulo}»: {p.ig_error}</span><button className="link-btn" onClick={() => setEditando(p)}>Abrir</button></div>)}
      {recientes.map((p) => <div key={`r${p.id}`} className="aviso ok ig-aviso"><Icon name="instagram" size={14} /><span>Publicado en Instagram: «{p.titulo}»</span>{p.ig_permalink && <a className="link-btn" href={p.ig_permalink} target="_blank" rel="noreferrer">Verlo ↗</a>}</div>)}

      <div className="estados-kpis">
        {ESTADOS.map((e) => {
          return (
            <button
              key={e.id}
              className="estado-kpi"
              style={{ '--c': e.color }}
              onClick={() => setVista('pipeline')}
              title="Ver en el pipeline"
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
              <Icon name={v.icon} />{v.label}{v.id === 'biblioteca' && biblioteca.length > 0 && <span className="seg-n">· {biblioteca.length}</span>}{v.id === 'ideas' && ideas > 0 && <span className="seg-n">· {ideas}</span>}
            </button>
          ))}
        </div>
      </div>

      {vista === 'calendario' && <Calendario piezas={piezas} versiones={data?.versiones || []} carpetas={carpetas} dia={dia} setDia={setDia} onAbrir={setEditando} onNuevo={nuevo} onMover={mover} onProgramar={(p, f) => setProgramando({ p, f })} />}
      {vista === 'biblioteca' && <Biblioteca piezas={biblioteca} publicados={publicados} carpetas={carpetas} onAbrir={setEditando} onProgramar={(p) => setProgramando({ p })} onRepublicar={republicar} recargar={recargar} />}
      {vista === 'biblioteca' && <LeadMagnetsBiblioteca />}
      {vista === 'ideas' && <BancoIdeas piezas={piezas} onAbrir={setEditando} onMover={mover} onNuevaIdea={() => onCaptura('idea')} onBorrar={borrar} />}
      {vista === 'pipeline' && <Pipeline piezas={piezas} onAbrir={setEditando} onMover={mover} onNuevaIdea={() => onCaptura('idea')} onBorrar={borrar} />}

      {editando && esReferencia(editando) && !editando.comoPieza && <FichaReferencia key={`ref-${editando.id}`} pieza={editando} onClose={() => { setEditando(null); recargar(); }} onGuardado={recargar} onEditar={() => setEditando({ ...editando, comoPieza: true })} />}
      {editando && (!esReferencia(editando) || editando.comoPieza) && <EditorContenido key={editando.id || `nuevo-${editando.padre_id || ''}`} pieza={editando} carpetas={carpetas} ig={data?.instagram} piezas={piezas} pilares={data?.pilares || []} onAbrir={setEditando} onDerivada={setEditando} onClose={() => setEditando(null)} onGuardado={recargar} onVisor={abrirVisor} onRepublicar={republicar} />}
      {programando && <ProgramarContenido pieza={programando.p} fecha={programando.f} ig={data?.instagram} onClose={() => setProgramando(null)} onGuardado={recargar} />}
      {visor && <Visor archivos={visor.archivos} inicio={visor.inicio} onClose={() => setVisor(null)} />}
      {subiendoStories && <ProgramarStories ig={data?.instagram} titulo="Stories" onClose={() => setSubiendoStories(false)} onHecho={(n, conErrores) => { setAviso(''); recargar(); if (!conErrores) setSubiendoStories(false); }} />}
    </section>
  );
}
