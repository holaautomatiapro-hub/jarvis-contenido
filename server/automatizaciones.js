// Automatizaciones de Instagram al estilo ManyChat, con Zernio (zernio.com). Se diseñan en un tablero de bloques
// (web/src/lib/flujo.js) y JARVIS las da de alta en Zernio, que tiene la app de Meta aprobada y hace los envíos.
//
// Disparadores:
//   - post / story: alguien comenta una palabra en una publicación (o responde a una story). Zernio le manda la
//     respuesta privada (el primer mensaje del tablero) con una «comment automation», que también hace la respuesta
//     pública y el «sígueme primero». Meta no deja enviar nada más hasta que la persona responda, así que cada botón
//     de ese primer mensaje arranca su propio «workflow» con lo que hay detrás.
//   - mensaje (te escriben una palabra por privado): un solo workflow.
// Para «la siguiente publicación», JARVIS la deja en pausa y la engancha sola al post o story que sale después.
import { randomBytes } from 'node:crypto';
import { row, rows } from './db.js';
import { createGraph } from './integrations/meta.js';
import { guardarEnv as guardarEnvArchivo } from './env-archivo.js';
import { ZONA_HORARIA, destinoDe, empiezaConComentario, esperaInicial, flujoDesdeFormulario, flujoInicial, minutosDeEspera, primerMensajeId, salidasDe, segundosDeEspera, validarFlujo } from '../web/src/lib/flujo.js';

export class AutomatizacionError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const BASE = 'https://zernio.com/api/v1';
const COINCIDENCIA = { palabra: 'word', contiene: 'contains', exacta: 'exact' };
const corto = (s, n) => String(s || '').trim().slice(0, n);
const lista = (v, n, largo) => (Array.isArray(v) ? v : String(v || '').split(/[,\n]/)).map((x) => corto(x, largo)).filter(Boolean).slice(0, n);
const esUrl = (u) => /^https:\/\/\S+$/i.test(String(u || '').trim());
const MAX_BLOQUES = 200;

// Da igual mayúsculas, minúsculas y tildes: «guía» también es GUÍA, Guía, guia, GUIA y Guia
const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
const clavePalabra = (t) => sinTildes(t).toLowerCase();
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
export function variantesPalabra(p) {
  const v = new Set();
  for (const base of [p, sinTildes(p)]) for (const f of [base, base.toLowerCase(), base.toUpperCase(), capital(base)]) v.add(f);
  return [...v];
}
// Las palabras que escribe la persona, sin repetir (GUIA y guía son la misma; se queda la que lleva tilde, en minúsculas)
function unicas(palabras) {
  const m = new Map();
  for (const p of palabras) {
    const k = clavePalabra(p);
    const ya = m.get(k);
    if (!ya || (ya === sinTildes(ya) && p !== sinTildes(p))) m.set(k, p.toLowerCase());
  }
  return [...m.values()];
}
export const palabrasParaZernio = (palabras) => [...new Set(palabras.flatMap(variantesPalabra))].slice(0, 120);

// ---------- Configuración: disparador + flujo ----------
function limpiarDisparador(d = {}) {
  const tipo = ['post', 'story', 'mensaje'].includes(d.tipo) ? d.tipo : 'post';
  const comentario = empiezaConComentario(tipo);
  const destino = comentario && ['publicacion', 'siguiente', 'cualquiera'].includes(d.destino) ? d.destino : comentario ? 'publicacion' : 'cualquiera';
  const r = {
    tipo,
    destino,
    media_id: destino === 'publicacion' ? corto(d.media_id, 64) : '',
    media_titulo: destino === 'publicacion' ? corto(d.media_titulo, 120) : '',
    media_miniatura: destino === 'publicacion' && esUrl(d.media_miniatura) ? String(d.media_miniatura).slice(0, 1000) : '',
    palabras: unicas(lista(d.palabras, 40, 40)).slice(0, 20),
    coincidencia: COINCIDENCIA[d.coincidencia] ? d.coincidencia : 'palabra',
    erratas: d.erratas !== false,
    respuestas: tipo === 'post' ? lista(d.respuestas, 6, 300) : [],
    sigueme: comentario && Boolean(d.sigueme),
    seguir: {
      mensaje: corto(d.seguir?.mensaje, 640) || '¡Hola! Para enviártelo, primero sígueme y luego pulsa el botón 👇',
      boton: corto(d.seguir?.boton, 20) || 'Ya te sigo',
      noSigue: corto(d.seguir?.noSigue, 640) || 'Todavía no me sigues 😅 Sígueme y vuelve a pulsar el botón.',
      // Dónde está su cuadro en el tablero
      x: Math.round(Number(d.seguir?.x) || 0), y: Math.round(Number(d.seguir?.y) || 0),
    },
    repetir: d.repetir === 'cada' ? 'cada' : 'una',
    tambienDm: tipo === 'post' && Boolean(d.tambienDm),
  };
  if (destino === 'publicacion' && !r.media_id) throw new AutomatizacionError(tipo === 'story' ? 'Elige la story' : 'Elige la publicación');
  if (tipo === 'mensaje' && !r.palabras.length) throw new AutomatizacionError('Pon la palabra que te tienen que escribir por privado');
  if (r.tambienDm && !r.palabras.length) throw new AutomatizacionError('Para que también responda a mensajes directos pon al menos una palabra');
  return r;
}

