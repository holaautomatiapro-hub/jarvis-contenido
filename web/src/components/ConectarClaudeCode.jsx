import { useState } from 'react';
import Icon from './Icon.jsx';
import { BotonCopiar } from '../views/contenido/comun.jsx';

// Conectar JARVIS con Claude Code en el ordenador (Windows): un conector que, en cualquier chat, sube a JARVIS lo
// que Claude acaba de hacer («súbelo a JARVIS») y deja ver el calendario. Se instala con un comando de PowerShell.
export default function ConectarClaudeCode() {
  const [abierto, setAbierto] = useState(() => { try { return localStorage.getItem('conectar_cc') === '1'; } catch { return false; } });
  const alternar = () => { setAbierto(!abierto); try { localStorage.setItem('conectar_cc', abierto ? '0' : '1'); } catch { /* sin localStorage */ } };
  const origen = window.location.origin;
  const ruta = '$env:USERPROFILE\\.jarvis\\jarvis-puente.mjs';
  const instalar = [
    'New-Item -ItemType Directory -Force "$env:USERPROFILE\\.jarvis" | Out-Null',
    `Invoke-WebRequest "${origen}/puente/jarvis-puente.mjs?url=${encodeURIComponent(origen)}" -OutFile "${ruta}" -UseBasicParsing`,
    'claude mcp remove jarvis --scope user 2>$null',
    `claude mcp add --scope user jarvis node "${ruta}"`,
  ].join('; ');
  return (
    <section className="panel panel-pad conectar-cc">
      <button type="button" className="aprendido-cab" onClick={alternar} aria-expanded={abierto}>
        <Icon name="claude" size={14} />
        <b>Conectar con Claude Code en tu ordenador</b>
        <span className="t-dim">«súbelo a JARVIS» desde cualquier chat</span>
        <span className="aprendido-flecha">{abierto ? '▾' : '▸'}</span>
      </button>
      {abierto && (
        <div className="conectar-cc-cuerpo">
          <p className="ayuda">Con esto, en cualquier chat de Claude Code de tu ordenador puedes decir <b>«súbelo a JARVIS»</b> (o «súbelo como carrusel para el jueves a las 18:00 y que se publique solo») y lo que acabas de hacer llega a tu biblioteca de Contenido. También puedes preguntarle qué tienes programado. Solo funciona en tu ordenador (con Tailscale conectado), no en los chats en la nube.</p>
          <ol className="conectar-cc-pasos">
            <li>
              <b>Necesitas Node.js.</b> Abre <b>PowerShell</b> y escribe <code>node -v</code>. Si no sale un número, instálalo con:
              <div className="conectar-cc-cmd"><code>winget install OpenJS.NodeJS.LTS</code><BotonCopiar texto="winget install OpenJS.NodeJS.LTS" /></div>
              y cierra y vuelve a abrir PowerShell.
            </li>
            <li>
              <b>Instala el conector</b> pegando esto en PowerShell (baja el conector de este JARVIS y lo añade a todos tus chats de Claude Code):
              <div className="conectar-cc-cmd"><code>{instalar}</code><BotonCopiar texto={instalar} /></div>
              Si dice que no conoce <code>claude</code>, instala antes Claude Code con <code>irm https://claude.ai/install.ps1 | iex</code>.
            </li>
            <li><b>Pruébalo:</b> abre un chat nuevo de Claude Code, escribe <code>/mcp</code> y verás «jarvis» conectado. Luego, por ejemplo: «sube a JARVIS el vídeo que acabas de hacer como reel, con este caption, para mañana a las 19:00».</li>
          </ol>
          <p className="ayuda">Para actualizarlo, vuelve a pegar el comando del paso 2. Solo sube los archivos que le pidas a Claude, y entra en JARVIS igual que tu navegador.</p>
        </div>
      )}
    </section>
  );
}
