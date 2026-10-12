import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import CampoCaption from '../../components/CampoCaption.jsx';
import GenerarPortada, { esFormatoVideo } from './Portada.jsx';
import { api } from '../../lib/api.js';
import { markdownANegrita } from '../../lib/negrita.js';
import { diaLargo, hoyIso, sumarDias } from '../../lib/fechas.js';
import { NOMBRE_TIPO_IG, planDePublicacion } from '../../lib/planIg.js';
import { CampoLeadMagnet, OpcionesCarpetas, useFases, MAX_CAPTION, Miniatura, Modal, TIPOS, borrarArchivo, esMedio, esStory, esVideo, subirArchivo, tamanoLegible, tipoDe } from './comun.jsx';

// Caption con IA: JARVIS lo escribe con tu voz a partir de lo que tenga la pieza (título, guion, lead magnet…)
const crearCaption = async (datos) => {
  const { caption } = await api('/api/caption', { method: 'POST', body: { titulo: datos.titulo, formato: datos.formato, nota: datos.nota || null, caption: datos.caption, leadmagnet: Boolean(datos.leadmagnet), leadmagnet_url: datos.leadmagnet_url || null, archivos: (datos.archivos || []).map((a) => a.nombre) } });
  return markdownANegrita(caption); // la negrita se ve ya como en Instagram
};

// ---------- Visor a pantalla completa ----------
export function Visor({ archivos, inicio = 0, onClose }) {
  const [i, setI] = useState(inicio);
  const n = archivos.length;
  useEffect(() => {
    // En fase de captura: la ficha de debajo no recibe estas teclas
    const tecla = (e) => {
      if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(e.key)) return;
      e.stopPropagation(); e.preventDefault();
      if (e.key === 'Escape') onClose();
      else setI((x) => (x + (e.key === 'ArrowRight' ? 1 : -1) + n) % n);
    };
    window.addEventListener('keydown', tecla, true);
    return () => window.removeEventListener('keydown', tecla, true);
  }, [n, onClose]);
  const a = archivos[i];
  if (!a) return null;
  return (
    <div className="visor" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="visor-barra">
        <span>{i + 1} / {n} · {a.nombre}</span>
        <a className="btn btn-sec" href={a.url} download={a.nombre}>Descargar</a>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar">✕</button>
      </div>
      {n > 1 && <button className="visor-flecha izq" onClick={() => setI((i - 1 + n) % n)} aria-label="Anterior">‹</button>}
      {esVideo(a) ? <video key={a.url} src={a.url} controls autoPlay playsInline /> : <img src={a.url} alt={a.nombre} />}
      {n > 1 && <button className="visor-flecha der" onClick={() => setI((i + 1) % n)} aria-label="Siguiente">›</button>}
    </div>
  );
}

function Pildoras({ opciones, valor, onCambio, color }) {
  return (
    <div className="pildoras">
      {opciones.map((o) => (
        <button
          type="button" key={o.id}
          className={valor === o.id ? 'on' : ''}
          style={valor === o.id && color ? { '--c': o.color } : undefined}
          onClick={() => onCambio(o.id)}
        >
          {o.color && <span className="punto" style={{ background: o.color }} />}{o.label || o.id}
        </button>
      ))}
    </div>
  );
}