function limpiarFlujo(f = {}) {
  const nodos = (Array.isArray(f.nodos) ? f.nodos : []).slice(0, MAX_BLOQUES).map((n) => {
    const d = n.datos || {};
    const base = { id: corto(n.id, 40).replace(/[^A-Za-z0-9_]/g, '') || 'x', tipo: n.tipo, x: Math.round(Number(n.x) || 0), y: Math.round(Number(n.y) || 0) };
    switch (n.tipo) {
      case 'inicio': return { ...base, id: 'inicio', datos: {} };
      case 'mensaje': return { ...base, datos: { texto: corto(d.texto, 1000), esperaHoras: Math.min(720, Math.max(1, Number(d.esperaHoras) || 24)), botones: (d.botones || []).slice(0, 3).map((b) => ({ titulo: corto(b.titulo, 20), tipo: b.tipo === 'enlace' ? 'enlace' : 'camino', ...(b.tipo === 'enlace' ? { url: corto(b.url, 1000) } : {}) })) } };
      case 'pregunta': return { ...base, datos: { texto: corto(d.texto, 640), opciones: lista(d.opciones, 13, 20), campo: corto(d.campo, 40).replace(/[^A-Za-z0-9_]/g, '_'), esperaHoras: Math.min(720, Math.max(1, Number(d.esperaHoras) || 24)) } };
      case 'esperar': {
        const hora = (v, def) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= 23 ? Number(v) : def);
        return { ...base, datos: { cantidad: Math.max(0, Number(d.cantidad) || 0), unidad: ['segundos', 'minutos', 'horas', 'dias'].includes(d.unidad) ? d.unidad : 'horas', horario: { activo: Boolean(d.horario?.activo), desde: hora(d.horario?.desde, 9), hasta: hora(d.horario?.hasta, 21) } } };
      }
      case 'condicion': return { ...base, datos: { tipo: ['etiqueta', 'sigue', 'contiene'].includes(d.tipo) ? d.tipo : 'etiqueta', valor: corto(d.valor, 100) } };
      case 'etiqueta': return { ...base, datos: { accion: d.accion === 'quitar' ? 'quitar' : 'poner', etiqueta: corto(d.etiqueta, 60) } };
      case 'fin': return { ...base, datos: {} };
      default: return null;
    }
  }).filter(Boolean);
  if (!nodos.some((n) => n.tipo === 'inicio')) nodos.unshift({ id: 'inicio', tipo: 'inicio', x: 0, y: 0, datos: {} });
  const ids = new Set(nodos.map((n) => n.id));
  if (ids.size !== nodos.length) throw new AutomatizacionError('Hay bloques repetidos en el flujo');
  // Una flecha por salida, entre bloques que existen
  const vistas = new Set();
  const conexiones = (Array.isArray(f.conexiones) ? f.conexiones : []).filter((c) => {
    const k = `${c.de}:${c.salida}`;
    if (!ids.has(c.de) || !ids.has(c.a) || c.a === 'inicio' || vistas.has(k)) return false;
    vistas.add(k);
    return true;
  }).map((c) => ({ de: c.de, salida: String(c.salida), a: c.a }));
  return { nodos, conexiones };
}

// Lo que llega del tablero → configuración limpia (lo que se guarda en JARVIS)
export function normalizarConfig(c = {}) {
  const disparador = limpiarDisparador(c.disparador || {});
  const flujo = limpiarFlujo(c.flujo || flujoInicial(disparador.tipo));
  const { errores } = validarFlujo(flujo, disparador);
  if (errores.length) throw new AutomatizacionError(errores.slice(0, 3).join(' · '));
  const nombre = corto(c.nombre, 80) || (disparador.palabras[0] ? `Palabra ${disparador.palabras[0].toUpperCase()}` : disparador.tipo === 'story' ? 'Respuestas a stories' : 'Comentarios');
  return { nombre, disparador, flujo };
}

// Las automatizaciones guardadas con el formulario de antes (sin tablero), al formato de ahora
export function aFormatoNuevo(cfg = {}) {
  if (cfg.disparador) return cfg;
  return {
    nombre: cfg.nombre || 'Automatización',
    disparador: { tipo: cfg.tipo === 'story' ? 'story' : 'post', destino: cfg.destino, media_id: cfg.media_id || '', media_titulo: cfg.media_titulo || '', media_miniatura: cfg.media_miniatura || '', palabras: cfg.palabras || [], coincidencia: cfg.coincidencia || 'palabra', erratas: cfg.erratas !== false, respuestas: cfg.respuestas || [], sigueme: Boolean(cfg.sigueme), seguir: cfg.seguir || {}, repetir: cfg.repetir || 'una', tambienDm: Boolean(cfg.tambienDm) },
    flujo: flujoDesdeFormulario(cfg),
  };
}

