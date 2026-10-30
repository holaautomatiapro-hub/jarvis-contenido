import { useCallback, useMemo, useState } from 'react';
import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import Icon from '../../components/Icon.jsx';
import CampoEmoji from '../../components/CampoEmoji.jsx';
import { api, useRecurso } from '../../lib/api.js';
import { DISPARADORES, MAX_BOTONES, TIPOS_BLOQUE, ZONA_HORARIA, bloqueNuevo, empiezaConComentario, esPrimero, esperaInicial, flujoInicial, salidasDe, validarFlujo } from '../../lib/flujo.js';

// El tablero de una automatización (tipo ManyChat): bloques que se conectan con flechas. A la derecha se edita el
// bloque elegido; el «inicio» es el disparador (publicación, palabras, respuesta pública). «Sígueme primero» es un cuadro
// fijo justo después del disparador (no es un bloque del flujo: lo hace la comment automation de Zernio).
const SIGUEME = '__sigueme';
const DEFECTO_SEGUIR = { mensaje: '¡Hola! Para enviártelo, primero sígueme y luego pulsa el botón 👇', boton: 'Ya te sigo', noSigue: 'Todavía no me sigues 😅 Sígueme y vuelve a pulsar el botón.' };
const UNIDAD = { segundos: ['segundo', 'segundos'], minutos: ['minuto', 'minutos'], horas: ['hora', 'horas'], dias: ['día', 'días'] };

const DISPARADOR_VACIO = {
  tipo: 'post', destino: 'siguiente', media_id: '', media_titulo: '', media_miniatura: '',
  palabras: [], coincidencia: 'palabra', erratas: true,
  respuestas: ['¡Te lo acabo de enviar por privado! 📩', '¡Hecho! Mira tus mensajes 👀', '¡Enviado! Revisa tu bandeja 🙌'],
  sigueme: false, seguir: { mensaje: '', boton: '', noSigue: '' }, repetir: 'una', tambienDm: false,
};
const DESTINOS = {
  post: [['siguiente', 'La siguiente publicación', 'Se activa sola al subir tu próximo post o reel'], ['publicacion', 'Una publicación concreta', 'Una que ya esté en Instagram'], ['cualquiera', 'Cualquier publicación', 'Todas tus publicaciones']],
  story: [['siguiente', 'La siguiente story', 'Se activa sola al subir tu próxima story'], ['publicacion', 'Una story activa', 'Una de las que tienes ahora'], ['cualquiera', 'Cualquier story', 'Respuestas a todas tus stories']],
};

// Da igual mayúsculas, minúsculas y tildes (el servidor da de alta todas las formas en Zernio)
const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
const variantes = (p) => [...new Set([p, sinTildes(p)].flatMap((b) => [b.toLowerCase(), b.toUpperCase(), b.charAt(0).toUpperCase() + b.slice(1).toLowerCase()]))];
const textoPalabras = (l) => (Array.isArray(l) ? l.join(', ') : String(l || ''));
const listaPalabras = (t) => String(t || '').split(',').map((x) => x.trim()).filter(Boolean);

function Pildoras({ opciones, valor, onCambio }) {
  return <div className="pildoras">{opciones.map(([id, label]) => <button type="button" key={id} className={valor === id ? 'on' : ''} onClick={() => onCambio(id)}>{label}</button>)}</div>;
}

// Elegir la publicación o la story (las últimas de tu Instagram)
function ElegirMedio({ tipo, valor, onElegir }) {
  const [medios, , error] = useRecurso(`/api/automatizaciones/medios?tipo=${tipo}`, null);
  if (error) return <div className="caja-error">{error}</div>;
  if (!medios) return <p className="ayuda">Cargando tus {tipo === 'story' ? 'stories' : 'publicaciones'}…</p>;
  if (!medios.length) return <p className="ayuda">{tipo === 'story' ? 'Ahora mismo no tienes stories activas (o JARVIS no ve tu Instagram: conéctalo con Facebook).' : 'No hay publicaciones. Sincroniza Instagram o conéctalo con Facebook.'}</p>;
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
      <option value="">{enlace && !elegido ? 'Otro enlace (escrito a mano)' : 'O elige uno de tus lead magnets…'}</option>
      {todos.map((x) => <option key={x.slug} value={x.slug} disabled={!x.url}>{x.titulo}{x.url ? '' : ' (sin publicar)'}</option>)}
    </select>
  );
}

