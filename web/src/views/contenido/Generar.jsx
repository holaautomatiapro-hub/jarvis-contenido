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

// La otra versión de la pieza (en vídeo, de sus fotos; en imagen, de sus vídeos). Se ve antes y eliges cuáles
// quieres: se añaden al final de la pieza sin quitar nada (lo que sobre lo quitas tú con ✕).
// a: 'video' | 'imagen' (lo que se pide); estado: lo que dice el servidor (null si aún no se ha pedido)
export function OtraVersion({ pieza, a, estado, onCerrar, onAnadidos }) {
  const [haciendo, setHaciendo] = useState('');
  const [error, setError] = useState('');
  const [quitados, setQuitados] = useState(() => new Set()); // los que NO se quieren (por defecto, todos marcados)
  const que = estado?.a ? estado.a === 'video' : a === 'video';
  const nombre = que ? 'vídeo' : 'imagen';
  const accion = async (cual, fn) => {
    setHaciendo(cual); setError('');
    try { await fn(); } catch (e) { setError(e.message); }
    setHaciendo('');
  };
  const empezar = () => accion('empezar', async () => { setQuitados(new Set()); await api(`/api/piezas/${pieza.id}/convertir`, { method: 'POST', body: { a } }); });
  const lista = estado?.archivos || [];
  const elegidos = lista.filter((x) => !quitados.has(x.path));
  const marcar = (x) => setQuitados((q) => { const n = new Set(q); if (n.has(x.path)) n.delete(x.path); else n.add(x.path); return n; });
  const anadir = () => accion('anadir', async () => onAnadidos(await api(`/api/piezas/${pieza.id}/convertir/aceptar`, { method: 'POST', body: { elegidos: elegidos.map((x) => x.path) } })));
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
            : 'Si sale de un diseño, se exporta en imágenes; si son vídeos, se saca un fotograma de cada uno.'} Luego eliges cuáles quieres y se añaden a la pieza: no se quita nada de lo que ya tiene.</p>
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
          <p className="ayuda">Marca con ✓ los que quieras quedarte (pulsa el círculo para quitar o poner la marca; los vídeos se pueden ver antes).</p>
          <div className="otra-version-archivos">
            {lista.map((x, i) => {
              const on = !quitados.has(x.path);
              return (
                <div key={x.path} className={`otra-version-item${on ? ' on' : ''}`}>
                  {esVideo(x)
                    ? <video src={`${x.url}#t=0.1`} controls muted playsInline preload="metadata" />
                    : <img src={x.url} alt={x.nombre} loading="lazy" onClick={() => marcar(x)} />}
                  <button type="button" className="otra-version-check" onClick={() => marcar(x)} aria-pressed={on} title={on ? 'Se añadirá: pulsa para no añadirlo' : 'Pulsa para añadirlo'}>{on ? <Icon name="check" size={13} /> : null}</button>
                  <span className="otra-version-n">{i + 1}</span>
                </div>
              );
            })}
          </div>
          <div className="otra-version-acciones">
            <button type="button" className="btn" onClick={anadir} disabled={Boolean(haciendo) || !elegidos.length}><Icon name="plus" size={14} />{haciendo === 'anadir' ? 'Añadiendo…' : `Añadir ${elegidos.length === lista.length && lista.length > 1 ? 'todos' : elegidos.length} a la pieza`}</button>
            <button type="button" className="link-btn" onClick={() => setQuitados(elegidos.length ? new Set(lista.map((x) => x.path)) : new Set())}>{elegidos.length ? 'Desmarcar todos' : 'Marcar todos'}</button>
            <button type="button" className="btn btn-sec" onClick={descartar} disabled={Boolean(haciendo)}>Descartar</button>
          </div>
          <span className="ayuda">Se añaden al final, sin quitar lo que ya tiene la pieza. Si luego sobra algo, quítalo con ✕ en «Contenido».</span>
        </>
      )}
      {error && <div className="aviso error">{error}</div>}
    </div>
  );
}
