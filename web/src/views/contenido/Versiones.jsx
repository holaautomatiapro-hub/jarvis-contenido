import { useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useMensajes, useRecurso } from '../../lib/api.js';
import { diaCorto } from '../../lib/fechas.js';
import { redDe } from '../../lib/redes.js';

// «Crea una vez, publica en todos lados», dentro de la ficha de la pieza: JARVIS adapta la pieza a otras redes
// y cada versión sale el mismo día que la pieza (o el día que le pongas). Tú la copias y la publicas.

export function Insignia({ red, size = 24 }) {
  return <span className="insignia" style={{ width: size, height: size, '--c': red.color }} title={red.nombre}>{red.corto.slice(0, 2).toUpperCase()}</span>;
}

function Version({ v, fechaPieza, onCambio, setError }) {
  const red = redDe(v.red);
  const [abierta, setAbierta] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [otroDia, setOtroDia] = useState(Boolean(v.fecha));
  const publicada = v.estado === 'publicado';
  const accion = async (fn) => { try { await fn(); onCambio(); } catch (e) { setError(e.message); } };
  const copiar = async () => {
    try { await navigator.clipboard.writeText([v.titulo, v.texto, v.extra].filter(Boolean).join('\n\n')); setCopiado(true); setTimeout(() => setCopiado(false), 1500); } catch { /* sin portapapeles */ }
  };
  const cuando = v.fecha ? `${diaCorto(v.fecha)}${v.hora ? ` · ${v.hora}` : ''}` : fechaPieza ? 'el mismo día' : 'sin día (como la pieza)';
  return (
    <div className={`vr${publicada ? ' hecha' : ''}`}>
      <div className="vr-cab" role="button" tabIndex={0} onClick={() => setAbierta(!abierta)} onKeyDown={(e) => e.key === 'Enter' && setAbierta(!abierta)}>
        <Insignia red={red} />
        <b>{red.nombre}</b>
        <small>{publicada ? '✓ publicada' : cuando}</small>
        <span className="vr-acciones" onClick={(e) => e.stopPropagation()}>
          <button type="button" className="link-btn" onClick={copiar}>{copiado ? '✓ Copiado' : 'Copiar'}</button>
          {publicada
            ? <button type="button" className="link-btn" onClick={() => accion(() => api(`/api/publicar/versiones/${v.id}`, { method: 'PATCH', body: { publicado: false } }))}>Desmarcar</button>
            : <button type="button" className="btn btn-sec btn-mini" onClick={() => accion(() => api(`/api/publicar/versiones/${v.id}`, { method: 'PATCH', body: { publicado: true } }))}>Marcar publicada</button>}
        </span>
        <Icon name="chevron" size={12} style={{ transform: abierta ? 'rotate(90deg)' : 'none', color: 'var(--dim)' }} />
      </div>
      {abierta && (
        <div className="vr-cuerpo">
          {v.titulo && <div className="version-titulo">{v.titulo}</div>}
          <pre className="version-texto">{v.texto}</pre>
          {v.extra && <div className="version-extra">{v.extra}</div>}
          {v.notas && <div className="version-notas"><Icon name="pen" size={12} /> {v.notas}</div>}
          <div className="vr-pie">
            <label className="lm-check">
              <input type="checkbox" checked={otroDia} onChange={(e) => { setOtroDia(e.target.checked); if (!e.target.checked && v.fecha) accion(() => api(`/api/publicar/versiones/${v.id}`, { method: 'PATCH', body: { fecha: null, hora: null } })); }} />
              Otro día que la pieza
            </label>
            {otroDia && (
              <>
                <input type="date" className="campo" defaultValue={v.fecha || fechaPieza || ''} onBlur={(e) => e.target.value !== (v.fecha || '') && accion(() => api(`/api/publicar/versiones/${v.id}`, { method: 'PATCH', body: { fecha: e.target.value || null, hora: v.hora || null } }))} aria-label="Día" />
                <input type="time" className="campo hora" defaultValue={v.hora || ''} onBlur={(e) => e.target.value !== (v.hora || '') && accion(() => api(`/api/publicar/versiones/${v.id}`, { method: 'PATCH', body: { fecha: v.fecha || fechaPieza || null, hora: e.target.value || null } }))} aria-label="Hora" />
              </>
            )}
            <button type="button" className="link-btn peligro" onClick={() => window.confirm(`¿Borrar la versión de ${red.nombre}?`) && accion(() => api(`/api/publicar/versiones/${v.id}`, { method: 'DELETE' }))}>Borrar</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function VersionesRed({ pieza, fecha }) {
  const [data, recargar] = useRecurso(`/api/publicar/piezas/${pieza.id}`, null);
  const [elegidas, setElegidas] = useState(null);
  const [progreso, setProgreso] = useState(null);
  const [error, setError] = useState('');
  const [abierto, setAbierto] = useState(false);
  useMensajes('jarvis', (e) => {
    if (e.conversacion !== 'publicar') return;
    if (e.tipo === 'pregunta') setProgreso('JARVIS está adaptando la pieza…');
    if (e.tipo === 'herramienta') setProgreso(`JARVIS está adaptando la pieza… (${e.nombre.replace(/^mcp__jarvis__/, '')})`);
    if (e.tipo === 'fin') { setProgreso(null); recargar(); }
    if (e.tipo === 'error') { setProgreso(null); setError(e.mensaje); }
  });
  if (!data) return null;
  const versiones = data.versiones || [];
  const redes = data.redes || [];
  const sel = elegidas ?? data.porDefecto ?? [];
  const pendientes = versiones.filter((v) => v.estado !== 'publicado').length;
  const ocupado = Boolean(progreso) || data.trabajando;
  const adaptar = async () => {
    setError('');
    try { await api('/api/publicar/adaptar', { method: 'POST', body: { piezaId: pieza.id, redes: sel } }); setProgreso('JARVIS está adaptando la pieza…'); } catch (e) { setError(e.message); }
  };
  const alternar = (id) => setElegidas(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  return (
    <div className="versiones-red">
      <div className="vr-titulo" role="button" tabIndex={0} onClick={() => setAbierto(!abierto)} onKeyDown={(e) => e.key === 'Enter' && setAbierto(!abierto)}>
        <Icon name="publish" size={14} />
        <b>Otras redes</b>
        <span className="ayuda">{versiones.length ? `${versiones.length} ${versiones.length === 1 ? 'versión' : 'versiones'}${pendientes ? ` · ${pendientes} por publicar` : ' · todas publicadas'}` : 'TikTok, Shorts, LinkedIn, X… adaptadas por JARVIS'}</span>
        <span className="vr-chips">{versiones.map((v) => <Insignia key={v.id} red={redDe(v.red)} size={18} />)}</span>
        <Icon name="chevron" size={12} style={{ transform: abierto ? 'rotate(90deg)' : 'none', color: 'var(--dim)' }} />
      </div>
      {abierto && (
        <div className="vr-panel">
          {versiones.map((v) => <Version key={v.id} v={v} fechaPieza={fecha} onCambio={recargar} setError={setError} />)}
          <div className="vr-adaptar">
            <div className="redes-chips">
              {redes.map((r) => (
                <button type="button" key={r.id} className={`red-chip${sel.includes(r.id) ? ' on' : ''}`} onClick={() => alternar(r.id)} style={{ '--c': r.color }}>
                  <span className="red-punto" />{r.corto}
                </button>
              ))}
            </div>
            <div className="vr-adaptar-fila">
              <button type="button" className="btn btn-sec" onClick={adaptar} disabled={ocupado || !sel.length}><Icon name="sparkle" size={14} />{ocupado ? 'Adaptando…' : versiones.length ? 'Rehacer las elegidas' : 'Adaptar con JARVIS'}</button>
              <span className="ayuda">{progreso || (versiones.length ? 'Rehacer sustituye las que aún no has publicado.' : 'Escribe una versión nativa para cada red con tu voz. Guarda antes los cambios de la ficha.')}</span>
            </div>
          </div>
          {error && <div className="aviso-error">{error}</div>}
        </div>
      )}
    </div>
  );
}
