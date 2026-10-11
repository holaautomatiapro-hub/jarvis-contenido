import { useEffect, useMemo, useState } from 'react';
import Icon from '../components/Icon.jsx';
import Replicar, { FORMATO_DE_IG } from '../components/Replicar.jsx';
import { Modal } from './contenido/comun.jsx';
import { api } from '../lib/api.js';
import { fechaCorta, num, numLargo } from '../lib/formato.js';

// Las mejores publicaciones de la competencia según la métrica que elijas, con su detalle
// (caption, transcripción del reel, slides del carrusel) y "Replicar con mi estilo".
const COLOR_FORMATO = { Reels: '#3987e5', Carruseles: '#d95926', 'Imágenes': '#199e70' };
const ORDENES = [
  { id: 'engagement', label: 'Engagement' },
  { id: 'interacciones', label: 'Interacciones' },
  { id: 'vistas', label: 'Visualizaciones' },
  { id: 'likes', label: 'Me gusta' },
  { id: 'comentarios', label: 'Comentarios' },
  { id: 'fecha', label: 'Más recientes' },
];
const FORMATOS = ['Reels', 'Carruseles', 'Imágenes'];
const POR_PAGINA = 12;

function Metricas({ m }) {
  return (
    <div className="comp-metricas">
      <span title="Me gusta"><Icon name="heart" size={11} />{num(m.likes)}</span>
      <span title="Comentarios"><Icon name="notes" size={11} />{num(m.comentarios)}</span>
      {m.vistas != null && <span title="Visualizaciones"><Icon name="play" size={11} />{num(m.vistas)}</span>}
      <span title="Engagement: interacciones / seguidores" className="comp-eng">{m.engagement ?? '—'}%</span>
    </div>
  );
}