// ---------- Publicar en Instagram (solo si tú marcas la casilla) ----------
function CajaInstagram({ ig, pieza, plan, marcado, onMarcar, onAhora, onConvertir, onRepublicar, ocupado, texto = 'Publicar sola en Instagram el día y la hora de arriba' }) {
  if (pieza.ig_estado === 'publicado') {
    return (
      <div className="caja-ig ok">
        <Icon name="instagram" size={14} /> Publicada en Instagram{pieza.ig_permalink && <> · <a href={pieza.ig_permalink} target="_blank" rel="noreferrer">verla ↗</a></>}
        {onRepublicar && <button type="button" className="link-btn caja-ig-repub" onClick={onRepublicar} disabled={ocupado}>Volver a publicar otro día</button>}
      </div>
    );
  }
  if (!ig?.disponible || ig.motivo) return <div className="caja-ig apagada"><Icon name="instagram" size={14} /><span>{ig?.motivo || 'Conecta Instagram con Facebook para publicar desde JARVIS.'}</span></div>;
  return (
    <div className={`caja-ig${marcado ? ' on' : ''}`}>
      <label className="caja-ig-check">
        <input type="checkbox" checked={marcado} onChange={(e) => onMarcar(e.target.checked)} disabled={ocupado} />
        <span><b>{texto}</b><small>en @{ig.cuenta} · JARVIS tiene que estar abierto a esa hora</small></span>
      </label>
      {pieza.ig_estado === 'procesando' && <div className="caja-ig-linea">Instagram está procesando el vídeo. Se publica en cuanto termine.</div>}
      {pieza.ig_estado === 'error' && <div className="caja-ig-linea error">No se pudo publicar: {pieza.ig_error}. Corrige lo que haga falta y guarda: se vuelve a intentar.</div>}
      {marcado && plan.problemas.length > 0 && <ul className="caja-ig-problemas">{plan.problemas.map((x) => <li key={x}>{x}</li>)}</ul>}
      {marcado && onConvertir && plan.problemas.some((x) => /no es JPG/.test(x)) && <button type="button" className="btn btn-sec caja-ig-convertir" onClick={onConvertir} disabled={ocupado}>Convertir las imágenes a JPG</button>}
      {marcado && !plan.problemas.length && <div className="caja-ig-linea ok">Se publicará como {NOMBRE_TIPO_IG[plan.tipo]}.</div>}
      {onAhora && <button type="button" className="link-btn caja-ig-ahora" onClick={onAhora} disabled={ocupado}>Publicar ahora en Instagram</button>}
    </div>
  );
}

