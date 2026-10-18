import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import ChatJarvis from '../../components/ChatJarvis.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { BotonCopiar, Modal } from './comun.jsx';

// Todos tus lead magnets en la biblioteca: los que hace JARVIS (Laboratorio) y los que ya tenías publicados (se
// añaden con su título y su enlace). Cada uno se cambia con JARVIS en un chat, se edita a mano o se borra.

// El chat para cambiar uno: cada mensaje va con el lead magnet de contexto (en el chat del Laboratorio)
function EditarConJarvis({ lm, onClose, onPublicado }) {
  const [publicando, setPublicando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const prefijo = `[Lead magnet «${lm.titulo}», en leadmagnets/${lm.slug}/index.html${lm.url ? `, publicado en ${lm.url}` : ''}] Cámbialo como te pido: mantén su diseño y su estructura, compruébalo en móvil con laboratorio/captura.mjs y no lo publiques. Lo que quiero:`;
  const publicar = async () => {
    setPublicando(true); setAviso(null);
    try {
      const r = await api(`/api/laboratorio/leadmagnets/${lm.slug}/publicar`, { method: 'POST' });
      setAviso({ tipo: 'ok', texto: r.aviso || `Publicado: ${r.url}` });
      onPublicado?.();
    } catch (e) { setAviso({ tipo: 'error', texto: e.message }); }
    setPublicando(false);
  };
  return (
    <Modal titulo={<><Icon name="target" size={15} />Cambiar «{lm.titulo}»</>} onClose={onClose} ancho={760} clase="lm-chat-modal">
      {!lm.listo ? (
        <div className="aviso">No tengo la página de este lead magnet (no se pudo bajar de su enlace), así que JARVIS no puede cambiarla. Puedes cambiar su título o su enlace a mano.</div>
      ) : (
        <>
          <ChatJarvis
            conversacion="laboratorio"
            titulo="JARVIS · Lead magnet"
            subtitulo={lm.url || `leadmagnets/${lm.slug}`}
            placeholder="Qué quieres cambiar: «añade un paso sobre el guion», «el título más corto», «cambia el CTA»…"
            intro="Dime qué cambiar. JARVIS lo cambia, lo revisa en móvil y te avisa. Después, publica los cambios."
            prefijo={prefijo}
            mostrarPregunta={(t) => (t.startsWith(prefijo) ? t.slice(prefijo.length).trim() : t)}
            conGuardarGuion={false}
            clase="lm-chat"
          />
          <div className="modal-pie">
            <span className="ayuda">{lm.externo ? 'Lo publicaste fuera de JARVIS: al publicar, se sube a tu dominio de lead magnets (si lo tienes conectado).' : 'Los cambios no se ven en el enlace hasta que los publiques.'}</span>
            <button type="button" className="btn" onClick={publicar} disabled={publicando}><Icon name="publish" size={14} />{publicando ? 'Publicando…' : 'Publicar cambios'}</button>
          </div>
          {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}</div>}
        </>
      )}
    </Modal>
  );
}

function Fila({ lm, recargar, onChat, setAviso }) {
  const [editando, setEditando] = useState(false);
  const [titulo, setTitulo] = useState(lm.titulo);
  const [url, setUrl] = useState(lm.url || '');
  const guardar = async (e) => {
    e.preventDefault();
    try { await api(`/api/laboratorio/leadmagnets/${lm.slug}`, { method: 'PATCH', body: { titulo, url } }); setEditando(false); recargar(); } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
  };
  const borrar = async () => {
    const aviso = lm.externo || !lm.url ? '' : ' También se quita de donde JARVIS lo publicó.';
    if (!window.confirm(`¿Eliminar «${lm.titulo}»?${aviso}`)) return;
    try { await api(`/api/laboratorio/leadmagnets/${lm.slug}`, { method: 'DELETE' }); recargar(); } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
  };
  if (editando) {
    return (
      <form className="lmb-fila editando" onSubmit={guardar}>
        <input className="campo" value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título" maxLength={120} required autoFocus />
        <input className="campo" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        <div className="lmb-acciones">
          <button className="btn">Guardar</button>
          <button type="button" className="link-btn" onClick={() => { setEditando(false); setTitulo(lm.titulo); setUrl(lm.url || ''); }}>Cancelar</button>
        </div>
      </form>
    );
  }
  return (
    <div className="lmb-fila">
      <div className="lmb-txt">
        <b>{lm.titulo}</b>
        {lm.url ? (
          <span className="lmb-url"><a href={lm.url} target="_blank" rel="noreferrer">{lm.url}</a><BotonCopiar texto={lm.url} className="link-btn" /></span>
        ) : <span className="ayuda">{lm.listo ? 'Sin publicar (publícalo desde Laboratorio → Lead magnets)' : 'JARVIS lo está haciendo…'}</span>}
      </div>
      <div className="lmb-acciones">
        <button type="button" className="btn btn-sec" onClick={() => onChat(lm)} title="Pedirle cambios a JARVIS en un chat"><Icon name="sparkle" size={14} />Editar con JARVIS</button>
        <button type="button" className="chip" onClick={() => setEditando(true)} title="Cambiar el título o el enlace"><Icon name="pen" size={13} /></button>
        <button type="button" className="chip" onClick={borrar} title="Eliminar" aria-label="Eliminar"><Icon name="trash" size={13} /></button>
      </div>
    </div>
  );
}