// ---------- Del tablero a Zernio ----------
// Un workflow de Zernio con lo que cuelga de un bloque. «disparo» es la config del nodo trigger.
export function grafoZernio(flujo, desde, disparo) {
  const nodos = [{ id: 'inicio', type: 'trigger', config: disparo }];
  const aristas = [];
  const hecho = new Map(); // bloque de JARVIS → nodo de entrada en Zernio
  let finComun = null;
  const unir = (a, b, handle) => aristas.push({ id: `${a}>${b}${handle ? `:${handle}` : ''}`, source: a, target: b, ...(handle ? { sourceHandle: handle } : {}) });
  const fin = () => { if (!finComun) { finComun = 'fin_jarvis'; nodos.push({ id: finComun, type: 'end' }); } return finComun; };
  const bloque = (id) => flujo.nodos.find((n) => n.id === id);
  const destino = (id, salida) => entrada(destinoDe(flujo, id, salida));

  function entrada(id) {
    const n = id && bloque(id);
    if (!n || n.tipo === 'inicio') return fin();
    if (hecho.has(id)) return hecho.get(id);
    hecho.set(id, id);
    const d = n.datos;
    switch (n.tipo) {
      case 'mensaje': {
        const caminos = d.botones.map((b, i) => ({ b, i })).filter(({ b }) => b.tipo === 'camino');
        nodos.push({ id, type: 'send_message', label: 'Mensaje', config: {
          messageType: 'text', text: d.texto,
          ...(d.botones.length ? { buttons: d.botones.map((b) => (b.tipo === 'enlace' ? { type: 'url', title: b.titulo, url: b.url } : { type: 'postback', title: b.titulo })) } : {}),
        } });
        if (!caminos.length) { unir(id, destino(id, 'siguiente')); break; }
        // Espera a que pulse y sigue por el camino de ese botón
        nodos.push({ id: `${id}_w`, type: 'wait_for_reply', config: { timeoutMinutes: d.esperaHoras * 60, saveAs: `r_${id}` } });
        nodos.push({ id: `${id}_c`, type: 'condition', config: { rules: caminos.map(({ b, i }) => ({ id: `b${i}`, variable: 'postback.title', operator: 'equals', value: b.titulo })) } });
        unir(id, `${id}_w`);
        unir(`${id}_w`, `${id}_c`, 'reply');
        for (const { i } of caminos) unir(`${id}_c`, destino(id, `b${i}`), `b${i}`);
        const sin = destino(id, 'sin_respuesta');
        unir(`${id}_c`, sin, 'default');
        unir(`${id}_w`, sin, 'timeout');
        break;
      }
      case 'pregunta': {
        const ops = d.opciones;
        nodos.push({ id, type: 'send_message', label: 'Pregunta', config: { messageType: 'text', text: d.texto, ...(ops.length ? { quickReplies: ops.map((o) => ({ title: o, payload: o })) } : {}) } });
        nodos.push({ id: `${id}_w`, type: 'wait_for_reply', config: { timeoutMinutes: d.esperaHoras * 60, saveAs: `r_${id}` } });
        nodos.push({ id: `${id}_f`, type: 'set_field', config: { field: d.campo || `respuesta_${id}`, value: `{{r_${id}}}` } });
        unir(id, `${id}_w`);
        unir(`${id}_w`, `${id}_f`, 'reply');
        unir(`${id}_w`, destino(id, 'sin_respuesta'), 'timeout');
        if (!ops.length) { unir(`${id}_f`, destino(id, 'respuesta')); break; }
        // Una respuesta rápida pulsada, o escrita igual que la opción
        nodos.push({ id: `${id}_c`, type: 'condition', config: { rules: ops.flatMap((o, i) => [{ id: `q${i}`, variable: 'quickReply.title', operator: 'equals', value: o }, { id: `t${i}`, variable: `r_${id}`, operator: 'equals', value: o }]) } });
        unir(`${id}_f`, `${id}_c`);
        ops.forEach((_, i) => { const a = destino(id, `o${i}`); unir(`${id}_c`, a, `q${i}`); unir(`${id}_c`, a, `t${i}`); });
        unir(`${id}_c`, destino(id, 'otra'), 'default');
        break;
      }
      case 'esperar': {
        const siguiente = destino(id, 'siguiente');
        const h = d.horario || {};
        if (segundosDeEspera(d) > 0 || !h.activo) nodos.push({ id, type: 'delay', label: 'Esperar', config: { delayMinutes: Math.min(43200, Math.max(1, Math.ceil(minutosDeEspera(d)))) } });
        if (!h.activo) { unir(id, siguiente); break; }
        // Solo dentro del tramo horario: mira la hora (en España) y, si no toca, vuelve a mirar cada 15 minutos
        const hora = `${id}_h`;
        if (segundosDeEspera(d) > 0) unir(id, hora); else hecho.set(id, hora);
        const variable = `h_${id}.body.hour`;
        nodos.push({ id: hora, type: 'webhook', label: 'Mira la hora', config: { url: `https://timeapi.io/api/time/current/zone?timeZone=${encodeURIComponent(ZONA_HORARIA)}`, method: 'GET', saveAs: `h_${id}` } });
        nodos.push({ id: `${id}_a`, type: 'condition', config: { rules: [{ id: 'si', variable, operator: 'greater_or_equal', value: h.desde }] } });
        nodos.push({ id: `${id}_b`, type: 'condition', config: { rules: [{ id: 'si', variable, operator: 'less_than', value: h.hasta }] } });
        nodos.push({ id: `${id}_r`, type: 'delay', label: 'Fuera de horario', config: { delayMinutes: 15 } });
        unir(hora, `${id}_a`, 'success');
        unir(hora, siguiente, 'error'); // si no se puede saber la hora, se envía igual
        unir(`${id}_r`, hora);
        if (h.desde < h.hasta) {
          // De 9 a 21: hora ≥ 9 y hora < 21
          unir(`${id}_a`, `${id}_b`, 'si');
          unir(`${id}_a`, `${id}_r`, 'default');
        } else {
          // De 22 a 8 (cruza la medianoche): hora ≥ 22 o hora < 8
          unir(`${id}_a`, siguiente, 'si');
          unir(`${id}_a`, `${id}_b`, 'default');
        }
        unir(`${id}_b`, siguiente, 'si');
        unir(`${id}_b`, `${id}_r`, 'default');
        return hecho.get(id);
      }
      case 'condicion': {
        const regla = d.tipo === 'sigue' ? { variable: 'contact.isFollower', operator: 'is_true' }
          : d.tipo === 'contiene' ? { variable: 'lastMessage', operator: 'contains', value: d.valor }
            : { variable: 'contact.tags', operator: 'has_tag', value: d.valor };
        nodos.push({ id, type: 'condition', label: 'Condición', config: { rules: [{ id: 'si', ...regla }] } });
        unir(id, destino(id, 'si'), 'si');
        unir(id, destino(id, 'no'), 'default');
        break;
      }
      case 'etiqueta':
        nodos.push({ id, type: d.accion === 'quitar' ? 'remove_tag' : 'add_tag', label: 'Etiqueta', config: { tag: d.etiqueta } });
        unir(id, destino(id, 'siguiente'));
        break;
      default:
        nodos.push({ id, type: 'end' });
    }
    return id;
  }
  unir('inicio', entrada(desde));
  return { nodes: nodos, edges: aristas, entryNodeId: 'inicio' };
}

