import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';

// Piezas que comparten la bandeja y los contactos: etiquetas, pausar automatizaciones, bloquear y la ventana de 24 h

export const fechaCorta = (f) => {
  if (!f) return '';
  const d = new Date(f);
  const hoy = new Date();
  return d.toDateString() === hoy.toDateString() ? d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

// Meta deja escribir 24 h tras su último mensaje, y hasta 7 días si responde una persona
export function ventana(ultimoSuyo, ahora = Date.now()) {
  if (!ultimoSuyo) return { tipo: 'cerrada', texto: 'Esta persona aún no te ha escrito: Meta no deja empezar tú la conversación.' };
  const h = (ahora - Date.parse(ultimoSuyo)) / 3600000;
  if (h < 24) {
    const quedan = 24 - h;
    return { tipo: 'ok', texto: `Puedes responder durante ${Math.floor(quedan)} h ${Math.floor((quedan % 1) * 60)} min más` };
  }
  if (h < 168) return { tipo: 'humano', texto: `Fuera de las 24 h: puedes responder tú a mano ${Math.ceil((168 - h) / 24)} día(s) más (no las automatizaciones)` };
  return { tipo: 'cerrada', texto: 'Han pasado más de 7 días desde su último mensaje: Meta no deja escribirle hasta que vuelva a escribir.' };
}

export function Avatar({ foto, nombre, tam = 36 }) {
  const [mal, setMal] = useState(false);
  return foto && !mal
    ? <img className="mc-avatar" src={foto} alt="" width={tam} height={tam} style={{ width: tam, height: tam }} onError={() => setMal(true)} />
    : <span className="mc-avatar mc-avatar-sin" style={{ width: tam, height: tam }}>{(nombre || '?').trim().charAt(0).toUpperCase()}</span>;
}

// Las etiquetas de un contacto: quitar con la ✕ y añadir escribiendo (sugiere las que ya existen)
export function Etiquetas({ contactoId, etiquetas, onCambio }) {
  const [lista, setLista] = useState(etiquetas || []);
  const [nueva, setNueva] = useState('');
  const [error, setError] = useState('');
  const [todas] = useRecurso('/api/manychat/contactos?limite=1', null);
  useEffect(() => { setLista(etiquetas || []); }, [contactoId, (etiquetas || []).join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const guardar = async (l) => {
    setLista(l); setError('');
    try { await api(`/api/manychat/contactos/${contactoId}/etiquetas`, { method: 'PUT', body: { etiquetas: l } }); onCambio?.(l); }
    catch (e) { setError(e.message); }
  };
  const anadir = () => { const t = nueva.trim(); if (t && !lista.includes(t)) guardar([...lista, t]); setNueva(''); };
  return (
    <div className="mc-etiquetas">
      {lista.map((t) => <span key={t} className="chip">{t}<button type="button" onClick={() => guardar(lista.filter((x) => x !== t))} aria-label={`Quitar ${t}`}>✕</button></span>)}
      <input className="campo" list={`mc-etq-${contactoId}`} value={nueva} onChange={(e) => setNueva(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); anadir(); } }} placeholder="+ Añadir etiqueta" />
      <datalist id={`mc-etq-${contactoId}`}>{(todas?.etiquetas || []).map((t) => <option key={t.nombre} value={t.nombre} />)}</datalist>
      {error && <div className="caja-error">{error}</div>}
    </div>
  );
}

// Pausar las automatizaciones de esta persona (un rato o hasta reanudar) y bloquearla
export function Acciones({ contacto, onCambio }) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState('');
  const caja = useRef(null);
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => { if (!caja.current?.contains(e.target)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);
  if (!contacto) return <p className="ayuda">Aún no hay ficha de contacto para esta conversación.</p>;
  const hacer = async (fn) => { setError(''); setAbierto(false); try { await fn(); onCambio?.(); } catch (e) { setError(e.message); } };
  const pausar = (minutos) => hacer(() => api(`/api/manychat/contactos/${contacto.id}/pausar`, { method: 'POST', body: { minutos } }));
  const reanudar = () => hacer(() => api(`/api/manychat/contactos/${contacto.id}/pausar`, { method: 'POST', body: { reanudar: true } }));
  const bloquear = () => contacto.usuario && window.confirm(`¿Bloquear a @${contacto.usuario}? No se le activará ninguna automatización.`)
    && hacer(() => api('/api/manychat/bloqueos', { method: 'POST', body: { usuario: contacto.usuario, motivo: 'Desde Manychat' } }));
  return (
    <div className="mc-acciones" ref={caja}>
      {contacto.bloqueado ? <div className="aviso error">Bloqueado: no se le activa ninguna automatización (quítalo en Configuración → Bloqueos).</div>
        : contacto.pausado ? (
          <div className="aviso">Automatizaciones en pausa{contacto.pausaHasta ? ` hasta las ${new Date(contacto.pausaHasta).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : ''}. <button className="link-btn" onClick={reanudar}>Reanudar</button></div>
        ) : (
          <div className="mc-menu-pausa">
            <button className="btn btn-sec" onClick={() => setAbierto((v) => !v)}><Icon name="clock" size={13} />Pausar automatizaciones</button>
            {abierto && (
              <div className="panel mc-desplegable">
                {[[30, '30 minutos'], [60, '1 hora'], [240, '4 horas'], [1440, '24 horas'], [null, 'Hasta que la reanude']].map(([m, t]) => <button key={t} onClick={() => pausar(m)}>{t}</button>)}
              </div>
            )}
          </div>
        )}
      {!contacto.bloqueado && contacto.usuario && <button className="link-btn peligro" onClick={bloquear}>Bloquear</button>}
      {error && <div className="caja-error">{error}</div>}
    </div>
  );
}

// Elegir una plantilla para pegarla (bandeja y tablero)
export function ElegirPlantilla({ onElegir, texto = 'Plantilla' }) {
  const [abierto, setAbierto] = useState(false);
  const [lista] = useRecurso(abierto ? '/api/manychat/plantillas' : null, null);
  const caja = useRef(null);
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => { if (!caja.current?.contains(e.target)) setAbierto(false); };
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, [abierto]);
  return (
    <span className="mc-elegir-plantilla" ref={caja}>
      <button type="button" className="btn btn-sec" onClick={() => setAbierto((v) => !v)}><Icon name="doc" size={13} />{texto}</button>
      {abierto && (
        <div className="panel mc-desplegable mc-plantillas-lista">
          {!lista && <p className="ayuda">Cargando…</p>}
          {lista && !lista.length && <p className="ayuda">Aún no tienes plantillas: créalas en Manychat → Plantillas.</p>}
          {(lista || []).map((p) => (
            <button key={p.id} type="button" onClick={() => { onElegir(p); setAbierto(false); }} title={p.texto}>
              <b>{p.nombre}</b>{p.carpeta && <small> · {p.carpeta}</small>}<span>{p.texto.slice(0, 70)}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
