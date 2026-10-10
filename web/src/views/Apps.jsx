import { useState } from 'react';
import Icon from '../components/Icon.jsx';
import Mascota from '../components/Mascota.jsx';
import { api, obsidianUrl, useRecurso } from '../lib/api.js';

const INSTALAR = 'iex (irm https://hermes-agent.nousresearch.com/install.ps1)';

const horaDe = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).replace('.', '');
};

const RESULTADO = { ok: ['Bien', 'var(--green)'], error: ['Error', '#f87171'], blocked_config: ['Falta configurar', 'var(--orange)'], delivery_failed: ['No llegó a Telegram', 'var(--orange)'] };

function Copiable({ texto }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="codigo">
      <code>{texto}</code>
      <button className="link-btn" onClick={() => navigator.clipboard?.writeText(texto).then(() => { setOk(true); setTimeout(() => setOk(false), 1500); })}>{ok ? '✓ Copiado' : 'Copiar'}</button>
    </div>
  );
}

function Paso({ ok, titulo, detalle, children }) {
  return (
    <li className={`hermes-paso${ok ? ' ok' : ''}`}>
      <span className="hermes-check">{ok ? <Icon name="check" size={11} /> : null}</span>
      <div>
        <div className="hermes-paso-t">{titulo}</div>
        {!ok && detalle && <div className="ayuda">{detalle}</div>}
        {!ok && children}
      </div>
    </li>
  );
}

function PanelHermes({ h, recargar }) {
  const [log, setLog] = useState(null);
  const [trabajando, setTrabajando] = useState(false);
  const telegramOk = h.telegram.token && h.telegram.permitidos;
  const listo = h.instalado && h.soul && h.mcp && h.skills && telegramOk && h.gateway.online;

  const configurar = async (simular) => {
    setTrabajando(true);
    try { setLog(await api('/api/hermes/configurar', { method: 'POST', body: { simular } })); }
    catch (e) { setLog({ ok: false, error: e.message, pasos: [] }); }
    finally { setTrabajando(false); recargar(); }
  };

  return (
    <div className="panel panel-pad hermes-panel">
      <div className="hermes-cab">
        <span className="hermes-logo"><Icon name="telegram" size={20} /></span>
        <div>
          <div className="hermes-titulo">Hermes · JARVIS en Telegram</div>
          <div className="ayuda">Le hablas desde el móvil (texto o notas de voz) y usa la misma memoria y datos que este dashboard.</div>
        </div>
        <span className={`estado-pill ${h.gateway.online ? 'on' : ''}`}><span className={`dot ${h.gateway.online ? 'on' : 'off'}`} />{h.gateway.online ? 'Online' : h.instalado ? 'Bot parado' : 'Sin instalar'}</span>
      </div>

      <ul className="hermes-pasos">
        <Paso ok={h.instalado} titulo="Hermes instalado en este PC" detalle="Abre PowerShell y pega esto (no hace falta ser administrador). Luego abre una terminal nueva y ejecuta hermes model para elegir el modelo.">
          <Copiable texto={INSTALAR} />
        </Paso>
        <Paso ok={h.soul && h.mcp && h.skills} titulo="Personalidad de JARVIS, MCP jarvis y skills del vault" detalle="Lo hace el botón Configurar Hermes (o npm run hermes en la carpeta de JARVIS)." />
        <Paso ok={telegramOk} titulo="Bot de Telegram conectado y solo para ti" detalle="Crea el bot con @BotFather y ejecuta esto; pon tu ID numérico (te lo da @userinfobot) en la lista de permitidos.">
          <Copiable texto="hermes gateway setup" />
        </Paso>
        <Paso ok={h.telegram.canal} titulo="Chat de avisos para las tareas programadas" detalle="Escribe /sethome en el chat con tu bot." />
        <Paso ok={h.gateway.online} titulo="Bot en marcha (y al iniciar Windows)" detalle="Solo funciona con el PC encendido.">
          <Copiable texto="hermes gateway install" />
        </Paso>
      </ul>

      <div className="pub-acciones">
        <button className="btn" onClick={() => configurar(false)} disabled={trabajando || !h.instalado}><Icon name="sparkle" size={13} />{trabajando ? 'Configurando…' : h.mcp ? 'Volver a configurar' : 'Configurar Hermes'}</button>
        <button className="btn btn-sec" onClick={() => configurar(true)} disabled={trabajando}>Ver qué haría</button>
        {listo && <span className="ayuda">Todo listo. Prueba: manda “idea: test desde Telegram” a tu bot.</span>}
      </div>

      {log && (
        <div className={`aviso ${log.ok ? 'ok' : 'error'} hermes-log`}>
          <div>
            {log.error && <div>{log.error}</div>}
            {log.pasos.map((p) => (
              <div key={p.id} className="hermes-log-l">
                <b>{{ hecho: '✓', ok: '✓', pendiente: '·', manual: '!', aviso: '!', error: '✗' }[p.estado]}</b> {p.titulo}
                {p.estado === 'hecho' && <span className="t-dim"> (ya estaba)</span>}
                {p.aviso && <div className="t-dim">{p.aviso}</div>}
                {p.estado === 'error' && <div className="t-dim">{(p.salida || p.error || '').split('\n').slice(-2).join(' ')}</div>}
              </div>
            ))}
          </div>
          <button className="link-btn" onClick={() => setLog(null)}>Cerrar</button>
        </div>
      )}
    </div>
  );
}

