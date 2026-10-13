import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';
import Apariencia from './Apariencia.jsx';
import Trabajando from './Trabajando.jsx';

export const TABS = [
  { id: 'inicio', label: 'Inicio', icon: 'home' },
  { id: 'tareas', label: 'Tareas', icon: 'tasks' },
  { id: 'contenido', label: 'Contenido', icon: 'layers' },
  { id: 'laboratorio', label: 'Laboratorio', icon: 'flask' },
  { id: 'notas', label: 'Notas', icon: 'notes' },
  { id: 'chat', label: 'Chat', icon: 'voice' },
  { id: 'skills', label: 'Skills', icon: 'skills' },
  { id: 'instagram', label: 'Instagram', icon: 'instagram' },
  { id: 'competencia', label: 'Competencia', icon: 'spy' },
  { id: 'ads', label: 'Meta Ads', icon: 'ads' },
  { id: 'apps', label: 'Apps', icon: 'apps' },
];

function useClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000 * 15);
    return () => clearInterval(id);
  }, []);
  return now;
}

export default function Topbar({ tab, onTab, onBuscar }) {
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
        <button className="icon-btn hide-sm" aria-label="Buscar en tus notas" onClick={onBuscar}><Icon name="search" /></button>
        <Apariencia />
        <div className="avatar">J</div>
        <div className="clock">
          <div className="clock-time">{time}</div>
          <div className="clock-date">{date}</div>
        </div>
      </div>
    </header>
  );
}