// Qué hay que dar de alta en Zernio: los workflows («ramas») y, si empieza por un comentario, la comment automation
export function compilar(cfg, { claves = {} } = {}) {
  const { disparador: d, flujo } = cfg;
  const primero = destinoDe(flujo, 'inicio', 'siguiente');
  const clave = (rama) => claves[rama] || `jarvis-${rama}-${randomBytes(6).toString('hex')}`;
  if (!empiezaConComentario(d.tipo)) {
    const disparo = { triggerType: 'inbound_message', matchType: d.coincidencia === 'exacta' ? 'exact' : 'contains', keywords: palabrasParaZernio(d.palabras), cooldownHours: d.repetir === 'cada' ? 24 : 720 };
    return { ramas: [{ rama: 'principal', clave: null, grafo: grafoZernio(flujo, primero, disparo) }], comentario: null };
  }
  // El primer mensaje lo manda la comment automation; cada botón con camino arranca su workflow
  const primerMensaje = primerMensajeId(flujo, d);
  const m = flujo.nodos.find((n) => n.id === primerMensaje);
  const ramas = [];
  m.datos.botones.forEach((b, i) => {
    if (b.tipo !== 'camino') return;
    const k = clave(`b${i}`);
    ramas.push({ rama: `b${i}`, clave: k, grafo: grafoZernio(flujo, destinoDe(flujo, primerMensaje, `b${i}`), { triggerType: 'inbound_message', keywords: [k], matchType: 'exact' }) });
  });
  return { ramas, comentario: { primero: m } };
}

// La comment automation de Zernio. idsRamas: { b0: workflowId, … }
export function cuerpoAutomatizacion(cfg, { idsRamas = {}, activa = true, mediaId = null } = {}) {
  const { disparador: d, flujo } = cfg;
  const post = d.tipo === 'post';
  const m = flujo.nodos.find((n) => n.id === primerMensajeId(flujo, d));
  const espera = esperaInicial(flujo, d);
  const id = mediaId || d.media_id || null;
  return {
    name: cfg.nombre,
    trigger: post ? 'comment' : 'story_reply',
    ...(id ? { platformPostId: id, postTitle: d.media_titulo || cfg.nombre } : {}),
    keywords: palabrasParaZernio(d.palabras),
    matchMode: COINCIDENCIA[d.coincidencia],
    ...(d.coincidencia === 'palabra' ? { typoTolerance: d.erratas } : {}),
    dmMessage: m.datos.texto,
    ...(espera ? { dmDelaySeconds: Math.min(86400, segundosDeEspera(espera.datos)) } : {}),
    buttons: m.datos.botones.map((b, i) => (b.tipo === 'enlace' ? { type: 'url', title: b.titulo, url: b.url } : { type: 'postback', title: b.titulo, payload: `zernio:workflow:${idsRamas[`b${i}`]}` })),
    ...(post && d.respuestas.length ? { commentReply: d.respuestas[0], commentReplyVariations: d.respuestas.slice(1) } : {}),
    // «Sígueme primero»: Instagram solo dice si te sigue a quien ya te ha escrito; al resto se le manda el botón para
    // confirmarlo y, al pulsarlo, se comprueba de verdad
    audience: d.sigueme ? { followerStatus: 'follower', whenUnknown: 'verify' } : { followerStatus: 'any' },
    ...(d.sigueme ? { followGate: { message: d.seguir.mensaje, buttonLabel: d.seguir.boton, profileButtonLabel: 'Ver perfil', notFollowingMessage: d.seguir.noSigue } } : {}),
    repeatPolicy: d.repetir === 'cada' ? { mode: 'every_comment', cooldownHours: 24 } : { mode: 'once' },
    ...(post ? { alsoMatchInDms: d.tambienDm } : {}),
    isActive: activa,
  };
}