function Detalle({ id, demo, onClose }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState('');
  const [slide, setSlide] = useState(0);
  const [replicando, setReplicando] = useState(false);

  useEffect(() => {
    api(`/api/competencia/publicaciones/${encodeURIComponent(id)}`).then(setD).catch((e) => setError(e.message));
  }, [id]);
  const accion = async (que) => {
    setCargando(que); setError('');
    try {
      if (que === 'slides') { const r = await api(`/api/competencia/publicaciones/${encodeURIComponent(id)}/slides`, { method: 'POST' }); setD((x) => ({ ...x, slides: r.slides })); }
      else { const r = await api(`/api/competencia/publicaciones/${encodeURIComponent(id)}/transcribir`, { method: 'POST' }); setD((x) => ({ ...x, ...r })); }
    } catch (e) { setError(e.message); }
    setCargando('');
  };
  // Al abrir un carrusel o una imagen se bajan sus slides solas
  useEffect(() => { if (d && d.formato !== 'Reels' && !d.slides?.length && !demo) accion('slides'); }, [d?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (replicando && d) {
    return (
      <Replicar
        competencia
        titulo={`@${d.username}: ${(d.gancho || d.caption || '').slice(0, 120)}`}
        detalle={`${d.formato} · ${fechaCorta(d.fecha)} · ${numLargo(d.likes)} me gusta · ${numLargo(d.comentarios)} comentarios${d.engagement != null ? ` · ${d.engagement}% engagement` : ''}`}
        url={`/api/competencia/publicaciones/${encodeURIComponent(d.id)}/replicar`}
        inicial={{ [FORMATO_DE_IG[d.formato] || 'Reel']: 1 }}
        onClose={onClose}
      />
    );
  }
  const urlSlide = (f) => `/api/competencia/publicaciones/${encodeURIComponent(id)}/slides/${f}`;
  return (
    <Modal titulo={d ? <>@{d.username} · {d.formato}</> : 'Publicación'} onClose={onClose} ancho={880}>
      {error && <div className="aviso error" style={{ marginBottom: 10 }}>{error}</div>}
      {!d && !error && <div className="vacio">Cargando…</div>}
      {d && (
        <div className="comp-detalle">
          <div className="comp-detalle-media">
            {d.slides?.length ? (
              <>
                <img src={urlSlide(d.slides[slide])} alt={`Slide ${slide + 1}`} />
                {d.slides.length > 1 && (
                  <div className="comp-slides-nav">
                    <button className="icon-btn mini" onClick={() => setSlide((s) => Math.max(0, s - 1))} disabled={!slide} aria-label="Slide anterior">‹</button>
                    <span>{slide + 1} / {d.slides.length}</span>
                    <button className="icon-btn mini" onClick={() => setSlide((s) => Math.min(d.slides.length - 1, s + 1))} disabled={slide >= d.slides.length - 1} aria-label="Slide siguiente">›</button>
                  </div>
                )}
              </>
            ) : d.miniatura ? <img src={d.miniatura} alt="" /> : <div className="comp-sin-media"><Icon name={d.formato === 'Reels' ? 'play' : 'layers'} size={22} /></div>}
            {d.formato !== 'Reels' && !d.slides?.length && <button className="btn btn-sec" onClick={() => accion('slides')} disabled={cargando === 'slides'}>{cargando === 'slides' ? 'Descargando…' : 'Ver los slides'}</button>}
          </div>
          <div className="comp-detalle-txt">
            <Metricas m={d} />
            <div className="ayuda">{fechaCorta(d.fecha)}{d.seguidores ? ` · @${d.username} tiene ${num(d.seguidores)} seguidores` : ''}{d.permalink && <> · <a href={d.permalink} target="_blank" rel="noreferrer">Ver en Instagram ↗</a></>}</div>
            <div className="label">Caption</div>
            <div className="comp-caption">{d.caption || 'Sin caption'}</div>
            {d.formato === 'Reels' && (
              <>
                <div className="label">Transcripción</div>
                {d.transcripcion ? <div className="comp-caption">{d.transcripcion}</div>
                  : d.puedeTranscribir ? <button className="btn btn-sec" onClick={() => accion('transcribir')} disabled={cargando === 'transcribir'}><Icon name="mic" size={14} />{cargando === 'transcribir' ? 'Transcribiendo… (1-2 min)' : 'Transcribir el reel'}</button>
                    : <div className="ayuda">{d.media_url ? 'Para transcribir hace falta la clave de ElevenLabs (ELEVENLABS_API_KEY).' : 'Instagram no da el vídeo de este reel (pasa con algunos reels con música con derechos).'}</div>}
              </>
            )}
            {d.formato !== 'Reels' && d.slides?.length > 0 && <div className="ayuda">Al replicarlo, JARVIS lee cada slide (títulos y textos).</div>}
          </div>
        </div>
      )}
      <div className="modal-pie">
        <button className="btn btn-sec" onClick={onClose}>Cerrar</button>
        <button className="btn" onClick={() => setReplicando(true)} disabled={!d}><Icon name="sparkle" size={14} />Replicar con mi estilo</button>
      </div>
    </Modal>
  );
}

export default function MejoresCompetencia({ data }) {
  const [orden, setOrden] = useState('engagement');
  const [formato, setFormato] = useState('');
  const [usuario, setUsuario] = useState('');
  const [mostrar, setMostrar] = useState(POR_PAGINA);
  const [abierta, setAbierta] = useState(null);
  const lista = useMemo(() => {
    const l = data.publicaciones.filter((m) => (!formato || m.formato === formato) && (!usuario || m.username === usuario));
    return [...l].sort((a, b) => (orden === 'fecha' ? String(b.fecha).localeCompare(String(a.fecha)) : (b[orden] ?? -1) - (a[orden] ?? -1)));
  }, [data.publicaciones, orden, formato, usuario]);
  const usuarios = [...new Set(data.publicaciones.map((m) => m.username))];
  const ordenes = ORDENES.filter((o) => o.id !== 'vistas' || data.hayVistas);

  return (
    <div className="panel panel-pad comp-mejores">
      <div className="panel-head">
        <div>
          <span className="label">Sus mejores publicaciones</span>
          <div className="ayuda" style={{ marginTop: 3 }}>
            Ábrelas para ver el caption, la transcripción del reel o los slides del carrusel, y replícalas con tu estilo.
            {!data.hayVistas && ' Instagram solo da me gusta y comentarios de otros perfiles (las visualizaciones, guardados y compartidos son privados).'}
          </div>
        </div>
        <div className="comp-filtros">
          <select className="campo" value={orden} onChange={(e) => { setOrden(e.target.value); setMostrar(POR_PAGINA); }} aria-label="Ordenar por">
            {ordenes.map((o) => <option key={o.id} value={o.id}>Ordenar por: {o.label}</option>)}
          </select>
          <select className="campo" value={usuario} onChange={(e) => { setUsuario(e.target.value); setMostrar(POR_PAGINA); }} aria-label="Perfil">
            <option value="">Todos los perfiles</option>
            {usuarios.map((u) => <option key={u} value={u}>@{u}</option>)}
          </select>
          <div className="seg seg-mini">
            <button className={!formato ? 'on' : ''} onClick={() => setFormato('')}>Todo</button>
            {FORMATOS.map((f) => <button key={f} className={formato === f ? 'on' : ''} onClick={() => { setFormato(f); setMostrar(POR_PAGINA); }}>{f}</button>)}
          </div>
        </div>
      </div>
      <div className="comp-tarjetas">
        {lista.slice(0, mostrar).map((m, i) => (
          <button key={m.id} className="comp-tarjeta" onClick={() => setAbierta(m.id)} title={data.demo ? 'Ejemplo' : 'Ver y replicar'}>
            <span className="comp-tarjeta-img" style={m.miniatura ? { backgroundImage: `url("${m.miniatura}")` } : { background: `color-mix(in srgb, ${COLOR_FORMATO[m.formato]} 30%, var(--panel-2))` }}>
              <span className="comp-pos">{i + 1}</span>
              <span className="comp-fmt" style={{ background: COLOR_FORMATO[m.formato] }}>{m.formato}{m.slides ? ` · ${m.slides}` : ''}</span>
              {!m.miniatura && <Icon name={m.formato === 'Reels' ? 'play' : 'layers'} size={18} />}
            </span>
            <span className="comp-tarjeta-txt">
              <small>@{m.username} · {fechaCorta(m.fecha)}{m.transcrita ? ' · transcrito' : ''}</small>
              <b>{(m.gancho || m.caption || 'Sin texto').slice(0, 90)}</b>
              <Metricas m={m} />
            </span>
          </button>
        ))}
      </div>
      {!lista.length && <div className="vacio">No hay publicaciones con ese filtro.</div>}
      {lista.length > mostrar && <button className="chip" style={{ marginTop: 10 }} onClick={() => setMostrar((n) => n + POR_PAGINA)}>Ver más ({lista.length - mostrar})</button>}
      {abierta && <Detalle id={abierta} demo={data.demo} onClose={() => setAbierta(null)} />}
    </div>
  );
}
