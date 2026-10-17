import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import Replicar from '../../components/Replicar.jsx';
import { api, useMensajes, useRecurso } from '../../lib/api.js';
import { hace, num } from '../../lib/formato.js';
import { BotonCopiar, Modal } from '../contenido/comun.jsx';

// Anuncios de la competencia: buscas sus cuentas en la Biblioteca de anuncios de Meta, ves todos sus anuncios
// activos (los que más tiempo llevan activos suelen ser los que les funcionan), y de cada uno su vídeo, su texto,
// la transcripción y «Adaptar a mi estilo».

const ORDENES = [
  { id: 'tiempo', label: 'Más tiempo activos', ayuda: 'Los que mantienen: los que mejor les funcionan' },
  { id: 'variantes', label: 'Más variantes', ayuda: 'El mismo texto en varios anuncios: lo están escalando' },
  { id: 'alcance', label: 'Más alcance', ayuda: 'Personas alcanzadas en la UE' },
  { id: 'recientes', label: 'Más nuevos', ayuda: 'Lo último que están probando' },
];
const ANTIGUEDAD = [[0, 'Todos'], [7, '+7 días'], [30, '+30 días'], [90, '+90 días']];

function subirVideo(id, file, onProgreso) {
  return new Promise((ok, ko) => {
    const x = new XMLHttpRequest();
    x.open('POST', `/api/ads/anuncios/${encodeURIComponent(id)}/video`);
    x.setRequestHeader('content-type', 'application/octet-stream');
    x.upload.onprogress = (e) => e.lengthComputable && onProgreso(Math.round((e.loaded / e.total) * 100));
    x.onload = () => {
      let d = {};
      try { d = JSON.parse(x.responseText); } catch { /* sin cuerpo */ }
      if (x.status >= 200 && x.status < 300) ok(d); else ko(new Error(d.error || 'No se ha podido subir el vídeo'));
    };
    x.onerror = () => ko(new Error('Se cortó la subida. Revisa la conexión y vuelve a intentarlo.'));
    x.send(file);
  });
}