export function createAutomatizaciones({ db, env = process.env, fetchImpl = fetch, instagram = null, guardarEnv = guardarEnvArchivo, alCambiar = () => {}, log = () => {} }) {
  db.exec(`CREATE TABLE IF NOT EXISTS automatizaciones (
    id INTEGER PRIMARY KEY,
    config TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'activa',
    zernio_id TEXT,
    flujo_id TEXT,
    clave TEXT,
    media_id TEXT,
    media_titulo TEXT,
    desde TEXT,
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    actualizado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  )`);
  // Los workflows de cada una: [{ rama, id, clave }]
  try { db.exec('ALTER TABLE automatizaciones ADD COLUMN flujos TEXT'); } catch { /* ya estaba */ }
  const q = {
    todas: db.prepare('SELECT * FROM automatizaciones ORDER BY id DESC'),
    una: db.prepare('SELECT * FROM automatizaciones WHERE id = ?'),
    esperando: db.prepare("SELECT * FROM automatizaciones WHERE estado = 'esperando'"),
    borrar: db.prepare('DELETE FROM automatizaciones WHERE id = ?'),
  };
  const set = (id, campos) => {
    const k = Object.keys(campos);
    db.prepare(`UPDATE automatizaciones SET ${k.map((c) => `${c} = ?`).join(', ')}, actualizado = datetime('now','localtime') WHERE id = ?`).run(...k.map((c) => campos[c] ?? null), id);
  };
  const flujosDe = (r) => {
    try { const l = JSON.parse(r.flujos || 'null'); if (Array.isArray(l)) return l; } catch { /* vacío */ }
    return r.flujo_id ? [{ rama: 'b0', id: r.flujo_id, clave: r.clave }] : [];
  };
  const leer = (id) => {
    const r = row(q.una, Number(id));
    if (!r) throw new AutomatizacionError('Esa automatización no existe');
    return { ...r, config: aFormatoNuevo(JSON.parse(r.config)), ramas: flujosDe(r) };
  };

  const clave = () => String(env.ZERNIO_API_KEY || '').trim();
  const configurado = () => Boolean(clave());

  // Llamada a Zernio. El mensaje de error es el suyo (nunca lleva la clave)
  async function zernio(metodo, ruta, body) {
    if (!configurado()) throw new AutomatizacionError('Falta la API key de Zernio (ZERNIO_API_KEY)');
    let r;
    try {
      r = await fetchImpl(`${BASE}${ruta}`, { method: metodo, headers: { Authorization: `Bearer ${clave()}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    } catch { throw new AutomatizacionError('No puedo conectar con Zernio. Revisa la conexión a internet.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) throw new AutomatizacionError('Zernio no acepta la API key: revísala en zernio.com y vuelve a ponerla');
      const m = j?.error?.message || j?.message || (typeof j?.error === 'string' ? j.error : '') || `error ${r.status}`;
      throw new AutomatizacionError(`Zernio: ${String(m).slice(0, 300)}`);
    }
    return j;
  }

  // La cuenta de Instagram conectada en Zernio (ZERNIO_ACCOUNT_ID si hay varias)
  let cacheCuenta = null;
  async function cuenta() {
    if (cacheCuenta && Date.now() - cacheCuenta.en < 10 * 60000) return cacheCuenta.c;
    const { accounts = [] } = await zernio('GET', '/accounts');
    const ig = accounts.filter((a) => a.platform === 'instagram' && a.isActive !== false);
    const a = (env.ZERNIO_ACCOUNT_ID && ig.find((x) => x._id === env.ZERNIO_ACCOUNT_ID)) || ig[0];
    if (!a) throw new AutomatizacionError('No tienes ninguna cuenta de Instagram conectada en Zernio: conéctala en zernio.com');
    const c = { accountId: a._id, profileId: typeof a.profileId === 'object' ? a.profileId?._id : a.profileId, username: a.username || a.displayName || null, reconectar: Boolean(a.needsReconnection) };
    cacheCuenta = { c, en: Date.now() };
    return c;
  }

  async function conectar({ clave: k } = {}) {
    const nueva = String(k || '').trim();
    if (nueva.length < 16) throw new AutomatizacionError('Esa no parece una API key de Zernio');
    const antes = env.ZERNIO_API_KEY;
    env.ZERNIO_API_KEY = nueva;
    cacheCuenta = null;
    try { await cuenta(); } catch (e) { env.ZERNIO_API_KEY = antes; cacheCuenta = null; throw e; }
    guardarEnv({ ZERNIO_API_KEY: nueva });
    return estado();
  }

  // ---------- Instagram (para elegir publicación y detectar la siguiente) ----------
  const graph = () => {
    const c = instagram?.conexion?.();
    return c?.token && c?.igUserId ? { g: createGraph({ token: c.token, fetchImpl }), ig: c.igUserId } : null;
  };
  async function medios(tipo = 'post') {
    const m = graph();
    if (tipo === 'story') {
      if (!m) return [];
      const { data = [] } = await m.g.get(`${m.ig}/stories`, { fields: 'id,media_type,media_url,thumbnail_url,permalink,timestamp' });
      return data.map((s) => ({ id: s.id, titulo: `Story · ${new Date(s.timestamp).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`, miniatura: s.thumbnail_url || s.media_url || null, fecha: s.timestamp, enlace: s.permalink || null }));
    }
    if (m) {
      try {
        const { data = [] } = await m.g.get(`${m.ig}/media`, { fields: 'id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp', limit: 30 });
        return data.map((p) => ({ id: p.id, titulo: corto(p.caption, 120) || 'Sin texto', miniatura: p.thumbnail_url || (p.media_type === 'VIDEO' ? null : p.media_url) || null, fecha: p.timestamp, enlace: p.permalink || null, formato: p.media_product_type === 'REELS' ? 'Reel' : p.media_type === 'CAROUSEL_ALBUM' ? 'Carrusel' : 'Post' }));
      } catch (e) { log(`No se pudieron leer las publicaciones de Instagram: ${e.message}`); }
    }
    // Sin la conexión de Meta: las que trae la sincronización (Windsor)
    return rows(db.prepare('SELECT id, caption, miniatura, media_url, permalink, fecha, formato FROM ig_media ORDER BY fecha DESC LIMIT 30'))
      .map((p) => ({ id: p.id, titulo: corto(p.caption, 120) || 'Sin texto', miniatura: p.miniatura || p.media_url || null, fecha: p.fecha, enlace: p.permalink, formato: p.formato }));
  }

  // ---------- Altas, cambios y bajas ----------
  const nombreFlujo = (cfg, rama) => `JARVIS · ${cfg.nombre}${rama === 'principal' ? '' : ` · botón ${Number(rama.slice(1)) + 1}`}`;
  // Crea o actualiza los workflows de las ramas; borra los que sobran. Devuelve [{ rama, id, clave }]
  async function sincronizarRamas(cfg, previas, { activar }) {
    const c = await cuenta();
    const claves = Object.fromEntries(previas.filter((p) => p.clave).map((p) => [p.rama, p.clave]));
    const { ramas, comentario } = compilar(cfg, { claves });
    const hechas = [];
    try {
      for (const r of ramas) {
        const ya = previas.find((p) => p.rama === r.rama);
        const cuerpo = { name: nombreFlujo(cfg, r.rama), ...r.grafo };
        let id = ya?.id;
        if (id) await zernio('PATCH', `/workflows/${id}`, cuerpo);
        else {
          const { workflow } = await zernio('POST', '/workflows', { profileId: c.profileId, accountId: c.accountId, platform: 'instagram', ...cuerpo });
          id = workflow?.id;
          if (!id) throw new AutomatizacionError('Zernio no ha devuelto el flujo');
          hechas.push(id);
        }
        // Las ramas de un comentario arrancan solo con su botón: siempre activas. La principal, según la pausa.
        if (r.rama !== 'principal' || activar) await zernio('POST', `/workflows/${id}/activate`);
        else if (ya) await zernio('POST', `/workflows/${id}/pause`).catch(() => {});
        r.id = id;
      }
    } catch (e) {
      for (const id of hechas) await zernio('DELETE', `/workflows/${id}`).catch(() => {});
      throw e;
    }
    for (const p of previas) if (!ramas.some((r) => r.rama === p.rama)) await zernio('DELETE', `/workflows/${p.id}`).catch(() => {});
    return { ramas: ramas.map(({ rama, id, clave: k }) => ({ rama, id, clave: k })), comentario, cuenta: c };
  }

  async function crear(datos = {}, { pausada = false } = {}) {
    const cfg = normalizarConfig(datos);
    const d = cfg.disparador;
    const esperar = d.destino === 'siguiente' && empiezaConComentario(d.tipo);
    if (esperar && !graph()) throw new AutomatizacionError('Para «la siguiente publicación» JARVIS tiene que ver tu Instagram: conéctalo con Facebook en la pestaña Instagram');
    const estado = pausada ? 'pausada' : esperar ? 'esperando' : 'activa';
    const r = db.prepare('INSERT INTO automatizaciones (config, estado, desde, media_id, media_titulo) VALUES (?, ?, ?, ?, ?)')
      .run(JSON.stringify(cfg), estado, new Date().toISOString(), d.media_id || null, d.media_titulo || null);
    const id = Number(r.lastInsertRowid);
    let creadas = [];
    try {
      const s = await sincronizarRamas(cfg, [], { activar: estado === 'activa' });
      creadas = s.ramas;
      let zernioId = null;
      if (s.comentario) {
        const idsRamas = Object.fromEntries(s.ramas.map((x) => [x.rama, x.id]));
        const { automation } = await zernio('POST', '/comment-automations', { profileId: s.cuenta.profileId, accountId: s.cuenta.accountId, ...cuerpoAutomatizacion(cfg, { idsRamas, activa: estado === 'activa' }) });
        if (!automation?.id) throw new AutomatizacionError('Zernio no ha devuelto la automatización');
        zernioId = automation.id;
      }
      set(id, { zernio_id: zernioId, flujos: JSON.stringify(s.ramas), flujo_id: null, clave: null });
    } catch (e) {
      for (const x of creadas) await zernio('DELETE', `/workflows/${x.id}`).catch(() => {});
      q.borrar.run(id);
      throw e;
    }
    alCambiar();
    return ver(id);
  }

  async function editar(id, datos = {}) {
    const a = leer(id);
    const cfg = normalizarConfig(datos);
    const d = cfg.disparador;
    const comentario = empiezaConComentario(d.tipo);
    // Se mantiene a qué post está enganchada si sigue siendo «la siguiente» y ya salió
    const mismaSiguiente = a.config.disparador.destino === 'siguiente' && d.destino === 'siguiente' && a.config.disparador.tipo === d.tipo;
    const mediaId = !comentario ? null : d.destino === 'siguiente' ? (mismaSiguiente ? a.media_id : null) : d.media_id || null;
    const esperar = comentario && d.destino === 'siguiente' && !mediaId;
    const estado = a.estado === 'pausada' ? 'pausada' : esperar ? 'esperando' : 'activa';
    const s = await sincronizarRamas(cfg, a.ramas, { activar: estado === 'activa' });
    let zernioId = a.zernio_id;
    if (comentario) {
      const cuerpo = cuerpoAutomatizacion(cfg, { idsRamas: Object.fromEntries(s.ramas.map((x) => [x.rama, x.id])), activa: estado === 'activa', mediaId });
      if (zernioId) {
        // Sin post: que Zernio la deje para cualquier publicación (sin enganchar) hasta que salga la siguiente
        if (!cuerpo.platformPostId) Object.assign(cuerpo, { platformPostId: null, postId: null, postTitle: null });
        await zernio('PATCH', `/comment-automations/${zernioId}`, cuerpo);
      } else {
        const { automation } = await zernio('POST', '/comment-automations', { profileId: s.cuenta.profileId, accountId: s.cuenta.accountId, ...cuerpo });
        zernioId = automation?.id || null;
      }
    } else if (zernioId) {
      await zernio('DELETE', `/comment-automations/${zernioId}`).catch(() => {});
      zernioId = null;
    }
    set(a.id, { config: JSON.stringify(cfg), zernio_id: zernioId, flujos: JSON.stringify(s.ramas), flujo_id: null, clave: null, media_id: mediaId, media_titulo: mismaSiguiente ? a.media_titulo : d.media_titulo || null, estado, ...(esperar && !mismaSiguiente ? { desde: new Date().toISOString() } : {}) });
    alCambiar();
    return ver(a.id);
  }

  // Duplicar: la copia queda en pausa (dos automatizaciones activas en el mismo post chocarían); se edita y se reanuda
  async function duplicar(id) {
    const a = leer(id);
    return crear({ ...a.config, nombre: `${a.config.nombre} (copia)`.slice(0, 80) }, { pausada: true });
  }

  async function pausar(id, { activa } = {}) {
    const a = leer(id);
    const d = a.config.disparador;
    const esperando = empiezaConComentario(d.tipo) && d.destino === 'siguiente' && !a.media_id;
    const principal = a.ramas.find((r) => r.rama === 'principal');
    if (activa) {
      if (a.zernio_id && !esperando) await zernio('PATCH', `/comment-automations/${a.zernio_id}`, { isActive: true });
      for (const r of a.ramas) await zernio('POST', `/workflows/${r.id}/activate`).catch((e) => { if (r === principal) throw e; });
      set(a.id, { estado: esperando ? 'esperando' : 'activa' });
    } else {
      if (a.zernio_id) await zernio('PATCH', `/comment-automations/${a.zernio_id}`, { isActive: false });
      if (principal) await zernio('POST', `/workflows/${principal.id}/pause`);
      set(a.id, { estado: 'pausada' });
    }
    alCambiar();
    return ver(a.id);
  }

  async function borrar(id) {
    const a = leer(id);
    if (a.zernio_id) await zernio('DELETE', `/comment-automations/${a.zernio_id}`).catch((e) => { if (!/not.?found|404/i.test(e.message)) throw e; });
    for (const r of a.ramas) await zernio('DELETE', `/workflows/${r.id}`).catch(() => {});
    q.borrar.run(a.id);
    alCambiar();
    return { ok: true };
  }

  // ---------- «La siguiente publicación» ----------
  // Mira si ha salido un post (o una story) después de crear la automatización y la engancha a él
  let revisando = false;
  async function revisarSiguientes() {
    const pendientes = rows(q.esperando).filter((p) => p.zernio_id);
    if (revisando || !pendientes.length || !configurado()) return { enganchadas: 0 };
    const m = graph();
    if (!m) return { enganchadas: 0 };
    revisando = true;
    let enganchadas = 0;
    try {
      const recientes = {};
      for (const p of pendientes) p.cfg = aFormatoNuevo(JSON.parse(p.config));
      for (const tipo of new Set(pendientes.map((p) => p.cfg.disparador.tipo))) {
        recientes[tipo] = tipo === 'story'
          ? (await m.g.get(`${m.ig}/stories`, { fields: 'id,timestamp' })).data || []
          : (await m.g.get(`${m.ig}/media`, { fields: 'id,caption,timestamp', limit: 5 })).data || [];
      }
      for (const p of pendientes) {
        const tipo = p.cfg.disparador.tipo;
        // La más antigua de las que salieron después (si salieron dos, la primera)
        const nuevo = (recientes[tipo] || []).filter((x) => new Date(x.timestamp) > new Date(p.desde)).sort((x, y) => new Date(x.timestamp) - new Date(y.timestamp))[0];
        if (!nuevo) continue;
        const titulo = tipo === 'story' ? 'Story' : corto(nuevo.caption, 120) || 'Publicación';
        await zernio('PATCH', `/comment-automations/${p.zernio_id}`, { platformPostId: nuevo.id, postTitle: titulo, isActive: true });
        set(p.id, { estado: 'activa', media_id: nuevo.id, media_titulo: titulo });
        log(`«${p.cfg.nombre}» enganchada a ${tipo === 'story' ? 'la story' : 'la publicación'} ${nuevo.id}`);
        enganchadas++;
      }
    } catch (e) { log(`No se pudo revisar la siguiente publicación: ${e.message}`); }
    finally { revisando = false; }
    if (enganchadas) alCambiar();
    return { enganchadas };
  }
  let reloj = null;
  const iniciar = (cada = 2 * 60000) => { if (!reloj) { reloj = setInterval(() => revisarSiguientes(), cada); reloj.unref?.(); } };
  const parar = () => { clearInterval(reloj); reloj = null; };

  // ---------- Lectura ----------
  const fila = (r, z) => {
    const cfg = aFormatoNuevo(JSON.parse(r.config));
    return {
      id: r.id, nombre: cfg.nombre, disparador: cfg.disparador, flujo: cfg.flujo, estado: r.estado,
      media_id: r.media_id || cfg.disparador.media_id || null, media_titulo: r.media_titulo || cfg.disparador.media_titulo || null,
      bloques: cfg.flujo.nodos.filter((n) => n.tipo !== 'inicio' && n.tipo !== 'fin').length,
      creado: r.creado, zernio: z ? { activa: Boolean(z.isActive), stats: z.stats || {} } : null,
    };
  };
  async function listar() {
    const locales = rows(q.todas);
    let remotas = {};
    let error = null;
    if (configurado() && locales.length) {
      try {
        const c = await cuenta();
        const { automations = [] } = await zernio('GET', `/comment-automations?profileId=${encodeURIComponent(c.profileId)}`);
        remotas = Object.fromEntries(automations.map((a) => [a.id, a]));
        // Las que no empiezan por un comentario (palabra por privado): las cifras de su workflow
        for (const r of locales.filter((x) => !x.zernio_id)) {
          const p = flujosDe(r).find((x) => x.rama === 'principal');
          if (!p) continue;
          const { workflow } = await zernio('GET', `/workflows/${p.id}`).catch(() => ({}));
          if (workflow) remotas[`wf:${r.id}`] = { isActive: workflow.status === 'active', stats: { triggered: workflow.totalStarted || 0, completed: workflow.totalCompleted || 0 } };
        }
      } catch (e) { error = e.message; }
    }
    return { lista: locales.map((r) => fila(r, remotas[r.zernio_id] || remotas[`wf:${r.id}`])), error };
  }

  async function ver(id) {
    const r = row(q.una, Number(id));
    if (!r) throw new AutomatizacionError('Esa automatización no existe');
    return fila(r, null);
  }

  // Detalle: estadísticas, últimos que la activaron y las respuestas a las preguntas
  async function detalle(id) {
    const a = leer(id);
    let automation = null;
    let logs = [];
    if (a.zernio_id) ({ automation = null, logs = [] } = await zernio('GET', `/comment-automations/${a.zernio_id}`));
    const preguntas = Object.fromEntries(a.config.flujo.nodos.filter((n) => n.tipo === 'pregunta').map((n) => [`r_${n.id}`, n.datos.texto]));
    const respuestas = [];
    let iniciados = 0;
    for (const r of a.ramas) {
      const { executions = [] } = await zernio('GET', `/workflows/${r.id}/executions?limit=100`).catch(() => ({}));
      iniciados += executions.length;
      for (const x of executions) {
        const v = x.variables || {};
        const quien = v['contact.handle'] || v.contact?.handle || v['contact.name'] || v.contact?.name || null;
        for (const [k, pregunta] of Object.entries(preguntas)) {
          const valor = v[k];
          if (valor != null && valor !== '') respuestas.push({ quien, pregunta, respuesta: typeof valor === 'string' ? valor : valor?.text || String(valor), fecha: x.updatedAt || x.createdAt });
        }
      }
    }
    respuestas.sort((x, y) => String(y.fecha).localeCompare(String(x.fecha)));
    const base = fila(row(q.una, a.id), automation);
    if (!a.zernio_id) base.zernio = { activa: a.estado === 'activa', stats: { triggered: iniciados } };
    return {
      ...base,
      registros: logs.map((l) => ({ quien: l.commenterUsername || l.commenterName || null, comentario: l.commentText || null, estado: l.status, motivo: l.error || null, sigue: l.commenterIsFollower, clic: Boolean(l.clickedAt), fecha: l.createdAt })),
      respuestas,
    };
  }

  async function estado() {
    if (!configurado()) return { configurado: false, meta: Boolean(graph()) };
    try {
      const c = await cuenta();
      return { configurado: true, meta: Boolean(graph()), cuenta: c.username, reconectar: c.reconectar };
    } catch (e) { return { configurado: true, meta: Boolean(graph()), error: e.message }; }
  }

  return { configurado, estado, conectar, medios, crear, editar, duplicar, pausar, borrar, listar, detalle, revisarSiguientes, iniciar, parar };
}

// Para comprobar el tablero sin guardar (la interfaz enseña errores y avisos)
export { salidasDe };
