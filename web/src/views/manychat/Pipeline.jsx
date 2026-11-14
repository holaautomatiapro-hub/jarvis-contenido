import { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { Modal } from '../contenido/comun.jsx';
import { Avatar, fechaCorta } from './comun.jsx';

// Pipeline de ventas: una columna por fase. Se arrastra una tarjeta para moverla a mano; con la IA activada, JARVIS lee
// las conversaciones con mensajes nuevos y mueve a cada persona hacia delante según en qué punto esté.

const hace = (f) => {
  if (!f) return 'nunca';
  const min = Math.round((Date.now() - Date.parse(f)) / 60000);
  if (min < 1) return 'ahora mismo';
  if (min < 60) return `hace ${min} min`;
  if (min < 1440) return `hace ${Math.round(min / 60)} h`;
  return new Date(f).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

function EditarColumnas({ fases, onClose, onGuardado }) {
  const [lista, setLista] = useState(() => fases.map((f) => ({ ...f })));
  const [error, setError] = useState('');
  const cambiar = (i, c) => setLista((l) => l.map((f, j) => (j === i ? { ...f, ...c } : f)));
  const subir = (i, d) => setLista((l) => { const n = [...l]; const j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const guardar = async () => {
    setError('');
    try { await api('/api/manychat/pipeline/fases', { method: 'PUT', body: { fases: lista.map(({ id, nombre, criterio }) => ({ id, nombre, criterio })) } }); onGuardado(); onClose(); }
    catch (e) { setError(e.message); }
  };
  return (
    <Modal titulo="Columnas del pipeline" onClose={onClose} ancho={680} cerrarFuera={false}>
      <p className="ayuda">«Cuándo pasa aquí» es lo que lee la IA para decidir si mueve a alguien a esa columna. Las predeterminadas se pueden renombrar y mover, pero no borrar.</p>
      <div className="mc-columnas-ed">
        {lista.map((f, i) => (
          <div key={f.id || `nueva-${i}`} className="mc-columna-ed">
            <div className="mc-orden">
              <button type="button" className="icon-btn" onClick={() => subir(i, -1)} disabled={i === 0} aria-label="Subir">↑</button>
              <button type="button" className="icon-btn" onClick={() => subir(i, 1)} disabled={i === lista.length - 1} aria-label="Bajar">↓</button>
            </div>
            <div className="mc-columna-campos">
              <input className="campo" value={f.nombre} maxLength={40} onChange={(e) => cambiar(i, { nombre: e.target.value })} placeholder="Nombre de la columna" />
              <textarea className="campo" rows={2} value={f.criterio || ''} maxLength={400} onChange={(e) => cambiar(i, { criterio: e.target.value })} placeholder="Cuándo pasa aquí (para la IA): p. ej. «hizo la llamada y lo está pensando»" />
            </div>
            {f.base ? <span className="chip" title="Columna predeterminada">fija</span>
              : <button type="button" className="link-btn peligro" onClick={() => setLista((l) => l.filter((_, j) => j !== i))}>Borrar</button>}
          </div>
        ))}
      </div>
      <button type="button" className="btn btn-sec" onClick={() => setLista((l) => { const n = [...l]; const fin = n.findIndex((f) => f.final); n.splice(fin < 0 ? n.length : fin, 0, { nombre: '', criterio: '' }); return n; })}><Icon name="plus" size={13} />Añadir columna</button>
      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie"><span className="ayuda">Si borras una columna, quien estaba en ella vuelve a Iniciada.</span><div style={{ display: 'flex', gap: 8 }}><button className="btn btn-sec" onClick={onClose}>Cancelar</button><button className="btn" onClick={guardar}>Guardar</button></div></div>
    </Modal>
  );
}

export default function Pipeline({ soloIds = null, onAbrir, cambios = 0 }) {
  const [d, recargar, error, setD] = useRecurso('/api/manychat/pipeline', null);
  const [arrastrando, setArrastrando] = useState(null);
  const [encima, setEncima] = useState(null);
  const [editando, setEditando] = useState(false);
  const [aviso, setAviso] = useState(null);
  const [leyendo, setLeyendo] = useState(false);
  const [mostrar, setMostrar] = useState({});
  useEffect(() => { recargar(); }, [cambios]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setInterval(recargar, 60000); return () => clearInterval(t); }, [recargar]);

  if (error) return <div className="caja-error">{error}</div>;
  if (!d) return <p className="ayuda">Cargando el pipeline…</p>;
  const tarjetas = soloIds ? d.tarjetas.filter((t) => soloIds.has(t.id)) : d.tarjetas;

  const mover = async (id, fase) => {
    const t = d.tarjetas.find((x) => x.id === id);
    if (!t || t.fase === fase) return;
    setD({ ...d, tarjetas: d.tarjetas.map((x) => (x.id === id ? { ...x, fase, por: 'manual', motivo: null } : x)) });
    try { await api(`/api/manychat/contactos/${encodeURIComponent(id)}/fase`, { method: 'POST', body: { fase } }); }
    catch (e) { setAviso({ ok: false, texto: e.message }); recargar(); }
  };
  const activarIa = async (activo) => { await api('/api/manychat/pipeline/ia', { method: 'POST', body: { activo } }).catch(() => {}); recargar(); };
  const analizar = async () => {
    setLeyendo(true); setAviso(null);
    try {
      const r = await api('/api/manychat/pipeline/analizar', { method: 'POST' });
      setAviso({ ok: true, texto: r.enCurso ? 'Ya se están leyendo las conversaciones: espera un momento.' : r.analizados ? `Leídas ${r.analizados} conversaciones: ${r.movidos ? `${r.movidos} cambiaron de columna` : 'ninguna cambia de columna'}.` : 'No hay conversaciones con mensajes nuevos que leer.' });
    } catch (e) { setAviso({ ok: false, texto: e.message }); }
    setLeyendo(false); recargar();
  };

  return (
    <div className="mc-pipeline">
      <div className="mc-pipeline-cab">
        <label className="lm-check" title="Cada 15 minutos lee las conversaciones con mensajes nuevos y mueve a cada persona según el punto en que esté">
          <input type="checkbox" checked={d.ia.activo} disabled={!d.ia.disponible} onChange={(e) => activarIa(e.target.checked)} />
          Mover solas con IA
        </label>
        <span className="ayuda">{!d.ia.disponible ? 'Necesita Claude Code en este JARVIS.' : `Última lectura: ${hace(d.ia.ultima)}${d.ia.movidos ? ` · ${d.ia.movidos} movidas por la IA` : ''}`}</span>
        {d.ia.error && <span className="aviso-error" title={d.ia.error}>Último error: {d.ia.error.slice(0, 80)}</span>}
        <span style={{ flex: 1 }} />
        {d.ia.disponible && <button className="btn btn-sec" onClick={analizar} disabled={leyendo}><Icon name="sparkle" size={13} />{leyendo ? 'Leyendo…' : 'Leer conversaciones ahora'}</button>}
        <button className="btn btn-sec" onClick={() => setEditando(true)}><Icon name="pen" size={13} />Columnas</button>
      </div>
      {aviso && <div className={`aviso ${aviso.ok ? 'ok' : 'error'}`}>{aviso.texto}</div>}
      <div className="mc-tablero">
        {d.fases.map((f) => {
          const suyas = tarjetas.filter((t) => t.fase === f.id);
          const tope = mostrar[f.id] || 60;
          return (
            <div key={f.id} className={`mc-columna${encima === f.id ? ' encima' : ''}${f.id === 'ganado' ? ' ganado' : f.id === 'perdido' ? ' perdido' : ''}`}
              onDragOver={(e) => { if (arrastrando) { e.preventDefault(); setEncima(f.id); } }}
              onDragLeave={() => setEncima((x) => (x === f.id ? null : x))}
              onDrop={(e) => { e.preventDefault(); setEncima(null); if (arrastrando) mover(arrastrando, f.id); setArrastrando(null); }}>
              <div className="mc-columna-cab" title={f.criterio}><b>{f.nombre}</b><span className="mc-contador-col">{suyas.length}</span></div>
              <div className="mc-columna-lista">
                {suyas.slice(0, tope).map((t) => (
                  <button key={t.id} type="button" className={`mc-tarjeta${arrastrando === t.id ? ' moviendo' : ''}`} draggable
                    onDragStart={(e) => { setArrastrando(t.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t.id); }}
                    onDragEnd={() => { setArrastrando(null); setEncima(null); }}
                    onClick={() => onAbrir(t.id)}>
                    <span className="mc-tarjeta-cab">
                      <Avatar foto={t.foto} nombre={t.nombre || t.usuario} tam={26} />
                      <span className="fila-c-txt"><b>{t.usuario ? `@${t.usuario}` : t.nombre || 'Contacto'}</b>{t.recurso && <small>{t.recurso}</small>}</span>
                    </span>
                    {t.por === 'ia' && t.motivo && <span className="mc-motivo" title="La movió la IA">✦ {t.motivo}</span>}
                    <small className="mc-tarjeta-pie">{t.ultimoRecibido ? `Último mensaje: ${fechaCorta(t.ultimoRecibido)}` : 'Sin mensajes suyos'}</small>
                  </button>
                ))}
                {suyas.length > tope && <button type="button" className="link-btn" onClick={() => setMostrar((m) => ({ ...m, [f.id]: tope + 60 }))}>Ver {Math.min(60, suyas.length - tope)} más</button>}
                {!suyas.length && <p className="mc-columna-vacia">Arrastra aquí</p>}
              </div>
            </div>
          );
        })}
      </div>
      {editando && <EditarColumnas fases={d.fases} onClose={() => setEditando(false)} onGuardado={recargar} />}
    </div>
  );
}
