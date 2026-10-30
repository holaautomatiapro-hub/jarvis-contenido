import { useEffect, useState } from 'react';
import Icon from '../../components/Icon.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { Modal } from '../contenido/comun.jsx';

// Automatizaciones tipo ManyChat con Zernio: comentan una palabra (o responden a una story) → mensaje privado con
// botón → recurso y pregunta. Con «Sígueme primero», respuesta pública, pausa y «la siguiente publicación».
const VACIA = {
  nombre: '', tipo: 'post', destino: 'siguiente', media_id: '', media_titulo: '', media_miniatura: '',
  palabras: '', coincidencia: 'palabra', erratas: true,
  respuestas: '¡Te lo acabo de enviar por privado! 📩\n¡Hecho! Mira tus mensajes 👀\n¡Enviado! Revisa tu bandeja 🙌',
  mensaje: '¡Hola {{first_name}}! 👋 Aquí tienes lo que me pediste. Pulsa el botón 👇', variaciones: '', boton: 'Lo quiero',
  recurso: { texto: '', enlace: '', titulo: 'Ver recurso' },
  pregunta: { texto: '', opciones: '', gracias: '' },
  sigueme: false, seguir: { mensaje: '', boton: '', noSigue: '' },
  repetir: 'una', tambienDm: false,
};
const DESTINOS = {
  post: [['siguiente', 'La siguiente publicación', 'Se activa sola en cuanto subas tu próximo post o reel'], ['publicacion', 'Una publicación concreta', 'Elige una que ya esté en Instagram'], ['cualquiera', 'Cualquier publicación', 'Todas tus publicaciones']],
  story: [['siguiente', 'La siguiente story', 'Se activa sola en cuanto subas tu próxima story'], ['publicacion', 'Una story activa', 'Elige una de las que tienes ahora'], ['cualquiera', 'Cualquier story', 'Respuestas a todas tus stories']],
};
const ESTADO = { activa: ['Activa', 'on'], pausada: ['Pausada', 'warn'], esperando: ['Esperando la siguiente', 'warn'] };
// Da igual mayúsculas, minúsculas y tildes (el servidor da de alta todas las formas en Zernio)
const sinTildes = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
const variantes = (p) => [...new Set([p, sinTildes(p)].flatMap((b) => [b.toLowerCase(), b.toUpperCase(), b.charAt(0).toUpperCase() + b.slice(1).toLowerCase()]))];
const palabrasDe = (t) => {
  const m = new Map();
  for (const p of String(t || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const k = sinTildes(p).toLowerCase();
    if (!m.has(k) || (m.get(k) === sinTildes(m.get(k)) && p !== sinTildes(p))) m.set(k, p.toLowerCase());
  }
  return [...m.values()];
};
const lineas = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
const aFormulario = (a) => ({
  ...VACIA, ...a,
  palabras: (a.palabras || []).join(', '), respuestas: (a.respuestas || []).join('\n'), variaciones: (a.variaciones || []).join('\n'),
  recurso: { ...VACIA.recurso, ...a.recurso }, pregunta: { ...VACIA.pregunta, ...a.pregunta, opciones: (a.pregunta?.opciones || []).join(', ') },
  seguir: { ...VACIA.seguir, ...a.seguir },
});
const aServidor = (f) => ({
  ...f, respuestas: lineas(f.respuestas), variaciones: lineas(f.variaciones),
  pregunta: { ...f.pregunta, opciones: String(f.pregunta.opciones || '').split(',').map((x) => x.trim()).filter(Boolean) },
});

function Pildoras({ opciones, valor, onCambio }) {
  return (
    <div className="pildoras">
      {opciones.map(([id, label]) => <button type="button" key={id} className={valor === id ? 'on' : ''} onClick={() => onCambio(id)}>{label}</button>)}
    </div>
  );
}

// Elegir la publicación o la story (las últimas de tu Instagram)
function ElegirMedio({ tipo, valor, onElegir }) {
  const [medios, , error] = useRecurso(`/api/automatizaciones/medios?tipo=${tipo}`, null);
  if (error) return <div className="caja-error">{error}</div>;
  if (!medios) return <p className="ayuda">Cargando tus {tipo === 'story' ? 'stories' : 'publicaciones'}…</p>;
  if (!medios.length) return <p className="ayuda">{tipo === 'story' ? 'Ahora mismo no tienes stories activas (o JARVIS no ve tu Instagram: conéctalo con Facebook arriba).' : 'No hay publicaciones. Sincroniza Instagram o conéctalo con Facebook.'}</p>;
  return (
    <div className="auto-medios">
      {medios.map((m) => (
        <button type="button" key={m.id} className={`auto-medio${valor === m.id ? ' on' : ''}`} onClick={() => onElegir(m)} title={m.titulo}>
          {m.miniatura ? <img src={m.miniatura} alt="" loading="lazy" /> : <span className="auto-medio-sin"><Icon name="instagram" size={18} /></span>}
          <small>{m.formato ? `${m.formato} · ` : ''}{m.fecha ? new Date(m.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : ''}</small>
        </button>
      ))}
    </div>
  );
}

// Tus lead magnets publicados (Laboratorio → Lead magnets): se elige uno y se pone su enlace
function ElegirLeadMagnet({ enlace, onElegir }) {
  const [lms] = useRecurso('/api/laboratorio/leadmagnets', null);
  const todos = (lms?.leadmagnets || []).slice().sort((x, y) => String(y.mod || y.creado || '').localeCompare(String(x.mod || x.creado || '')));
  if (!todos.length) return null;
  const elegido = todos.find((x) => x.url && x.url === enlace);
  return (
    <select className="campo" value={elegido?.slug || ''} onChange={(e) => { const x = todos.find((y) => y.slug === e.target.value); if (x?.url) onElegir(x); }} aria-label="Elegir uno de tus lead magnets">
      <option value="">{enlace && !elegido ? 'Otro enlace (escrito a mano)' : 'Elige uno de tus lead magnets…'}</option>
      {todos.map((x) => <option key={x.slug} value={x.slug} disabled={!x.url}>{x.titulo}{x.url ? '' : ' (sin publicar: publícalo en Laboratorio → Lead magnets)'}</option>)}
    </select>
  );
}

function Editor({ inicial, meta, onClose, onGuardado }) {
  const [f, setF] = useState(() => (inicial ? aFormulario(inicial) : { ...VACIA, destino: meta ? 'siguiente' : 'publicacion' }));
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const cambia = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const sub = (grupo, k) => (e) => setF((x) => ({ ...x, [grupo]: { ...x[grupo], [k]: e.target.value } }));
  const post = f.tipo === 'post';
  const guardar = async () => {
    setGuardando(true); setError('');
    try {
      await api(inicial ? `/api/automatizaciones/${inicial.id}` : '/api/automatizaciones', { method: inicial ? 'PUT' : 'POST', body: aServidor(f) });
      onGuardado(); onClose();
    } catch (e) { setError(e.message); setGuardando(false); }
  };
  return (
    <Modal titulo={inicial ? 'Editar automatización' : 'Nueva automatización'} onClose={onClose} ancho={760} cerrarFuera={false} clase="editor-c auto-editor">
      <label className="campo-et">Nombre</label>
      <input className="campo" value={f.nombre} onChange={cambia('nombre')} placeholder="Ej.: Guía de prompts (GUÍA)" />

      <div className="auto-paso"><b>1</b> Cuándo se activa</div>
      <Pildoras opciones={[['post', 'Comentan una publicación'], ['story', 'Responden a una story']]} valor={f.tipo} onCambio={(v) => setF((x) => ({ ...x, tipo: v, media_id: '', media_titulo: '', media_miniatura: '' }))} />
      <div className="modos auto-destinos">
        {DESTINOS[f.tipo].map(([id, t, d]) => (
          <button type="button" key={id} className={`modo${f.destino === id ? ' on' : ''}`} disabled={id === 'siguiente' && !meta} onClick={() => setF((x) => ({ ...x, destino: id }))} title={id === 'siguiente' && !meta ? 'Conecta Instagram con Facebook (arriba) para que JARVIS vea cuándo sale' : undefined}>
            <b>{t}</b><small>{d}</small>
          </button>
        ))}
      </div>
      {f.destino === 'publicacion' && <ElegirMedio tipo={f.tipo} valor={f.media_id} onElegir={(m) => setF((x) => ({ ...x, media_id: m.id, media_titulo: m.titulo, media_miniatura: m.miniatura || '' }))} />}
      {inicial?.estado === 'activa' && inicial.destino === 'siguiente' && inicial.media_titulo && <p className="ayuda">Ya está enganchada a: «{inicial.media_titulo}».</p>}

      <label className="campo-et">Palabras clave <span className="ayuda" style={{ textTransform: 'none', letterSpacing: 0 }}>separadas por comas · vacío = cualquier {post ? 'comentario' : 'respuesta'}</span></label>
      <div className="dos-col">
        <input className="campo" value={f.palabras} onChange={cambia('palabras')} placeholder="GUÍA, guia, info" />
        <select className="campo" value={f.coincidencia} onChange={cambia('coincidencia')}>
          <option value="palabra">Como palabra (recomendado)</option>
          <option value="contiene">Si la contiene en cualquier sitio</option>
          <option value="exacta">Solo si el comentario es exactamente eso</option>
        </select>
      </div>
      {palabrasDe(f.palabras).length > 0 && (
        <p className="ayuda auto-variantes">Da igual mayúsculas, minúsculas o tildes (escríbela con su tilde si la lleva). Responde a: {palabrasDe(f.palabras).flatMap(variantes).slice(0, 18).join(', ')}{palabrasDe(f.palabras).flatMap(variantes).length > 18 ? '…' : ''}</p>
      )}
      {f.coincidencia === 'palabra' && <label className="lm-check"><input type="checkbox" checked={f.erratas} onChange={cambia('erratas')} />Aceptar pequeñas erratas («gúia», «guai»)</label>}
      {post && <label className="lm-check"><input type="checkbox" checked={f.tambienDm} onChange={cambia('tambienDm')} />Responder también si te escriben la palabra por mensaje directo</label>}

      {post && (
        <>
          <div className="auto-paso"><b>2</b> Respuesta pública al comentario</div>
          <textarea className="campo" rows={3} value={f.respuestas} onChange={cambia('respuestas')} placeholder="Una por línea: se elige una al azar para que no parezca un bot. Vacío = no responde en público." />
        </>
      )}

      <div className="auto-paso"><b>{post ? 3 : 2}</b> Mensaje privado</div>
      <textarea className="campo" rows={3} value={f.mensaje} onChange={cambia('mensaje')} />
      <p className="ayuda">Puedes usar {'{{first_name}}'} (su nombre) o {'{{username}}'}. Máximo 640 caracteres.</p>
      <div className="dos-col">
        <div><label className="campo-et">Texto del botón</label><input className="campo" maxLength={20} value={f.boton} onChange={cambia('boton')} /></div>
        <div><label className="campo-et">Versiones del mensaje (opcional)</label><textarea className="campo" rows={2} value={f.variaciones} onChange={cambia('variaciones')} placeholder="Una por línea, hasta 5" /></div>
      </div>
      <label className="lm-check auto-sigueme"><input type="checkbox" checked={f.sigueme} onChange={cambia('sigueme')} /><Icon name="users" size={13} /><b>Sígueme primero</b>: solo se lo envía si te sigue</label>
      {f.sigueme && (
        <div className="auto-caja">
          <p className="ayuda">A quien no sabemos si te sigue le llega este mensaje con un botón para confirmarlo y otro para ver tu perfil. Al pulsar, se comprueba de verdad: si te sigue, recibe el mensaje; si no, el aviso.</p>
          <label className="campo-et">Mensaje para que te siga</label>
          <textarea className="campo" rows={2} value={f.seguir.mensaje} onChange={sub('seguir', 'mensaje')} placeholder="¡Hola! Para enviártelo, primero sígueme y luego pulsa el botón 👇" />
          <div className="dos-col">
            <div><label className="campo-et">Botón</label><input className="campo" maxLength={20} value={f.seguir.boton} onChange={sub('seguir', 'boton')} placeholder="Ya te sigo" /></div>
            <div><label className="campo-et">Si aún no te sigue</label><input className="campo" value={f.seguir.noSigue} onChange={sub('seguir', 'noSigue')} placeholder="Todavía no me sigues 😅 Sígueme y vuelve a pulsar." /></div>
          </div>
        </div>
      )}

      <div className="auto-paso"><b>{post ? 4 : 3}</b> El recurso</div>
      {/* Al elegir un lead magnet se pone su enlace y, si aún no hay palabras, su palabra clave */}
      <ElegirLeadMagnet enlace={f.recurso.enlace} onElegir={(x) => setF((v) => ({ ...v, palabras: v.palabras.trim() || x.palabra || '', nombre: v.nombre || x.titulo, recurso: { ...v.recurso, enlace: x.url, titulo: v.recurso.titulo && v.recurso.titulo !== 'Ver recurso' ? v.recurso.titulo : 'Ver la guía' } }))} />
      <div className="dos-col">
        <div><label className="campo-et">Enlace</label><input className="campo" value={f.recurso.enlace} onChange={sub('recurso', 'enlace')} placeholder="https://… (o elige arriba uno de tus lead magnets)" /></div>
        <div><label className="campo-et">Texto del botón del enlace</label><input className="campo" maxLength={20} value={f.recurso.titulo} onChange={sub('recurso', 'titulo')} /></div>
      </div>

      <div className="auto-paso"><b>{post ? 5 : 4}</b> Pregunta (opcional)</div>
      <p className="ayuda">{f.pregunta.texto ? 'Al pulsar el botón le llega el recurso y después esta pregunta. Su respuesta se guarda y la ves aquí.' : 'Sin pregunta, el botón del mensaje abre directamente el enlace del recurso.'}</p>
      <textarea className="campo" rows={2} value={f.pregunta.texto} onChange={sub('pregunta', 'texto')} placeholder="Ej.: ¿A qué te dedicas?" />
      {f.pregunta.texto && (
        <>
          <label className="campo-et">Mensaje con el recurso</label>
          <textarea className="campo" rows={2} value={f.recurso.texto} onChange={sub('recurso', 'texto')} placeholder="¡Aquí lo tienes! 👇" />
          <div className="dos-col">
            <div><label className="campo-et">Respuestas rápidas (opcional)</label><input className="campo" value={f.pregunta.opciones} onChange={sub('pregunta', 'opciones')} placeholder="Entrenador, Nutricionista, Otro" /></div>
            <div><label className="campo-et">Al responder (opcional)</label><input className="campo" value={f.pregunta.gracias} onChange={sub('pregunta', 'gracias')} placeholder="¡Gracias! Te escribo pronto 🙌" /></div>
          </div>
        </>
      )}

      <div className="auto-paso"><b>{post ? 6 : 5}</b> Repetición</div>
      <Pildoras opciones={[['una', 'Una vez por persona'], ['cada', 'Cada vez que comente (máx. 1 al día)']]} valor={f.repetir} onCambio={(v) => setF((x) => ({ ...x, repetir: v }))} />

      {error && <div className="caja-error">{error}</div>}
      <div className="modal-pie">
        <span className="ayuda">{f.destino === 'siguiente' ? 'Quedará esperando y se activará sola al subir la siguiente.' : 'Se activa nada más guardar.'}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-sec" onClick={onClose}>Cancelar</button>
          <button className="btn" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : inicial ? 'Guardar cambios' : 'Crear automatización'}</button>
        </div>
      </div>
    </Modal>
  );
}

const ESTADO_LOG = { sent: 'Enviado', failed: 'Falló', skipped: 'Saltado', gated: 'Esperando que confirme que te sigue', pending: 'En cola' };
function Detalle({ id, onClose }) {
  const [d, , error] = useRecurso(`/api/automatizaciones/${id}`, null);
  const s = d?.zernio?.stats || {};
  return (
    <Modal titulo={d ? d.nombre : 'Automatización'} onClose={onClose} ancho={720}>
      {error && <div className="caja-error">{error}</div>}
      {!d && !error && <p className="ayuda">Cargando…</p>}
      {d && (
        <>
          <div className="auto-stats">
            {[['Activaciones', s.triggered], ['Mensajes enviados', s.dmsSent], ['Fallidos', s.dmsFailed], ['Clics en el enlace', s.linkClicks], ['Pidieron seguir', s.followGateSent], ['Confirmaron que siguen', s.followGatePassed]].map(([t, v]) => <div key={t}><b>{v ?? 0}</b><small>{t}</small></div>)}
          </div>
          {d.respuestas.length > 0 && (
            <>
              <div className="campo-et">Respuestas a «{d.pregunta.texto}»</div>
              <div className="auto-tabla">{d.respuestas.map((r, i) => <div key={i}><b>{r.quien ? `@${r.quien}` : 'Alguien'}</b><span>{r.respuesta || <i>esperando respuesta…</i>}</span><small>{r.fecha ? new Date(r.fecha).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</small></div>)}</div>
            </>
          )}
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

export default function Automatizaciones() {
  const [d, recargar, error] = useRecurso('/api/automatizaciones', null);
  const [editando, setEditando] = useState(null); // null | 'nueva' | automatización
  const [viendo, setViendo] = useState(null);
  const [aviso, setAviso] = useState('');
  // Mientras alguna espera «la siguiente», se mira de vez en cuando si ya se enganchó
  useEffect(() => {
    if (!d?.lista?.some((a) => a.estado === 'esperando')) return undefined;
    const t = setInterval(recargar, 60000);
    return () => clearInterval(t);
  }, [d, recargar]);

  const accion = async (fn) => { setAviso(''); try { await fn(); recargar(); } catch (e) { setAviso(e.message); } };
  const pausar = (a) => accion(() => api(`/api/automatizaciones/${a.id}/pausar`, { method: 'POST', body: { activa: a.estado === 'pausada' } }));
  const borrar = (a) => window.confirm(`¿Eliminar «${a.nombre}»? Deja de responder ya.`) && accion(() => api(`/api/automatizaciones/${a.id}`, { method: 'DELETE' }));

  if (error) return <div className="aviso error">No se pudieron cargar las automatizaciones. {error}</div>;
  if (!d) return <div className="panel panel-pad"><p className="ayuda">Cargando…</p></div>;
  if (!d.configurado) return <ConectarZernio onHecho={recargar} />;

  return (
    <section className="auto-vista">
      <div className="panel panel-pad auto-cab">
        <div>
          <div className="label">Automatizaciones</div>
          <p className="ayuda">Comentan una palabra en tu publicación (o responden a una story) y les llega un mensaje privado con tu recurso, como en ManyChat. Las envía Zernio{d.cuenta ? <> desde <b>@{d.cuenta}</b></> : ''}.</p>
        </div>
        <button className="btn" onClick={() => setEditando('nueva')}><Icon name="plus" size={14} />Nueva automatización</button>
      </div>
      {d.error && <div className="aviso error">{d.error}</div>}
      {d.reconectar && <div className="aviso error">Zernio dice que hay que volver a conectar tu Instagram: entra en zernio.com y reconéctalo.</div>}
      {aviso && <div className="aviso error">{aviso}</div>}
      {!d.lista.length && <div className="panel panel-pad vacio">Aún no tienes automatizaciones. Crea la primera: elige la publicación (o «la siguiente»), la palabra y lo que se envía.</div>}
      <div className="auto-lista">
        {d.lista.map((a) => {
          const [txt, punto] = ESTADO[a.estado] || [a.estado, 'warn'];
          const s = a.zernio?.stats || {};
          return (
            <div key={a.id} className="panel auto-card">
              <div className="auto-card-cab">
                {a.media_miniatura ? <img src={a.media_miniatura} alt="" /> : <span className="auto-medio-sin"><Icon name={a.tipo === 'story' ? 'clock' : 'instagram'} size={16} /></span>}
                <div className="fila-c-txt">
                  <b>{a.nombre}</b>
                  <small>{a.tipo === 'story' ? 'Story' : 'Publicación'} · {a.destino === 'cualquiera' ? (a.tipo === 'story' ? 'cualquier story' : 'cualquier publicación') : a.destino === 'siguiente' && a.estado === 'esperando' ? (a.tipo === 'story' ? 'la siguiente story' : 'la siguiente publicación') : a.media_titulo ? `«${a.media_titulo.slice(0, 50)}»` : 'una concreta'}</small>
                </div>
                <span className="chip-estado"><span className={`dot ${punto}`} />{txt}</span>
              </div>
              <div className="auto-palabras">{a.palabras.length ? a.palabras.map((p) => <span key={p} className="chip">{p}</span>) : <span className="ayuda">Cualquier {a.tipo === 'story' ? 'respuesta' : 'comentario'}</span>}{a.sigueme && <span className="chip"><Icon name="users" size={11} /> sígueme primero</span>}{a.conFlujo && <span className="chip">con pregunta</span>}</div>
              <div className="auto-mini-stats"><span><b>{s.triggered ?? 0}</b> activaciones</span><span><b>{s.dmsSent ?? 0}</b> enviados</span><span><b>{s.linkClicks ?? 0}</b> clics</span></div>
              <div className="auto-acciones">
                <button className="btn btn-sec" onClick={() => pausar(a)}><Icon name={a.estado === 'pausada' ? 'play' : 'clock'} size={13} />{a.estado === 'pausada' ? 'Reanudar' : 'Pausar'}</button>
                <button className="btn btn-sec" onClick={() => setViendo(a.id)}><Icon name="chart" size={13} />Resultados</button>
                <button className="btn btn-sec" onClick={() => setEditando(a)}><Icon name="pen" size={13} />Editar</button>
                <button className="link-btn peligro" onClick={() => borrar(a)}>Eliminar</button>
              </div>
            </div>
          );
        })}
      </div>
      {editando && <Editor inicial={editando === 'nueva' ? null : editando} meta={d.meta} onClose={() => setEditando(null)} onGuardado={recargar} />}
      {viendo && <Detalle id={viendo} onClose={() => setViendo(null)} />}
    </section>
  );
}
