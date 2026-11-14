import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import CampoEmoji from '../../components/CampoEmoji.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { Acciones, Avatar, ElegirPlantilla, Etiquetas, fechaCorta, ventana } from './comun.jsx';

// Bandeja de entrada: a la izquierda los chats (con filtros), en medio la conversación y a la derecha la persona
// (etiquetas, pausar automatizaciones, bloquear). Se actualiza sola cada pocos segundos.

function Conversacion({ chat, onCambio }) {
  const [d, recargar, error] = useRecurso(`/api/manychat/conversaciones/${encodeURIComponent(chat.id)}?cuenta=${encodeURIComponent(chat.cuenta)}`, null);
  const [texto, setTexto] = useState('');
  const [botones, setBotones] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState('');
  const final = useRef(null);
  useEffect(() => { const t = setInterval(recargar, 10000); return () => clearInterval(t); }, [recargar]);
  useEffect(() => { final.current?.scrollIntoView({ block: 'end' }); }, [d?.mensajes?.length]);
  useEffect(() => { if (chat.noLeidos) api(`/api/manychat/conversaciones/${encodeURIComponent(chat.id)}/leido`, { method: 'POST', body: { cuenta: chat.cuenta } }).then(onCambio).catch(() => {}); }, [chat.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = ventana(d?.ultimoSuyo);
  const enviar = async () => {
    if (!texto.trim()) return;
    setEnviando(true); setAviso('');
    try {
      const r = await api(`/api/manychat/conversaciones/${encodeURIComponent(chat.id)}/mensajes`, { method: 'POST', body: { cuenta: chat.cuenta, texto, botones } });
      setTexto(''); setBotones([]);
      if (r.etiqueta === 'HUMAN_AGENT') setAviso('Enviado como respuesta tuya fuera de las 24 h (Meta lo permite hasta 7 días).');
      recargar(); onCambio();
    } catch (e) { setAviso(e.message); }
    setEnviando(false);
  };
  return (
    <div className="mc-chat">
      <div className="mc-chat-cab">
        <Avatar foto={chat.foto} nombre={chat.nombre} />
        <div className="fila-c-txt"><b>{chat.nombre}</b><small>{chat.usuario ? `@${chat.usuario}` : chat.canal}{chat.sigue != null ? ` · ${chat.sigue ? 'te sigue' : 'no te sigue'}` : ''}</small></div>
        {chat.enlace && <a className="link-btn" href={chat.enlace} target="_blank" rel="noreferrer">Abrir en Instagram ↗</a>}
      </div>
      <div className="mc-mensajes">
        {error && <div className="caja-error">{error}</div>}
        {!d && !error && <p className="ayuda">Cargando la conversación…</p>}
        {(d?.mensajes || []).map((m) => (
          <div key={m.id} className={`mc-msg ${m.de}`}>
            <div className="mc-burbuja">
              {m.historia && <small className="mc-msg-nota">Respondió a tu historia</small>}
              {m.mencion && <small className="mc-msg-nota">Te mencionó en su historia</small>}
              {m.adjuntos.map((a, i) => (/image|share|sticker/.test(a.tipo || '') && (a.vista || a.url)
                ? <a key={i} href={a.url || a.vista} target="_blank" rel="noreferrer"><img src={a.vista || a.url} alt="" className="mc-adjunto" /></a>
                : a.url ? <a key={i} className="link-btn" href={a.url} target="_blank" rel="noreferrer">📎 {a.tipo || 'adjunto'}</a> : null))}
              {m.texto && <span>{m.texto}</span>}
              {m.borrado && <small className="mc-msg-nota">(lo borró)</small>}
            </div>
            <small className="mc-hora">{fechaCorta(m.fecha)}</small>
          </div>
        ))}
        <div ref={final} />
      </div>
      <div className="mc-responder">
        <div className={`mc-ventana ${v.tipo}`}><Icon name="clock" size={12} />{v.texto}</div>
        <CampoEmoji rows={2} value={texto} onChange={setTexto} placeholder={v.tipo === 'cerrada' ? 'No puedes escribirle ahora' : 'Escribe un mensaje… ({{first_name}} no se sustituye aquí: escribe su nombre)'} disabled={v.tipo === 'cerrada'} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) enviar(); }} />
        {botones.map((b, i) => (
          <div key={i} className="fila">
            <input className="campo" maxLength={20} value={b.titulo} onChange={(e) => setBotones(botones.map((x, j) => (j === i ? { ...x, titulo: e.target.value } : x)))} placeholder="Texto del botón" />
            <input className="campo" value={b.url} onChange={(e) => setBotones(botones.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="https://…" />
            <button className="icon-btn" onClick={() => setBotones(botones.filter((_, j) => j !== i))} aria-label="Quitar botón">✕</button>
          </div>
        ))}
        <div className="mc-responder-pie">
          <ElegirPlantilla onElegir={(p) => { setTexto(p.texto); setBotones(p.botones || []); }} />
          {botones.length < 3 && <button className="btn btn-sec" onClick={() => setBotones([...botones, { titulo: '', url: '' }])}><Icon name="link" size={13} />Botón con enlace</button>}
          <span className="ayuda">Ctrl+Enter para enviar</span>
          <button className="btn" onClick={enviar} disabled={enviando || !texto.trim() || v.tipo === 'cerrada'}><Icon name="send" size={13} />{enviando ? 'Enviando…' : 'Enviar'}</button>
        </div>
        {aviso && <div className={`aviso${/^Enviado/.test(aviso) ? ' ok' : ' error'}`}>{aviso}</div>}
      </div>
    </div>
  );
}

function Persona({ chat, onCambio }) {
  const c = chat.contacto;
  const archivar = async () => {
    await api(`/api/manychat/conversaciones/${encodeURIComponent(chat.id)}/estado`, { method: 'POST', body: { cuenta: chat.cuenta, estado: chat.estado === 'archived' ? 'active' : 'archived' } }).catch(() => {});
    onCambio();
  };
  return (
    <aside className="mc-persona">
      <div className="mc-persona-cab">
        <Avatar foto={chat.foto} nombre={chat.nombre} tam={56} />
        <b>{chat.nombre}</b>
        {chat.usuario && <a href={`https://www.instagram.com/${chat.usuario}/`} target="_blank" rel="noreferrer">@{chat.usuario}</a>}
        <small>{chat.sigue == null ? '' : chat.sigue ? 'Te sigue' : 'No te sigue'}{chat.seguidores != null ? ` · ${chat.seguidores.toLocaleString('es-ES')} seguidores` : ''}</small>
      </div>
      <div className="campo-et">Automatizaciones</div>
      <Acciones contacto={c ? { ...c, usuario: chat.usuario } : null} onCambio={onCambio} />
      {c && (
        <>
          <div className="campo-et">Etiquetas</div>
          <Etiquetas contactoId={c.id} etiquetas={c.etiquetas} onCambio={onCambio} />
        </>
      )}
      <div className="campo-et">Conversación</div>
      <button className="btn btn-sec" onClick={archivar}><Icon name="check" size={13} />{chat.estado === 'archived' ? 'Reabrir' : 'Cerrar (archivar)'}</button>
    </aside>
  );
}

export default function Bandeja({ abrir = null, onAbierto = () => {} }) {
  const [filtros, setFiltros] = useState({ estado: 'active', noLeidos: '', etiqueta: '', q: '' });
  const qs = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
  const [d, recargar, error] = useRecurso(`/api/manychat/conversaciones?${qs}`, null);
  const [etq] = useRecurso('/api/manychat/contactos?limite=1', null);
  const [elegido, setElegido] = useState(null);
  useEffect(() => { const t = setInterval(recargar, 20000); return () => clearInterval(t); }, [recargar]);
  // Desde la ficha de un contacto: abrir su conversación
  useEffect(() => {
    if (!abrir || !d) return;
    const c = d.lista.find((x) => x.id === abrir.id);
    setElegido(c || { id: abrir.id, cuenta: abrir.cuenta, nombre: abrir.nombre || 'Conversación', estado: 'active', contacto: null });
    onAbierto();
  }, [abrir, d]); // eslint-disable-line react-hooks/exhaustive-deps
  const chat = elegido && (d?.lista.find((x) => x.id === elegido.id) || elegido);
  const pon = (k, v) => setFiltros((f) => ({ ...f, [k]: v }));
  return (
    <div className="panel mc-bandeja">
      <div className="mc-lista">
        <div className="mc-filtros">
          <div className="seg">
            <button className={filtros.estado === 'active' ? 'on' : ''} onClick={() => pon('estado', 'active')}>Abiertos</button>
            <button className={filtros.estado === 'archived' ? 'on' : ''} onClick={() => pon('estado', 'archived')}>Cerrados</button>
          </div>
          <label className="lm-check"><input type="checkbox" checked={Boolean(filtros.noLeidos)} onChange={(e) => pon('noLeidos', e.target.checked ? '1' : '')} />No leídos</label>
          <div className="buscar-mini"><Icon name="search" size={13} /><input placeholder="Buscar" value={filtros.q} onChange={(e) => pon('q', e.target.value)} /></div>
          <select className="campo" value={filtros.etiqueta} onChange={(e) => pon('etiqueta', e.target.value)} aria-label="Filtrar por etiqueta">
            <option value="">Todas las etiquetas</option>
            {(etq?.etiquetas || []).map((t) => <option key={t.nombre} value={t.nombre}>{t.nombre} ({t.n})</option>)}
          </select>
        </div>
        {error && <div className="caja-error">{error}</div>}
        {!d && !error && <p className="ayuda" style={{ padding: 12 }}>Cargando chats…</p>}
        {d && !d.lista.length && <div className="vacio">No hay chats con estos filtros.</div>}
        {(d?.lista || []).map((x) => (
          <button key={x.id} className={`mc-item${chat?.id === x.id ? ' on' : ''}${x.noLeidos ? ' nuevo' : ''}`} onClick={() => setElegido(x)}>
            <Avatar foto={x.foto} nombre={x.nombre} />
            <span className="fila-c-txt"><b>{x.nombre}</b><small>{x.ultimo || '…'}</small></span>
            <span className="mc-item-der"><small>{fechaCorta(x.fecha)}</small>{x.noLeidos > 0 && <span className="mc-contador">{x.noLeidos}</span>}{x.contacto?.bloqueado && <span title="Bloqueado">⛔</span>}{x.contacto?.pausado && <span title="Automatizaciones en pausa"><Icon name="clock" size={11} /></span>}</span>
          </button>
        ))}
      </div>
      {chat ? (
        <>
          <Conversacion key={chat.id} chat={chat} onCambio={recargar} />
          <Persona chat={chat} onCambio={recargar} />
        </>
      ) : <div className="mc-chat mc-chat-vacio"><Icon name="send" size={28} /><p>Elige un chat de la lista.</p></div>}
    </div>
  );
}