export function LeadMagnetsBiblioteca() {
  const [data, recargar, error] = useRecurso('/api/laboratorio/leadmagnets', null);
  const [anadiendo, setAnadiendo] = useState(false);
  const [nuevo, setNuevo] = useState({ titulo: '', url: '' });
  const [guardando, setGuardando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [chat, setChat] = useState(null);
  if (error || !data) return null; // sin Laboratorio no hay lead magnets

  const anadir = async (e) => {
    e.preventDefault();
    setGuardando(true); setAviso(null);
    try {
      const r = await api('/api/laboratorio/leadmagnets/enlace', { method: 'POST', body: nuevo });
      setAviso(r.conPagina ? { tipo: 'ok', texto: 'Guardado. JARVIS tiene su página: puedes cambiarlo con él.' } : { tipo: 'ok', texto: 'Guardado con su enlace (no he podido bajar la página, así que JARVIS no podrá cambiarla).' });
      setNuevo({ titulo: '', url: '' }); setAnadiendo(false); recargar();
    } catch (err) { setAviso({ tipo: 'error', texto: err.message }); }
    setGuardando(false);
  };
  const lista = [...data.leadmagnets].sort((a, b) => String(b.mod || b.creado || '').localeCompare(String(a.mod || a.creado || '')));
  return (
    <div className="panel panel-pad lmb">
      <div className="panel-head">
        <div>
          <span className="label">Lead magnets</span>
          <div className="ayuda" style={{ marginTop: 3 }}>Todos los tuyos, con su enlace. Los nuevos se crean en Laboratorio → Lead magnets.</div>
        </div>
        {!anadiendo && <button type="button" className="btn btn-sec" onClick={() => setAnadiendo(true)}><Icon name="plus" size={14} />Añadir uno que ya tengo</button>}
      </div>
      {anadiendo && (
        <form className="lmb-fila editando" onSubmit={anadir}>
          <input className="campo" value={nuevo.titulo} onChange={(e) => setNuevo({ ...nuevo, titulo: e.target.value })} placeholder="Título (si lo dejas vacío, el de la página)" maxLength={120} autoFocus />
          <input className="campo" value={nuevo.url} onChange={(e) => setNuevo({ ...nuevo, url: e.target.value })} placeholder="https://recursos.tudominio.com/mi-guia/" required />
          <div className="lmb-acciones">
            <button className="btn" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
            <button type="button" className="link-btn" onClick={() => setAnadiendo(false)}>Cancelar</button>
          </div>
        </form>
      )}
      {aviso && <div className={`aviso ${aviso.tipo}`}>{aviso.texto}<button className="link-btn" onClick={() => setAviso(null)}>Cerrar</button></div>}
      {lista.map((lm) => <Fila key={lm.slug} lm={lm} recargar={recargar} onChat={setChat} setAviso={setAviso} />)}
      {!lista.length && <div className="vacio">Aún no hay lead magnets. Añade los que ya tienes publicados o crea uno en Laboratorio.</div>}
      {chat && <EditarConJarvis lm={chat} onClose={() => { setChat(null); recargar(); }} onPublicado={recargar} />}
    </div>
  );
}