function Mensajes({ mensajes }) {
  return (
    <div className="panel panel-pad">
      <div className="panel-head"><span className="label">Últimos mensajes por Telegram</span></div>
      {mensajes.length ? (
        <ul className="hermes-mensajes">
          {mensajes.map((m, i) => (
            <li key={i}><span className="hora">{m.ts.slice(5, 16).replace('-', '/').replace(' ', ' · ')}</span><span>{m.texto}</span></li>
          ))}
        </ul>
      ) : <div className="vacio"><Mascota pose="pensando" size={96} float={false} /><br />Aún no ha llegado nada.<br />Cuando le escribas a tu bot, lo que guarde (ideas, tareas, guiones, versiones…) aparecerá aquí y en Inicio.</div>}
    </div>
  );
}

function Tareas({ h }) {
  const [abierta, setAbierta] = useState(null);
  const porNombre = Object.fromEntries(h.tareas.map((t) => [t.nombre, t]));
  const otras = h.tareas.filter((t) => !t.jarvis);
  return (
    <div className="panel panel-pad">
      <div className="panel-head">
        <span className="label">Tareas programadas</span>
        <span className="ayuda">Te llegan por Telegram · hora de Madrid</span>
      </div>
      <div className="cron-grid">
        {h.plantillas.map((p) => {
          const t = porNombre[p.nombre];
          const res = t?.resultado && RESULTADO[t.resultado];
          return (
            <div key={p.nombre} className={`cron${t ? '' : ' pendiente'}`}>
              <div className="cron-cab"><Icon name="clock" size={14} /><b>{p.titulo}</b></div>
              <div className="cron-cuando">{p.cuando}</div>
              <div className="cron-estado">
                {t ? <><span className={`dot ${t.activa ? 'on' : 'off'}`} />{t.activa ? `Próxima: ${horaDe(t.proxima)}` : 'En pausa'}</> : <><span className="dot off" />Pendiente de configurar</>}
              </div>
              {res && <div className="cron-res" style={{ color: res[1] }}>Última: {res[0]} · {horaDe(t.ultima)}</div>}
              <button className="link-btn" onClick={() => setAbierta(abierta === p.nombre ? null : p.nombre)}>{abierta === p.nombre ? 'Ocultar instrucciones' : 'Ver qué hace'}</button>
              {abierta === p.nombre && <p className="cron-prompt">{p.prompt}</p>}
            </div>
          );
        })}
      </div>
      {otras.length > 0 && <div className="ayuda" style={{ marginTop: 10 }}>Además tienes {otras.length} tarea{otras.length > 1 ? 's' : ''} propia{otras.length > 1 ? 's' : ''} en Hermes: {otras.map((t) => t.nombre).join(', ')}.</div>}
    </div>
  );
}

const APPS = (vault) => [
  { titulo: 'Obsidian', desc: 'Tu vault: la memoria de JARVIS', icon: 'obsidian', href: obsidianUrl(vault), color: 'var(--purple)' },
  { titulo: 'Panel de Hermes', desc: 'Sesiones, tareas y ajustes (hermes dashboard)', icon: 'telegram', href: 'http://localhost:9119', color: 'var(--cyan)' },
  { titulo: 'Meta Business Suite', desc: 'Programar posts de Instagram y Facebook', icon: 'calendar', href: 'https://business.facebook.com/latest/content_calendar', color: '#1877f2' },
  { titulo: 'Administrador de anuncios', desc: 'Activar las campañas que JARVIS deja en pausa', icon: 'ads', href: 'https://adsmanager.facebook.com/', color: 'var(--accent-2)' },
  { titulo: 'Instagram', desc: 'Tu perfil', icon: 'instagram', href: 'https://www.instagram.com/', color: '#e1306c' },
  { titulo: 'TikTok Studio', desc: 'Subir y programar en TikTok', icon: 'play', href: 'https://www.tiktok.com/tiktokstudio/upload', color: '#25f4ee' },
  { titulo: 'YouTube Studio', desc: 'Shorts y vídeos', icon: 'play', href: 'https://studio.youtube.com/', color: '#ff0033' },
  { titulo: 'LinkedIn', desc: 'Publicar el post adaptado', icon: 'briefcase', href: 'https://www.linkedin.com/feed/', color: '#0a66c2' },
  { titulo: 'Telegram', desc: 'Hablar con tu bot', icon: 'send', href: 'https://web.telegram.org/', color: '#2aabee' },
];

export default function Apps() {
  const [h, recargar, error] = useRecurso('/api/hermes', null);
  if (!h) return <section className="panel soon"><div className="t-dim">{error || 'Cargando…'}</div></section>;
  return (
    <section className="apps-vista">
      <div className="apps-top">
        <PanelHermes h={h} recargar={recargar} />
        <Mensajes mensajes={h.mensajes} />
      </div>
      <Tareas h={h} />
      <div className="panel panel-pad">
        <div className="panel-head"><span className="label">Accesos rápidos</span><span className="ayuda">JARVIS prepara; tú publicas desde aquí</span></div>
        <div className="apps-grid">
          {APPS(h.vault).map((a) => (
            <a key={a.titulo} className="app-tile" href={a.href} target={a.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" style={{ '--c': a.color }}>
              <span className="app-icon"><Icon name={a.icon} size={18} /></span>
              <span><b>{a.titulo}</b><span className="ayuda">{a.desc}</span></span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
