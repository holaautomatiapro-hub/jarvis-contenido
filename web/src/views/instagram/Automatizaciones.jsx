import { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { DISPARADORES } from '../../lib/flujo.js';
import { Modal } from '../contenido/comun.jsx';
import Tablero from './Tablero.jsx';

// Automatizaciones tipo ManyChat con Zernio: comentan una palabra (o responden a una story, o te la escriben por
// privado) y les llega un mensaje; lo que pasa después se diseña en un tablero de bloques.
const ESTADO = { activa: ['Activa', 'on'], pausada: ['Pausada', 'warn'], esperando: ['Esperando la siguiente', 'warn'] };
const ESTADO_LOG = { sent: 'Enviado', failed: 'Falló', skipped: 'Saltado', gated: 'Esperando que confirme que te sigue', pending: 'En cola' };

function Detalle({ id, onClose }) {
  const [d, , error] = useRecurso(`/api/automatizaciones/${id}`, null);
  const s = d?.zernio?.stats || {};
  const fecha = (f) => (f ? new Date(f).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  return (
    <Modal titulo={d ? d.nombre : 'Automatización'} onClose={onClose} ancho={720}>
      {error && <div className="caja-error">{error}</div>}
      {!d && !error && <p className="ayuda">Cargando…</p>}
      {d && (
        <>
          <div className="auto-stats">
            {[['Activaciones', s.triggered], ['Mensajes enviados', s.dmsSent], ['Fallidos', s.dmsFailed], ['Clics en enlaces', s.linkClicks], ['Pidieron seguir', s.followGateSent], ['Confirmaron que siguen', s.followGatePassed]].filter(([, v]) => v != null).map(([t, v]) => <div key={t}><b>{v ?? 0}</b><small>{t}</small></div>)}
          </div>
          {d.respuestas.length > 0 && (
            <>
              <div className="campo-et">Respuestas</div>
              <div className="auto-tabla">{d.respuestas.map((r, i) => <div key={i}><b>{r.quien ? `@${r.quien}` : 'Alguien'}</b><span><small>{r.pregunta}</small><br />{r.respuesta}</span><small>{fecha(r.fecha)}</small></div>)}</div>
            </>
          )}
          {d.disparador.tipo !== 'mensaje' && (
            <>
              <div className="campo-et">Últimos que la activaron</div>
              {!d.registros.length && <div className="vacio">Todavía nadie. Prueba a comentar la palabra desde otra cuenta.</div>}
              <div className="auto-tabla">
                {d.registros.map((r, i) => (
                  <div key={i}>
                    <b>{r.quien ? `@${r.quien}` : 'Alguien'}</b>
                    <span>{r.comentario ? `«${r.comentario}»` : ''}</span>
                    <small className={r.estado === 'failed' ? 'peligro' : ''} title={r.motivo || undefined}>{ESTADO_LOG[r.estado] || r.estado}{r.clic ? ' · abrió el enlace' : ''}{r.motivo && r.estado !== 'sent' ? ` · ${r.motivo}` : ''}</small>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
}

function ConectarZernio({ onHecho }) {
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const guardar = async () => {
    setGuardando(true); setError('');
    try { await api('/api/automatizaciones/clave', { method: 'PUT', body: { clave: clave.trim() } }); setClave(''); onHecho(); }
    catch (e) { setError(e.message); }
    setGuardando(false);
  };
  return (
    <div className="panel panel-pad">
      <b>Conecta Zernio</b>
      <p className="ayuda">Las automatizaciones las envía Zernio, que tiene la app de Meta aprobada (sin pasar tú la verificación). Crea tu cuenta en zernio.com, conecta allí tu Instagram y pega aquí tu API key (zernio.com → API keys). Se guarda en el servidor.</p>
      <div className="fotos-ia-fila">
        <input className="campo" type="password" autoComplete="off" value={clave} onChange={(e) => setClave(e.target.value)} placeholder="API key de Zernio" style={{ flex: 1, minWidth: 220 }} />
        <button className="btn" onClick={guardar} disabled={guardando || clave.trim().length < 16}>{guardando ? 'Comprobando…' : 'Guardar'}</button>
      </div>
      {error && <div className="caja-error">{error}</div>}
    </div>
  );
}

const donde = (a) => {
  const d = a.disparador;
  if (d.tipo === 'mensaje') return 'por privado';
  const cosa = d.tipo === 'story' ? 'story' : 'publicación';
  if (d.destino === 'cualquiera') return `cualquier ${cosa}`;
  if (a.estado === 'esperando') return `la siguiente ${cosa}`;
  return a.media_titulo ? `«${a.media_titulo.slice(0, 50)}»` : `una ${cosa} concreta`;
};

export default function Automatizaciones() {
  const [d, recargar, error] = useRecurso('/api/automatizaciones', null);
  const [editando, setEditando] = useState(null); // null | 'nueva' | automatización
  const [viendo, setViendo] = useState(null);
  const [aviso, setAviso] = useState(null);
  // Mientras alguna espera «la siguiente», se mira de vez en cuando si ya se enganchó
  useEffect(() => {
    if (!d?.lista?.some((a) => a.estado === 'esperando')) return undefined;
    const t = setInterval(recargar, 60000);
    return () => clearInterval(t);
  }, [d, recargar]);

  const accion = async (fn, ok = null) => { setAviso(null); try { await fn(); recargar(); if (ok) setAviso({ ok: true, texto: ok }); } catch (e) { setAviso({ ok: false, texto: e.message }); } };
  const pausar = (a) => accion(() => api(`/api/automatizaciones/${a.id}/pausar`, { method: 'POST', body: { activa: a.estado === 'pausada' } }));
  const duplicar = (a) => accion(() => api(`/api/automatizaciones/${a.id}/duplicar`, { method: 'POST' }), 'Copia creada en pausa: ábrela (por ejemplo, para cambiar la publicación) y pulsa Reanudar.');
  const borrar = (a) => window.confirm(`¿Eliminar «${a.nombre}»? Deja de responder ya.`) && accion(() => api(`/api/automatizaciones/${a.id}`, { method: 'DELETE' }));

  if (error) return <div className="aviso error">No se pudieron cargar las automatizaciones. {error}</div>;
  if (!d) return <div className="panel panel-pad"><p className="ayuda">Cargando…</p></div>;
  if (!d.configurado) return <ConectarZernio onHecho={recargar} />;

  return (
    <section className="auto-vista">
      <div className="panel panel-pad auto-cab">
        <div>
          <div className="label">Automatizaciones</div>
          <p className="ayuda">Comentan una palabra en tu publicación (o responden a una story, o te la escriben por privado) y les llega un mensaje; lo que pasa después lo diseñas en un tablero, como en ManyChat. Las envía Zernio{d.cuenta ? <> desde <b>@{d.cuenta}</b></> : ''}.</p>
        </div>
        <button className="btn" onClick={() => setEditando('nueva')}><Icon name="plus" size={14} />Nueva automatización</button>
      </div>
      {d.error && <div className="aviso error">{d.error}</div>}
      {d.reconectar && <div className="aviso error">Zernio dice que hay que volver a conectar tu Instagram: entra en zernio.com y reconéctalo.</div>}
      {aviso && <div className={`aviso ${aviso.ok ? 'ok' : 'error'}`}>{aviso.texto}</div>}
      {!d.lista.length && <div className="panel panel-pad vacio">Aún no tienes automatizaciones. Crea la primera: eliges cuándo se activa y diseñas los mensajes en el tablero.</div>}
      <div className="auto-lista">
        {d.lista.map((a) => {
          const [txt, punto] = ESTADO[a.estado] || [a.estado, 'warn'];
          const s = a.zernio?.stats || {};
          return (
            <div key={a.id} className="panel auto-card">
              <div className="auto-card-cab">
                {a.disparador.media_miniatura ? <img src={a.disparador.media_miniatura} alt="" /> : <span className="auto-medio-sin"><Icon name={a.disparador.tipo === 'mensaje' ? 'send' : a.disparador.tipo === 'story' ? 'clock' : 'instagram'} size={16} /></span>}
                <div className="fila-c-txt">
                  <b>{a.nombre}</b>
                  <small>{DISPARADORES[a.disparador.tipo]} · {donde(a)}</small>
                </div>
                <span className="chip-estado"><span className={`dot ${punto}`} />{txt}</span>
              </div>
              <div className="auto-palabras">
                {a.disparador.palabras.length ? a.disparador.palabras.map((p) => <span key={p} className="chip">{p}</span>) : <span className="ayuda">Cualquier comentario</span>}
                {a.disparador.sigueme && <span className="chip"><Icon name="users" size={11} /> sígueme primero</span>}
                <span className="chip"><Icon name="layers" size={11} /> {a.bloques} bloque{a.bloques === 1 ? '' : 's'}</span>
              </div>
              <div className="auto-mini-stats"><span><b>{s.triggered ?? 0}</b> activaciones</span>{s.dmsSent != null && <span><b>{s.dmsSent}</b> enviados</span>}{s.linkClicks != null && <span><b>{s.linkClicks}</b> clics</span>}</div>
              <div className="auto-acciones">
                <button className="btn btn-sec" onClick={() => setEditando(a)}><Icon name="pen" size={13} />Abrir tablero</button>
                <button className="btn btn-sec" onClick={() => pausar(a)}><Icon name={a.estado === 'pausada' ? 'play' : 'clock'} size={13} />{a.estado === 'pausada' ? 'Reanudar' : 'Pausar'}</button>
                <button className="btn btn-sec" onClick={() => setViendo(a.id)}><Icon name="chart" size={13} />Resultados</button>
                <button className="btn btn-sec" onClick={() => duplicar(a)} title="Hace una copia en pausa"><Icon name="layers" size={13} />Duplicar</button>
                <button className="link-btn peligro" onClick={() => borrar(a)}>Eliminar</button>
              </div>
            </div>
          );
        })}
      </div>
      {editando && <Tablero inicial={editando === 'nueva' ? null : editando} meta={d.meta} onClose={() => setEditando(null)} onGuardado={recargar} />}
      {viendo && <Detalle id={viendo} onClose={() => setViendo(null)} />}
    </section>
  );
}
