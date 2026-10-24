import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import CampoCaption from '../../components/CampoCaption.jsx';
import GenerarPortada, { esFormatoVideo } from './Portada.jsx';
import { ResultadosPieza } from './Resultados.jsx';
import { api, useMensajes, useRecurso } from '../../lib/api.js';
import { colorCategoria } from '../../lib/categorias.js';
import { markdownANegrita } from '../../lib/negrita.js';
import { diaLargo, hoyIso, sumarDias } from '../../lib/fechas.js';
import { NOMBRE_TIPO_IG, planDePublicacion } from '../../lib/planIg.js';
import { CampoLeadMagnet, OBJETIVOS, OpcionesCarpetas, useFases, MAX_CAPTION, Miniatura, Modal, TIPOS, borrarArchivo, esMedio, esStory, esVideo, subirArchivo, tamanoLegible, tipoDe } from './comun.jsx';
import { GenerarLeadMagnet, OtraVersion } from './Generar.jsx';
import CajaGuion from './Guion.jsx';
import ElegirBiblioteca from './ElegirBiblioteca.jsx';
import EstiloStories from './EstiloStories.jsx';
import PortadaReel from './PortadaReel.jsx';

// Caption con IA: JARVIS lo escribe con tu voz a partir de lo que tenga la pieza (título, guion, lead magnet…)
const crearCaption = async (datos) => {
  const { caption, leido = {}, avisos = [] } = await api('/api/caption', { method: 'POST', body: { titulo: datos.titulo, formato: datos.formato, nota: datos.nota || null, caption: datos.caption, leadmagnet: Boolean(datos.leadmagnet), leadmagnet_url: datos.leadmagnet_url || null, archivos: (datos.archivos || []).map((a) => ({ path: a.path, mime: a.mime, nombre: a.nombre })) } });
  // Qué ha tenido en cuenta (para saber si ha escuchado el vídeo o leído las slides)
  const visto = [leido.transcripciones && 'escuchado el vídeo', leido.imagenes && `${leido.imagenes} ${leido.imagenes === 1 ? 'imagen' : 'imágenes'}`].filter(Boolean).join(' y ');
  return { texto: markdownANegrita(caption), nota: [visto && `ha usado ${visto}`, ...avisos].filter(Boolean).join(' · ') }; // la negrita se ve ya como en Instagram
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
      {onAhora && <button type="button" className="btn btn-sec caja-ig-ahora" onClick={onAhora} disabled={ocupado}><Icon name="send" size={13} />Publicar ahora en Instagram</button>}
    </div>
  );
}

// ---------- Ficha de una pieza: nueva o para editar ----------
// piezas y pilares: para enseñar de dónde sale y qué ha salido de ella, y sugerir pilares.
// onDerivada: abre una pieza nueva que sale de esta (p. ej. el carrusel de un reel).
// El botón de la estrategia que cubre la pieza (LM, Viral, Educar…): los de publicaciones o los de stories
function CampoCategoria({ valor, story, onCambio }) {
  const [cats] = useRecurso('/api/estrategia/categorias', null);
  if (!cats?.post) return null;
  const lista = [...new Set([...(story ? cats.stories : cats.post), ...(valor ? [valor] : [])])];
  return (
    <>
      <label className="campo-et">Tipo de contenido <span className="ayuda">(de tu estrategia)</span></label>
      <div className="pildoras">
        {lista.map((c) => (
          <button type="button" key={c} className={valor === c ? 'on' : ''} style={valor === c ? { '--c': colorCategoria(c) } : undefined} onClick={() => onCambio(valor === c ? '' : c)}>
            <span className="punto" style={{ background: colorCategoria(c) }} />{c}
          </button>
        ))}
      </div>
    </>
  );
}

