import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api } from '../../lib/api.js';
import { BotonCopiar, Modal } from './comun.jsx';
import CajaGuion from './Guion.jsx';

// Una idea guardada de la competencia (una publicación o un anuncio): se ve el post entero, su enlace, su caption
// y su transcripción, y su guion. «Replicar» escribe tu versión en esta misma pieza: solo el guion o completo
// (también las imágenes con tu kit de diseño, en posts y carruseles), con tus indicaciones, tu plantilla y tu CTA.
export const esReferencia = (p) => Boolean(p?.id && p.origen === 'competencia' && p.origen_ref && ['idea', 'guion'].includes(p.estado));

function Medio({ r, onTraer, trayendo }) {
  const [i, setI] = useState(0);
  if (r.video) return <video className="ref-video" src={r.video} controls playsInline />;
  if (r.imagenes.length) {
    return (
      <div className="ref-slides">
        <img src={r.imagenes[Math.min(i, r.imagenes.length - 1)]} alt={`Slide ${i + 1}`} />
        {r.imagenes.length > 1 && (
          <div className="comp-slides-nav">
            <button type="button" className="icon-btn mini" onClick={() => setI((x) => Math.max(0, x - 1))} disabled={!i} aria-label="Anterior">‹</button>
            <span>{i + 1} / {r.imagenes.length}</span>
            <button type="button" className="icon-btn mini" onClick={() => setI((x) => Math.min(r.imagenes.length - 1, x + 1))} disabled={i >= r.imagenes.length - 1} aria-label="Siguiente">›</button>
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="anun-sin-medio">
      <Icon name={r.esVideo ? 'play' : 'layers'} size={22} />
      <p>{r.fuente ? 'El post aún no está en JARVIS.' : 'No encuentro la publicación original (quizá ya no sigues esa cuenta).'}</p>
      {r.fuente && <button type="button" className="btn" onClick={onTraer} disabled={trayendo}>{trayendo ? 'Trayéndolo…' : 'Ver el post'}</button>}
    </div>
  );
}

// El cuadro de «Replicar»: indicaciones, plantilla (en completo) y CTA
function Replicar({ r, modo, onVolver, onHecho }) {
  const [indicaciones, setIndicaciones] = useState('');
  const [plantilla, setPlantilla] = useState('');
  const [cta, setCta] = useState('mismo');
  const [ctaTexto, setCtaTexto] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const completo = modo === 'completo';
  const enviar = async () => {
    if (cta === 'otro' && !ctaTexto.trim()) return setError('Escribe el CTA que quieres, o elige «el mismo».');
    setEnviando(true); setError('');
    try {
      await api(`/api/piezas/${r.pieza.id}/replicar`, { method: 'POST', body: { modo, indicaciones, plantilla: completo ? plantilla || null : null, cta: { tipo: cta, texto: ctaTexto } } });
      onHecho();
    } catch (e) { setError(e.message); setEnviando(false); }
  };
  return (
    <Modal titulo={<><Icon name="sparkle" size={15} />Replicar {completo ? 'completo (guion + imágenes)' : 'solo el guion'}</>} onClose={onVolver} ancho={620}>
      <div className="ref-replicar">
        <p className="ayuda">JARVIS entiende por qué funciona y escribe tu versión con tu voz{completo ? ', y la diseña con tu kit: las imágenes quedan en esta pieza' : ''}. El guion aparece en la ficha.</p>
        <label className="campo-et">Instrucciones (opcional)</label>
        <textarea className="campo" rows={4} autoFocus value={indicaciones} onChange={(e) => setIndicaciones(e.target.value)} placeholder="Algo diferente a tener en cuenta: otro ángulo, otro ejemplo, para quién es, qué no decir…" />
        {completo && (
          <>
            <label className="campo-et">Plantilla</label>
            <select className="campo" value={plantilla} onChange={(e) => setPlantilla(e.target.value)}>
              <option value="">Que elija JARVIS la que mejor encaje</option>
              {r.plantillas.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.descripcion ? ` — ${p.descripcion}` : ''}</option>)}
            </select>
            {!r.plantillas.length && <small className="ayuda">Tu kit de diseño no tiene plantillas de carrusel: JARVIS usará el kit de serie.</small>}
          </>
        )}
        <label className="campo-et">CTA</label>
        <div className="ref-cta">
          <label><input type="radio" checked={cta === 'mismo'} onChange={() => setCta('mismo')} />El mismo que el original <small>(adaptado a tu oferta)</small></label>
          <label><input type="radio" checked={cta === 'otro'} onChange={() => setCta('otro')} />Otro:</label>
          {cta === 'otro' && <input className="campo" value={ctaTexto} onChange={(e) => setCtaTexto(e.target.value)} placeholder="Comenta GUÍA y te la mando por privado" maxLength={300} />}
        </div>
        {error && <div className="aviso error">{error}</div>}
      </div>
      <div className="modal-pie">
        <button type="button" className="btn btn-sec" onClick={onVolver}>Volver</button>
        <button type="button" className="btn" onClick={enviar} disabled={enviando}><Icon name="sparkle" size={14} />{enviando ? 'Enviando…' : 'Replicar'}</button>
      </div>
    </Modal>
  );
}

export function FichaReferencia({ pieza, onClose, onEditar, onGuardado }) {
  const [r, setR] = useState(null);
  const [error, setError] = useState('');
  const [trayendo, setTrayendo] = useState(false);
  const [transcribiendo, setTranscribiendo] = useState(null); // tarea o 'leyendo'
  const [menu, setMenu] = useState(false);
  const [modo, setModo] = useState(null); // 'guion' | 'completo': el cuadro de instrucciones
  const [versionGuion, setVersionGuion] = useState(0);
  const guion = useRef(null);

  const cargar = () => api(`/api/piezas/${pieza.id}/referencia`).then((x) => { setR(x); return x; }).catch((e) => { setError(e.message); return null; });
  useEffect(() => { cargar(); }, [pieza.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mientras JARVIS replica (o lee los slides) se mira cada pocos segundos; al acabar se ve el guion nuevo
  useEffect(() => {
    if (!r?.replicando && !transcribiendo) return undefined;
    const t = setInterval(async () => {
      if (transcribiendo?.clave) {
        try {
          const x = await api(`/api/transcripciones?clave=${encodeURIComponent(transcribiendo.clave)}`);
          if (x.estado !== 'haciendo') { setTranscribiendo(null); cargar(); } else setTranscribiendo(x);
        } catch (e) { setTranscribiendo(null); setError(e.message); }
        return;
      }
      const x = await cargar();
      if (x && !x.replicando && r?.replicando) { setVersionGuion((v) => v + 1); onGuardado?.(); }
      if (x && transcribiendo === 'leyendo' && (x.textoSlides || x.transcripcion)) setTranscribiendo(null);
    }, 4000);
    return () => clearInterval(t);
  }, [r?.replicando, transcribiendo]); // eslint-disable-line react-hooks/exhaustive-deps

  const traer = async () => {
    setTrayendo(true); setError('');
    try {
      if (r.fuente === 'anuncio') await api(`/api/ads/anuncios/${encodeURIComponent(r.fuenteId)}/medios`, { method: 'POST' });
      else await api(`/api/competencia/publicaciones/${encodeURIComponent(r.fuenteId)}/slides`, { method: 'POST' });
      await cargar();
    } catch (e) { setError(e.message); }
    setTrayendo(false);
  };
  const transcribir = async () => {
    setError('');
    try {
      const x = await api('/api/ideas/referencia', { method: 'POST', body: { fuente: r.fuente, id: r.fuenteId, conTranscripcion: true } });
      if (x.tarea?.estado === 'haciendo') setTranscribiendo(x.tarea);
      else if (x.leyendo) setTranscribiendo('leyendo');
      else if (x.aviso) setError(x.aviso);
      cargar();
    } catch (e) { setError(e.message); }
  };
  const cerrar = async () => {
    try { await guion.current?.guardar(); } catch { /* lo que no se guardó, se queda sin guardar */ }
    onClose();
  };

  if (!r) return <Modal titulo={pieza.titulo} onClose={onClose} ancho={1000}>{error ? <div className="aviso error">{error}</div> : <div className="t-dim">Cargando…</div>}</Modal>;
  if (modo) return <Replicar r={r} modo={modo} onVolver={() => setModo(null)} onHecho={() => { setModo(null); setMenu(false); cargar(); }} />;
  const textoExtra = r.transcripcion || r.textoSlides;
  return (
    <Modal titulo={<><Icon name="bulb" size={15} />{r.pieza.titulo}</>} onClose={cerrar} ancho={1040} cerrarFuera={false} clase="ficha-ref">
      <div className="ref-grid">
        <div className="ref-medio">
          <Medio r={r} onTraer={traer} trayendo={trayendo} />
        </div>
        <div className="ref-info">
          <div className="ref-origen">
            {r.cuenta && <b>{r.cuenta}</b>}
            {r.fecha && <span className="ayuda">{String(r.fecha).slice(0, 10)}</span>}
            {r.senales && <span className="ayuda">{r.senales}</span>}
          </div>
          <div className="ref-url">
            <a href={r.enlace} target="_blank" rel="noreferrer">{r.enlace}</a>
            <BotonCopiar texto={r.enlace} className="link-btn" />
          </div>

          <div className="anun-bloque">
            <div className="anun-bloque-cab"><span className="label">Caption</span>{r.caption && <BotonCopiar texto={r.caption} className="link-btn" />}</div>
            <p className="anun-texto">{r.caption || 'Sin caption.'}</p>
          </div>

          <div className="anun-bloque">
            <div className="anun-bloque-cab"><span className="label">{r.esVideo ? 'Transcripción' : 'Texto de los slides'}</span>{textoExtra && <BotonCopiar texto={textoExtra} className="link-btn" />}</div>
            {textoExtra ? <p className="anun-texto">{textoExtra.replace(/\*\*/g, '')}</p>
              : transcribiendo ? <p className="ayuda">{transcribiendo === 'leyendo' ? 'JARVIS está leyendo los slides…' : `Transcribiendo${transcribiendo.motor === 'Whisper' ? ' con Whisper (gratis)' : ''}… ${transcribiendo.progreso != null ? `${transcribiendo.progreso} %` : ''}`}</p>
                : r.fuente ? <button type="button" className="btn btn-sec" onClick={transcribir}><Icon name="mic" size={14} />{r.esVideo ? 'Transcribir el vídeo' : 'Sacar el texto de los slides'}</button>
                  : <p className="ayuda">Sin transcripción.</p>}
          </div>

          <div className="anun-bloque">
            <div className="anun-bloque-cab"><span className="label">Tu guion</span></div>
            {r.replicando ? <div className="diseno-progreso"><span>JARVIS está replicándolo con tu estilo… el guion aparecerá aquí al terminar (puedes cerrar).</span></div>
              : <CajaGuion key={versionGuion} ref={guion} pieza={r.pieza} sinReferencia />}
          </div>
          {error && <div className="aviso error">{error}</div>}
        </div>
      </div>
      <div className="modal-pie">
        <button type="button" className="btn btn-sec" onClick={async () => { try { await guion.current?.guardar(); } catch { /* sigue */ } onEditar(); }}><Icon name="pen" size={14} />Editar como pieza</button>
        <div className="ref-replicar-btn">
          {menu && !r.replicando && (
            <div className="ref-menu">
              <button type="button" onClick={() => setModo('guion')}><b>Solo guion</b><small>Un guion parecido, adaptado a ti</small></button>
              <button type="button" onClick={() => setModo('completo')} disabled={!r.puedeDisenar} title={r.puedeDisenar ? '' : 'Solo para posts y carruseles'}>
                <b>Completo</b><small>{r.puedeDisenar ? 'Guion + imágenes con tu kit de diseño' : 'Solo para posts y carruseles'}</small>
              </button>
            </div>
          )}
          <button type="button" className="btn" onClick={() => setMenu((m) => !m)} disabled={r.replicando}><Icon name="sparkle" size={14} />{r.replicando ? 'Replicando…' : 'Replicar'}</button>
        </div>
      </div>
    </Modal>
  );
}
