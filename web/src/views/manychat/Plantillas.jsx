import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import CampoEmoji from '../../components/CampoEmoji.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { Modal } from '../contenido/comun.jsx';

// Plantillas de mensajes: se pegan en la bandeja y en los bloques Mensaje del tablero
const VACIA = { nombre: '', carpeta: '', texto: '', botones: [] };

function Editor({ inicial, carpetas, onClose, onGuardado }) {
  const [p, setP] = useState(() => ({ ...VACIA, ...(inicial || {}), carpeta: inicial?.carpeta || '' }));
  const [error, setError] = useState('');
  const boton = (i, c) => setP((x) => ({ ...x, botones: x.botones.map((b, j) => (j === i ? { ...b, ...c } : b)) }));
  const guardar = async () => {
    setError('');
    try {
      await api(inicial?.id ? `/api/manychat/plantillas/${inicial.id}` : '/api/manychat/plantillas', { method: inicial?.id ? 'PUT' : 'POST', body: p });
      onGuardado(); onClose();
    } catch (e) { setError(e.message); }
  };
  return (
    <Modal titulo={inicial?.id ? 'Editar plantilla' : 'Nueva plantilla'} onClose={onClose} ancho={620} cerrarFuera={false}>
      <div className="dos-col">
        <div><label className="campo-et">Nombre</label><input className="campo" value={p.nombre} onChange={(e) => setP({ ...p, nombre: e.target.value })} placeholder="Ej.: Precio del setter" /></div>
        <div>
          <label className="campo-et">Carpeta (opcional)</label>
          <input className="campo" list="mc-carpetas" value={p.carpeta} onChange={(e) => setP({ ...p, carpeta: e.target.value })} placeholder="Ventas, Lead magnets…" />
          <datalist id="mc-carpetas">{carpetas.map((c) => <option key={c} value={c} />)}</datalist>
        </div>
      </div>
      <label className="campo-et">Texto <span className="contador">{p.texto.length} / {p.botones.length ? 640 : 1000}</span></label>
      <CampoEmoji rows={6} value={p.texto} onChange={(v) => setP({ ...p, texto: v })} placeholder="¡Hola {{first_name}}! 👋 …" />
      <p className="ayuda">En las automatizaciones, {'{{first_name}}'} pone su nombre.</p>
      <label className="campo-et">Botones con enlace ({p.botones.length}/3)</label>
      {p.botones.map((b, i) => (
        <div key={i} className="fila">
          <input className="campo" maxLength={20} value={b.titulo} onChange={(e) => boton(i, { titulo: e.target.value })} placeholder="Texto del botón" />
          <input className="campo" value={b.url} onChange={(e) => boton(i, { url: e.target.value })} placeholder="https://…" />
          <button className="icon-btn" onClick={() => setP((x) => ({ ...x, botones: x.botones.filter((_, j) => j !== i) }))} aria-label="Quitar">✕</button>
        </div>
      ))}
      {p.botones.length < 3 && <button className="btn btn-sec" onClick={() => setP((x) => ({ ...x, botones: [...x.botones, { titulo: '', url: '' }] }))}><Icon name="plus" size={13} />Añadir botón</button>}
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie"><span /><div style={{ display: 'flex', gap: 8 }}><button className="btn btn-sec" onClick={onClose}>Cancelar</button><button className="btn" onClick={guardar}>Guardar</button></div></div>
    </Modal>
  );
}

export default function Plantillas() {
  const [lista, recargar, error] = useRecurso('/api/manychat/plantillas', null);
  const [editando, setEditando] = useState(null);
  const [busca, setBusca] = useState('');
  const borrar = async (p) => { if (window.confirm(`¿Borrar la plantilla «${p.nombre}»?`)) { await api(`/api/manychat/plantillas/${p.id}`, { method: 'DELETE' }); recargar(); } };
  const b = busca.trim().toLowerCase();
  const filtradas = (lista || []).filter((p) => !b || `${p.nombre} ${p.texto} ${p.carpeta || ''}`.toLowerCase().includes(b));
  const carpetas = [...new Set((lista || []).map((p) => p.carpeta).filter(Boolean))];
  const grupos = [...new Set(filtradas.map((p) => p.carpeta || ''))];
  return (
    <div className="panel panel-pad mc-plantillas">
      <div className="mc-filtros">
        <div className="buscar-mini"><Icon name="search" size={13} /><input placeholder="Buscar plantilla" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <span className="ayuda" style={{ marginLeft: 'auto' }}>Se pegan en la bandeja y en los bloques Mensaje del tablero (botón «Plantilla»).</span>
        <button className="btn" onClick={() => setEditando('nueva')}><Icon name="plus" size={14} />Nueva plantilla</button>
      </div>
      {error && <div className="caja-error">{error}</div>}
      {lista && !lista.length && <div className="vacio">Aún no tienes plantillas. Crea las respuestas que más repites: precio, cómo funciona, enlace a la llamada…</div>}
      {grupos.map((g) => (
        <div key={g || '-'}>
          {g && <div className="campo-et mc-carpeta"><Icon name="folder" size={12} />{g}</div>}
          <div className="mc-plantillas-grid">
            {filtradas.filter((p) => (p.carpeta || '') === g).map((p) => (
              <div key={p.id} className="panel mc-plantilla">
                <b>{p.nombre}</b>
                <p>{p.texto}</p>
                {p.botones.map((x, i) => <span key={i} className="fl-boton">🔗 {x.titulo}</span>)}
                <div className="auto-acciones"><button className="btn btn-sec" onClick={() => setEditando(p)}><Icon name="pen" size={13} />Editar</button><button className="link-btn peligro" onClick={() => borrar(p)}>Borrar</button></div>
              </div>
            ))}
          </div>
        </div>
      ))}
      {editando && <Editor inicial={editando === 'nueva' ? null : editando} carpetas={carpetas} onClose={() => setEditando(null)} onGuardado={recargar} />}
    </div>
  );
}
