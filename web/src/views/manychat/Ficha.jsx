import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { Modal } from '../contenido/comun.jsx';
import { Acciones, Avatar, Etiquetas, fechaCorta } from './comun.jsx';

// La ficha de una persona: fase del pipeline, tareas, etiquetas, recursos pedidos, campos e historial

const nombreDe = (c) => (c.usuario ? `@${c.usuario}` : c.nombre || 'Contacto');
export const hoyIso = () => new Date().toLocaleDateString('sv-SE');

// Cambiar a mano la columna del pipeline
export function ElegirFase({ contactoId, etapa, onCambio }) {
  const [fs] = useRecurso('/api/manychat/pipeline', null);
  const [error, setError] = useState('');
  const fases = fs?.fases || [];
  const mover = async (fase) => {
    setError('');
    try { await api(`/api/manychat/contactos/${encodeURIComponent(contactoId)}/fase`, { method: 'POST', body: { fase } }); onCambio?.(); }
    catch (e) { setError(e.message); }
  };
  return (
    <div className="mc-elegir-fase">
      <select className="campo" value={etapa?.fase || 'iniciada'} onChange={(e) => mover(e.target.value)} aria-label="Fase del pipeline">
        {(fases.length ? fases : [{ id: etapa?.fase || 'iniciada', nombre: '…' }]).map((f) => <option key={f.id} value={f.id}>{f.nombre}</option>)}
      </select>
      {etapa?.por === 'ia' && etapa.motivo && <small title="La movió la IA al leer la conversación">✦ {etapa.motivo}</small>}
      {error && <div className="caja-error">{error}</div>}
    </div>
  );
}

// Tareas de esta persona: se ven aquí y en Manychat → Tareas (y en las tareas de JARVIS, categoría Ventas)
function TareasContacto({ contacto }) {
  const [d, recargar] = useRecurso(`/api/tareas/lista?contacto=${encodeURIComponent(contacto.id)}`, null);
  const [titulo, setTitulo] = useState('');
  const [fecha, setFecha] = useState(hoyIso);
  const [error, setError] = useState('');
  const crear = async () => {
    if (!titulo.trim()) return;
    setError('');
    try {
      await api('/api/tareas', { method: 'POST', body: { titulo, fecha, plazo_tipo: fecha ? 'dia' : null, categoria: 'ventas', prioridad: 'media', contacto_id: contacto.id, contacto_nombre: nombreDe(contacto) } });
      setTitulo(''); recargar();
    } catch (e) { setError(e.message); }
  };
  const marcar = async (t) => { await api(`/api/tareas/${t.id}`, { method: 'PATCH', body: { hecha: t.estado !== 'terminada' } }).catch(() => {}); recargar(); };
  const tareas = d?.tareas || [];
  return (
    <>
      <div className="campo-et">Tareas ({tareas.filter((t) => t.estado !== 'terminada').length} pendientes)</div>
      <div className="mc-tareas-ficha">
        {tareas.map((t) => (
          <label key={t.id} className={`mc-tarea${t.estado === 'terminada' ? ' hecha' : ''}${t.atrasada ? ' atrasada' : ''}`}>
            <input type="checkbox" checked={t.estado === 'terminada'} onChange={() => marcar(t)} />
            <span>{t.titulo}</span>
            <small>{t.plazo_desde ? new Date(`${t.plazo_desde}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : 'sin fecha'}</small>
          </label>
        ))}
        <div className="fila mc-nueva-tarea">
          <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') crear(); }} placeholder="Nueva tarea: p. ej. mandarle el enlace de la llamada" />
          <input className="campo" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} aria-label="Fecha" />
          <button className="btn" onClick={crear} disabled={!titulo.trim()}><Icon name="plus" size={13} />Asignar</button>
        </div>
        {error && <div className="caja-error">{error}</div>}
      </div>
    </>
  );
}

export default function Ficha({ id, onClose, onChat = null }) {
  const [c, recargar, error] = useRecurso(`/api/manychat/contactos/${encodeURIComponent(id)}`, null);
  const campos = Object.entries(c?.campos || {}).filter(([, v]) => v !== '' && v != null);
  return (
    <Modal titulo={c ? (c.nombre || (c.usuario ? `@${c.usuario}` : 'Contacto')) : 'Contacto'} onClose={onClose} ancho={860}>
      {error && <div className="caja-error">{error}</div>}
      {!c && !error && <p className="ayuda">Cargando…</p>}
      {c && (
        <div className="mc-ficha">
          <div className="mc-ficha-izq">
            <Avatar foto={c.foto} nombre={c.nombre || c.usuario} tam={72} />
            {c.usuario && <a href={`https://www.instagram.com/${c.usuario}/`} target="_blank" rel="noreferrer">@{c.usuario}</a>}
            <small>{c.canal} · {c.suscrito ? 'suscrito' : 'sin suscripción'}</small>
            <small>Alta: {c.creado ? new Date(c.creado).toLocaleDateString('es-ES') : '—'}</small>
            <small>Mensajes suyos: {c.recibidos} · tuyos: {c.enviados}</small>
            {c.conversacion && onChat && <button className="btn" onClick={() => onChat({ id: c.conversacion.id, cuenta: c.conversacion.cuenta, nombre: c.nombre || c.usuario })}><Icon name="send" size={13} />Abrir el chat</button>}
            <div className="campo-et">Fase del pipeline</div>
            <ElegirFase contactoId={c.id} etapa={c.etapa} onCambio={recargar} />
            <div className="campo-et">Automatizaciones</div>
            <Acciones contacto={c} onCambio={recargar} />
          </div>
          <div className="mc-ficha-der">
            <TareasContacto contacto={c} />
            <div className="campo-et">Etiquetas</div>
            <Etiquetas contactoId={c.id} etiquetas={c.etiquetas} onCambio={recargar} />
            <div className="campo-et">Recursos pedidos ({c.recursos.length})</div>
            {c.recursos.length ? (
              <div className="mc-recursos">{c.recursos.map((r, i) => <div key={r.id}><b>{r.nombre}</b>{i === 0 && <span className="chip">de entrada</span>}<small>{r.fecha ? new Date(r.fecha).toLocaleString('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'sin fecha'}</small></div>)}</div>
            ) : <p className="ayuda">Ninguno todavía.</p>}
            <div className="campo-et">Campos y respuestas</div>
            {campos.length ? <div className="mc-campos">{campos.map(([k, v]) => <div key={k}><small>{k.replace(/^respuesta_/, 'respuesta · ')}</small><span>{String(v)}</span></div>)}</div> : <p className="ayuda">Sin campos guardados.</p>}
            <div className="campo-et">Historial ({c.mensajes.length} mensajes)</div>
            <div className="mc-historial">
              {!c.mensajes.length && <p className="ayuda">Sin mensajes.</p>}
              {c.mensajes.map((m) => <div key={m.id} className={`mc-msg ${m.de}`}><div className="mc-burbuja"><span>{m.texto || (m.adjuntos.length ? '📎 adjunto' : '')}</span></div><small className="mc-hora">{fechaCorta(m.fecha)}</small></div>)}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}

