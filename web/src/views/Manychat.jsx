import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import { useRecurso } from '../lib/api.js';
import Automatizaciones, { ConectarZernio } from './manychat/Automatizaciones.jsx';
import Bandeja from './manychat/Bandeja.jsx';
import Contactos from './manychat/Contactos.jsx';
import Plantillas from './manychat/Plantillas.jsx';
import Configuracion from './manychat/Configuracion.jsx';

// «Manychat» de JARVIS, sobre Zernio: automatizaciones, bandeja de entrada, contactos, plantillas y configuración
const PESTANAS = [
  { id: 'automatizaciones', label: 'Automatizaciones', icon: 'bolt' },
  { id: 'bandeja', label: 'Bandeja de entrada', icon: 'send' },
  { id: 'contactos', label: 'Contactos', icon: 'users' },
  { id: 'plantillas', label: 'Plantillas', icon: 'doc' },
  { id: 'configuracion', label: 'Configuración', icon: 'skills' },
];
const LS = 'jarvis-manychat-pestana';
const leer = () => { try { const v = localStorage.getItem(LS); return PESTANAS.some((p) => p.id === v) ? v : 'automatizaciones'; } catch { return 'automatizaciones'; } };

export default function Manychat() {
  const [pestana, setPestanaEstado] = useState(leer);
  const [abrirChat, setAbrirChat] = useState(null); // conversación a abrir en la bandeja (desde la ficha de un contacto)
  const [estado, recargar, error] = useRecurso('/api/automatizaciones', null);
  const setPestana = (p) => { setPestanaEstado(p); try { localStorage.setItem(LS, p); } catch { /* sin almacenamiento */ } };
  const irAlChat = (conversacion) => { setAbrirChat(conversacion); setPestana('bandeja'); };

  return (
    <section className="mc-vista">
      <header className="panel mc-cabecera">
        <div className="mc-titulo">
          <span className="mc-logo"><Icon name="bolt" size={16} /></span>
          <div>
            <div className="label">Manychat</div>
            <div className="mc-cuenta">{estado?.cuenta ? `@${estado.cuenta}` : estado?.configurado === false ? 'Sin conectar' : '…'}<small> · con Zernio</small></div>
          </div>
        </div>
        <div className="seg mc-pestanas">
          {PESTANAS.map((p) => <button key={p.id} className={pestana === p.id ? 'on' : ''} onClick={() => setPestana(p.id)}><Icon name={p.icon} />{p.label}</button>)}
        </div>
      </header>
      {error && <div className="aviso error">No se pudo cargar Manychat. {error}</div>}
      {estado && !estado.configurado ? <ConectarZernio onHecho={recargar} /> : (
        <>
          {pestana === 'automatizaciones' && <Automatizaciones />}
          {pestana === 'bandeja' && <Bandeja abrir={abrirChat} onAbierto={() => setAbrirChat(null)} />}
          {pestana === 'contactos' && <Contactos onChat={irAlChat} />}
          {pestana === 'plantillas' && <Plantillas />}
          {pestana === 'configuracion' && <Configuracion />}
        </>
      )}
    </section>
  );
}
