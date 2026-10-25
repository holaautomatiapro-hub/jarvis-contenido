import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api } from '../../lib/api.js';
import { Modal, ponerFases, useFases } from './comun.jsx';

// Editar las fases del pipeline: añadir, renombrar, colorear, ordenar y borrar.
// Idea, Listo y Publicado son del sistema (JARVIS las usa para ideas, Instagram y Diseño): se renombran, no se borran.
const COLORES = ['var(--blue)', 'var(--purple)', 'var(--orange)', 'var(--pink)', 'var(--cyan)', 'var(--green)', 'var(--red)', '#eab308'];
const ICONOS = ['bulb', 'pen', 'mic', 'layers', 'calendar', 'checkCircle', 'target', 'eye', 'play', 'sparkle', 'bolt', 'users', 'chart', 'doc', 'clock'];

export function EditorFases({ piezas = [], onClose, onGuardado }) {
  const actuales = useFases();
  const [lista, setLista] = useState(() => actuales.map((f) => ({ ...f, clave: f.id })));
  const [mover, setMover] = useState({});
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [abierta, setAbierta] = useState(null); // fase con el selector de icono abierto

  const cuenta = (id) => piezas.filter((p) => p.estado === id).length;
  const cambiar = (i, k, v) => setLista((l) => l.map((f, j) => (j === i ? { ...f, [k]: v } : f)));
  const subir = (i, d) => setLista((l) => {
    const n = [...l];
    const j = i + d;
    if (j < 0 || j >= n.length) return l;
    [n[i], n[j]] = [n[j], n[i]];
    return n;
  });
  const anadir = () => setLista((l) => {
    const n = [...l];
    n.splice(n.length, 0, { clave: `nueva-${Date.now()}`, label: 'Nueva fase', color: COLORES[(n.length + 2) % COLORES.length], icon: 'target', ayuda: '' });
    return n;
  });
  const borradas = actuales.filter((f) => !lista.some((x) => x.id === f.id));
  const quitar = (i) => setLista((l) => l.filter((_, j) => j !== i));

  const guardar = async () => {
    setGuardando(true); setError('');
    try {
      const destinos = Object.fromEntries(borradas.filter((f) => cuenta(f.id)).map((f) => [f.id, mover[f.id] || lista[0].id]));
      const r = await api('/api/pipeline', { method: 'PUT', body: { fases: lista.map(({ id, label, color, icon, ayuda }) => ({ id, label, color, icon, ayuda })), mover: destinos } });
      ponerFases(r);
      onGuardado?.();
      onClose();
    } catch (e) { setError(e.message); setGuardando(false); }
  };

  return (
    <Modal titulo={<><Icon name="layers" size={15} />Fases del pipeline</>} onClose={onClose} ancho={640} cerrarFuera={false}>
      <p className="ayuda fases-intro">Añade, renombra, ordena (también arrastrando las columnas en el pipeline) o borra fases. <b>Idea</b>, <b>Listo</b> y <b>Publicado</b> las usa JARVIS (ideas nuevas, publicar en Instagram y Diseño): se pueden renombrar, pero no borrar.</p>
      <div className="fases-lista">
        {lista.map((f, i) => {
          return (
            <div key={f.clave} className="fase-fila" style={{ '--c': f.color }}>
              <div className="fase-orden">
                <button type="button" onClick={() => subir(i, -1)} disabled={i === 0} aria-label="Subir">▲</button>
                <button type="button" onClick={() => subir(i, 1)} disabled={i === lista.length - 1} aria-label="Bajar">▼</button>
              </div>
              <button type="button" className="fase-icono" onClick={() => setAbierta(abierta === f.clave ? null : f.clave)} aria-label="Cambiar icono" title="Cambiar icono"><Icon name={f.icon} size={15} color={f.color} /></button>
              <div className="fase-campos">
                <input className="campo" value={f.label} onChange={(e) => cambiar(i, 'label', e.target.value)} maxLength={30} aria-label="Nombre de la fase" />
                <div className="fase-sub">
                  <input className="campo fase-ayuda" value={f.ayuda || ''} onChange={(e) => cambiar(i, 'ayuda', e.target.value)} maxLength={60} placeholder="Descripción corta (opcional)" aria-label="Descripción" />
                  <div className="fase-colores">
                    {COLORES.map((c) => <button type="button" key={c} className={f.color === c ? 'on' : ''} style={{ background: c }} onClick={() => cambiar(i, 'color', c)} aria-label="Color" />)}
                  </div>
                </div>
                {abierta === f.clave && (
                  <div className="fase-iconos">{ICONOS.map((ic) => <button type="button" key={ic} className={f.icon === ic ? 'on' : ''} onClick={() => { cambiar(i, 'icon', ic); setAbierta(null); }} aria-label={ic}><Icon name={ic} size={14} /></button>)}</div>
                )}
              </div>
              <span className="fase-n" title="Piezas en esta fase">{f.id ? cuenta(f.id) : 0}</span>
              {f.sistema ? <span className="fase-sistema" title="Fase del sistema: no se puede borrar">Sistema</span>
                : <button type="button" className="icon-btn mini" onClick={() => quitar(i)} aria-label={`Borrar la fase ${f.label}`} title="Borrar fase"><Icon name="trash" /></button>}
            </div>
          );
        })}
      </div>
      <button type="button" className="chip fases-anadir" onClick={anadir} disabled={lista.length >= 12}><Icon name="plus" />Añadir fase</button>

      {borradas.filter((f) => cuenta(f.id)).map((f) => (
        <div key={f.id} className="aviso fase-mover">
          <span>«{f.label}» tiene {cuenta(f.id)} {cuenta(f.id) === 1 ? 'pieza' : 'piezas'}. Pasan a:</span>
          <select className="campo" value={mover[f.id] || lista[0].id} onChange={(e) => setMover({ ...mover, [f.id]: e.target.value })} aria-label={`Fase de destino para ${f.label}`}>
            {lista.filter((x) => x.id).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </div>
      ))}
      {error && <div className="aviso error">{error}</div>}
      <div className="modal-pie">
        <button type="button" className="btn btn-sec" onClick={onClose}>Cancelar</button>
        <button type="button" className="btn" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar fases'}</button>
      </div>
    </Modal>
  );
}