// ---------- Ficha de una pieza: nueva o para editar ----------
export function EditorContenido({ pieza, carpetas, ig, onClose, onGuardado, onVisor, onRepublicar }) {
  const ESTADOS = useFases();
  const nueva = !pieza.id;
  const [d, setD] = useState(() => ({
    titulo: pieza.titulo || '', carpeta: pieza.carpeta || '', formato: tipoDe(pieza.formato)?.id || pieza.formato || 'Reel',
    estado: pieza.estado || 'idea', fecha: pieza.fecha || '', hora: pieza.hora || '', caption: pieza.caption || '', video_url: pieza.video_url || '',
    publicar_ig: Boolean(pieza.publicar_ig), leadmagnet: Boolean(pieza.leadmagnet), leadmagnet_url: pieza.leadmagnet_url || '',
  }));
  const [archivos, setArchivos] = useState(pieza.archivos || []);
  const [portada, setPortada] = useState(pieza.portada || null); // la de un reel (Instagram la usa de cover)
  const [generandoPortada, setGenerandoPortada] = useState(false);
  const [avisoPortada, setAvisoPortada] = useState('');
  const subidos = useRef(new Set()); // subidos en esta edición: si se cancela, se borran
  const [quitados, setQuitados] = useState([]); // ya guardados y quitados ahora: se borran al guardar
  const [subiendo, setSubiendo] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [sobre, setSobre] = useState(false);
  const input = useRef(null);
  const titulo = useRef(null);
  const ocupado = subiendo > 0 || guardando;
  const cambia = (k) => (e) => setD((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  useEffect(() => { if (nueva) titulo.current?.focus(); }, [nueva]);

  const cerrar = () => {
    if (ocupado) return;
    for (const a of archivos) if (subidos.current.has(a.path)) borrarArchivo(a);
    onClose();
  };

  // De uno en uno y en orden: no satura la conexión y conserva el orden del carrusel
  const subir = async (lista) => {
    const medios = [...lista].filter(esMedio);
    if (!medios.length) return setError('No había ninguna foto ni vídeo en lo que has elegido.');
    setError('');
    setSubiendo(medios.length);
    for (const f of medios) {
      try {
        const a = await subirArchivo(f);
        subidos.current.add(a.path);
        setArchivos((x) => [...x, a]);
      } catch (e) { setError((x) => (x ? `${x}\n` : '') + e.message); }
      setSubiendo((n) => n - 1);
    }
  };
  const quitar = (a) => {
    setArchivos((x) => x.filter((y) => y !== a));
    if (subidos.current.has(a.path)) { subidos.current.delete(a.path); borrarArchivo(a); }
    else setQuitados((x) => [...x, a]);
  };
  const moverArchivo = (i, dir) => setArchivos((x) => {
    const j = i + dir;
    if (j < 0 || j >= x.length) return x;
    const y = [...x];
    [y[i], y[j]] = [y[j], y[i]];
    return y;
  });

  const plan = planDePublicacion({ ...d, archivos });
  const conIg = ig?.disponible && !ig.motivo && pieza.ig_estado !== 'publicado';
  // Vuelve a subir como JPG las fotos que no lo son (Instagram solo publica JPG)
  const convertirAJpg = async () => {
    setError('');
    const malas = archivos.filter((a) => /^image\//.test(a.mime) && !/^image\/jpe?g$/.test(a.mime));
    setSubiendo(malas.length);
    for (const a of malas) {
      try {
        const blob = await (await fetch(a.url)).blob();
        const nuevo = await subirArchivo(new File([blob], a.nombre, { type: blob.type || a.mime }));
        if (!/^image\/jpe?g$/.test(nuevo.mime)) { borrarArchivo(nuevo); throw new Error(`«${a.nombre}» no se ha podido convertir en este navegador`); }
        subidos.current.add(nuevo.path);
        setArchivos((x) => x.map((y) => (y === a ? nuevo : y)));
        if (subidos.current.has(a.path)) { subidos.current.delete(a.path); borrarArchivo(a); } else setQuitados((x) => [...x, a]);
      } catch (e) { setError((x) => (x ? `${x}\n` : '') + e.message); }
      setSubiendo((n) => n - 1);
    }
  };
  const marcarIg = (v) => setD((x) => ({ ...x, publicar_ig: v, estado: v && x.estado !== 'publicado' ? 'listo' : x.estado }));

  // ahora = true: guarda y publica en Instagram sin esperar a la fecha
  const guardar = async (e, { ahora = false } = {}) => {
    e?.preventDefault?.();
    if (ocupado) return;
    if (!d.titulo.trim()) return setError('Ponle un título.');
    if (d.publicar_ig && conIg && plan.problemas.length) return setError(`Para publicarla en Instagram falta: ${plan.problemas.join(' ')}`);
    if (ahora) {
      const p = planDePublicacion({ ...d, archivos }, { conFecha: false });
      if (p.problemas.length) return setError(`Para publicarla en Instagram falta: ${p.problemas.join(' ')}`);
      if (!window.confirm(`¿Publicar «${d.titulo}» en Instagram ahora, en @${ig.cuenta}? Se publica como ${NOMBRE_TIPO_IG[p.tipo]} y no se puede deshacer desde JARVIS.`)) return;
    }
    setGuardando(true); setError('');
    if (d.leadmagnet && d.leadmagnet_url && !/^https?:\/\//i.test(d.leadmagnet_url)) return setError('El enlace del lead magnet debe empezar por https://');
    const body = { ...d, carpeta: d.carpeta || null, fecha: d.fecha || null, hora: d.hora || null, archivos, portada: esFormatoVideo(d.formato) ? portada : null, publicar_ig: ahora ? false : conIg ? d.publicar_ig : false, leadmagnet_url: d.leadmagnet ? d.leadmagnet_url.trim() || null : null };
    if (!conIg) delete body.publicar_ig;
    try {
      const r = nueva ? await api('/api/piezas', { method: 'POST', body }) : await api(`/api/piezas/${pieza.id}`, { method: 'PATCH', body });
      subidos.current.clear();
      for (const a of quitados) borrarArchivo(a);
      if (ahora) await api(`/api/piezas/${r.id}/instagram/ahora`, { method: 'POST' });
      onGuardado(); onClose();
    } catch (err) { setError(err.message); setGuardando(false); }
  };
  const eliminar = async () => {
    if (!window.confirm(`¿Eliminar «${pieza.titulo}» y sus archivos?`)) return;
    try {
      for (const a of archivos) if (subidos.current.has(a.path)) borrarArchivo(a);
      await api(`/api/piezas/${pieza.id}`, { method: 'DELETE' });
      onGuardado(); onClose();
    } catch (err) { setError(err.message); }
  };

  const largo = d.caption.length > MAX_CAPTION;
  return (
    <Modal titulo={nueva ? 'Nuevo contenido' : 'Editar contenido'} onClose={cerrar} ancho={960} cerrarFuera={false} clase="editor-c">
      <form className="editor-grid" onSubmit={guardar}>
        <div className="editor-datos">
          <label className="campo-et">Título</label>
          <input ref={titulo} className="campo" value={d.titulo} onChange={cambia('titulo')} placeholder="3 errores al grabar un reel" maxLength={200} />
          {carpetas.length > 0 && (
            <>
              <label className="campo-et">Carpeta</label>
              <select className="campo" value={d.carpeta} onChange={cambia('carpeta')}>
                <option value="">Sin carpeta</option>
                <OpcionesCarpetas carpetas={carpetas} />
              </select>
            </>
          )}
          <label className="campo-et">Tipo</label>
          <Pildoras opciones={TIPOS} valor={d.formato} onCambio={cambia('formato')} />
          <label className="campo-et">Estado</label>
          <Pildoras opciones={ESTADOS} valor={d.estado} onCambio={cambia('estado')} color />
          <div className="dos-col">
            <div>
              <label className="campo-et">Fecha de publicación</label>
              <input type="date" className="campo" value={d.fecha} onChange={cambia('fecha')} />
            </div>
            <div>
              <label className="campo-et">Hora (opcional)</label>
              <input type="time" className="campo" value={d.hora} onChange={cambia('hora')} />
            </div>
          </div>
          {!d.fecha && <div className="ayuda">Sin fecha se queda en la biblioteca hasta que la programes.</div>}
          <label className="campo-et">Caption <span className={`contador${largo ? ' pasado' : ''}`}>{d.caption.length} / {MAX_CAPTION}</span></label>
          <CampoCaption rows={7} value={d.caption} onChange={cambia('caption')} placeholder="El texto que acompaña a la publicación…" onIA={() => crearCaption({ ...d, nota: pieza.nota, archivos })} />
          <label className="campo-et">URL del vídeo</label>
          <div className="fila" style={{ marginBottom: 0 }}>
            <input className="campo" value={d.video_url} onChange={cambia('video_url')} placeholder="https://drive.google.com/… o el enlace de la publicación" />
            {/^https?:\/\//i.test(d.video_url) && <a className="btn btn-sec" href={d.video_url} target="_blank" rel="noreferrer">↗ Abrir</a>}
          </div>
          <CampoLeadMagnet activo={d.leadmagnet} url={d.leadmagnet_url} onCambio={(c) => setD((x) => ({ ...x, ...c }))} />
          <CajaInstagram ig={ig} pieza={pieza} plan={plan} marcado={d.publicar_ig} onMarcar={marcarIg} ocupado={ocupado} onAhora={conIg ? () => guardar(null, { ahora: true }) : null} onConvertir={convertirAJpg} onRepublicar={!nueva && onRepublicar ? () => { cerrar(); onRepublicar(pieza); } : null} />
          {d.formato !== 'Story' && (
            <div className="portada-boton">
              <button type="button" className="btn btn-sec" onClick={() => setGenerandoPortada(true)} disabled={ocupado}><Icon name="sparkle" size={14} />Generar portada</button>
              <span className="ayuda">{avisoPortada || (esFormatoVideo(d.formato) ? 'Con tu sistema de diseño; queda como portada del reel.' : 'Con tu sistema de diseño; entra como primera imagen.')}</span>
            </div>
          )}
        </div>

        <div className="editor-archivos">
          <label className="campo-et">Contenido (vídeos y fotos)</label>
          <div
            className={`soltar${sobre ? ' sobre' : ''}`}
            onClick={() => !ocupado && input.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
            onDragLeave={() => setSobre(false)}
            onDrop={(e) => { e.preventDefault(); setSobre(false); subir(e.dataTransfer.files); }}
            role="button" tabIndex={0}
            onKeyDown={(e) => e.key === 'Enter' && input.current?.click()}
          >
            <Icon name="share" size={18} />
            <span>{subiendo ? `Subiendo ${subiendo}…` : 'Arrastra aquí o pulsa para subir'}</span>
            <input ref={input} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { subir(e.target.files); e.target.value = ''; }} />
          </div>
          {portada && esFormatoVideo(d.formato) && (
            <div className="portada-actual">
              <div className="archivo" title={portada.nombre}>
                <Miniatura p={{ archivos: [portada] }} onClick={() => onVisor([portada], 0)} />
                <span className="archivo-n">Portada</span>
                <div className="archivo-acciones"><button type="button" onClick={() => setPortada(null)} aria-label="Quitar la portada">✕</button></div>
              </div>
            </div>
          )}
          <div className="archivos-grid">
            {archivos.map((a, i) => (
              <div key={a.path || a.url} className="archivo" title={`${a.nombre} · ${tamanoLegible(a.tamano)}`}>
                <Miniatura p={{ archivos: [a] }} onClick={() => onVisor(archivos, i)} />
                <span className="archivo-n">{i + 1}</span>
                <div className="archivo-acciones">
                  <button type="button" onClick={() => moverArchivo(i, -1)} disabled={i === 0} aria-label="Mover antes">←</button>
                  <button type="button" onClick={() => moverArchivo(i, 1)} disabled={i === archivos.length - 1} aria-label="Mover después">→</button>
                  <button type="button" onClick={() => quitar(a)} aria-label="Quitar">✕</button>
                </div>
              </div>
            ))}
          </div>
          {!archivos.length && <div className="ayuda">Se guardan en tu PC, en la carpeta data\contenido de JARVIS.</div>}
        </div>
      </form>
      {error && <div className="caja-error">{error}</div>}
      {generandoPortada && (
        <GenerarPortada
          pieza={{ ...pieza, titulo: d.titulo, formato: d.formato, archivos }}
          onClose={() => setGenerandoPortada(false)}
          onHecha={(a) => {
            if (esFormatoVideo(d.formato)) setPortada(a); else setArchivos((l) => [a, ...l]);
            setAvisoPortada('✓ Portada añadida. Pulsa Guardar para quedártela.');
          }}
        />
      )}
      <div className="modal-pie">
        {nueva ? <span /> : <button type="button" className="btn btn-sec peligro" onClick={eliminar} disabled={ocupado}>Eliminar</button>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-sec" onClick={cerrar} disabled={ocupado}>Cancelar</button>
          <button type="button" className="btn" onClick={guardar} disabled={ocupado}>{guardando ? 'Guardando…' : subiendo ? 'Subiendo…' : 'Guardar'}</button>
        </div>
      </div>
    </Modal>
  );
}

// ---------- Programar: elegir día (y hora) y pasarla al calendario ----------
export function ProgramarContenido({ pieza, fecha, ig, onClose, onGuardado }) {
  const [d, setD] = useState({
    formato: tipoDe(pieza.formato)?.id || pieza.formato || 'Reel',
    fecha: fecha || pieza.fecha || sumarDias(hoyIso(), 1),
    hora: pieza.hora || '18:00',
    caption: pieza.caption || '',
    publicar_ig: Boolean(pieza.publicar_ig),
    leadmagnet: Boolean(pieza.leadmagnet),
    leadmagnet_url: pieza.leadmagnet_url || '',
  });
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const story = esStory({ formato: d.formato });
  const n = pieza.archivos?.length || 0;

  const conIg = ig?.disponible && !ig.motivo && pieza.ig_estado !== 'publicado';
  const plan = planDePublicacion({ ...pieza, ...d });
  const guardar = async () => {
    if (!d.fecha) return setError('Elige el día.');
    if (d.publicar_ig && plan.problemas.length) return setError('Corrige lo que falta para Instagram o desmarca la publicación automática.');
    if (d.leadmagnet && d.leadmagnet_url && !/^https?:\/\//i.test(d.leadmagnet_url)) return setError('El enlace del lead magnet debe empezar por https://');
    setGuardando(true);
    try {
      await api(`/api/piezas/${pieza.id}`, { method: 'PATCH', body: { formato: d.formato, fecha: d.fecha, hora: d.hora || null, ...(story ? {} : { caption: d.caption }), ...(conIg ? { publicar_ig: d.publicar_ig } : {}), leadmagnet: d.leadmagnet, leadmagnet_url: d.leadmagnet ? d.leadmagnet_url.trim() || null : null } });
      onGuardado(); onClose();
    } catch (e) { setError(e.message); setGuardando(false); }
  };

  return (
    <Modal titulo={<><Icon name="calendar" size={14} /> Programar</>} onClose={onClose} ancho={520}>
      <div className="programar-cab">
        <Miniatura p={pieza} className="peque" />
        <div><b>{pieza.titulo}</b><small>{n} archivo{n === 1 ? '' : 's'}</small></div>
      </div>
      <label className="campo-et">Tipo</label>
      <Pildoras opciones={TIPOS} valor={d.formato} onCambio={(v) => setD({ ...d, formato: v })} />
      <div className="dos-col">
        <div>
          <label className="campo-et">Día</label>
          <input type="date" className="campo" value={d.fecha} onChange={(e) => setD({ ...d, fecha: e.target.value })} />
        </div>
        <div>
          <label className="campo-et">Hora</label>
          <input type="time" className="campo" value={d.hora} onChange={(e) => setD({ ...d, hora: e.target.value })} />
        </div>
      </div>
      {!story && (
        <>
          <label className="campo-et">Caption <span className={`contador${d.caption.length > MAX_CAPTION ? ' pasado' : ''}`}>{d.caption.length} / {MAX_CAPTION}</span></label>
          <CampoCaption rows={5} value={d.caption} onChange={(v) => setD((x) => ({ ...x, caption: v }))} placeholder="El texto que acompaña a la publicación…" onIA={() => crearCaption({ ...pieza, ...d })} />
        </>
      )}
      <CampoLeadMagnet activo={d.leadmagnet} url={d.leadmagnet_url} onCambio={(c) => setD((x) => ({ ...x, ...c }))} />
      <CajaInstagram ig={ig} pieza={pieza} plan={plan} marcado={d.publicar_ig} onMarcar={(v) => setD({ ...d, publicar_ig: v })} texto="Publicar automáticamente en Instagram" />
      {d.fecha && <div className="aviso ok" style={{ marginTop: 10 }}>{d.publicar_ig && conIg && !plan.problemas.length ? `Se publicará como ${NOMBRE_TIPO_IG[plan.tipo]} el ${diaLargo(d.fecha).toLowerCase()} a las ${d.hora}.` : `Quedará en el calendario el ${diaLargo(d.fecha).toLowerCase()}${d.hora ? ` a las ${d.hora}` : ''}. La publicas tú.`}</div>}
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        <span />
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sec" onClick={onClose}>Cancelar</button>
          <button className="btn" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : d.publicar_ig && conIg ? 'Programar en Instagram' : 'Pasar al calendario'}</button>
        </div>
      </div>
    </Modal>
  );
}