// ---------- Cómo se ve cada bloque en el tablero ----------
function resumen(n, disparador) {
  const d = n.datos || {};
  switch (n.tipo) {
    case 'inicio': {
      const p = disparador.palabras || [];
      return `${DISPARADORES[disparador.tipo]}${empiezaConComentario(disparador.tipo) ? ` · ${(DESTINOS[disparador.tipo].find(([id]) => id === disparador.destino) || [])[1] || ''}` : ''}${p.length ? ` · «${p.join('», «')}»` : ' · cualquier palabra'}`;
    }
    case 'sigueme': return disparador.seguir?.mensaje || DEFECTO_SEGUIR.mensaje;
    case 'mensaje': return d.texto || 'Escribe el mensaje…';
    case 'pregunta': return d.texto || 'Escribe la pregunta…';
    case 'esperar': {
      const [uno, varios] = UNIDAD[d.unidad] || UNIDAD.horas;
      const espera = Number(d.cantidad) > 0 ? `Espera ${d.cantidad} ${Number(d.cantidad) === 1 ? uno : varios}` : 'Sin espera';
      return d.horario?.activo ? `${espera} · solo de ${d.horario.desde}:00 a ${d.horario.hasta}:00` : espera;
    }
    case 'condicion': return d.tipo === 'sigue' ? '¿Te sigue?' : d.tipo === 'contiene' ? `¿Su mensaje contiene «${d.valor || '…'}»?` : `¿Tiene la etiqueta «${d.valor || '…'}»?`;
    case 'etiqueta': return `${d.accion === 'quitar' ? 'Quita' : 'Pone'} la etiqueta «${d.etiqueta || '…'}»`;
    default: return 'Termina aquí';
  }
}

function Bloque({ data, selected }) {
  const { nodo, salidas, disparador, primero } = data;
  const tipo = nodo.tipo === 'inicio' ? { nombre: 'Cuando…', color: 'var(--accent)' } : nodo.tipo === 'sigueme' ? { nombre: 'Sígueme primero', color: 'var(--pink)' } : TIPOS_BLOQUE[nodo.tipo];
  const enlaces = nodo.tipo === 'mensaje' ? (nodo.datos.botones || []).filter((b) => b.tipo === 'enlace')
    : nodo.tipo === 'sigueme' ? [{ titulo: disparador.seguir?.boton || DEFECTO_SEGUIR.boton }, { titulo: 'Ver perfil' }] : [];
  return (
    <div className={`fl-bloque${selected ? ' on' : ''}`} style={{ '--c': tipo.color }}>
      {nodo.tipo !== 'inicio' && <Handle type="target" position={Position.Left} id="in" className="fl-entrada" />}
      <div className="fl-cab">{tipo.nombre}{primero && <small> · respuesta privada</small>}</div>
      <div className="fl-txt">{resumen(nodo, disparador)}</div>
      {enlaces.map((b, i) => <div key={i} className="fl-boton enlace">{nodo.tipo === 'sigueme' ? '' : '🔗 '}{b.titulo || 'Enlace'}</div>)}
      {salidas.map((s) => (
        <div key={s.id} className={`fl-salida${s.etiqueta ? '' : ' sola'}`}>
          {s.etiqueta && <span>{s.etiqueta}</span>}
          <Handle type="source" position={Position.Right} id={s.id} className="fl-punto" />
        </div>
      ))}
    </div>
  );
}
const TIPOS_NODO = { bloque: Bloque };

