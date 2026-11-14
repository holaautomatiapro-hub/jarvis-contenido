import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';
import Ficha from './Ficha.jsx';

// Tareas asignadas a contactos (se crean desde la ficha de cada persona). También salen en las tareas de JARVIS.
const FILTROS = [['pendientes', 'Pendientes'], ['hechas', 'Hechas'], ['todas', 'Todas']];

export default function Tareas({ onChat }) {
  const [filtro, setFiltro] = useState('pendientes');
  const [busca, setBusca] = useState('');
  const [viendo, setViendo] = useState(null);
  const estado = filtro === 'pendientes' ? '&estado=sin_empezar,en_proceso' : filtro === 'hechas' ? '&estado=terminada' : '';
  const [d, recargar, error] = useRecurso(`/api/tareas/lista?contacto=*${estado}${busca.trim() ? `&texto=${encodeURIComponent(busca.trim())}` : ''}`, null);
  const marcar = async (t) => { await api(`/api/tareas/${t.id}`, { method: 'PATCH', body: { hecha: t.estado !== 'terminada' } }).catch(() => {}); recargar(); };
  const borrar = async (t) => { if (window.confirm(`¿Borrar la tarea «${t.titulo}»?`)) { await api(`/api/tareas/${t.id}`, { method: 'DELETE' }).catch(() => {}); recargar(); } };
  const tareas = (d?.tareas || []).slice().sort((a, b) => (a.estado === 'terminada') - (b.estado === 'terminada') || String(a.plazo_desde || '9999').localeCompare(String(b.plazo_desde || '9999')));
  return (
    <div className="panel panel-pad mc-tareas">
      <div className="mc-filtros">
        <div className="seg">{FILTROS.map(([k, t]) => <button key={k} className={filtro === k ? 'on' : ''} onClick={() => setFiltro(k)}>{t}</button>)}</div>
        <div className="buscar-mini"><Icon name="search" size={13} /><input placeholder="Buscar tarea o persona" value={busca} onChange={(e) => setBusca(e.target.value)} /></div>
        <span className="ayuda" style={{ marginLeft: 'auto' }}>Se asignan desde la ficha de cada persona (Contactos o Bandeja → Ficha).</span>
      </div>
      {error && <div className="caja-error">{error}</div>}
      {!d && !error && <p className="ayuda">Cargando tareas…</p>}
      {d && (
        <div className="mc-tabla">
          <div className="mc-fila mc-fila-tarea mc-fila-cab"><span /><span>Tarea</span><span>Persona</span><span>Fecha</span><span /></div>
          {tareas.map((t) => (
            <div key={t.id} className={`mc-fila mc-fila-tarea${t.estado === 'terminada' ? ' hecha' : ''}${t.atrasada ? ' atrasada' : ''}`}>
              <input type="checkbox" checked={t.estado === 'terminada'} onChange={() => marcar(t)} aria-label="Hecha" />
              <span className="mc-tarea-titulo">{t.titulo}</span>
              <button type="button" className="link-btn" onClick={() => setViendo(t.contacto_id)}>{t.contacto_nombre || 'Ver ficha'}</button>
              <span className="mc-tarea-fecha">{t.plazo_desde ? new Date(`${t.plazo_desde}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : 'Sin fecha'}{t.atrasada ? ' · atrasada' : ''}</span>
              <button type="button" className="icon-btn" onClick={() => borrar(t)} aria-label="Borrar tarea">✕</button>
            </div>
          ))}
          {!tareas.length && <div className="vacio">{filtro === 'pendientes' ? 'No tienes tareas pendientes con contactos.' : 'No hay tareas.'}</div>}
        </div>
      )}
      {viendo && <Ficha id={viendo} onClose={() => { setViendo(null); recargar(); }} onChat={onChat ? (c) => { setViendo(null); onChat(c); } : null} />}
    </div>
  );
}
