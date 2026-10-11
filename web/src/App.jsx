import { useCallback, useEffect, useState } from 'react';
import Topbar, { TABS } from './components/Topbar.jsx';
import Captura from './components/Captura.jsx';
import Inicio from './views/Inicio.jsx';
import Tareas from './views/Tareas.jsx';
import Contenido from './views/Contenido.jsx';
import Laboratorio from './views/Laboratorio.jsx';
import Notas from './views/Notas.jsx';
import Voz from './views/Voz.jsx';
import Skills from './views/Skills.jsx';
import Instagram from './views/Instagram.jsx';
import Competencia from './views/Competencia.jsx';
import Ads from './views/Ads.jsx';
import Publicar from './views/Publicar.jsx';
import Apps from './views/Apps.jsx';
import { demoInicio } from './lib/demo.js';
import { obsidianUrl, useRecurso } from './lib/api.js';
import { ponerFases } from './views/contenido/comun.jsx';

const initialTab = () => {
  const h = window.location.hash.slice(1).split('?')[0];
  return TABS.some((t) => t.id === h) ? h : 'inicio';
};

export default function App() {
  const [tab, setTab] = useState(initialTab);
  const [inicio, recargarInicio] = useRecurso('/api/inicio', demoInicio);
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
    guion: () => go('skills'),
    dictar: () => go('voz'),
    vault: () => { window.location.href = obsidianUrl(cfg.vault); },
    ir: go,
  };

  let vista;
  if (tab === 'inicio') vista = <Inicio data={inicio} onAsk={(t) => { setPendiente(t); go('voz'); }} acciones={acciones} recargar={recargarInicio} />;
  else if (tab === 'tareas') vista = <Tareas />;
  else if (tab === 'contenido') vista = <Contenido onCaptura={setCaptura} />;
  else if (tab === 'laboratorio') vista = <Laboratorio />;
  else if (tab === 'notas') vista = <Notas onCaptura={setCaptura} />;
  else if (tab === 'voz') vista = <Voz sistema={inicio.sistema} pendiente={pendiente} onConsumido={() => setPendiente(null)} />;
  else if (tab === 'skills') vista = <Skills />;
  else if (tab === 'instagram') vista = <Instagram />;
  else if (tab === 'competencia') vista = <Competencia />;
  else if (tab === 'ads') vista = <Ads />;
  else if (tab === 'publicar') vista = <Publicar />;
  else vista = <Apps />;

  return (
    <div className="app">
      <Topbar tab={tab} onTab={go} demo={inicio.demo} onBuscar={() => go('notas')} />
      {vista}
      {captura && <Captura tipo={captura} onClose={cerrar} />}
    </div>
  );
}
