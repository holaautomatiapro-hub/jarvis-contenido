import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';

// Configuración: bloqueos (por usuario de Instagram), canales conectados en Zernio, campos personalizados y etiquetas

function Bloqueos() {
  const [lista, recargar, error] = useRecurso('/api/manychat/bloqueos', null);
  const [usuario, setUsuario] = useState('');
  const [motivo, setMotivo] = useState('');
  const [aviso, setAviso] = useState('');
  const bloquear = async () => {
    setAviso('');
    try { await api('/api/manychat/bloqueos', { method: 'POST', body: { usuario, motivo } }); setUsuario(''); setMotivo(''); recargar(); }
    catch (e) { setAviso(e.message); }
  };
  const quitar = async (b) => { if (window.confirm(`¿Quitar el bloqueo de @${b.usuario}?`)) { try { await api(`/api/manychat/bloqueos/${b.id}`, { method: 'DELETE' }); recargar(); } catch (e) { setAviso(e.message); } } };
  return (
    <div className="panel panel-pad">
      <b>Bloqueos</b>
      <p className="ayuda">A estas personas nunca se les activa ninguna automatización. Basta con su usuario de Instagram: si aún no te ha escrito, el bloqueo se aplica solo en cuanto aparezca (JARVIS lo mira cada 5 minutos).</p>
      <div className="fila mc-fila-bloqueo">
        <input className="campo" value={usuario} onChange={(e) => setUsuario(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') bloquear(); }} placeholder="@usuario o enlace a su perfil" />
        <input className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo (opcional)" />
        <button className="btn" onClick={bloquear} disabled={!usuario.trim()}><Icon name="x" size={13} />Bloquear</button>
      </div>
      {aviso && <div className="caja-error">{aviso}</div>}
      {error && <div className="caja-error">{error}</div>}
      <div className="mc-lista-simple">
        {(lista || []).map((b) => (
          <div key={b.id}>
            <a href={`https://www.instagram.com/${b.usuario}/`} target="_blank" rel="noreferrer"><b>@{b.usuario}</b></a>
            <small>{b.motivo || ''}</small>
            <span className={`chip-estado`}><span className={`dot ${b.aplicado ? 'on' : 'warn'}`} />{b.aplicado ? 'Aplicado' : 'Pendiente: aún no te ha escrito'}</span>
            <button className="link-btn peligro" onClick={() => quitar(b)}>Quitar</button>
          </div>
        ))}
        {lista && !lista.length && <p className="ayuda">No hay nadie bloqueado.</p>}
      </div>
    </div>
  );
}

function Canales() {
  const [lista, , error] = useRecurso('/api/manychat/canales', null);
  const NOMBRE = { instagram: 'Instagram', facebook: 'Facebook', whatsapp: 'WhatsApp' };
  return (
    <div className="panel panel-pad">
      <b>Canales</b>
      <p className="ayuda">Las cuentas que tienes conectadas en Zernio. Para conectar Facebook o WhatsApp, hazlo en zernio.com (Accounts → Connect) y aparecerán aquí, en la bandeja y en los contactos. En Zernio cada cuenta conectada cuenta (las dos primeras son gratis).</p>
      {error && <div className="caja-error">{error}</div>}
      <div className="mc-lista-simple">
        {(lista || []).map((c) => (
          <div key={c.id}><b>{NOMBRE[c.canal] || c.canal}</b><small>{c.usuario ? `@${c.usuario}` : ''}</small><span className="chip-estado"><span className={`dot ${c.activo && !c.reconectar ? 'on' : 'warn'}`} />{c.reconectar ? 'Hay que reconectarla en Zernio' : c.activo ? 'Conectada' : 'Desactivada'}</span></div>
        ))}
        {lista && !lista.length && <p className="ayuda">No hay canales de mensajería conectados en Zernio.</p>}
      </div>
    </div>
  );
}

function Campos() {
  const [lista, recargar, error] = useRecurso('/api/manychat/campos', null);
  const [nuevo, setNuevo] = useState({ nombre: '', tipo: 'text', opciones: '' });
  const [aviso, setAviso] = useState('');
  const crear = async () => {
    setAviso('');
    try { await api('/api/manychat/campos', { method: 'POST', body: { ...nuevo, opciones: nuevo.opciones.split(',').map((x) => x.trim()).filter(Boolean) } }); setNuevo({ nombre: '', tipo: 'text', opciones: '' }); recargar(); }
    catch (e) { setAviso(e.message); }
  };
  const TIPO = { text: 'Texto', number: 'Número', date: 'Fecha', boolean: 'Sí / no', select: 'Lista de opciones' };
  return (
    <div className="panel panel-pad">
      <b>Campos personalizados</b>
      <p className="ayuda">Datos que guardas de cada persona (su respuesta a una pregunta, su nicho, su web…). Las preguntas del tablero guardan la respuesta en un campo.</p>
      <div className="fila mc-fila-bloqueo">
        <input className="campo" value={nuevo.nombre} onChange={(e) => setNuevo({ ...nuevo, nombre: e.target.value })} placeholder="Nombre del campo (p. ej. Nicho)" />
        <select className="campo" value={nuevo.tipo} onChange={(e) => setNuevo({ ...nuevo, tipo: e.target.value })}>{Object.entries(TIPO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        {nuevo.tipo === 'select' && <input className="campo" value={nuevo.opciones} onChange={(e) => setNuevo({ ...nuevo, opciones: e.target.value })} placeholder="Opciones separadas por comas" />}
        <button className="btn" onClick={crear} disabled={!nuevo.nombre.trim()}><Icon name="plus" size={13} />Crear</button>
      </div>
      {aviso && <div className="caja-error">{aviso}</div>}
      {error && <div className="caja-error">{error}</div>}
      <div className="mc-lista-simple">
        {(lista || []).map((c) => <div key={c.id || c.clave}><b>{c.nombre}</b><small>{c.clave}</small><span className="chip">{TIPO[c.tipo] || c.tipo}</span>{c.opciones?.length > 0 && <small>{c.opciones.join(', ')}</small>}</div>)}
        {lista && !lista.length && <p className="ayuda">Aún no hay campos.</p>}
      </div>
    </div>
  );
}

function Etiquetas() {
  const [d, , error] = useRecurso('/api/manychat/contactos?limite=1', null);
  return (
    <div className="panel panel-pad">
      <b>Etiquetas</b>
      <p className="ayuda">Las que usan tus contactos. Se ponen y se quitan desde la bandeja, la ficha del contacto o con el bloque Etiqueta del tablero.</p>
      {error && <div className="caja-error">{error}</div>}
      <div className="auto-palabras">{(d?.etiquetas || []).map((t) => <span key={t.nombre} className="chip">{t.nombre} <small>· {t.n}</small></span>)}</div>
      {d && !d.etiquetas.length && <p className="ayuda">Aún no hay etiquetas.</p>}
    </div>
  );
}

export default function Configuracion() {
  return (
    <div className="mc-config">
      <Bloqueos />
      <Canales />
      <Campos />
      <Etiquetas />
    </div>
  );
}
