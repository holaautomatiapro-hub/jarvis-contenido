import { useState } from 'react';
import Icon from './Icon.jsx';
import { api } from '../lib/api.js';
import { Modal } from '../views/contenido/comun.jsx';

// Replicar una publicación que funcionó en más versiones u otros formatos. Claude escribe los guiones con tu voz
// y los deja como piezas del pipeline (fase Guion) con su nota en 02-Guiones.
const FORMATOS = [
  { id: 'Reel', icon: 'play', ayuda: 'Guion con gancho, texto en pantalla y caption' },
  { id: 'Carrusel', icon: 'layers', ayuda: 'Slide a slide, listo para Diseño' },
  { id: 'Story', icon: 'clock', ayuda: 'Secuencia de 3-7 stories con sticker y CTA' },
  { id: 'Post', icon: 'eye', ayuda: 'Una imagen con titular y caption' },
];
export const FORMATO_DE_IG = { Reels: 'Reel', Carruseles: 'Carrusel', 'Imágenes': 'Post' };

export default function Replicar({ titulo, detalle, url, inicial, competencia = false, onClose }) {
  const [n, setN] = useState(() => ({ Reel: 0, Carrusel: 0, Story: 0, Post: 0, ...inicial }));
  const [indicaciones, setIndicaciones] = useState('');
  const [estado, setEstado] = useState(null); // null | 'enviando' | { ok } | { error }
  const total = Object.values(n).reduce((a, b) => a + b, 0);
  const cambiar = (f, d) => setN((x) => ({ ...x, [f]: Math.max(0, Math.min(3, x[f] + d)) }));

  const enviar = async () => {
    setEstado('enviando');
    try {
      const r = await api(url, { method: 'POST', body: { formatos: n, indicaciones } });
      setEstado({ ok: true, ...r });
    } catch (e) { setEstado({ error: e.message }); }
  };

  return (
    <Modal titulo={<><Icon name="sparkle" size={15} />{competencia ? 'Replicar con mi estilo' : 'Replicar en más formatos'}</>} onClose={onClose} ancho={560}>
      <div className="replicar-origen">
        <b>{titulo}</b>
        {detalle && <small>{detalle}</small>}
      </div>
      {estado?.ok ? (
        <div className="aviso ok replicar-ok">
          JARVIS está escribiendo {total === 1 ? 'la versión' : `las ${total} versiones`} con tu voz{competencia ? `${estado.transcrita ? ' a partir de la transcripción del reel' : ''}${estado.slides ? ` leyendo sus ${estado.slides} slides` : ''}` : ''}.
          Tarda unos minutos: {total === 1 ? 'aparecerá' : 'aparecerán'} en <b>Contenido → Pipeline</b> (fase Guion), con su guion en 02-Guiones.
        </div>
      ) : (
        <>
          <p className="ayuda" style={{ margin: '0 0 10px' }}>
            {competencia
              ? 'JARVIS entiende por qué funciona (caption, transcripción o slides) y lo adapta a tu negocio y a tu voz. No copia.'
              : 'JARVIS mira por qué funcionó (sus métricas, el gancho, el tema) y escribe versiones nuevas con tu voz.'}
          </p>
          <div className="replicar-formatos">
            {FORMATOS.map((f) => (
              <div key={f.id} className={`replicar-formato${n[f.id] ? ' on' : ''}`}>
                <Icon name={f.icon} size={16} />
                <div><b>{f.id}</b><small>{f.ayuda}</small></div>
                <div className="contador">
                  <button type="button" onClick={() => cambiar(f.id, -1)} disabled={!n[f.id]} aria-label={`Menos ${f.id}`}>−</button>
                  <span>{n[f.id]}</span>
                  <button type="button" onClick={() => cambiar(f.id, 1)} disabled={n[f.id] >= 3} aria-label={`Más ${f.id}`}>+</button>
                </div>
              </div>
            ))}
          </div>
          <textarea className="campo" rows={3} value={indicaciones} onChange={(e) => setIndicaciones(e.target.value)} maxLength={1500} placeholder="Indicaciones (opcional): «enfócalo a clínicas», «CTA: comenta SETTER»…" aria-label="Indicaciones" style={{ marginTop: 10 }} />
          {estado?.error && <div className="aviso error" style={{ marginTop: 10 }}>{estado.error}</div>}
        </>
      )}
      <div className="modal-pie">
        <button type="button" className="btn btn-sec" onClick={onClose}>{estado?.ok ? 'Cerrar' : 'Cancelar'}</button>
        {!estado?.ok && <button type="button" className="btn" onClick={enviar} disabled={!total || estado === 'enviando'}><Icon name="sparkle" size={14} />{estado === 'enviando' ? 'Preparando…' : `Crear ${total || ''} ${total === 1 ? 'versión' : 'versiones'}`}</button>}
      </div>
    </Modal>
  );
}
