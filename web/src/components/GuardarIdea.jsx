import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../lib/api.js';

// «Guardar como idea» una publicación o un anuncio de la competencia: solo la idea (enlace, señales y caption) o
// la idea con lo que se dice en el vídeo / el texto de los slides. Queda en Ideas; desde su ficha se escribe el guion.
// que: 'video' | 'slides' | null (aún no se sabe: anuncio sin traer)
export default function GuardarIdea({ fuente, id, que = null, deshabilitado = false }) {
  const [abierto, setAbierto] = useState(false);
  const [con, setCon] = useState(true);
  const [estado, setEstado] = useState(null); // null | 'guardando' | { ... respuesta }
  const [error, setError] = useState('');
  const [tarea, setTarea] = useState(null);
  const extra = que === 'video' ? 'la transcripción del vídeo' : que === 'slides' ? 'el texto de los slides' : 'la transcripción o el texto de las imágenes';

  // La transcripción va en segundo plano: se pregunta cómo va para avisar cuando esté en la idea
  useEffect(() => {
    if (!tarea?.clave || tarea.estado !== 'haciendo') return undefined;
    const t = setInterval(async () => {
      try { setTarea(await api(`/api/transcripciones?clave=${encodeURIComponent(tarea.clave)}`)); } catch (e) { setTarea({ estado: 'error', error: e.message }); }
    }, 4000);
    return () => clearInterval(t);
  }, [tarea?.clave, tarea?.estado]);

  const guardar = async () => {
    setEstado('guardando'); setError('');
    try {
      const r = await api('/api/ideas/referencia', { method: 'POST', body: { fuente, id, conTranscripcion: con } });
      setEstado(r); setAbierto(false);
      if (r.tarea) setTarea(r.tarea);
    } catch (e) { setError(e.message); setEstado(null); }
  };

  if (estado && estado !== 'guardando') {
    return (
      <div className="guardar-idea hecho">
        <span><Icon name="check" size={13} />{estado.ya ? 'Ya estaba en Ideas' : 'Guardada en Ideas'}: «{estado.pieza?.titulo}»</span>
        {tarea?.estado === 'haciendo' && <small className="ayuda">Transcribiendo{tarea.motor === 'Whisper' ? ' con Whisper (gratis)' : ''}… {tarea.progreso != null ? `${tarea.progreso} % · ` : ''}se añadirá a la idea al terminar (puedes cerrar).</small>}
        {tarea?.estado === 'listo' && <small className="ayuda">Transcripción añadida a la idea.</small>}
        {tarea?.estado === 'error' && <small className="aviso error">No se ha podido transcribir: {tarea.error}</small>}
        {estado.leyendo && <small className="ayuda">JARVIS está leyendo el texto de los slides; lo añade a la idea en un par de minutos (puedes cerrar).</small>}
        {estado.transcripcion && <small className="ayuda">Con la transcripción.</small>}
        {estado.aviso && <small className="aviso">{estado.aviso}</small>}
        <small className="ayuda">Ábrela en Contenido → Ideas para escribir su guion, a mano o con IA.</small>
      </div>
    );
  }
  return (
    <div className="guardar-idea">
      {abierto ? (
        <div className="guardar-idea-opciones">
          <label><input type="radio" checked={!con} onChange={() => setCon(false)} />Solo la idea <small>(enlace, señales y texto)</small></label>
          <label><input type="radio" checked={con} onChange={() => setCon(true)} />La idea con {extra}</label>
          <div className="guardar-idea-botones">
            <button type="button" className="btn" onClick={guardar} disabled={estado === 'guardando'}>{estado === 'guardando' ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="link-btn" onClick={() => setAbierto(false)}>Cancelar</button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-sec" onClick={() => setAbierto(true)} disabled={deshabilitado}><Icon name="bulb" size={14} />Guardar como idea</button>
      )}
      {error && <div className="aviso error">{error}</div>}
    </div>
  );
}