// ---------- Paneles de edición ----------
function PanelDisparador({ d, setD, meta, onSigueme }) {
  const cambia = (k) => (e) => setD({ ...d, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const comentario = empiezaConComentario(d.tipo);
  const [palabras, setPalabras] = useState(textoPalabras(d.palabras));
  const unicas = [...new Map(listaPalabras(palabras).map((p) => [sinTildes(p).toLowerCase(), p.toLowerCase()])).values()];
  return (
    <>
      <label className="campo-et">Se activa cuando</label>
      <select className="campo" value={d.tipo} onChange={(e) => setD({ ...d, tipo: e.target.value, destino: empiezaConComentario(e.target.value) ? (meta ? 'siguiente' : 'publicacion') : 'cualquiera', media_id: '', media_titulo: '', media_miniatura: '' })}>
        {Object.entries(DISPARADORES).map(([id, t]) => <option key={id} value={id}>{t}</option>)}
      </select>
      {comentario && (
        <>
          <div className="modos fl-destinos">
            {DESTINOS[d.tipo].map(([id, t, ayuda]) => (
              <button type="button" key={id} className={`modo${d.destino === id ? ' on' : ''}`} disabled={id === 'siguiente' && !meta} onClick={() => setD({ ...d, destino: id })} title={id === 'siguiente' && !meta ? 'Conecta Instagram con Facebook (pestaña Instagram) para que JARVIS vea cuándo sale' : undefined}><b>{t}</b><small>{ayuda}</small></button>
            ))}
          </div>
          {d.destino === 'publicacion' && <ElegirMedio tipo={d.tipo} valor={d.media_id} onElegir={(m) => setD({ ...d, media_id: m.id, media_titulo: m.titulo, media_miniatura: m.miniatura || '' })} />}
        </>
      )}
      <label className="campo-et">Palabras clave</label>
      <input className="campo" value={palabras} onChange={(e) => { setPalabras(e.target.value); setD({ ...d, palabras: listaPalabras(e.target.value) }); }} placeholder={d.tipo === 'mensaje' ? 'precio, info' : 'guía, info (vacío = cualquier comentario)'} />
      {unicas.length > 0 && <p className="ayuda">Da igual mayúsculas o tildes (escríbela con su tilde si la lleva). Responde a: {unicas.flatMap(variantes).slice(0, 14).join(', ')}{unicas.flatMap(variantes).length > 14 ? '…' : ''}</p>}
      <select className="campo" value={d.coincidencia} onChange={cambia('coincidencia')}>
        <option value="palabra">Como palabra (recomendado)</option>
        <option value="contiene">Si la contiene en cualquier sitio</option>
        <option value="exacta">Solo si el mensaje es exactamente eso</option>
      </select>
      {d.coincidencia === 'palabra' && comentario && <label className="lm-check"><input type="checkbox" checked={d.erratas} onChange={cambia('erratas')} />Aceptar pequeñas erratas</label>}
      {d.tipo === 'post' && <label className="lm-check"><input type="checkbox" checked={d.tambienDm} onChange={cambia('tambienDm')} />Responder también si la escriben por privado</label>}
      {d.tipo === 'post' && (
        <>
          <label className="campo-et">Respuesta pública al comentario</label>
          <CampoEmoji rows={4} value={(d.respuestas || []).join('\n')} onChange={(v) => setD({ ...d, respuestas: v.split('\n') })} placeholder="Una por línea: se elige una al azar. Vacío = no responde en público." />
        </>
      )}
      {comentario && (
        <>
          <label className="lm-check fl-sigueme"><input type="checkbox" checked={d.sigueme} onChange={(e) => onSigueme(e.target.checked)} /><Icon name="users" size={13} /><b>Sígueme primero</b>: solo se lo envía si te sigue</label>
          {d.sigueme && <p className="ayuda">Sale como un cuadro justo después del disparador: pulsa en él para cambiar sus textos.</p>}
        </>
      )}
      <label className="campo-et">Repetición</label>
      <Pildoras opciones={[['una', 'Una vez por persona'], ['cada', 'Cada vez (máx. 1 al día)']]} valor={d.repetir} onCambio={(v) => setD({ ...d, repetir: v })} />
    </>
  );
}

function PanelSigueme({ d, setD }) {
  const seguir = (k) => (v) => setD({ ...d, seguir: { ...d.seguir, [k]: v } });
  return (
    <>
      <p className="ayuda">A <b>todos</b> los que comentan les llega primero este mensaje, con los botones «{d.seguir?.boton || DEFECTO_SEGUIR.boton}» y «Ver perfil». Al pulsar el botón se comprueba si te sigue:</p>
      <ul className="ayuda fl-casos">
        <li><b>Te sigue</b>: le llega el mensaje siguiente y todo el flujo.</li>
        <li><b>No te sigue</b>: le llega «Si aún no te sigue» con el botón para volver a comprobarlo cuando te siga.</li>
        <li>Si Instagram no deja saberlo, se envía igual (para no dejar a nadie sin su recurso).</li>
      </ul>
      <label className="campo-et">Mensaje para que te siga</label>
      <CampoEmoji rows={3} value={d.seguir?.mensaje || ''} onChange={seguir('mensaje')} placeholder={DEFECTO_SEGUIR.mensaje} />
      <label className="campo-et">Botón para confirmar</label>
      <CampoEmoji linea maxLength={20} value={d.seguir?.boton || ''} onChange={seguir('boton')} placeholder={DEFECTO_SEGUIR.boton} />
      <label className="campo-et">Si aún no te sigue</label>
      <CampoEmoji rows={2} value={d.seguir?.noSigue || ''} onChange={seguir('noSigue')} placeholder={DEFECTO_SEGUIR.noSigue} />
    </>
  );
}

function PanelBloque({ n, primero, inicial, cambiar, quitarSalida }) {
  const d = n.datos;
  const pon = (k, v) => cambiar({ ...d, [k]: v });
  if (n.tipo === 'mensaje') {
    const botones = d.botones || [];
    const boton = (i, cambios) => pon('botones', botones.map((b, j) => (j === i ? { ...b, ...cambios } : b)));
    return (
      <>
        <label className="campo-et">Mensaje <span className="contador">{(d.texto || '').length} / {botones.length ? 640 : 1000}</span></label>
        <CampoEmoji rows={5} value={d.texto} onChange={(v) => pon('texto', v)} placeholder="¡Hola {{first_name}}! …" />
        <p className="ayuda">{'{{first_name}}'} pone su nombre. {primero ? 'Es la respuesta privada al comentario: para seguir, la persona tiene que pulsar un botón.' : ''}</p>
        <label className="campo-et">Botones ({botones.length}/{MAX_BOTONES})</label>
        {botones.map((b, i) => (
          <div key={i} className="auto-caja fl-boton-ed">
            <div className="fila">
              <CampoEmoji linea maxLength={20} value={b.titulo} onChange={(v) => boton(i, { titulo: v })} placeholder="Texto del botón" />
              <button type="button" className="icon-btn" onClick={() => quitarSalida('botones', i)} aria-label="Quitar botón">✕</button>
            </div>
            <Pildoras opciones={[['camino', 'Sigue un camino'], ['enlace', 'Abre un enlace']]} valor={b.tipo} onCambio={(v) => boton(i, { tipo: v, ...(v === 'enlace' ? { url: b.url || '' } : {}) })} />
            {b.tipo === 'enlace' && (
              <>
                <input className="campo" value={b.url || ''} onChange={(e) => boton(i, { url: e.target.value })} placeholder="https://…" />
                <ElegirLeadMagnet enlace={b.url} onElegir={(x) => boton(i, { url: x.url })} />
              </>
            )}
          </div>
        ))}
        {botones.length < MAX_BOTONES && <button type="button" className="btn btn-sec" onClick={() => pon('botones', [...botones, { titulo: '', tipo: 'camino' }])}><Icon name="plus" size={13} />Añadir botón</button>}
        {!primero && botones.some((b) => b.tipo === 'camino') && (
          <>
            <label className="campo-et">Si no pulsa en</label>
            <div className="fila"><input className="campo" type="number" min={1} max={720} value={d.esperaHoras} onChange={(e) => pon('esperaHoras', Number(e.target.value))} style={{ width: 90 }} /><span className="ayuda">horas, sigue por «Si no pulsa»</span></div>
          </>
        )}
      </>
    );
  }
  if (n.tipo === 'pregunta') {
    const ops = d.opciones || [];
    return (
      <>
        <label className="campo-et">Pregunta</label>
        <CampoEmoji rows={3} value={d.texto} onChange={(v) => pon('texto', v)} placeholder="¿A qué te dedicas?" />
        <label className="campo-et">Respuestas rápidas (opcional)</label>
        {ops.map((o, i) => (
          <div key={i} className="fila">
            <CampoEmoji linea maxLength={20} value={o} onChange={(v) => pon('opciones', ops.map((x, j) => (j === i ? v : x)))} />
            <button type="button" className="icon-btn" onClick={() => quitarSalida('opciones', i)} aria-label="Quitar">✕</button>
          </div>
        ))}
        {ops.length < 13 && <button type="button" className="btn btn-sec" onClick={() => pon('opciones', [...ops, ''])}><Icon name="plus" size={13} />Añadir respuesta</button>}
        <p className="ayuda">Cada respuesta rápida tiene su camino; si escribe otra cosa, sigue por «Otra respuesta». Su respuesta se guarda y la ves en Resultados.</p>
        <label className="campo-et">Si no responde en</label>
        <div className="fila"><input className="campo" type="number" min={1} max={720} value={d.esperaHoras} onChange={(e) => pon('esperaHoras', Number(e.target.value))} style={{ width: 90 }} /><span className="ayuda">horas</span></div>
      </>
    );
  }
  if (n.tipo === 'esperar') {
    const h = d.horario || { activo: false, desde: 9, hasta: 21 };
    const horas = Array.from({ length: 24 }, (_, i) => i);
    return (
      <>
        <label className="campo-et">Esperar</label>
        <div className="fila">
          <input className="campo" type="number" min={0} value={d.cantidad} onChange={(e) => pon('cantidad', Number(e.target.value))} style={{ width: 90 }} />
          <select className="campo" value={d.unidad} onChange={(e) => pon('unidad', e.target.value)}><option value="segundos">segundos</option><option value="minutos">minutos</option><option value="horas">horas</option><option value="dias">días</option></select>
        </div>
        <p className="ayuda">{inicial ? 'Justo después del disparador: es lo que tarda en llegar la respuesta privada (los segundos valen aquí).' : 'Entre mensajes, Zernio espera como mínimo 1 minuto (los segundos se redondean). Meta solo deja escribirle en las 24 h siguientes a su último mensaje.'}</p>
        {!inicial && (
          <>
            <label className="lm-check"><input type="checkbox" checked={Boolean(h.activo)} onChange={(e) => pon('horario', { ...h, activo: e.target.checked })} />Enviar solo dentro de un horario</label>
            {h.activo && (
              <>
                <div className="fila">
                  <span className="ayuda">De</span>
                  <select className="campo" value={h.desde} onChange={(e) => pon('horario', { ...h, desde: Number(e.target.value) })}>{horas.map((x) => <option key={x} value={x}>{String(x).padStart(2, '0')}:00</option>)}</select>
                  <span className="ayuda">a</span>
                  <select className="campo" value={h.hasta} onChange={(e) => pon('horario', { ...h, hasta: Number(e.target.value) })}>{horas.map((x) => <option key={x} value={x}>{String(x).padStart(2, '0')}:00</option>)}</select>
                </div>
                <p className="ayuda">Hora de España ({ZONA_HORARIA}). Tras la espera, si está fuera de ese horario, vuelve a mirar cada 15 minutos hasta que toque. Si el horario cruza la medianoche (p. ej. de 22:00 a 08:00), también vale.</p>
              </>
            )}
          </>
        )}
      </>
    );
  }
  if (n.tipo === 'condicion') {
    return (
      <>
        <label className="campo-et">Si…</label>
        <select className="campo" value={d.tipo} onChange={(e) => pon('tipo', e.target.value)}>
          <option value="etiqueta">Tiene la etiqueta…</option>
          <option value="sigue">Te sigue</option>
          <option value="contiene">Su último mensaje contiene…</option>
        </select>
        {d.tipo !== 'sigue' && <input className="campo" value={d.valor} onChange={(e) => pon('valor', e.target.value)} placeholder={d.tipo === 'etiqueta' ? 'entrenador' : 'precio'} />}
        <p className="ayuda">Sigue por «Sí» o por «No».</p>
      </>
    );
  }
  if (n.tipo === 'etiqueta') {
    return (
      <>
        <Pildoras opciones={[['poner', 'Poner etiqueta'], ['quitar', 'Quitar etiqueta']]} valor={d.accion} onCambio={(v) => pon('accion', v)} />
        <input className="campo" value={d.etiqueta} onChange={(e) => pon('etiqueta', e.target.value)} placeholder="interesado" />
        <p className="ayuda">Sirve para separar a la gente y usarlo luego en una Condición.</p>
      </>
    );
  }
  return <p className="ayuda">Aquí termina este camino.</p>;
}

// ---------- El tablero ----------
function Lienzo({ inicial, meta, onClose, onGuardado }) {
  const [nombre, setNombre] = useState(inicial?.nombre || '');
  const [disparador, setDisparador] = useState(() => ({ ...DISPARADOR_VACIO, destino: meta ? 'siguiente' : 'publicacion', ...(inicial?.disparador || {}), seguir: { ...DISPARADOR_VACIO.seguir, ...(inicial?.disparador?.seguir || {}) } }));
  const [flujo, setFlujo] = useState(() => inicial?.flujo || flujoInicial());
  const [sel, setSel] = useState('inicio');
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const rf = useReactFlow();

  // Las flechas que salen de salidas que ya no existen (p. ej. un botón que pasó a enlace) no cuentan
  const valido = useMemo(() => {
    const salidas = Object.fromEntries(flujo.nodos.map((n) => [n.id, new Set(salidasDe(n, { primero: esPrimero(flujo, disparador, n.id) }).map((s) => s.id))]));
    return { ...flujo, conexiones: flujo.conexiones.filter((c) => salidas[c.de]?.has(c.salida)) };
  }, [flujo, disparador]);
  const { errores, avisos } = useMemo(() => validarFlujo(valido, disparador), [valido, disparador]);

  // «Sígueme primero»: un cuadro entre el disparador y lo que va detrás (la flecha del inicio sale de él)
  const conSigueme = disparador.sigueme && empiezaConComentario(disparador.tipo);
  const inicio = valido.nodos.find((n) => n.id === 'inicio');
  const posSigueme = { x: disparador.seguir?.x || (inicio?.x || 0) + 340, y: disparador.seguir?.y || inicio?.y || 0 };
  const nodes = useMemo(() => {
    const l = valido.nodos.map((n) => {
      const primero = esPrimero(valido, disparador, n.id);
      return { id: n.id, type: 'bloque', position: { x: n.x || 0, y: n.y || 0 }, selected: sel === n.id, deletable: n.tipo !== 'inicio', data: { nodo: n, salidas: salidasDe(n, { primero }), disparador, primero } };
    });
    if (conSigueme) l.push({ id: SIGUEME, type: 'bloque', position: posSigueme, selected: sel === SIGUEME, deletable: false, data: { nodo: { id: SIGUEME, tipo: 'sigueme', datos: {} }, salidas: [{ id: 'siguiente', etiqueta: 'Si te sigue' }], disparador, primero: false } });
    return l;
  }, [valido, disparador, sel, conSigueme, posSigueme.x, posSigueme.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const edges = useMemo(() => {
    const l = valido.conexiones.map((c) => ({ id: `${c.de}:${c.salida}`, source: conSigueme && c.de === 'inicio' ? SIGUEME : c.de, sourceHandle: c.salida, target: c.a, targetHandle: 'in', type: 'smoothstep', animated: true }));
    if (conSigueme) l.push({ id: 'inicio>sigueme', source: 'inicio', sourceHandle: 'siguiente', target: SIGUEME, targetHandle: 'in', type: 'smoothstep', deletable: false });
    return l;
  }, [valido, conSigueme]);
  // Activar «Sígueme primero» hace sitio a su cuadro: lo que está a la derecha del disparador se corre
  const alternarSigueme = (v) => {
    setDisparador((d) => ({ ...d, sigueme: v, seguir: { ...d.seguir, x: 0, y: 0 } }));
    if (v) setFlujo((f) => ({ ...f, nodos: f.nodos.map((n) => (n.id !== 'inicio' && (n.x || 0) > (inicio?.x || 0) ? { ...n, x: (n.x || 0) + 340 } : n)) }));
    setSel(v ? SIGUEME : 'inicio');
  };

  const onNodesChange = useCallback((cambios) => {
    const delSigueme = cambios.find((c) => c.id === SIGUEME && c.type === 'position' && c.position);
    if (delSigueme) setDisparador((d) => ({ ...d, seguir: { ...d.seguir, x: Math.round(delSigueme.position.x), y: Math.round(delSigueme.position.y) } }));
    setFlujo((f) => {
      let nodos = f.nodos;
      let conexiones = f.conexiones;
      for (const c of cambios) {
        if (c.type === 'position' && c.position) nodos = nodos.map((n) => (n.id === c.id ? { ...n, x: Math.round(c.position.x), y: Math.round(c.position.y) } : n));
        if (c.type === 'remove' && c.id !== 'inicio') { nodos = nodos.filter((n) => n.id !== c.id); conexiones = conexiones.filter((x) => x.de !== c.id && x.a !== c.id); }
      }
      return nodos === f.nodos && conexiones === f.conexiones ? f : { nodos, conexiones };
    });
    for (const c of cambios) if (c.type === 'select' && c.selected) setSel(c.id);
  }, []);
  const onEdgesChange = useCallback((cambios) => {
    const fuera = new Set(cambios.filter((c) => c.type === 'remove').map((c) => c.id).filter((id) => id !== 'inicio>sigueme'));
    if (fuera.size) setFlujo((f) => ({ ...f, conexiones: f.conexiones.filter((c) => !fuera.has(`${c.de}:${c.salida}`)) }));
  }, []);
  const onConnect = useCallback(({ source: origen, sourceHandle, target }) => {
    // Lo que sale del cuadro de «Sígueme primero» es la flecha del disparador
    const source = origen === SIGUEME ? 'inicio' : origen;
    if (!source || !target || source === target || target === 'inicio' || target === SIGUEME) return;
    setFlujo((f) => ({ ...f, conexiones: [...f.conexiones.filter((c) => !(c.de === source && c.salida === sourceHandle)), { de: source, salida: sourceHandle, a: target }] }));
  }, []);

  // Un bloque nuevo, a la derecha del elegido y conectado a su primera salida libre
  const anadir = (tipo) => {
    const desde = valido.nodos.find((n) => n.id === (sel === SIGUEME ? 'inicio' : sel)) || valido.nodos[0];
    const base = sel === SIGUEME ? posSigueme : desde;
    const libre = salidasDe(desde, { primero: esPrimero(valido, disparador, desde.id) }).find((s) => !valido.conexiones.some((c) => c.de === desde.id && c.salida === s.id));
    const b = bloqueNuevo(tipo, (base.x || 0) + 340, (base.y || 0) + (libre ? 0 : 200));
    setFlujo((f) => ({ nodos: [...f.nodos, b], conexiones: libre ? [...f.conexiones, { de: desde.id, salida: libre.id, a: b.id }] : f.conexiones }));
    setSel(b.id);
    setTimeout(() => rf.fitView({ padding: 0.2, duration: 300 }), 50);
  };
  const cambiarDatos = (id, datos) => setFlujo((f) => ({ ...f, nodos: f.nodos.map((n) => (n.id === id ? { ...n, datos } : n)) }));
  // Al quitar un botón o una respuesta, las flechas de los de después se corren un puesto
  const quitarSalida = (id, campo, i) => setFlujo((f) => {
    const pre = campo === 'botones' ? 'b' : 'o';
    const n = f.nodos.find((x) => x.id === id);
    const nodos = f.nodos.map((x) => (x.id === id ? { ...x, datos: { ...x.datos, [campo]: n.datos[campo].filter((_, j) => j !== i) } } : x));
    const conexiones = f.conexiones.flatMap((c) => {
      if (c.de !== id || !c.salida.startsWith(pre)) return [c];
      const j = Number(c.salida.slice(1));
      if (Number.isNaN(j) || j < i) return [c];
      return j === i ? [] : [{ ...c, salida: `${pre}${j - 1}` }];
    });
    return { nodos, conexiones };
  });
  const borrarBloque = (id) => { setFlujo((f) => ({ nodos: f.nodos.filter((n) => n.id !== id), conexiones: f.conexiones.filter((c) => c.de !== id && c.a !== id) })); setSel('inicio'); };

  const guardar = async () => {
    if (errores.length) return setError(errores.join(' · '));
    setGuardando(true); setError('');
    try {
      const body = { nombre, disparador: { ...disparador, respuestas: (disparador.respuestas || []).map((x) => x.trim()).filter(Boolean) }, flujo: valido };
      await api(inicial?.id ? `/api/automatizaciones/${inicial.id}` : '/api/automatizaciones', { method: inicial?.id ? 'PUT' : 'POST', body });
      onGuardado(); onClose();
    } catch (e) { setError(e.message); setGuardando(false); }
  };

  const elegido = sel === SIGUEME && conSigueme ? { id: SIGUEME, tipo: 'sigueme' } : valido.nodos.find((n) => n.id === sel);
  return (
    <div className="fl-pantalla" role="dialog" aria-modal="true" aria-label="Tablero de la automatización">
      <div className="fl-barra">
        <input className="campo fl-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre de la automatización" />
        <div className="fl-anadir">
          {Object.entries(TIPOS_BLOQUE).map(([t, b]) => <button key={t} type="button" className="btn btn-sec" style={{ '--c': b.color }} onClick={() => anadir(t)}><span className="fl-punto-color" />{b.nombre}</button>)}
        </div>
        <span className={`fl-estado${errores.length ? ' mal' : ''}`} title={[...errores, ...avisos].join('\n')}>{errores.length ? `⚠ ${errores.length} por corregir` : avisos.length ? `✓ Listo · ${avisos.length} aviso${avisos.length === 1 ? '' : 's'}` : '✓ Listo'}</span>
        <button className="btn btn-sec" onClick={onClose}>Cancelar</button>
        <button className="btn" onClick={guardar} disabled={guardando}>{guardando ? 'Guardando…' : inicial?.id ? 'Guardar' : 'Crear automatización'}</button>
      </div>
      {error && <div className="caja-error fl-error">{error}</div>}
      <div className="fl-cuerpo">
        <div className="fl-lienzo">
          <ReactFlow
            nodes={nodes} edges={edges} nodeTypes={TIPOS_NODO}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onPaneClick={() => setSel('inicio')} fitView fitViewOptions={{ padding: 0.2, maxZoom: 1 }} minZoom={0.2}
            deleteKeyCode={['Backspace', 'Delete']} proOptions={{ hideAttribution: true }}
          >
            <Background gap={22} />
            <Controls showInteractive={false} />
          </ReactFlow>
          <div className="fl-ayuda">Arrastra desde un punto ● hasta otro bloque para unirlos · selecciona una flecha y pulsa Supr para quitarla</div>
        </div>
        <aside className="fl-panel">
          {elegido && (
            <>
              <div className="fl-panel-cab">
                <b>{elegido.tipo === 'inicio' ? 'Disparador' : elegido.tipo === 'sigueme' ? 'Sígueme primero' : TIPOS_BLOQUE[elegido.tipo]?.nombre}</b>
                {elegido.tipo === 'sigueme' ? <button type="button" className="link-btn peligro" onClick={() => alternarSigueme(false)}>Quitar</button>
                  : elegido.tipo !== 'inicio' && <button type="button" className="link-btn peligro" onClick={() => borrarBloque(elegido.id)}>Borrar bloque</button>}
              </div>
              {elegido.tipo === 'inicio' ? <PanelDisparador d={disparador} setD={setDisparador} meta={meta} onSigueme={alternarSigueme} />
                : elegido.tipo === 'sigueme' ? <PanelSigueme d={disparador} setD={setDisparador} />
                  : <PanelBloque key={elegido.id} n={elegido} primero={esPrimero(valido, disparador, elegido.id)} inicial={esperaInicial(valido, disparador)?.id === elegido.id} cambiar={(datos) => cambiarDatos(elegido.id, datos)} quitarSalida={(campo, i) => quitarSalida(elegido.id, campo, i)} />}
            </>
          )}
          {(errores.length > 0 || avisos.length > 0) && (
            <div className="fl-problemas">
              {errores.map((e) => <div key={e} className="mal">⚠ {e}</div>)}
              {avisos.map((e) => <div key={e}>ℹ {e}</div>)}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default function Tablero(props) {
  return <ReactFlowProvider><Lienzo {...props} /></ReactFlowProvider>;
}
