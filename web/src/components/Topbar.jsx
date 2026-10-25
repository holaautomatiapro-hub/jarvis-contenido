import { useEffect, useRef, useState } from 'react';
import Icon from './Icon.jsx';
import Apariencia from './Apariencia.jsx';
import Trabajando from './Trabajando.jsx';
import { api, useRecurso } from '../lib/api.js';
import Actualizar from './Actualizar.jsx';
import ConectarClaudeCode from './ConectarClaudeCode.jsx';
import { Modal } from '../views/contenido/comun.jsx';

// La inicial de quien usa este JARVIS: abre el menú (buscar actualizaciones, conectar Claude Code y, con contraseña,
// cerrar sesión). Un punto avisa si hay una actualización esperando o la última falló.
function Avatar() {
  const [a] = useRecurso('/api/acceso', null);
  const [act] = useRecurso('/api/actualizar', null);
  const [abierto, setAbierto] = useState(false);
  const [viendo, setViendo] = useState(null); // 'actualizar' | 'claude'
  const ref = useRef(null);
  useEffect(() => {
    if (!abierto) return undefined;
    const fuera = (e) => { if (!ref.current?.contains(e.target)) setAbierto(false); };
    const esc = (e) => e.key === 'Escape' && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fuera); document.removeEventListener('keydown', esc); };
  }, [abierto]);
  const inicial = (a?.nombre || 'J').trim().charAt(0).toUpperCase() || 'J';
  const aviso = Boolean(act?.actualizando || act?.comprobado?.pendientes?.length || act?.ultima?.estado === 'error');
  const salir = async () => {
    if (!window.confirm('¿Cerrar la sesión de JARVIS en este navegador?')) return;
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    window.location.reload();
  };
  const abrir = (que) => { setAbierto(false); setViendo(que); };
  return (
    <div className="menu-jarvis" ref={ref}>
      <button type="button" className="avatar avatar-btn" onClick={() => setAbierto(!abierto)} aria-haspopup="menu" aria-expanded={abierto} title={a?.nombre || 'Menú'}>
        {inicial}{aviso && <span className="avatar-aviso" aria-label="Hay una actualización" />}
      </button>
      {abierto && (
        <div className="menu-jarvis-lista panel" role="menu">
          {a?.nombre && <div className="menu-jarvis-nombre">{a.nombre}</div>}
          <button type="button" role="menuitem" onClick={() => abrir('actualizar')}><Icon name="refresh" size={14} />Buscar actualizaciones{aviso && <span className="tag">nueva</span>}</button>
          <button type="button" role="menuitem" onClick={() => abrir('claude')}><Icon name="claude" size={14} />Conectar Claude Code</button>
          {a?.conClave && <button type="button" role="menuitem" onClick={salir}><Icon name="x" size={14} />Cerrar sesión</button>}
        </div>
      )}
      {viendo === 'actualizar' && <Modal titulo="Actualizar JARVIS" onClose={() => setViendo(null)} ancho={720}><Actualizar /></Modal>}
      {viendo === 'claude' && <Modal titulo="Conectar Claude Code" onClose={() => setViendo(null)} ancho={760}><ConectarClaudeCode fijo /></Modal>}
    </div>
  );
}

export const TABS = [
  { id: 'inicio', label: 'Inicio', icon: 'home' },
  { id: 'contenido', label: 'Contenido', icon: 'layers' },
  { id: 'estrategia', label: 'Estrategia', icon: 'target' },
  { id: 'laboratorio', label: 'Laboratorio', icon: 'flask' },
  { id: 'chat', label: 'Chat', icon: 'voice' },
  { id: 'instagram', label: 'Instagram', icon: 'instagram' },
  { id: 'competencia', label: 'Competencia', icon: 'spy' },
  { id: 'ads', label: 'Meta Ads', icon: 'ads' },
];

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000 * 15);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function Topbar({ tab, onTab }) {
  const now = useClock();
  const time = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
  return (
    <header className="topbar panel">
      <div className="logo">
        <div className="logo-word">JARVIS<span className="logo-dot" /></div>
        <div className="logo-sub-row">
          <span className="logo-sub">Sistema Operativo de IA</span>
        </div>
      </div>
      <nav className="nav" aria-label="Secciones">
        {TABS.map((t) => (
          <button key={t.id} className={`pill${tab === t.id ? ' active' : ''}`} onClick={() => onTab(t.id)}>
            <Icon name={t.icon} />
            {t.label}
          </button>
        ))}
      </nav>
      <div className="top-right">
        <Trabajando onTab={onTab} />
        <Apariencia />
        <Avatar />
        <div className="clock">
          <div className="clock-time">{time}</div>
          <div className="clock-date">{date}</div>
        </div>
      </div>
    </header>
  );
}
