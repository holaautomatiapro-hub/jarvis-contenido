import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { fechaCorta } from '../../lib/formato.js';
import { COLOR_FORMATO, Detalle, Metricas } from '../CompetenciaMejores.jsx';

// Replicar desde un enlace: pegas un post, carrusel o reel de cualquier cuenta profesional, JARVIS lo trae
// (slides, caption y transcripción) y hace tu versión con tu voz y, si es carrusel o stories, con tu diseño.
export default function DesdeEnlace() {
  const [url, setUrl] = useState('');
  const [usuario, setUsuario] = useState('');
  const [pideUsuario, setPideUsuario] = useState(false);
  const [trayendo, setTrayendo] = useState(false);
  const [error, setError] = useState('');
  const [abierta, setAbierta] = useState(null); // { id, auto }
  const [traidas] = useRecurso('/api/competencia/enlaces', []);

  const traer = async (e) => {
    e.preventDefault();
    if (!url.trim()) return;
    setTrayendo(true); setError('');
    try {
      const r = await fetch('/api/competencia/enlace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url, usuario: pideUsuario ? usuario : undefined }) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (d.campo === 'usuario') setPideUsuario(true);
        throw new Error(d.error || `Error ${r.status}`);
      }
      setAbierta({ id: d.id, auto: true });
      setUrl(''); setUsuario(''); setPideUsuario(false);
    } catch (err) { setError(err.message); }
    setTrayendo(false);
  };

  return (
    <>
      <form className="panel panel-pad replicar-enlace" onSubmit={traer}>
        <div className="label">Pega el enlace de una publicación</div>
        <div className="replicar-enlace-fila">
          <input className="campo" type="url" value={url} onChange={(e) => { setUrl(e.target.value); setError(''); }} placeholder="https://www.instagram.com/p/… o https://www.instagram.com/reel/…" aria-label="Enlace de Instagram" />
          {pideUsuario && <input className="campo replicar-usuario" value={usuario} onChange={(e) => setUsuario(e.target.value)} placeholder="@cuenta" aria-label="De qué cuenta es" autoFocus />}
          <button className="btn" type="submit" disabled={!url.trim() || trayendo || (pideUsuario && !usuario.trim())}><Icon name="link" size={14} />{trayendo ? 'Trayendo…' : 'Traer'}</button>
        </div>
        {error && <div className="aviso error">{error}</div>}
        <p className="ayuda">
          Carruseles, posts y reels de cualquier <b>cuenta profesional</b> (Instagram no deja traer las personales ni las privadas). JARVIS trae sus slides, el caption y, si es un reel, lo transcribe.
          Después eliges qué quieres (carrusel, stories, reel o post), le dices lo que quieras cambiar y hace tu versión: los carruseles y stories, diseñados con tu sistema de diseño; los reels, con su guion listo para grabar.
        </p>
      </form>

      {traidas.length > 0 && (
        <div className="panel panel-pad">
          <div className="panel-head"><span className="label">Las últimas que has traído</span></div>
          <div className="comp-tarjetas">
            {traidas.map((m) => (
              <button key={m.id} className="comp-tarjeta" onClick={() => setAbierta({ id: m.id, auto: false })} title="Ver y replicar">
                <span className="comp-tarjeta-img" style={m.miniatura ? { backgroundImage: `url("${m.miniatura}")` } : { background: `color-mix(in srgb, ${COLOR_FORMATO[m.formato] || 'var(--accent)'} 30%, var(--panel-2))` }}>
                  <span className="comp-fmt" style={{ background: COLOR_FORMATO[m.formato] }}>{m.formato}{m.slides ? ` · ${m.slides}` : ''}</span>
                  {!m.miniatura && <Icon name={m.formato === 'Reels' ? 'play' : 'layers'} size={18} />}
                </span>
                <span className="comp-tarjeta-txt">
                  <small>@{m.username} · {fechaCorta(m.fecha)}{m.transcrita ? ' · transcrito' : ''}</small>
                  <b>{(m.gancho || m.caption || 'Sin texto').slice(0, 90)}</b>
                  <Metricas m={m} />
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {abierta && <Detalle id={abierta.id} auto={abierta.auto} onClose={() => setAbierta(null)} />}
    </>
  );
}
