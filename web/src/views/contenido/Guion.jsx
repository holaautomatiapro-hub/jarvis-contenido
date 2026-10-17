import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api } from '../../lib/api.js';

// El guion de la pieza (su nota de 02-Guiones): el que dejó «Replicar» o el que escribas aquí, a mano o con JARVIS.
// Si la pieza sale de una idea guardada (con su transcripción o el texto de sus slides), se ve encima como referencia.
// Quien lo usa llama a ref.guardar() al guardar la ficha.
const CajaGuion = forwardRef(function CajaGuion({ pieza }, ref) {
  const [g, setG] = useState(null); // { ruta, texto, modificado, referencia, escribiendo }
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [pidiendo, setPidiendo] = useState(false); // la caja de «qué quieres» de la IA
  const [indicaciones, setIndicaciones] = useState('');
  const [guardando, setGuardando] = useState(false);
  const cambiado = g && texto !== g.texto;

  const cargar = async ({ conTexto = true } = {}) => {
    try {
      const r = await api(`/api/piezas/${pieza.id}/guion`);
      setG(r);
      if (conTexto) setTexto(r.texto);
      return r;
    } catch (e) { setError(e.message); return null; }
  };
  useEffect(() => { cargar(); }, [pieza.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Mientras JARVIS lo escribe, se mira cada pocos segundos; al acabar aparece el guion nuevo
  useEffect(() => {
    if (!g?.escribiendo) return undefined;
    const t = setInterval(async () => {
      const r = await cargar({ conTexto: false });
      if (r && !r.escribiendo) { setTexto(r.texto); setAviso(r.texto ? 'JARVIS ha terminado el guion. Revísalo y cámbialo a mano si quieres.' : 'JARVIS ha terminado, pero el guion ha quedado vacío: mira el chat de Guiones.'); }
    }, 3000);
    return () => clearInterval(t);
  }, [g?.escribiendo]); // eslint-disable-line react-hooks/exhaustive-deps

  const guardar = async () => {
    if (!cambiado) return;
    const r = await api(`/api/piezas/${pieza.id}/guion`, { method: 'PUT', body: { texto, modificado: g.modificado } });
    setG((x) => ({ ...x, ...r }));
    setTexto(r.texto);
  };
  useImperativeHandle(ref, () => ({ guardar, cambiado: Boolean(cambiado) }));

  const guardarYa = async () => {
    setGuardando(true); setError(''); setAviso('');
    try { await guardar(); setAviso('Guion guardado.'); } catch (e) { setError(e.message); }
    setGuardando(false);
  };
  const conIA = async () => {
    setError(''); setAviso('');
    try {
      if (cambiado) await guardar(); // lo que hayas escrito a mano es la base
      await api(`/api/piezas/${pieza.id}/guion/ia`, { method: 'POST', body: { indicaciones } });
      setPidiendo(false); setIndicaciones('');
      setG((x) => ({ ...x, escribiendo: true }));
    } catch (e) { setError(e.message); }
  };

  if (!g) return error ? <div className="aviso error">{error}</div> : null;
  const vacio = !texto.trim();
  return (
    <div className="caja-guion">
      {g.referencia && (
        <details className="guion-ref">
          <summary><Icon name="bulb" size={13} />La idea de la que sale{/## Transcripción|## Texto de los slides/.test(g.referencia.texto) ? ' (con la transcripción)' : ''}</summary>
          <div className="guion-ref-txt">{g.referencia.texto || 'Vacía'}</div>
          <small className="ayuda">{g.referencia.ruta}</small>
        </details>
      )}
      {g.escribiendo ? (
        <div className="diseno-progreso"><span>JARVIS está escribiendo el guion… (lo verás aquí al terminar)</span></div>
      ) : (
        <textarea className="campo" rows={vacio ? 4 : 12} value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder={g.referencia ? 'Escribe aquí el guion, o pídeselo a JARVIS: lo escribe a partir de la idea de arriba.' : 'Escribe aquí el guion: gancho, desarrollo y CTA (o slide a slide).'} />
      )}
      {pidiendo && !g.escribiendo && (
        <div className="guion-ia">
          <input className="campo" autoFocus value={indicaciones} onChange={(e) => setIndicaciones(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); conIA(); } }}
            placeholder={vacio ? 'Opcional: ángulo, duración, a quién va… (vacío = lo escribe completo)' : 'Qué quieres cambiar: «gancho más fuerte», «más corto», «termina con CTA a la guía»…'} />
          <button type="button" className="btn" onClick={conIA}><Icon name="sparkle" size={14} />{vacio ? 'Escribirlo' : 'Cambiarlo'}</button>
          <button type="button" className="link-btn" onClick={() => setPidiendo(false)}>Cancelar</button>
        </div>
      )}
      {!g.escribiendo && (
        <div className="guion-acciones">
          {!pidiendo && <button type="button" className="btn btn-sec" onClick={() => setPidiendo(true)}><Icon name="sparkle" size={14} />{vacio ? 'Escribir con IA' : 'Cambiar con IA'}</button>}
          {cambiado && <button type="button" className="btn btn-sec" onClick={guardarYa} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar guion'}</button>}
          {g.ruta && <small className="ayuda">En tu vault: {g.ruta}</small>}
        </div>
      )}
      {aviso && <div className="ayuda">{aviso}</div>}
      {error && <div className="aviso error">{error}</div>}
    </div>
  );
});

export default CajaGuion;