export function EditorContenido({ pieza, carpetas, ig, onClose, onGuardado, onVisor, onRepublicar, piezas = [], pilares = [], onAbrir, onDerivada }) {
  const ESTADOS = useFases();
  const nueva = !pieza.id;
  const [d, setD] = useState(() => ({
    titulo: pieza.titulo || '', carpeta: pieza.carpeta || '', formato: tipoDe(pieza.formato)?.id || pieza.formato || 'Reel',
    estado: pieza.estado || 'idea', fecha: pieza.fecha || '', hora: pieza.hora || '', caption: pieza.caption || '', video_url: pieza.video_url || '',
    publicar_ig: Boolean(pieza.publicar_ig), leadmagnet: Boolean(pieza.leadmagnet), leadmagnet_url: pieza.leadmagnet_url || '',
    pilar: pieza.pilar || '', objetivo: pieza.objetivo || '', gancho: pieza.gancho || '', cta: pieza.cta || '', categoria: pieza.categoria || '',
  }));
  const padre = pieza.padre_id ? piezas.find((p) => p.id === pieza.padre_id) : null;
  const derivadas = pieza.id ? piezas.filter((p) => p.padre_id === pieza.id) : [];
  const [archivos, setArchivos] = useState(pieza.archivos || []);
  const [portada, setPortada] = useState(pieza.portada || null); // la de un reel (Instagram la usa de cover)
  const [generandoPortada, setGenerandoPortada] = useState(false);
  const [avisoPortada, setAvisoPortada] = useState('');
  // La portada se hace en segundo plano: cuando está, el servidor la pone en la pieza y aquí se refleja
  const ponerPortadaHecha = (a, comoPortada = esFormatoVideo(d.formato)) => {
    if (comoPortada) setPortada(a);
    else setArchivos((l) => (l.some((x) => x.path === a.path) ? l : [a, ...l]));
    setAvisoPortada('✓ Portada añadida.');
  };
  useMensajes('portada', (e) => { if (pieza.id && e.pieza === pieza.id) ponerPortadaHecha(e.archivo, e.comoPortada); });
  // Generar lead magnet / la otra versión (vídeo o imagen)
  const [generando, setGenerando] = useState(null); // null | 'leadmagnet' | 'video' | 'imagen'
  const [avisoGenerar, setAvisoGenerar] = useState('');
  const [version, setVersion] = useState(null); // la otra versión en marcha o lista (del servidor)
  const cargarVersion = () => { if (pieza.id) api(`/api/piezas/${pieza.id}/convertir`).then(setVersion).catch(() => {}); };
  useEffect(cargarVersion, [pieza.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useMensajes('conversion', (e) => { if (e.pieza === pieza.id) cargarVersion(); });
  const subidos = useRef(new Set()); // subidos en esta edición: si se cancela, se borran
  const [quitados, setQuitados] = useState([]); // ya guardados y quitados ahora: se borran al guardar
  const [subiendo, setSubiendo] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState('');
  const [sobre, setSobre] = useState(false);
  const [fichaCompleta, setFichaCompleta] = useState(false);
  const [viendoEstilo, setViendoEstilo] = useState(false);
  const [eligiendo, setEligiendo] = useState(false);
  const [deBiblioteca, setDeBiblioteca] = useState([]); // piezas de la biblioteca elegidas aquí: al guardar, salen de ella
  const input = useRef(null);
  const titulo = useRef(null);
  const guion = useRef(null);
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
  // Lo elegido de la biblioteca: sus archivos se añaden (sin repetir) y, si aquí faltan, su caption, portada y lead magnet
  const elegirDeBiblioteca = (elegidas) => {
    setEligiendo(false);
    const nuevos = elegidas.flatMap(({ pieza: p }) => p.archivos);
    setArchivos((x) => [...x, ...nuevos.filter((a, i) => !x.some((y) => y.path === a.path) && nuevos.findIndex((b) => b.path === a.path) === i)]);
    const conCaption = elegidas.find(({ pieza: p }) => p.caption)?.pieza;
    const conLm = elegidas.find(({ pieza: p }) => p.leadmagnet)?.pieza;
    // Si aún no tenía nada, toma también el tipo de lo elegido (un carrusel sigue siendo carrusel)
    const tipo = !archivos.length && elegidas.length === 1 ? tipoDe(elegidas[0].pieza.formato)?.id : null;
    setD((x) => ({
      ...x,
      ...(tipo ? { formato: tipo } : {}),
      ...(!x.caption.trim() && conCaption ? { caption: conCaption.caption } : {}),
      ...(!x.leadmagnet && conLm ? { leadmagnet: true, leadmagnet_url: conLm.leadmagnet_url || '' } : {}),
    }));
    const conPortada = elegidas.find(({ pieza: p }) => p.portada)?.pieza;
    if (!portada && conPortada) setPortada(conPortada.portada);
    setDeBiblioteca((l) => [...new Set([...l, ...elegidas.filter((e) => e.mover).map((e) => e.pieza.id)])]);
  };
  // Cambiar la portada del reel: la de antes se borra (ya, si se subió ahora; al guardar, si ya estaba guardada)
  const cambiarPortada = (a) => {
    if (portada && portada.path !== a?.path && !archivos.some((x) => x.path === portada.path)) {
      if (subidos.current.has(portada.path)) { subidos.current.delete(portada.path); borrarArchivo(portada); } else setQuitados((x) => [...x, portada]);
    }
    setPortada(a);
  };
  // Una foto subida con el vídeo pasa a ser su portada (en un reel no puede ir como archivo)
  const usarDePortada = (a) => { setArchivos((x) => x.filter((y) => y !== a)); cambiarPortada(a); };
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
  // «Generar vídeo» si hay fotos; «Generar imagen» si hay vídeos (con las dos cosas, salen los dos botones)
  const conFotos = archivos.some((a) => /^image\//.test(a.mime));
  const conVideos = archivos.some((a) => /^video\//.test(a.mime));
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
    const body = { ...d, categoria: d.categoria || null, pilar: d.pilar.trim() || null, objetivo: d.objetivo || null, gancho: d.gancho.trim() || null, cta: d.cta.trim() || null, ...(nueva && pieza.padre_id ? { padre_id: pieza.padre_id } : {}), ...(nueva && pieza.origen_ref ? { origen_ref: pieza.origen_ref } : {}), carpeta: d.carpeta || null, fecha: d.fecha || null, hora: d.hora || null, archivos, portada: esFormatoVideo(d.formato) ? portada : null, publicar_ig: ahora ? false : conIg ? d.publicar_ig : false, leadmagnet_url: d.leadmagnet ? d.leadmagnet_url.trim() || null : null };
    if (!conIg) delete body.publicar_ig;
    try {
      await guion.current?.guardar();
      const r = nueva ? await api('/api/piezas', { method: 'POST', body }) : await api(`/api/piezas/${pieza.id}`, { method: 'PATCH', body });
      subidos.current.clear();
      for (const a of quitados) borrarArchivo(a);
      // Lo que se trajo de la biblioteca ya está en esta pieza: sale de la biblioteca (si se quitó todo, se queda)
      const usadas = new Set([...archivos, ...(portada ? [portada] : [])].map((a) => a.path));
      for (const id of deBiblioteca) {
        const b = piezas.find((p) => p.id === id);
        if (b && id !== r.id && b.archivos.some((a) => usadas.has(a.path))) await api(`/api/piezas/${id}`, { method: 'DELETE' }).catch(() => {});
      }
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
  // Una story solo lleva título, fecha, tipo de contenido y guion (el resto, con «Ver todos los campos»)
  const soloStory = d.formato === 'Story' && !fichaCompleta;
  return (
    <Modal titulo={nueva ? 'Nuevo contenido' : soloStory ? 'Story' : 'Editar contenido'} onClose={cerrar} ancho={soloStory ? 860 : 960} cerrarFuera={false} clase="editor-c">
      <form className={`editor-grid${soloStory ? ' solo-story' : ''}`} onSubmit={guardar}>
        <div className="editor-datos">
          <label className="campo-et">Título</label>
          <input ref={titulo} className="campo" value={d.titulo} onChange={cambia('titulo')} placeholder={soloStory ? 'De qué va la story' : '3 errores al grabar un reel'} maxLength={200} />
          {soloStory && <div className="ayuda">Es una story. <button type="button" className="link-btn" onClick={() => setFichaCompleta(true)}>Ver todos los campos</button> (formato, estado, caption, archivos…)</div>}
          {!soloStory && carpetas.length > 0 && (
            <>
              <label className="campo-et">Carpeta</label>
              <select className="campo" value={d.carpeta} onChange={cambia('carpeta')}>
                <option value="">Sin carpeta</option>
                <OpcionesCarpetas carpetas={carpetas} />
              </select>
            </>
          )}
          {!soloStory && (
            <>
              <label className="campo-et">Tipo</label>
              <Pildoras opciones={TIPOS} valor={d.formato} onCambio={cambia('formato')} />
              <label className="campo-et">Estado</label>
              <Pildoras opciones={ESTADOS} valor={d.estado} onCambio={cambia('estado')} color />
            </>
          )}
          {!soloStory && (padre || pieza.origen_ref || derivadas.length > 0 || (!nueva && onDerivada)) && (
            <div className="origen-pieza">
              {padre && <span>Sale de <button type="button" className="link-btn" onClick={() => onAbrir?.(padre)}>«{padre.titulo}»</button></span>}
              {!padre && pieza.origen_ref && <span>Sale de {pieza.origen_ref.replace(/^laboratorio:/, 'Laboratorio · ')}</span>}
              {derivadas.length > 0 && (
                <span>De aquí {derivadas.length === 1 ? 'sale' : 'salen'}: {derivadas.map((x, i) => <span key={x.id}>{i ? ', ' : ''}<button type="button" className="link-btn" onClick={() => onAbrir?.(x)}>«{x.titulo}»</button></span>)}</span>
              )}
              {!nueva && onDerivada && <button type="button" className="link-btn" onClick={() => onDerivada({ titulo: '', estado: 'idea', archivos: [], padre_id: pieza.id, pilar: d.pilar, objetivo: d.objetivo, carpeta: d.carpeta })}>+ Sacar otra pieza de esta</button>}
            </div>
          )}
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
          {!soloStory && (
            <>
              <label className="campo-et">Objetivo</label>
              <div className="pildoras">
                {OBJETIVOS.map((o) => (
                  <button type="button" key={o.id} title={o.ayuda} className={d.objetivo === o.id ? 'on' : ''} style={d.objetivo === o.id ? { '--c': o.color } : undefined} onClick={() => setD((x) => ({ ...x, objetivo: x.objetivo === o.id ? '' : o.id }))}>
                    <span className="punto" style={{ background: o.color }} />{o.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <CampoCategoria valor={d.categoria} story={d.formato === 'Story'} onCambio={(v) => setD((x) => ({ ...x, categoria: v }))} />
          <label className="campo-et">Guion</label>
          {nueva ? <div className="ayuda">Guarda la pieza y vuelve a abrirla para escribir su guion (a mano o con IA).</div> : <CajaGuion ref={guion} pieza={pieza} />}
          {/* Una story también se sube y se programa: su archivo va a la derecha y aquí, publicarla sola en Instagram */}
          {d.formato === 'Story' && <button type="button" className="link-btn estilo-stories-enlace" onClick={() => setViendoEstilo(true)} title="Tu CLAUDE.md y tus stories de ejemplo: JARVIS los sigue al escribir el guion"><Icon name="doc" size={12} /> Tu estilo de stories (CLAUDE.md y ejemplos)</button>}
          {viendoEstilo && <EstiloStories onClose={() => setViendoEstilo(false)} />}
          {soloStory && <CajaInstagram ig={ig} pieza={pieza} plan={plan} marcado={d.publicar_ig} onMarcar={marcarIg} ocupado={ocupado} onAhora={conIg ? () => guardar(null, { ahora: true }) : null} onConvertir={convertirAJpg} onRepublicar={null} />}
          {!soloStory && (
          <>
          <label className="campo-et">Caption <span className={`contador${largo ? ' pasado' : ''}`}>{d.caption.length} / {MAX_CAPTION}</span></label>
          <CampoCaption rows={7} value={d.caption} onChange={cambia('caption')} placeholder="El texto que acompaña a la publicación…" onIA={() => crearCaption({ ...d, nota: pieza.nota, archivos })} />
          <CampoLeadMagnet activo={d.leadmagnet} url={d.leadmagnet_url} onCambio={(c) => setD((x) => ({ ...x, ...c }))} />
          {/* Programar y publicar en Instagram se hace desde «Programar» (biblioteca o calendario); aquí solo se ve cómo está */}
          <CajaInstagram ig={ig} pieza={pieza} plan={plan} marcado={d.publicar_ig} onMarcar={marcarIg} ocupado={ocupado} onAhora={conIg ? () => guardar(null, { ahora: true }) : null} onConvertir={convertirAJpg} onRepublicar={!nueva && onRepublicar ? () => { cerrar(); onRepublicar(pieza); } : null} />
          <div className="generar-botones">
            {d.formato !== 'Story' && !esFormatoVideo(d.formato) && <button type="button" className="btn btn-sec" onClick={() => setGenerandoPortada(true)} disabled={ocupado} title={esFormatoVideo(d.formato) ? 'Con tu sistema de diseño; queda como portada del reel' : 'Con tu sistema de diseño; entra como primera imagen'}><Icon name="sparkle" size={14} />Generar portada</button>}
            <button type="button" className="btn btn-sec" onClick={() => setGenerando('leadmagnet')} disabled={ocupado || nueva} title={nueva ? 'Guarda la pieza primero' : 'JARVIS hace el lead magnet de esta pieza'}><Icon name="target" size={14} />Generar lead magnet</button>
            {conFotos && <button type="button" className="btn btn-sec" onClick={() => setGenerando('video')} disabled={ocupado || nueva || version?.estado === 'haciendo'} title={nueva ? 'Guarda la pieza primero' : 'Saca la versión en vídeo y añade a la pieza los que elijas'}><Icon name="play" size={14} />Generar vídeo</button>}
            {conVideos && <button type="button" className="btn btn-sec" onClick={() => setGenerando('imagen')} disabled={ocupado || nueva || version?.estado === 'haciendo'} title={nueva ? 'Guarda la pieza primero' : 'Saca la versión en imagen y añade a la pieza las que elijas'}><Icon name="eye" size={14} />Generar imagen</button>}
          </div>
          {avisoPortada && <div className="ayuda">{avisoPortada}</div>}
          {avisoGenerar && <div className="aviso ok">{avisoGenerar}</div>}
          </>
          )}
        </div>

        {(
        <div className="editor-archivos">
          <label className="campo-et">{soloStory ? 'La story (foto o vídeo)' : 'Contenido (vídeos y fotos)'}</label>
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
          <button type="button" className="btn btn-sec editor-elegir-bib" onClick={() => setEligiendo(true)} disabled={ocupado}><Icon name="book" size={14} />Elegir de la biblioteca</button>
          {eligiendo && <ElegirBiblioteca piezas={piezas} carpetas={carpetas} excluir={[pieza.id, ...deBiblioteca].filter(Boolean)} onElegir={elegirDeBiblioteca} onClose={() => setEligiendo(false)} />}
          <div className="archivos-grid">
            {archivos.map((a, i) => (
              <div key={a.path || a.url} className="archivo" title={`${a.nombre} · ${tamanoLegible(a.tamano)}`}>
                <Miniatura p={{ archivos: [a] }} onClick={() => onVisor(archivos, i)} />
                <span className="archivo-n">{i + 1}</span>
                <div className="archivo-acciones">
                  <button type="button" onClick={() => moverArchivo(i, -1)} disabled={i === 0} aria-label="Mover antes">←</button>
                  <button type="button" onClick={() => moverArchivo(i, 1)} disabled={i === archivos.length - 1} aria-label="Mover después">→</button>
                  {esFormatoVideo(d.formato) && /^image\//.test(a.mime) && <button type="button" onClick={() => usarDePortada(a)} aria-label="Usar como portada" title="Usar como portada del reel">🖼</button>}
                  <button type="button" onClick={() => quitar(a)} aria-label="Quitar">✕</button>
                </div>
              </div>
            ))}
          </div>
          {!archivos.length && <div className="ayuda">Se guardan en tu PC, en la carpeta data\contenido de JARVIS.</div>}
          {esFormatoVideo(d.formato) && (
            <PortadaReel archivos={archivos} portada={portada} onCambio={cambiarPortada} onSubida={(a) => subidos.current.add(a.path)} onGenerar={() => setGenerandoPortada(true)} onVisor={onVisor} ocupado={ocupado} />
          )}
        </div>
        )}
      </form>
      {!nueva && !soloStory && <ResultadosPieza pieza={{ ...pieza, estado: d.estado, fecha: d.fecha }} onVinculada={(p) => p && setD((x) => ({ ...x, estado: p.estado, fecha: p.fecha || '' }))} />}
      {!nueva && (['video', 'imagen'].includes(generando) || version) && (
        <OtraVersion
          key={version ? 'servidor' : generando}
          pieza={pieza} a={generando === 'imagen' ? 'imagen' : 'video'} estado={version}
          onCerrar={() => setGenerando(null)}
          onAnadidos={({ nuevos }) => { setArchivos((l) => [...l, ...nuevos.filter((n) => !l.some((x) => x.path === n.path))]); setGenerando(null); onGuardado?.(); }}
        />
      )}
      {generando === 'leadmagnet' && (
        <GenerarLeadMagnet
          pieza={{ ...pieza, titulo: d.titulo, cta: d.cta }}
          onClose={() => setGenerando(null)}
          onEncargado={(texto) => { setAvisoGenerar(texto); setD((x) => ({ ...x, leadmagnet: true })); setGenerando(null); }}
        />
      )}
      {error && <div className="caja-error">{error}</div>}
      {generandoPortada && (
        <GenerarPortada
          pieza={{ ...pieza, titulo: d.titulo, formato: d.formato, archivos }}
          onClose={() => setGenerandoPortada(false)}
          onHecha={(a) => ponerPortadaHecha(a)}
          onSegundoPlano={() => setAvisoPortada('JARVIS sigue haciendo la portada: se añadirá sola a la pieza (lo ves arriba, en «Trabajando»).')}
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
