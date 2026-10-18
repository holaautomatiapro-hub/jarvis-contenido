import { useCallback, useEffect, useState } from 'react';
import Topbar, { TABS } from './components/Topbar.jsx';
import Captura from './components/Captura.jsx';
import Inicio from './views/Inicio.jsx';
import Contenido from './views/Contenido.jsx';
import Estrategia from './views/Estrategia.jsx';
import Laboratorio from './views/Laboratorio.jsx';
import Chat from './views/Chat.jsx';
import Instagram from './views/Instagram.jsx';
import Competencia from './views/Competencia.jsx';
import Ads from './views/Ads.jsx';
import { obsidianUrl, useRecurso } from './lib/api.js';
import { ponerFases } from './views/contenido/comun.jsx';

// Lo que se ve en Inicio mientras llega /api/inicio
const INICIO_VACIO = { kpis: [], publicaHoy: [], tareas: { hoy: [], semana: [], mes: [], atrasadas: [] }, recordatorios: [], sistema: [] };

const initialTab = () => {
  let h = window.location.hash.slice(1).split('?')[0];
  if (h === 'voz') h = 'chat'; // enlaces antiguos
  if (h === 'publicar') h = 'contenido'; // Publicar está ahora en la ficha de cada pieza
  return TABS.some((t) => t.id === h) ? h : 'inicio';
};

export default function App() {
  const [tab, setTab] = useState(initialTab);
  const [inicio, recargarInicio] = useRecurso('/api/inicio', INICIO_VACIO);
  const [cfg] = useRecurso('/api/config', { vault: 'JARVIS-Vault' });
  // Fases del pipeline (configurables): las comparten todas las vistas
  const [fases] = useRecurso('/api/pipeline', null);
  useEffect(() => ponerFases(fases), [fases]);
  const [captura, setCaptura] = useState(null);
  const [pendiente, setPendiente] = useState(null);
  const cerrar = useCallback(() => setCaptura(null), []);

  const go = (id) => { setTab(id); window.location.hash = id; };
  // Atrás/adelante del navegador y enlaces con #pestaña
  useEffect(() => {
    const f = () => setTab(initialTab());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);

  const acciones = {
    nota: () => setCaptura('nota'),
    idea: () => setCaptura('idea'),
    guion: () => go('chat'),
    dictar: () => go('chat'),
    vault: () => { window.location.href = obsidianUrl(cfg.vault); },
    ir: go,
  };

  let vista;
  if (tab === 'inicio') vista = <Inicio data={inicio} onAsk={(t) => { setPendiente(t); go('chat'); }} acciones={acciones} recargar={recargarInicio} />;
  else if (tab === 'contenido') vista = <Contenido onCaptura={setCaptura} />;
  else if (tab === 'estrategia') vista = <Estrategia />;
  else if (tab === 'laboratorio') vista = <Laboratorio />;
  else if (tab === 'chat') vista = <Chat pendiente={pendiente} onConsumido={() => setPendiente(null)} />;
  else if (tab === 'instagram') vista = <Instagram />;
  else if (tab === 'competencia') vista = <Competencia />;
  else if (tab === 'ads') vista = <Ads />;
  else vista = <Inicio data={inicio} onAsk={(t) => { setPendiente(t); go('chat'); }} acciones={acciones} recargar={recargarInicio} />;

  return (
    <div className="app">
      <Topbar tab={tab} onTab={go} />
      {vista}
      {captura && <Captura tipo={captura} onClose={cerrar} />}
    </div>
  );
}
