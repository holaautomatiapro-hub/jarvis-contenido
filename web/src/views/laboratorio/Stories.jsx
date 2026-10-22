import { useEffect, useMemo, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import ChatJarvis from '../../components/ChatJarvis.jsx';
import { api, useMensajes, useRecurso } from '../../lib/api.js';
import { diaCorto } from '../../lib/fechas.js';
import { Modal } from '../contenido/comun.jsx';
import { DetalleDiseno } from '../contenido/Diseno.jsx';

// Stories: de un carrusel, un reel o un tema, JARVIS escribe el guion de la secuencia de stories (lo cambias a mano o
// se lo pides de nuevo) y, con el guion listo, Claude las diseña con tu sistema de diseño. Se ajustan en el chat y se
// exportan a la biblioteca, una pieza por story, para programarlas.

const ORIGENES = ['Carrusel', 'Reel', 'Short', 'Reel split', 'B-roll', 'Post'];
const nStories = (g) => (g.match(/^##\s*Story/gim) || []).length;

// «Guion de stories» desde la ficha de una pieza: se abre aquí con esa pieza elegida
let piezaPendiente = null;
export const storiesDePieza = (id) => { piezaPendiente = id; window.dispatchEvent(new CustomEvent('jarvis:stories-de')); };

function NuevoGuion({ data, piezas, inicial, onClose, onCreado }) {
  const candidatas = useMemo(() => piezas.filter((p) => ORIGENES.includes(p.formato))
    .sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')) || b.id - a.id), [piezas]);
  const [origen, setOrigen] = useState(inicial || candidatas.length ? 'pieza' : 'tema');
  const [piezaId, setPiezaId] = useState(inicial || candidatas[0]?.id || '');
  const [tema, setTema] = useState('');
  const [titulo, setTitulo] = useState('');
  const [objetivo, setObjetivo] = useState(inicial ? 'promo' : '');
  const [cantidad, setCantidad] = useState(5);
  const [indicaciones, setIndicaciones] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const crear = async () => {
    if (origen === 'pieza' && !piezaId) return setError('Elige el carrusel o el reel.');
    if (origen === 'tema' && !tema.trim()) return setError('Escribe de qué van las stories.');
    setEnviando(true); setError('');
    try {
      const r = await api('/api/stories', { method: 'POST', body: {
        titulo: titulo.trim() || undefined, objetivo: objetivo || undefined, cantidad, indicaciones: indicaciones.trim() || undefined,
        ...(origen === 'pieza' ? { pieza_id: Number(piezaId) } : origen === 'tema' ? { tema } : { escribirConJarvis: false, titulo: titulo.trim() || 'Mis stories' }),
      } });
      onCreado(r);
    } catch (e) { setError(e.message); setEnviando(false); }
  };
  const etiqueta = (p) => `${p.formato} · ${p.titulo}${p.estado === 'publicado' || p.ig_estado === 'publicado' ? ' (publicado)' : p.fecha ? ` (${diaCorto(p.fecha)})` : ''}`;
  return (
    <Modal titulo={<><Icon name="layers" size={14} />Nuevo guion de stories</>} onClose={onClose} ancho={640}>
      <label className="campo-et">De dónde salen</label>
      <div className="seg seg-ancho seg-mini">
        <button type="button" className={origen === 'pieza' ? 'on' : ''} onClick={() => setOrigen('pieza')} disabled={!candidatas.length}>De un carrusel o reel</button>
        <button type="button" className={origen === 'tema' ? 'on' : ''} onClick={() => setOrigen('tema')}>De un tema</button>
        <button type="button" className={origen === 'mano' ? 'on' : ''} onClick={() => setOrigen('mano')}>Lo escribo yo</button>
      </div>
      {origen === 'pieza' && (
        <select className="campo" value={piezaId} onChange={(e) => setPiezaId(e.target.value)} style={{ marginTop: 8 }} aria-label="Carrusel o reel">
          {candidatas.map((p) => <option key={p.id} value={p.id}>{etiqueta(p)}</option>)}
        </select>
      )}
      {origen === 'tema' && <textarea className="campo" rows={3} value={tema} onChange={(e) => setTema(e.target.value)} placeholder="Ej.: los 3 errores que cometen los entrenadores al contestar DMs, y que me escriban SETTER" style={{ marginTop: 8 }} />}
      {origen !== 'mano' && (
        <>
          <label className="campo-et">Para qué son</label>
          <div className="pildoras stories-objetivos">
            {Object.entries(data.objetivos).map(([id, txt]) => (
              <button key={id} type="button" className={`chip${objetivo === id ? ' chip-acento' : ''}`} onClick={() => setObjetivo(objetivo === id ? '' : id)} title={txt}>{txt.split(':')[0]}</button>
            ))}
          </div>
          <div className="dos-col">
            <div>
              <label className="campo-et">Cuántas stories</label>
              <select className="campo" value={cantidad} onChange={(e) => setCantidad(Number(e.target.value))}>{[3, 4, 5, 6, 7, 8, 10, 12].map((n) => <option key={n} value={n}>{n}</option>)}</select>
            </div>
            <div>
              <label className="campo-et">Título <small className="t-dim">(opcional)</small></label>
              <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Si lo dejas vacío, el de la pieza o el tema" maxLength={120} />
            </div>
          </div>
          <label className="campo-et">Indicaciones para JARVIS <small className="t-dim">(opcional)</small></label>
          <textarea className="campo" rows={2} value={indicaciones} onChange={(e) => setIndicaciones(e.target.value)} placeholder="Ej.: palabra clave SETTER; una encuesta en la 2; que la última lleve al carrusel" />
        </>
      )}
      {origen === 'mano' && (
        <>
          <label className="campo-et">Título</label>
          <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Mis stories" maxLength={120} />
        </>
      )}
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        <span className="ayuda">{origen === 'mano' ? 'Se crea vacío y lo escribes tú.' : 'JARVIS lo escribe con tu voz en uno o dos minutos.'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sec" onClick={onClose}>Cancelar</button>
          <button type="button" className="btn" onClick={crear} disabled={enviando}><Icon name="sparkle" size={14} />{enviando ? 'Enviando…' : origen === 'mano' ? 'Crear' : 'Escribir el guion'}</button>
        </div>
      </div>
    </Modal>
  );
}

// El diseño de las stories, como en Diseño (vista previa, avisos, exportar), con su chat al lado
function DisenoStories({ id, piezas, ig, onVisor, onAbrir, onProgramar, onAviso, onBorrado }) {
  const [d, recargar] = useRecurso(`/api/disenos/${id}`, null);
  const [kit] = useRecurso('/api/disenos', null);
  const [progreso, setProgreso] = useState(null);
  useMensajes('diseno', (m) => { if (m.id !== id) return; if (m.progreso != null) setProgreso(m.progreso); else recargar(); });
  if (!d) return <div className="t-dim">Cargando el diseño…</div>;
  return <DetalleDiseno d={d} kit={kit?.kit} piezas={piezas} ig={ig} progreso={progreso} onVisor={onVisor} onAbrir={onAbrir} onProgramar={onProgramar} onAviso={onAviso} onBorrado={onBorrado} recargar={recargar} />;
}

function Detalle({ g, data, piezas, ig, onVisor, onAbrir, onProgramar, recargar, onBorrado }) {
  const [texto, setTexto] = useState(g.guion);
  const [pedido, setPedido] = useState('');
  const [plantilla, setPlantilla] = useState(data.plantillas[0]?.id || '');
  const [extra, setExtra] = useState('');
  const [ocupado, setOcupado] = useState('');
  const [aviso, setAviso] = useState('');
  // Lo que llega de JARVIS sustituye a lo de la caja si no lo estás cambiando
  const [base, setBase] = useState(g.guion);
  useEffect(() => { if (g.guion !== base) { if (texto === base) setTexto(g.guion); setBase(g.guion); } }, [g.guion]); // eslint-disable-line react-hooks/exhaustive-deps
  const cambiado = texto !== g.guion;
  const escribiendo = g.estado === 'escribiendo';
  const hacer = async (que, fn) => {
    setOcupado(que); setAviso('');
    try { await fn(); recargar(); } catch (e) { setAviso(e.message); }
    setOcupado('');
  };
  const guardar = () => hacer('guardar', () => api(`/api/stories/${g.id}`, { method: 'PUT', body: { guion: texto } }));
  const pedir = () => hacer('jarvis', async () => {
    if (cambiado) await api(`/api/stories/${g.id}`, { method: 'PUT', body: { guion: texto } });
    await api(`/api/stories/${g.id}/escribir`, { method: 'POST', body: { indicaciones: pedido } });
    setPedido('');
  });
  const disenar = () => hacer('disenar', async () => {
    if (cambiado) await api(`/api/stories/${g.id}`, { method: 'PUT', body: { guion: texto } });
    await api(`/api/stories/${g.id}/disenar`, { method: 'POST', body: { plantilla, indicaciones: extra } });
  });
  const borrar = () => {
    if (!window.confirm(`¿Borrar el guion «${g.titulo}»?${g.diseno ? ' Su diseño se queda en Diseño (y lo exportado, en la biblioteca).' : ''}`)) return;
    hacer('borrar', async () => { await api(`/api/stories/${g.id}`, { method: 'DELETE' }); onBorrado(); });
  };
  const n = nStories(texto);
  return (
    <div className="stories-detalle">
      <div className="panel panel-pad">
        <div className="panel-head">
          <div>
            <div className="label">{g.pieza ? `Stories · de «${g.pieza.titulo}» (${g.pieza.formato})` : g.tema ? 'Stories · de un tema' : 'Stories'}</div>
            <h2 className="diseno-titulo">{g.titulo}</h2>
          </div>
          <div className="diseno-acciones-cab">
            {g.pieza && <button type="button" className="link-btn" onClick={() => { const p = piezas.find((x) => x.id === g.pieza.id); if (p) onAbrir(p); }}>Ver la pieza</button>}
            <button type="button" className="link-btn peligro" onClick={borrar} disabled={escribiendo || Boolean(ocupado)}>Borrar</button>
          </div>
        </div>

        <div className="stories-paso"><span className="stories-n">1</span><b>Guion</b><span className="t-dim">{n ? `${n} ${n === 1 ? 'story' : 'stories'}` : ''}</span></div>
        {escribiendo
          ? <div className="aviso ig-aviso"><span className="cursor" />JARVIS está escribiendo el guion de {g.cantidad} stories con tu voz. Aparece aquí en cuanto lo guarde.</div>
          : (
            <>
              <textarea className="campo stories-guion" rows={14} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'## Story 1 · texto\nTexto en pantalla: …\nVisual: …\n\n## Story 2 · encuesta\nTexto en pantalla: …\nSticker: encuesta «Sí / No»'} />
              <div className="stories-guion-pie">
                {cambiado ? <><button type="button" className="btn btn-sec" onClick={guardar} disabled={Boolean(ocupado)}>{ocupado === 'guardar' ? 'Guardando…' : 'Guardar cambios'}</button><button type="button" className="link-btn" onClick={() => setTexto(g.guion)}>Deshacer</button></> : <span className="ayuda">{g.guion ? 'Puedes cambiarlo aquí a mano.' : 'Escríbelo aquí o pídeselo a JARVIS.'}</span>}
              </div>
            </>
          )}
        {g.error && !escribiendo && <div className="caja-error">{g.error}</div>}
        <div className="est-jarvis">
          <input className="campo" value={pedido} onChange={(e) => setPedido(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (pedido.trim() || !g.guion)) pedir(); }} placeholder={g.guion ? 'Pídele un cambio: «más corto», «añade un quiz en la 3», «cierra con SETTER»…' : 'Opcional: lo que quieres que tenga'} disabled={escribiendo} />
          <button type="button" className="btn btn-sec" onClick={pedir} disabled={escribiendo || Boolean(ocupado) || (Boolean(g.guion) && !pedido.trim())}><Icon name="sparkle" size={14} />{ocupado === 'jarvis' ? 'Enviando…' : g.guion ? 'Cambiar con JARVIS' : 'Escribir con JARVIS'}</button>
        </div>

        <div className="stories-paso"><span className="stories-n">2</span><b>Diseño</b><span className="t-dim">con tu sistema de diseño</span></div>
        {!g.diseno ? (
          data.plantillas.length ? (
            <div className="stories-disenar">
              {data.plantillas.length > 1 && (
                <div className="diseno-plantillas">
                  {data.plantillas.map((p) => <button key={p.id} type="button" className={`modo${plantilla === p.id ? ' on' : ''}`} onClick={() => setPlantilla(p.id)}><b>{p.nombre}</b>{p.descripcion && <small>{p.descripcion}</small>}</button>)}
                </div>
              )}
              <div className="est-jarvis">
                <input className="campo" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Opcional: «usa mi foto de la biblioteca en la 1», «fondo claro»…" />
                <button type="button" className="btn" onClick={disenar} disabled={escribiendo || !texto.trim() || Boolean(ocupado)} title={!texto.trim() ? 'Primero el guion' : ''}><Icon name="palette" size={14} />{ocupado === 'disenar' ? 'Enviando…' : 'Diseñar las stories'}</button>
              </div>
              <p className="ayuda">Claude las diseña con tu sistema (una por cada «## Story») y JARVIS revisa que todo quepa. Tarda unos minutos; luego las ajustas en el chat y las exportas a la biblioteca.</p>
            </div>
          ) : <div className="aviso">Tu sistema de diseño no tiene ninguna plantilla de stories. Añádela en tu kit (Diseño → Cambiar sistema) para diseñarlas aquí.</div>
        ) : (
          <>
          {g.diseno.guionCambiado && !cambiado && (
            <div className="aviso stories-redisenar">
              El guion ha cambiado desde que se diseñaron.
              <button type="button" className="btn btn-sec" onClick={() => { if (window.confirm('Claude las diseña de nuevo con el guion de ahora (el diseño anterior se queda en Diseño). ¿Seguir?')) disenar(); }} disabled={escribiendo || Boolean(ocupado) || ['generando', 'renderizando', 'exportando'].includes(g.diseno.estado)}><Icon name="palette" size={14} />{ocupado === 'disenar' ? 'Enviando…' : 'Diseñarlas con el guion nuevo'}</button>
            </div>
          )}
          <DisenoStories key={g.diseno.id} id={g.diseno.id} piezas={piezas} ig={ig} onVisor={onVisor} onAbrir={onAbrir} onProgramar={onProgramar} onAviso={setAviso} onBorrado={recargar} />
          </>
        )}
        {aviso && <div className="caja-error">{aviso}</div>}
      </div>
    </div>
  );
}

export default function Stories({ piezas, ig, onAbrir, onProgramar, onVisor }) {
  const [data, recargar, error] = useRecurso('/api/stories', null);
  const [sel, setSel] = useState(() => { try { return Number(localStorage.getItem('stories_sel')) || null; } catch { return null; } });
  const [nuevo, setNuevo] = useState(null); // { pieza } | {}
  const elegir = (id) => { setSel(id); try { localStorage.setItem('stories_sel', String(id || '')); } catch { /* sin localStorage */ } };
  // Desde la ficha de una pieza: «Guion de stories»
  useEffect(() => {
    const abrir = () => { if (piezaPendiente) { setNuevo({ pieza: piezaPendiente }); piezaPendiente = null; } };
    abrir();
    window.addEventListener('jarvis:stories-de', abrir);
    return () => window.removeEventListener('jarvis:stories-de', abrir);
  }, []);
  useMensajes('diseno', () => recargar());
  if (!data) return <div className="panel panel-pad vacio">{error ? `No se han podido cargar las stories: ${error}` : 'Cargando…'}</div>;
  const actual = data.guiones.find((g) => g.id === sel) || data.guiones[0] || null;
  return (
    <div className={`stories-grid${actual?.diseno ? ' con-chat' : ''}`}>
      <div className="panel panel-pad diseno-lista">
        <button type="button" className="btn stories-nuevo" onClick={() => setNuevo({})}><Icon name="plus" size={14} />Nuevo guion de stories</button>
        <div className="label" style={{ margin: '12px 0 8px' }}>Tus stories</div>
        {!data.guiones.length && <p className="ayuda">Aún no hay ninguna. Crea el guion de stories de un carrusel o un reel (o de un tema) y luego diséñalas con tu sistema.</p>}
        {data.guiones.map((g) => (
          <button key={g.id} type="button" className={`diseno-item${actual?.id === g.id ? ' on' : ''}`} onClick={() => elegir(g.id)}>
            <span className="diseno-mini story" style={g.diseno?.previa ? { backgroundImage: `url("${g.diseno.previa}")` } : undefined}>{!g.diseno?.previa && <Icon name="layers" size={14} />}</span>
            <span className="diseno-item-txt">
              <b>{g.titulo}</b>
              <small>{g.pieza ? `De ${g.pieza.formato.toLowerCase()}` : g.tema ? 'De un tema' : 'A mano'} · {nStories(g.guion) || g.cantidad} stories</small>
              <small className={g.estado === 'error' ? 't-err' : ''}>{g.estado === 'escribiendo' ? 'JARVIS escribiendo el guion…' : g.estado === 'error' ? 'Con error' : g.diseno ? (g.diseno.estado === 'listo' ? 'Diseñadas' : 'Diseñando…') : g.guion ? 'Guion listo' : 'Sin guion'}</small>
            </span>
          </button>
        ))}
      </div>
      {actual
        ? <Detalle key={actual.id} g={actual} data={data} piezas={piezas} ig={ig} onVisor={(v) => onVisor(v.archivos, v.inicio)} onAbrir={onAbrir} onProgramar={onProgramar} recargar={recargar} onBorrado={() => { elegir(null); recargar(); }} />
        : <div className="panel panel-pad diseno-vacio"><Icon name="layers" size={22} /><p>De cada carrusel o reel, JARVIS te escribe el guion de stories para moverlo; cuando el guion está, Claude las diseña con tu sistema de diseño y las exportas a la biblioteca.</p><button className="btn" onClick={() => setNuevo({})}><Icon name="plus" size={14} />Nuevo guion de stories</button></div>}
      {actual?.diseno && (
        <ChatJarvis
          conversacion="diseno"
          titulo="Ajustar con Claude"
          subtitulo={`Sobre las stories «${actual.titulo}»`}
          placeholder="Ej.: en la 2 pon la encuesta más abajo y cambia el color del titular"
          intro="Pídele cambios en el diseño de las stories: textos, orden, colores, otra composición… Claude lo vuelve a dibujar y revisa que todo quepa."
          prefijo={`[Diseño #${actual.diseno.id}]`}
          mostrarPregunta={(t) => (/^Diseña el diseño #\d+/.test(t) ? `Diseñar «${(/Título: (.*)/.exec(t) || [])[1] || 'las stories'}»` : t.replace(/^\[Diseño #\d+\]\s*/, ''))}
          conGuardarGuion={false}
        />
      )}
      {nuevo && <NuevoGuion data={data} piezas={piezas} inicial={nuevo.pieza || null} onClose={() => setNuevo(null)} onCreado={(g) => { setNuevo(null); elegir(g.id); recargar(); }} />}
    </div>
  );
}
