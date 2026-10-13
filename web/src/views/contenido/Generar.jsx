import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api } from '../../lib/api.js';
import { Modal, esVideo } from './comun.jsx';

// Botones «Generar…» de la ficha de una pieza: el lead magnet que la acompaña y su otra versión (vídeo o imagen).

const TIPOS_LM = [
  { id: 'guia', label: 'Guía paso a paso' },
  { id: 'checklist', label: 'Checklist' },
  { id: 'test', label: 'Test con resultado' },
  { id: 'generador', label: 'Generador' },
  { id: 'recursos', label: 'Pack de recursos' },
  { id: 'calculadora', label: 'Calculadora' },
];
// La palabra del CTA («Comenta EDITOR» → EDITOR): la que va en mayúsculas o la última
const palabraDe = (cta = '') => {
  const t = String(cta || '').replace(/[«»"“”.,!¡¿?]/g, ' ').split(/\s+/).filter(Boolean);
  return (t.find((x) => x.length > 2 && x === x.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(x)) || '').slice(0, 30);
};

export function GenerarLeadMagnet({ pieza, onClose, onEncargado }) {
  const [f, setF] = useState({ titulo: pieza.titulo || '', tipo: 'guia', palabra: palabraDe(pieza.cta), indicaciones: '' });
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const enviar = async (e) => {
    e.preventDefault();
    setEnviando(true); setError('');
    try {
      await api('/api/laboratorio/empezar', { method: 'POST', body: { tipo: 'leadmagnet', datos: { titulo: f.titulo, tipo: f.tipo, palabra: f.palabra, indicaciones: f.indicaciones, pieza: pieza.id } } });
      onEncargado('JARVIS está haciendo el lead magnet (lo ves arriba, en «Trabajando»). Cuando esté, revísalo y publícalo en Laboratorio → Lead magnets: el enlace se pondrá solo en esta pieza.');
    } catch (err) { setError(err.message); setEnviando(false); }
  };
  return (
    <Modal titulo={<><Icon name="target" size={15} />Generar lead magnet</>} onClose={onClose} ancho={560}>
      <form className="generar-form" onSubmit={enviar}>
        <p className="ayuda">JARVIS lo hace con tu voz y tu sistema de diseño a partir de esta pieza (su guion y su caption). Tarda unos minutos y puedes seguir con otras cosas.</p>
        <label className="campo-et">De qué va</label>
        <input className="campo" value={f.titulo} onChange={(e) => setF({ ...f, titulo: e.target.value })} maxLength={120} placeholder="Guía para editar tus reels con Claude Code" />
        <label className="campo-et">Tipo</label>
        <div className="pildoras">
          {TIPOS_LM.map((t) => <button type="button" key={t.id} className={f.tipo === t.id ? 'on' : ''} onClick={() => setF({ ...f, tipo: t.id })}>{t.label}</button>)}
        </div>
        <label className="campo-et">Palabra clave</label>
        <input className="campo" value={f.palabra} onChange={(e) => setF({ ...f, palabra: e.target.value.toUpperCase() })} maxLength={30} placeholder="EDITOR" />
        <label className="campo-et">Instrucciones (opcional)</label>
        <textarea className="campo" rows={3} value={f.indicaciones} onChange={(e) => setF({ ...f, indicaciones: e.target.value })} maxLength={2000} placeholder="«Que tenga los prompts para copiar», «corto, 5 pasos», «para entrenadores»…" />
        {error && <div className="aviso error">{error}</div>}
        <div className="modal-pie">
          <button type="button" className="btn btn-sec" onClick={onClose}>Cancelar</button>
          <button className="btn" disabled={enviando || !f.titulo.trim()}><Icon name="sparkle" size={14} />{enviando ? 'Encargando…' : 'Generar'}</button>
        </div>
      </form>
    </Modal>
  );
}

// La otra versión de la pieza (en vídeo si son fotos; en imagen si son vídeos). Se ve antes de cambiarla.
// estado: lo que dice el servidor (null si aún no se ha pedido)
export function OtraVersion({ pieza, haciaVideo, estado, onCerrar, onUsada }) {
  const [haciendo, setHaciendo] = useState('');
  const [error, setError] = useState('');
  const que = estado?.a ? estado.a === 'video' : haciaVideo;
  const nombre = que ? 'vídeo' : 'imagen';
  const accion = async (cual, fn) => {
    setHaciendo(cual); setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    setHaciendo('');
  };
  const empezar = () => accion('empezar', () => api(`/api/piezas/${pieza.id}/convertir`, { method: 'POST', body: { a: haciaVideo ? 'video' : 'imagen' } }));
  const usar = () => accion('usar', async () => onUsada(await api(`/api/piezas/${pieza.id}/convertir/aceptar`, { method: 'POST' })));
  const descartar = () => accion('descartar', async () => { await api(`/api/piezas/${pieza.id}/convertir`, { method: 'DELETE' }); onCerrar(); });

  return (
    <div className="otra-version">
      <div className="vr-titulo">
        <Icon name={que ? 'play' : 'eye'} size={14} />
        <b>{que ? 'Esta pieza en vídeo' : 'Esta pieza en imagen'}</b>
        {!estado && <button type="button" className="link-btn" onClick={onCerrar}>Cerrar</button>}
      </div>
      {!estado && (
        <>
          <p className="ayuda">{que
            ? 'Si sale de un diseño, se exporta en vídeo con su animación (unos 15 s por diapositiva); si son fotos subidas, cada una pasa a un vídeo corto con un zoom suave.'
            : 'Si sale de un diseño, se exporta en imágenes; si son vídeos, se saca un fotograma de cada uno.'} Lo ves antes de cambiar nada.</p>
          <button type="button" className="btn" onClick={empezar} disabled={Boolean(haciendo)}><Icon name="sparkle" size={14} />{haciendo ? 'Empezando…' : `Generar la versión en ${nombre}`}</button>
        </>
      )}
      {estado?.estado === 'haciendo' && (
        <div className="diseno-progreso">
          <span>Generando la versión en {nombre}… {estado.progreso || 0}% · puedes seguir con otras cosas (lo ves en «Trabajando»)</span>
          <div className="bar"><span style={{ width: `${estado.progreso || 0}%`, background: 'var(--accent-2)' }} /></div>
        </div>
      )}
      {estado?.estado === 'error' && (
        <div className="aviso error">No se ha podido: {estado.error} <button type="button" className="link-btn" onClick={descartar}>Cerrar</button></div>
      )}
      {estado?.estado === 'listo' && (
        <>
          <div className="otra-version-archivos">
            {estado.archivos.map((a) => (esVideo(a)
              ? <video key={a.url} src={`${a.url}#t=0.1`} controls muted playsInline preload="metadata" />
              : <img key={a.url} src={a.url} alt={a.nombre} loading="lazy" />))}
          </div>
          <div className="otra-version-acciones">
            <button type="button" className="btn" onClick={usar} disabled={Boolean(haciendo)}><Icon name="check" size={14} />{haciendo === 'usar' ? 'Cambiando…' : 'Usar esta versión'}</button>
            <button type="button" className="btn btn-sec" onClick={descartar} disabled={Boolean(haciendo)}>Descartar</button>
            <span className="ayuda">Al usarla, sustituye a lo que tiene ahora la pieza.</span>
          </div>
        </>
      )}
      {error && <div className="aviso error">{error}</div>}
    </div>
  );
}
