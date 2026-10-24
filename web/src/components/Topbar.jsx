import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import Apariencia from './Apariencia.jsx';
import Trabajando from './Trabajando.jsx';
import { api, useRecurso } from '../lib/api.js';

// La inicial de quien usa este JARVIS; con contraseña, pulsándola se cierra la sesión
function Avatar() {
  const [a] = useRecurso('/api/acceso', null);
  const inicial = (a?.nombre || 'J').trim().charAt(0).toUpperCase() || 'J';
  if (!a?.conClave) return <div className="avatar" title={a?.nombre || undefined}>{inicial}</div>;
  const salir = async () => {
    if (!window.confirm('¿Cerrar la sesión de JARVIS en este navegador?')) return;
    await api('/api/logout', { method: 'POST' }).catch(() => {});
    window.location.reload();
  };
  return <button type="button" className="avatar avatar-btn" onClick={salir} title={`${a.nombre ? `${a.nombre} · ` : ''}Cerrar sesión`} aria-label="Cerrar sesión">{inicial}</button>;
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
