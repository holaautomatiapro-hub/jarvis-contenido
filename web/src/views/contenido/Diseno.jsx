import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import ChatJarvis from '../../components/ChatJarvis.jsx';
import { api, useMensajes, useRecurso } from '../../lib/api.js';
import { Modal } from './comun.jsx';
import { Visor } from './Editor.jsx';

// Diseño: de un guion a un carrusel o unas stories con tu sistema de diseño. Claude lo diseña, JARVIS lo dibuja
// y lo revisa; tú lo ajustas en el chat y lo exportas a la biblioteca (imágenes o vídeo) para programarlo.

const NOMBRE_FORMATO = { carrusel: 'Carrusel', story: 'Stories' };
const ESTADO = {
  nuevo: ['Sin diseñar', 'var(--dim)'],
  generando: ['Claude está diseñando…', 'var(--accent-2)'],
  renderizando: ['Dibujando…', 'var(--accent-2)'],
  listo: ['Listo', 'var(--green)'],
  exportando: ['Exportando…', 'var(--orange)'],
  error: ['Con error', 'var(--red)'],
};
const seleccionGuardada = () => { try { return Number(localStorage.getItem('diseno_sel')) || null; } catch { return null; } };

export function Diseno({ piezas, ig, onAbrir, onProgramar }) {
  const [data, recargar, errorCarga] = useRecurso('/api/disenos', null);
  const [sel, setSelEstado] = useState(seleccionGuardada);
  const [nuevo, setNuevo] = useState(false);
  const [aviso, setAviso] = useState('');
  const [progreso, setProgreso] = useState({});
  const [visor, setVisor] = useState(null);
  const [importando, setImportando] = useState(false);
  const zip = useRef(null);

  const setSel = (id) => { setSelEstado(id); try { localStorage.setItem('diseno_sel', String(id || '')); } catch { /* sin localStorage */ } };
  useMensajes('diseno', (m) => {
    if (m.progreso != null) setProgreso((p) => ({ ...p, [m.id]: m.progreso }));
    else recargar();
  });

  const disenos = data?.disenos || [];
  const kit = data?.kit;
  const actual = disenos.find((d) => d.id === sel) || disenos[0] || null;
  useEffect(() => { if (actual && actual.id !== sel) setSel(actual.id); }, [actual?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const importarKit = async (f) => {
    if (!f) return;
    setImportando(true); setAviso('');
    try {
      const r = await fetch('/api/disenos/kit', { method: 'POST', headers: { 'content-type': 'application/zip' }, body: f });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      setAviso(`Sistema de diseño importado: ${j.nombre} (${j.plantillas.length} plantilla${j.plantillas.length === 1 ? '' : 's'}).`);
      recargar();
    } catch (e) { setAviso(`No se pudo importar el sistema de diseño. ${e.message}`); }
    setImportando(false);
    if (zip.current) zip.current.value = '';
  };

  return (
    <div className="diseno-vista">
      <div className="panel panel-pad diseno-kit">
        <span className="kpi-icon peque" style={{ background: 'color-mix(in srgb, var(--accent) 16%, transparent)' }}><Icon name="sparkle" size={14} color="var(--accent-2)" /></span>
        <div className="diseno-kit-txt">
          {kit?.error
            ? <><b>Tu sistema de diseño tiene un problema</b><small className="t-err">{kit.error}</small></>
            : <><b>{kit ? kit.nombre : 'Cargando…'}</b><small>{kit?.propio ? `Tu sistema de diseño · ${kit.plantillas.map((p) => p.nombre).join(' · ')}` : 'Sistema de diseño de ejemplo. Importa el tuyo para diseñar con tu marca.'}</small></>}
        </div>
        <input ref={zip} type="file" accept=".zip,application/zip" hidden onChange={(e) => importarKit(e.target.files[0])} />
        <button className="btn btn-sec" onClick={() => zip.current?.click()} disabled={importando}><Icon name="folder" size={14} />{importando ? 'Importando…' : kit?.propio ? 'Cambiar sistema (.zip)' : 'Importar mi sistema (.zip)'}</button>
        <button className="btn" onClick={() => setNuevo(true)} disabled={!kit || Boolean(kit.error)}><Icon name="plus" size={14} />Nuevo diseño</button>
      </div>
      {(aviso || errorCarga) && <div className={`aviso${/No se pudo|error/i.test(aviso || errorCarga) ? ' error' : ' ok'}`}>{aviso || `No se pudieron cargar los diseños. ${errorCarga}`}</div>}

      <div className="diseno-grid">
        <div className="panel panel-pad diseno-lista">
          <div className="label" style={{ marginBottom: 10 }}>Tus diseños</div>
          {!disenos.length && <p className="ayuda">Aún no hay diseños. Pulsa <b>Nuevo diseño</b>, elige un guion y una plantilla, y Claude lo diseña con tu sistema.</p>}
          {disenos.map((d) => (
            <button key={d.id} className={`diseno-item${actual?.id === d.id ? ' on' : ''}`} onClick={() => setSel(d.id)}>
              <span className={`diseno-mini ${d.formato}`} style={d.previas[0] ? { backgroundImage: `url("${d.previas[0]}")` } : undefined} />
              <span className="diseno-item-txt">
                <b>{d.titulo}</b>
                <small>{NOMBRE_FORMATO[d.formato]} · {d.diapositivas || '—'} {d.formato === 'story' ? 'stories' : 'diapositivas'}</small>
                <small style={{ color: ESTADO[d.estado]?.[1] }}>{d.estado === 'exportando' && progreso[d.id] != null ? `Exportando… ${progreso[d.id]}%` : ESTADO[d.estado]?.[0]}{d.exportado && d.estado === 'listo' ? ' · en la biblioteca' : ''}</small>
              </span>
            </button>
          ))}
        </div>

        {actual
          ? <DetalleDiseno d={actual} kit={kit} piezas={piezas} ig={ig} progreso={progreso[actual.id]} onVisor={setVisor} onAbrir={onAbrir} onProgramar={onProgramar} onAviso={setAviso} onBorrado={() => { setSel(null); recargar(); }} recargar={recargar} />
          : <div className="panel panel-pad diseno-vacio"><Icon name="sparkle" size={22} /><p>Elige un guion y una plantilla, y JARVIS te prepara el carrusel o las stories con tu diseño. Luego lo ajustas hablando con Claude y lo mandas a la biblioteca para programarlo.</p><button className="btn" onClick={() => setNuevo(true)} disabled={!kit || Boolean(kit.error)}><Icon name="plus" size={14} />Nuevo diseño</button></div>}

        <ChatJarvis
          conversacion="diseno"
          titulo="Ajustar con Claude"
          subtitulo={actual ? `Sobre «${actual.titulo}»` : 'Elige o crea un diseño'}
          placeholder="Ej.: en la 3 pon el chat más grande y cambia «leads» por «clientes»"
          intro="Pídele cambios en el diseño: textos, orden, colores, otra composición… Claude lo vuelve a dibujar y revisa que todo quepa."
          prefijo={actual ? `[Diseño #${actual.id}]` : ''}
          mostrarPregunta={(t) => (/^Diseña el diseño #\d+/.test(t) ? `Diseñar «${(/Título: (.*)/.exec(t) || [])[1] || 'el guion'}»` : t.replace(/^\[Diseño #\d+\]\s*/, ''))}
          conGuardarGuion={false}
          deshabilitado={actual ? '' : 'Crea o elige un diseño para hablar de él'}
        />
      </div>

      {nuevo && kit && <NuevoDiseno kit={kit} piezas={piezas} onClose={() => setNuevo(false)} onCreado={(d) => { setSel(d.id); setNuevo(false); recargar(); }} />}
      {visor && <Visor archivos={visor.archivos} inicio={visor.inicio} onClose={() => setVisor(null)} />}
    </div>
  );
}

function DetalleDiseno({ d, kit, piezas, ig, progreso, onVisor, onAbrir, onProgramar, onAviso, onBorrado, recargar }) {
  const [ocupado, setOcupado] = useState('');
  const plantilla = kit?.plantillas.find((p) => p.id === d.plantilla);
  const trabajando = ['generando', 'renderizando', 'exportando'].includes(d.estado);
  const exportadas = (d.exportado?.piezas || []).map((id) => piezas.find((p) => p.id === id)).filter(Boolean);
  const archivosVisor = d.previas.map((url, i) => ({ url, mime: 'image/jpeg', nombre: `${d.titulo} · ${i + 1}` }));

  const accion = async (nombre, fn) => {
    setOcupado(nombre); onAviso('');
    try { await fn(); recargar(); } catch (e) { onAviso(e.message); }
    setOcupado('');
  };
  const exportar = (tipo) => accion(tipo, () => api(`/api/disenos/${d.id}/exportar`, { method: 'POST', body: { tipo } }));
  const pedirCorreccion = () => accion('corregir', () => api('/api/jarvis/preguntar', { method: 'POST', body: { conversacion: 'diseno', texto: `[Diseño #${d.id}] Corrige estos avisos de la revisión y vuelve a guardar:\n${d.avisos.map((a) => `- Diapositiva ${a.diapositiva}: ${a.texto}`).join('\n')}` } }));
  const regenerar = () => {
    if (d.version && !window.confirm('Claude volverá a diseñarlo desde cero (el diseño actual se sustituye). ¿Seguir?')) return;
    accion('regenerar', () => api(`/api/disenos/${d.id}/generar`, { method: 'POST', body: {} }));
  };
  const borrar = () => {
    if (!window.confirm(`¿Borrar el diseño «${d.titulo}»? Lo que ya exportaste a la biblioteca se queda.`)) return;
    accion('borrar', async () => { await api(`/api/disenos/${d.id}`, { method: 'DELETE' }); onBorrado(); });
  };

  return (
    <div className="panel panel-pad diseno-detalle">
      <div className="panel-head">
        <div>
          <div className="label">{NOMBRE_FORMATO[d.formato]} · {plantilla?.nombre || d.plantilla}</div>
          <h2 className="diseno-titulo">{d.titulo}</h2>
        </div>
        <div className="diseno-acciones-cab">
          <button className="link-btn" onClick={regenerar} disabled={trabajando || Boolean(ocupado)}>Rediseñar</button>
          <button className="link-btn peligro" onClick={borrar} disabled={d.estado === 'exportando' || Boolean(ocupado)}>Borrar</button>
        </div>
      </div>

      {d.estado === 'generando' && <div className="aviso ig-aviso"><span className="cursor" />Claude está diseñando con tu sistema. Verás aquí cada versión en cuanto la guarde.</div>}
      {d.estado === 'renderizando' && <div className="aviso ig-aviso">Dibujando la vista previa…</div>}
      {d.estado === 'exportando' && (
        <div className="diseno-progreso"><span>Exportando a la biblioteca… {progreso ?? 0}%</span><div className="bar"><span style={{ width: `${progreso ?? 0}%`, background: 'var(--accent-2)' }} /></div></div>
      )}
      {d.error && <div className="caja-error">{d.error}</div>}

      {d.previas.length > 0 ? (
        <div className={`diseno-previas ${d.formato}`}>
          {d.previas.map((url, i) => (
            <button key={url} className="diseno-previa" onClick={() => onVisor({ archivos: archivosVisor, inicio: i })} title="Ver en grande">
              <img src={url} alt={`Diapositiva ${i + 1}`} loading="lazy" />
              <span className="diseno-n">{i + 1}</span>
              {d.avisos.some((a) => a.diapositiva === i + 1) && <span className="diseno-alerta" title="Tiene avisos">!</span>}
            </button>
          ))}
        </div>
      ) : !trabajando && <p className="ayuda">Este diseño aún no tiene diapositivas. Pulsa <b>Rediseñar</b> o pídeselo a Claude en el chat.</p>}

      {d.avisos.length > 0 && (
        <div className="diseno-avisos">
          <div className="label">Revisión: {d.avisos.length} aviso{d.avisos.length === 1 ? '' : 's'}</div>
          <ul>{d.avisos.map((a, i) => <li key={i}><b>{a.diapositiva}</b> {a.texto}</li>)}</ul>
          <button className="btn btn-sec" onClick={pedirCorreccion} disabled={trabajando || Boolean(ocupado)}>Pedir a Claude que lo corrija</button>
        </div>
      )}
      {d.previas.length > 0 && !d.avisos.length && d.estado === 'listo' && <div className="aviso ok">Revisión sin avisos: todo cabe y nada se pisa.</div>}

      {d.caption && (
        <details className="diseno-caption">
          <summary>Caption</summary>
          <p>{d.caption}</p>
        </details>
      )}

      {d.previas.length > 0 && (
        <div className="diseno-exportar">
          <div>
            <div className="label">Exportar a la biblioteca</div>
            <p className="ayuda">{d.formato === 'story' ? 'Cada story será una pieza, todas en una carpeta con el nombre del diseño.' : 'Será una pieza de tipo Carrusel con su caption, lista para programar.'} El vídeo tarda unos 15 s por diapositiva.</p>
          </div>
          <div className="diseno-botones">
            <button className="btn btn-sec" onClick={() => exportar('jpg')} disabled={trabajando || Boolean(ocupado)}><Icon name="doc" size={14} />Imágenes (JPG)</button>
            <button className="btn" onClick={() => exportar('mp4')} disabled={trabajando || Boolean(ocupado)}><Icon name="play" size={14} />Vídeo (MP4)</button>
          </div>
        </div>
      )}

      {exportadas.length > 0 && (
        <div className="diseno-exportado">
          <Icon name="checkCircle" size={16} color="var(--green)" />
          <span>En la biblioteca como {d.exportado.tipo === 'mp4' ? 'vídeo' : 'imágenes'}{exportadas.length > 1 ? ` (${exportadas.length} stories)` : ''}.</span>
          {exportadas.length === 1 && <>
            <button className="link-btn" onClick={() => onProgramar(exportadas[0])}>Programar…</button>
            <button className="link-btn" onClick={() => onAbrir(exportadas[0])}>{ig?.disponible ? 'Abrir y publicar' : 'Abrir'}</button>
          </>}
          {exportadas.length > 1 && <button className="link-btn" onClick={() => onAbrir(exportadas[0])}>Abrir la primera</button>}
        </div>
      )}
    </div>
  );
}

function NuevoDiseno({ kit, piezas, onClose, onCreado }) {
  const formatos = useMemo(() => ['carrusel', 'story'].filter((f) => kit.plantillas.some((p) => p.formatos.includes(f))), [kit]);
  const [formato, setFormato] = useState(formatos[0] || 'carrusel');
  const deFormato = kit.plantillas.filter((p) => p.formatos.includes(formato));
  const [plantilla, setPlantilla] = useState(deFormato[0]?.id || '');
  const conGuion = useMemo(() => piezas.filter((p) => p.estado !== 'publicado').sort((a, b) => (b.estado === 'guion') - (a.estado === 'guion') || Boolean(b.nota) - Boolean(a.nota)), [piezas]);
  const [origen, setOrigen] = useState(conGuion.some((p) => p.estado === 'guion') ? 'pieza' : 'texto');
  const [piezaId, setPiezaId] = useState(conGuion[0]?.id || '');
  const [guion, setGuion] = useState('');
  const [titulo, setTitulo] = useState('');
  const [indicaciones, setIndicaciones] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { if (!deFormato.some((p) => p.id === plantilla)) setPlantilla(deFormato[0]?.id || ''); }, [formato]); // eslint-disable-line react-hooks/exhaustive-deps

  const crear = async () => {
    if (origen === 'texto' && !guion.trim()) return setError('Pega el guion.');
    if (origen === 'pieza' && !piezaId) return setError('Elige la pieza con el guion.');
    setEnviando(true); setError('');
    try {
      const d = await api('/api/disenos', { method: 'POST', body: { formato, plantilla, titulo: titulo.trim() || undefined, indicaciones: indicaciones.trim() || undefined, ...(origen === 'pieza' ? { pieza_id: Number(piezaId) } : { guion }) } });
      onCreado(d);
    } catch (e) { setError(e.message); setEnviando(false); }
  };

  return (
    <Modal titulo={<><Icon name="sparkle" size={14} /> Nuevo diseño</>} onClose={onClose} ancho={620}>
      <label className="campo-et">Qué vas a diseñar</label>
      <div className="seg seg-ancho">
        {formatos.map((f) => <button key={f} type="button" className={formato === f ? 'on' : ''} onClick={() => setFormato(f)}>{NOMBRE_FORMATO[f]}</button>)}
      </div>
      <label className="campo-et">Plantilla</label>
      <div className="diseno-plantillas">
        {deFormato.map((p) => (
          <button key={p.id} type="button" className={`modo${plantilla === p.id ? ' on' : ''}`} onClick={() => setPlantilla(p.id)}>
            <b>{p.nombre}</b>{p.descripcion && <small>{p.descripcion}</small>}
          </button>
        ))}
      </div>
      <label className="campo-et">Guion</label>
      <div className="seg seg-ancho seg-mini">
        <button type="button" className={origen === 'pieza' ? 'on' : ''} onClick={() => setOrigen('pieza')} disabled={!conGuion.length}>De una pieza</button>
        <button type="button" className={origen === 'texto' ? 'on' : ''} onClick={() => setOrigen('texto')}>Pegarlo</button>
      </div>
      {origen === 'pieza'
        ? (
          <select className="campo" value={piezaId} onChange={(e) => setPiezaId(e.target.value)} style={{ marginTop: 8 }}>
            {conGuion.map((p) => <option key={p.id} value={p.id}>{p.estado === 'guion' ? '✎ ' : ''}{p.titulo}{p.nota ? '' : ' (sin nota de guion)'}</option>)}
          </select>
        )
        : <textarea className="campo" rows={7} value={guion} onChange={(e) => setGuion(e.target.value)} placeholder="Pega aquí el guion: el gancho, una idea por diapositiva y el cierre con la palabra clave…" style={{ marginTop: 8 }} />}
      <label className="campo-et">Título <small className="t-dim">(opcional)</small></label>
      <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Si lo dejas vacío, se usa el del guion" />
      <label className="campo-et">Indicaciones para Claude <small className="t-dim">(opcional)</small></label>
      <textarea className="campo" rows={3} value={indicaciones} onChange={(e) => setIndicaciones(e.target.value)} placeholder="Ej.: palabra clave SETTER; en la portada usa mi vídeo «jose-respuesta» de la biblioteca; 6 diapositivas" />
      <p className="ayuda" style={{ marginTop: 10 }}>Claude (Opus) lo diseña con tu sistema y JARVIS revisa que nada se salga ni se pise. Suele tardar 2-5 minutos.</p>
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        <span />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sec" onClick={onClose}>Cancelar</button>
          <button className="btn" onClick={crear} disabled={enviando || !plantilla}><Icon name="sparkle" size={14} />{enviando ? 'Enviando…' : 'Diseñar con Claude'}</button>
        </div>
      </div>
    </Modal>
  );
}