function Buscador({ onSeguido }) {
  const [texto, setTexto] = useState('');
  const [estado, setEstado] = useState(null); // null | 'buscando' | { candidatos } | { error }
  const [siguiendo, setSiguiendo] = useState('');
  const buscar = async (e) => {
    e.preventDefault();
    if (texto.trim().length < 2) return;
    setEstado('buscando');
    try { setEstado(await api('/api/ads/anunciantes/buscar', { method: 'POST', body: { texto } })); } catch (err) { setEstado({ error: err.message }); }
  };
  const seguir = async (c) => {
    setSiguiendo(c.pagina_id);
    try {
      const r = await api('/api/ads/anunciantes', { method: 'POST', body: { pagina_id: c.pagina_id, nombre: c.nombre } });
      setEstado(null); setTexto('');
      onSeguido(c, r);
    } catch (err) { setEstado({ error: err.message }); }
    setSiguiendo('');
  };
  return (
    <div className="anun-buscador">
      <form onSubmit={buscar} className="anun-buscar">
        <Icon name="search" size={15} />
        <input className="campo" value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Busca una cuenta de tu competencia: nombre, @usuario o enlace de su página o de la Biblioteca de anuncios" />
        <button className="btn" disabled={estado === 'buscando' || texto.trim().length < 2}>{estado === 'buscando' ? 'Buscando…' : 'Buscar'}</button>
      </form>
      {estado?.error && <div className="aviso error">{estado.error}</div>}
      {estado?.candidatos && (
        <div className="anun-candidatos">
          {estado.candidatos.length ? <div className="ayuda">¿Cuál es? Estas páginas tienen anuncios activos que encajan con «{texto}»:</div>
            : <div className="ayuda">No hay anuncios activos con «{texto}». Prueba con el nombre de su página de Facebook o pega el enlace de su página en la <a href="https://www.facebook.com/ads/library/" target="_blank" rel="noreferrer">Biblioteca de anuncios</a>.</div>}
          {estado.candidatos.map((c) => (
            <div key={c.pagina_id} className={`anun-candidato${c.coincide ? ' coincide' : ''}`}>
              <div><b>{c.nombre}</b><small>{c.anuncios ? `${c.anuncios} anuncio${c.anuncios === 1 ? '' : 's'} en la búsqueda` : 'Página de Facebook'} · <a href={`https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=ALL&view_all_page_id=${c.pagina_id}`} target="_blank" rel="noreferrer">ver en la Biblioteca ↗</a></small></div>
              {c.siguiendo ? <span className="ayuda">Ya la sigues</span>
                : <button type="button" className="btn btn-sec" onClick={() => seguir(c)} disabled={Boolean(siguiendo)}>{siguiendo === c.pagina_id ? 'Trayendo sus anuncios…' : 'Ver sus anuncios'}</button>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Tarjeta({ a, onAbrir }) {
  // La imagen se saca de Meta la primera vez que se ve la tarjeta: puede tardar unos segundos o no salir
  const [sinImagen, setSinImagen] = useState(false);
  const imagen = a.miniatura && !sinImagen;
  return (
    <button type="button" className="anun-tarjeta" onClick={() => onAbrir(a)}>
      <span className="anun-tarjeta-img">
        {imagen ? <img src={a.miniatura} alt="" loading="lazy" onError={() => setSinImagen(true)} /> : <Icon name={a.video ? 'play' : 'ads'} size={20} />}
        {a.video && imagen && <span className="anun-play"><Icon name="play" size={14} /></span>}
        <span className="anun-dias">{a.diasActivo} días activo</span>
      </span>
      <span className="anun-tarjeta-txt">
        <b>{a.pagina}</b>
        <span className="anun-cuerpo">{a.cuerpo || a.titulo || '(sin texto)'}</span>
        <span className="anun-meta">
          {a.variantes > 1 && <span className="tag" title="El mismo texto en varios anuncios">{a.variantes} variantes</span>}
          {a.alcance_ue ? <span>{num(a.alcance_ue)} alcance UE</span> : null}
          {a.transcrita && <span><Icon name="check" size={11} /> transcrito</span>}
        </span>
      </span>
    </button>
  );
}

function Detalle({ id, onClose }) {
  const [a, setA] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState('');
  const [tarea, setTarea] = useState(null); // transcripción en marcha
  const [adaptando, setAdaptando] = useState(false);
  const input = useRef(null);
  const cargar = () => api(`/api/ads/anuncios/${encodeURIComponent(id)}`).then(setA).catch((e) => setError(e.message));
  useEffect(() => { cargar(); }, [id]);
  // Al abrir un anuncio que aún no tiene su vídeo o sus imágenes en JARVIS, se traen solos
  const traido = useRef(false);
  useEffect(() => {
    if (!a || traido.current || a.video || a.imagenes?.length) return;
    traido.current = true;
    medios();
  }, [a]);
  // La transcripción va en segundo plano: se pregunta cómo va hasta que acaba
  useEffect(() => {
    if (!tarea?.clave) return undefined;
    const t = setInterval(async () => {
      try {
        const r = await api(`/api/transcripciones?clave=${encodeURIComponent(tarea.clave)}`);
        if (r.estado === 'haciendo') setTarea(r); else { setTarea(null); setCargando(''); cargar(); }
      } catch (e) { setTarea(null); setCargando(''); setError(e.message); }
    }, 3000);
    return () => clearInterval(t);
  }, [tarea?.clave]);
  useMensajes('transcripcion', () => tarea && cargar());

  async function medios() {
    setCargando('medios'); setError('');
    try { setA(await api(`/api/ads/anuncios/${encodeURIComponent(id)}/medios`, { method: 'POST' })); } catch (e) { setError(e.message); }
    setCargando('');
  }
  const transcribir = async () => {
    setCargando('transcribir'); setError('');
    try {
      const r = await api(`/api/ads/anuncios/${encodeURIComponent(id)}/transcribir`, { method: 'POST' });
      if (r.estado === 'haciendo') setTarea(r); else { setCargando(''); cargar(); }
    } catch (e) { setError(e.message); setCargando(''); }
  };
  const elegirVideo = async (f) => {
    if (!f) return;
    setError(''); setCargando('subiendo 0 %');
    try { setA(await subirVideo(id, f, (p) => setCargando(`subiendo ${p} %`))); } catch (e) { setError(e.message); }
    setCargando('');
  };

  if (!a) return <Modal titulo="Anuncio" onClose={onClose} ancho={980}>{error ? <div className="aviso error">{error}</div> : <div className="t-dim">Cargando…</div>}</Modal>;
  const textos = a.cuerpos?.length ? a.cuerpos : [];
  return (
    <Modal titulo={<><Icon name="ads" size={15} />{a.pagina}</>} onClose={onClose} ancho={980} clase="anun-detalle">
      <div className="anun-detalle-grid">
        <div className="anun-medio">
          {a.video ? <video src={a.video} controls playsInline poster={a.miniatura || undefined} />
            : a.imagenes?.length ? <div className="anun-imagenes">{a.imagenes.map((u) => <img key={u} src={u} alt="" />)}</div>
              : (
                <div className="anun-sin-medio">
                  <Icon name="play" size={22} />
                  <p>El vídeo o la imagen del anuncio aún no está en JARVIS.</p>
                  <button type="button" className="btn" onClick={medios} disabled={Boolean(cargando)}>{cargando === 'medios' ? 'Trayendo el anuncio…' : 'Ver el vídeo o la imagen'}</button>
                </div>
              )}
          <div className="anun-medio-acciones">
            <a className="link-btn" href={a.verEnBiblioteca} target="_blank" rel="noreferrer">Abrir en la Biblioteca de anuncios ↗</a>
            {!a.video && <button type="button" className="link-btn" onClick={() => input.current?.click()} disabled={Boolean(cargando)}>Subir el vídeo a mano</button>}
            <input ref={input} type="file" accept="video/*" hidden onChange={(e) => { elegirVideo(e.target.files?.[0]); e.target.value = ''; }} />
          </div>
          {cargando.startsWith('subiendo') && <div className="ayuda">{cargando}</div>}
        </div>

        <div className="anun-info">
          <div className="anun-datos">
            <span className="chip-estado on"><span className="dot on" />Activo · {a.diasActivo} días</span>
            {a.variantes > 1 && <span className="tag">{a.variantes} variantes</span>}
            {a.alcance_ue ? <span className="ayuda">{num(a.alcance_ue)} de alcance en la UE</span> : null}
            {a.plataformas && <span className="ayuda">{a.plataformas}</span>}
            <span className="ayuda">Desde el {String(a.inicio || '').slice(0, 10)}</span>
          </div>

          <div className="anun-bloque">
            <div className="anun-bloque-cab"><span className="label">Texto del anuncio{textos.length > 1 ? ` (${textos.length} versiones)` : ''}</span>{textos.length > 0 && <BotonCopiar texto={textos.join('\n\n---\n\n')} className="link-btn" />}</div>
            {textos.length ? textos.map((t, i) => <p key={i} className="anun-texto">{t}</p>) : <p className="ayuda">Sin texto.</p>}
            {(a.titulo || a.descripcion) && <p className="ayuda">{a.titulo && <b>{a.titulo}</b>}{a.titulo && a.descripcion ? ' · ' : ''}{a.descripcion}</p>}
          </div>

          <div className="anun-bloque">
            <div className="anun-bloque-cab"><span className="label">Lo que se dice en el vídeo</span>{a.transcripcion && <BotonCopiar texto={a.transcripcion} className="link-btn" />}</div>
            {a.transcripcion ? <p className="anun-texto">{a.transcripcion}</p>
              : tarea ? (
                <div className="diseno-progreso">
                  <span>Transcribiendo{tarea.motor === 'Whisper' ? ' con Whisper (gratis): tarda unos minutos' : tarea.motor ? ` con ${tarea.motor}` : ''}… {tarea.progreso != null ? `${tarea.progreso}%` : ''}</span>
                  {tarea.progreso != null && <div className="bar"><span style={{ width: `${tarea.progreso}%`, background: 'var(--accent-2)' }} /></div>}
                </div>
              ) : <button type="button" className="btn btn-sec" onClick={transcribir} disabled={Boolean(cargando)}><Icon name="mic" size={14} />{cargando === 'transcribir' ? 'Empezando…' : 'Transcribir el vídeo'}</button>}
            {a.nota && <small className="ayuda">Guardada en {a.nota}</small>}
          </div>

          {error && <div className="aviso error">{error}</div>}
          <button type="button" className="btn anun-adaptar" onClick={() => setAdaptando(true)}><Icon name="sparkle" size={15} />Adaptar a mi estilo</button>
          <small className="ayuda">JARVIS entiende por qué funciona y escribe tu versión con tu voz y tu oferta; la deja en Contenido → Pipeline.{!a.transcripcion && a.video ? ' Transcríbelo antes para que use también lo que se dice.' : ''}</small>
        </div>
      </div>
      {adaptando && (
        <Replicar
          competencia
          titulo={`Anuncio de ${a.pagina}`}
          detalle={(a.cuerpo || '').slice(0, 140)}
          url={`/api/ads/anuncios/${encodeURIComponent(a.id)}/adaptar`}
          inicial={a.video ? { Reel: 1 } : { Post: 1 }}
          onClose={() => setAdaptando(false)}
        />
      )}
    </Modal>
  );
}

export default function AnunciosCompetencia({ conectado }) {
  const [filtro, setFiltro] = useState(() => ({ pagina: '', orden: 'tiempo', minDias: 0 }));
  const qs = new URLSearchParams({ orden: filtro.orden, minDias: String(filtro.minDias), ...(filtro.pagina ? { pagina: filtro.pagina } : {}) }).toString();
  const [data, recargar] = useRecurso(`/api/ads/anuncios?${qs}`, { anunciantes: [], anuncios: [], total: 0 });
  const [abierto, setAbierto] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [actualizando, setActualizando] = useState(false);
  const orden = ORDENES.find((o) => o.id === filtro.orden);

  const actualizar = async () => {
    setActualizando(true); setAviso(null);
    try {
      const r = await api('/api/ads/anunciantes/sincronizar', { method: 'POST' });
      setAviso(r.errores?.length ? { tipo: 'error', texto: r.errores[0].error } : { tipo: 'ok', texto: `${r.anuncios} anuncios activos al día.` });
      recargar();
    } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
    setActualizando(false);
  };
  const dejar = async (p) => {
    if (!window.confirm(`¿Dejar de seguir a ${p.nombre}? Se quitan sus anuncios de aquí.`)) return;
    await api(`/api/ads/anunciantes/${p.pagina_id}`, { method: 'DELETE' });
    if (filtro.pagina === p.pagina_id) setFiltro((f) => ({ ...f, pagina: '' }));
    recargar();
  };

  return (
    <section className="panel panel-pad anun">
      <div className="panel-head">
        <div>
          <span className="label">Anuncios de la competencia</span>
          <div className="ayuda">Biblioteca de anuncios de Meta · todos sus anuncios activos ahora. Los que más tiempo llevan activos suelen ser los que les funcionan.</div>
        </div>
        {data.anunciantes.length > 0 && <button type="button" className="btn btn-sec" onClick={actualizar} disabled={actualizando}><Icon name="refresh" size={14} />{actualizando ? 'Actualizando…' : 'Actualizar'}</button>}
      </div>
      {!conectado ? <div className="aviso">Conecta Instagram con Facebook (pestaña Instagram) para buscar en la Biblioteca de anuncios.</div>
        : <Buscador onSeguido={(c, r) => { setFiltro((f) => ({ ...f, pagina: c.pagina_id })); setAviso({ tipo: 'ok', texto: `${c.nombre}: ${r.anuncios} anuncio${r.anuncios === 1 ? '' : 's'} activo${r.anuncios === 1 ? '' : 's'}.` }); recargar(); }} />}
      {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}

      {data.anunciantes.length > 0 && (
        <>
          <div className="anun-seguidos">
            <button type="button" className={`anun-chip${!filtro.pagina ? ' on' : ''}`} onClick={() => setFiltro((f) => ({ ...f, pagina: '' }))}>Todos</button>
            {data.anunciantes.map((p) => (
              <span key={p.pagina_id} className={`anun-chip${filtro.pagina === p.pagina_id ? ' on' : ''}${p.error ? ' error' : ''}`} title={p.error || (p.ultima_sync ? `Actualizado ${hace(p.ultima_sync)}` : '')}>
                <button type="button" onClick={() => setFiltro((f) => ({ ...f, pagina: p.pagina_id }))}>{p.nombre} <small>{p.activos}</small></button>
                <button type="button" className="anun-chip-x" onClick={() => dejar(p)} aria-label={`Dejar de seguir a ${p.nombre}`}>✕</button>
              </span>
            ))}
          </div>
          <div className="anun-filtros">
            <label className="anun-select">
              <span>Ordenar</span>
              <select className="campo" value={filtro.orden} onChange={(e) => setFiltro((f) => ({ ...f, orden: e.target.value }))}>
                {ORDENES.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
              </select>
            </label>
            <div className="seg">{ANTIGUEDAD.map(([d, l]) => <button key={d} type="button" className={filtro.minDias === d ? 'on' : ''} onClick={() => setFiltro((f) => ({ ...f, minDias: d }))}>{l}</button>)}</div>
            <span className="ayuda">{orden?.ayuda} · {data.total} anuncio{data.total === 1 ? '' : 's'}</span>
          </div>
          <div className="anun-tarjetas">
            {data.anuncios.map((a) => <Tarjeta key={a.id} a={a} onAbrir={setAbierto} />)}
          </div>
          {!data.anuncios.length && <div className="vacio">No hay anuncios activos con estos filtros.</div>}
        </>
      )}
      {conectado && !data.anunciantes.length && <div className="vacio">Busca arriba a tu competencia para ver todos sus anuncios activos.</div>}
      {abierto && <Detalle id={abierto.id} onClose={() => setAbierto(null)} />}
    </section>
  );
}
