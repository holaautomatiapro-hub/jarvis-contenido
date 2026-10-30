// Automatizaciones de Instagram al estilo ManyChat, con Zernio (zernio.com): alguien comenta una palabra en una
// publicación (o responde a una story) y le llega un mensaje privado con un botón; al pulsarlo, el recurso y una
// pregunta cuya respuesta se guarda. Zernio tiene la app de Meta aprobada y hace los envíos; JARVIS guarda la
// configuración, la da de alta en Zernio y, para «la siguiente publicación», la engancha sola al post que salga.
//
// Por cada automatización de JARVIS hay en Zernio:
//   - una «comment automation» (palabras, respuesta pública, mensaje privado, «sígueme primero», pausa…)
//   - y, si lleva pregunta, un «workflow» que arranca al pulsar el botón: recurso → pregunta → guardar la respuesta.
import { randomBytes } from 'node:crypto';
import { row, rows } from './db.js';
import { createGraph } from './integrations/meta.js';
import { guardarEnv as guardarEnvArchivo } from './env-archivo.js';

export class AutomatizacionError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const BASE = 'https://zernio.com/api/v1';
const COINCIDENCIA = { palabra: 'word', contiene: 'contains', exacta: 'exact' };
const corto = (s, n) => String(s || '').trim().slice(0, n);
const lista = (v, n, largo) => (Array.isArray(v) ? v : String(v || '').split(/[,\n]/)).map((x) => corto(x, largo)).filter(Boolean).slice(0, n);
const esUrl = (u) => /^https:\/\/\S+$/i.test(String(u || '').trim());

// Da igual mayúsculas, minúsculas y tildes: «guía» también es GUÍA, Guía, guia, GUIA y Guia
const sinTildes = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
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

// Lo que escribe la persona en el formulario → configuración limpia (lo que se guarda en JARVIS)
export function normalizarConfig(c = {}) {
  const tipo = c.tipo === 'story' ? 'story' : 'post';
  const destino = ['publicacion', 'siguiente', 'cualquiera'].includes(c.destino) ? c.destino : 'publicacion';
  const cfg = {
    nombre: corto(c.nombre, 80),
    tipo,
    destino,
    media_id: destino === 'publicacion' ? corto(c.media_id, 64) : '',
    media_titulo: destino === 'publicacion' ? corto(c.media_titulo, 120) : '',
    media_miniatura: destino === 'publicacion' && esUrl(c.media_miniatura) ? String(c.media_miniatura).slice(0, 1000) : '',
    palabras: unicas(lista(c.palabras, 40, 40)).slice(0, 20),
    coincidencia: COINCIDENCIA[c.coincidencia] ? c.coincidencia : 'palabra',
    erratas: c.erratas !== false,
    respuestas: tipo === 'post' ? lista(c.respuestas, 6, 300) : [],
    mensaje: corto(c.mensaje, 640),
    variaciones: lista(c.variaciones, 5, 640),
    boton: corto(c.boton, 20) || 'Lo quiero',
    recurso: { texto: corto(c.recurso?.texto, 640), enlace: corto(c.recurso?.enlace, 1000), titulo: corto(c.recurso?.titulo, 20) || 'Ver recurso' },
    pregunta: { texto: corto(c.pregunta?.texto, 640), opciones: lista(c.pregunta?.opciones, 10, 20), gracias: corto(c.pregunta?.gracias, 640) },
    sigueme: Boolean(c.sigueme),
    seguir: {
      mensaje: corto(c.seguir?.mensaje, 640) || '¡Hola! Para enviártelo, primero sígueme y luego pulsa el botón 👇',
      boton: corto(c.seguir?.boton, 20) || 'Ya te sigo',
      noSigue: corto(c.seguir?.noSigue, 640) || 'Todavía no me sigues 😅 Sígueme y vuelve a pulsar el botón.',
    },
    repetir: c.repetir === 'cada' ? 'cada' : 'una',
    tambienDm: tipo === 'post' && Boolean(c.tambienDm),
  };
  if (!cfg.nombre) cfg.nombre = cfg.palabras[0] ? `Palabra ${cfg.palabras[0].toUpperCase()}` : tipo === 'story' ? 'Respuestas a stories' : 'Comentarios';
  if (destino === 'publicacion' && !cfg.media_id) throw new AutomatizacionError(tipo === 'story' ? 'Elige la story' : 'Elige la publicación');
  if (!cfg.mensaje) throw new AutomatizacionError('Escribe el mensaje privado que se envía');
  if (cfg.recurso.enlace && !esUrl(cfg.recurso.enlace)) throw new AutomatizacionError('El enlace del recurso debe empezar por https://');
  if (!cfg.recurso.enlace && !cfg.pregunta.texto && !cfg.recurso.texto) throw new AutomatizacionError('Pon el enlace del recurso o una pregunta (si no, el botón no lleva a nada)');
  if (cfg.tambienDm && !cfg.palabras.length) throw new AutomatizacionError('Para que también responda a mensajes directos pon al menos una palabra');
  return cfg;
}

// ¿Hace falta el flujo de después del botón? Solo si hay pregunta (sin pregunta, el botón abre el recurso)
export const llevaFlujo = (cfg) => Boolean(cfg.pregunta.texto);
const campoDe = (id) => `respuesta_jarvis_${id}`;

// El flujo de Zernio que arranca al pulsar el botón: recurso → pregunta → espera la respuesta y la guarda
export function grafoFlujo(cfg, { id, clave }) {
  const nodos = [{ id: 'inicio', type: 'trigger', config: { triggerType: 'inbound_message', keywords: [clave], matchType: 'exact' } }];
  const aristas = [];
  let ultimo = 'inicio';
  const unir = (a, b, handle) => aristas.push({ id: `${a}-${b}${handle ? `-${handle}` : ''}`, source: a, target: b, ...(handle ? { sourceHandle: handle } : {}) });
  const nodo = (n) => { nodos.push(n); unir(ultimo, n.id); ultimo = n.id; };
  if (cfg.recurso.texto || cfg.recurso.enlace) {
    nodo({ id: 'recurso', type: 'send_message', label: 'Recurso', config: {
      messageType: 'text',
      text: cfg.recurso.texto || '¡Aquí lo tienes! 👇',
      ...(cfg.recurso.enlace ? { buttons: [{ type: 'url', title: cfg.recurso.titulo, url: cfg.recurso.enlace }] } : {}),
    } });
  }
  nodo({ id: 'pregunta', type: 'send_message', label: 'Pregunta', config: {
    messageType: 'text', text: cfg.pregunta.texto,
    ...(cfg.pregunta.opciones.length ? { quickReplies: cfg.pregunta.opciones.map((o) => ({ title: o, payload: o })) } : {}),
  } });
  nodo({ id: 'espera', type: 'wait_for_reply', label: 'Espera la respuesta', config: { timeoutMinutes: 1440, saveAs: 'respuesta' } });
  nodos.push({ id: 'guardar', type: 'set_field', label: 'Guarda la respuesta', config: { field: campoDe(id), value: '{{respuesta}}' } });
  unir('espera', 'guardar', 'reply');
  nodos.push({ id: 'etiqueta', type: 'add_tag', config: { tag: `jarvis-${id}` } });
  unir('guardar', 'etiqueta');
  ultimo = 'etiqueta';
  if (cfg.pregunta.gracias) nodo({ id: 'gracias', type: 'send_message', label: 'Gracias', config: { messageType: 'text', text: cfg.pregunta.gracias } });
  nodo({ id: 'fin', type: 'end' });
  unir('espera', 'fin', 'timeout');
  return { nodes: nodos, edges: aristas, entryNodeId: 'inicio' };
}

// La automatización de comentarios de Zernio (sin cuenta ni perfil: se añaden al crearla)
export function cuerpoAutomatizacion(cfg, { flujoId = null, activa = true, mediaId = null } = {}) {
  const post = cfg.tipo === 'post';
  const boton = flujoId ? { type: 'postback', title: cfg.boton, payload: `zernio:workflow:${flujoId}` }
    : cfg.recurso.enlace ? { type: 'url', title: cfg.boton, url: cfg.recurso.enlace } : null;
  const id = mediaId || cfg.media_id || null;
  return {
    name: cfg.nombre,
    trigger: post ? 'comment' : 'story_reply',
    ...(id ? { platformPostId: id, postTitle: cfg.media_titulo || cfg.nombre } : {}),
    keywords: palabrasParaZernio(cfg.palabras),
    matchMode: COINCIDENCIA[cfg.coincidencia],
    ...(cfg.coincidencia === 'palabra' ? { typoTolerance: cfg.erratas } : {}),
    dmMessage: cfg.mensaje,
    dmMessageVariations: cfg.variaciones,
    buttons: boton ? [boton] : [],
    ...(post && cfg.respuestas.length ? { commentReply: cfg.respuestas[0], commentReplyVariations: cfg.respuestas.slice(1) } : {}),
    // «Sígueme primero»: Instagram solo dice si te sigue a quien ya te ha escrito; al resto se le manda el botón para
    // confirmarlo y, al pulsarlo, se comprueba de verdad
    audience: cfg.sigueme ? { followerStatus: 'follower', whenUnknown: 'verify' } : { followerStatus: 'any' },
    ...(cfg.sigueme ? { followGate: { message: cfg.seguir.mensaje, buttonLabel: cfg.seguir.boton, profileButtonLabel: 'Ver perfil', notFollowingMessage: cfg.seguir.noSigue } } : {}),
    repeatPolicy: cfg.repetir === 'cada' ? { mode: 'every_comment', cooldownHours: 24 } : { mode: 'once' },
    ...(post ? { alsoMatchInDms: cfg.tambienDm } : {}),
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
  const leer = (id) => {
    const r = row(q.una, Number(id));
    if (!r) throw new AutomatizacionError('Esa automatización no existe');
    return { ...r, config: JSON.parse(r.config) };
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
  async function darDeAlta(id, cfg, { activa, mediaId }) {
    const c = await cuenta();
    let flujoId = null;
    let claveFlujo = null;
    if (llevaFlujo(cfg)) {
      // Una palabra que nadie escribe: el flujo solo arranca con el botón
      claveFlujo = `jarvis-${id}-${randomBytes(6).toString('hex')}`;
      const { workflow } = await zernio('POST', '/workflows', { profileId: c.profileId, accountId: c.accountId, platform: 'instagram', name: `JARVIS · ${cfg.nombre}`, ...grafoFlujo(cfg, { id, clave: claveFlujo }) });
      flujoId = workflow?.id;
      if (!flujoId) throw new AutomatizacionError('Zernio no ha devuelto el flujo');
      await zernio('POST', `/workflows/${flujoId}/activate`);
    }
    try {
      const { automation } = await zernio('POST', '/comment-automations', { profileId: c.profileId, accountId: c.accountId, ...cuerpoAutomatizacion(cfg, { flujoId, activa, mediaId }) });
      if (!automation?.id) throw new AutomatizacionError('Zernio no ha devuelto la automatización');
      return { zernio_id: automation.id, flujo_id: flujoId, clave: claveFlujo };
    } catch (e) {
      if (flujoId) await zernio('DELETE', `/workflows/${flujoId}`).catch(() => {});
      throw e;
    }
  }

  async function crear(datos = {}) {
    const cfg = normalizarConfig(datos);
    const esperar = cfg.destino === 'siguiente';
    if (esperar && !graph()) throw new AutomatizacionError('Para «la siguiente publicación» JARVIS tiene que ver tu Instagram: conéctalo con Facebook en la pestaña Instagram');
    const r = db.prepare('INSERT INTO automatizaciones (config, estado, desde, media_id, media_titulo) VALUES (?, ?, ?, ?, ?)')
      .run(JSON.stringify(cfg), esperar ? 'esperando' : 'activa', new Date().toISOString(), cfg.media_id || null, cfg.media_titulo || null);
    const id = Number(r.lastInsertRowid);
    try {
      set(id, await darDeAlta(id, cfg, { activa: !esperar }));
    } catch (e) { q.borrar.run(id); throw e; }
    alCambiar();
    return ver(id);
  }

  async function editar(id, datos = {}) {
    const a = leer(id);
    const cfg = normalizarConfig(datos);
    const c = await cuenta();
    // Se mantiene a qué post está enganchada si sigue siendo «la siguiente» y ya salió
    const mediaId = cfg.destino === 'siguiente' ? a.media_id : cfg.media_id || null;
    const esperar = cfg.destino === 'siguiente' && !a.media_id;
    const activa = a.estado !== 'pausada' && !esperar;
    let flujoId = a.flujo_id;
    let claveFlujo = a.clave;
    if (llevaFlujo(cfg)) {
      if (flujoId) await zernio('PATCH', `/workflows/${flujoId}`, { name: `JARVIS · ${cfg.nombre}`, ...grafoFlujo(cfg, { id: a.id, clave: claveFlujo }) });
      else {
        claveFlujo = `jarvis-${a.id}-${randomBytes(6).toString('hex')}`;
        const { workflow } = await zernio('POST', '/workflows', { profileId: c.profileId, accountId: c.accountId, platform: 'instagram', name: `JARVIS · ${cfg.nombre}`, ...grafoFlujo(cfg, { id: a.id, clave: claveFlujo }) });
        flujoId = workflow?.id;
        await zernio('POST', `/workflows/${flujoId}/activate`);
      }
    }
    const cuerpo = cuerpoAutomatizacion(cfg, { flujoId: llevaFlujo(cfg) ? flujoId : null, activa, mediaId });
    // Sin post: que Zernio la deje para cualquier publicación (sin enganchar) hasta que salga la siguiente
    if (!cuerpo.platformPostId) Object.assign(cuerpo, { platformPostId: null, postId: null, postTitle: null });
    await zernio('PATCH', `/comment-automations/${a.zernio_id}`, cuerpo);
    if (!llevaFlujo(cfg) && a.flujo_id) { await zernio('DELETE', `/workflows/${a.flujo_id}`).catch(() => {}); flujoId = null; claveFlujo = null; }
    set(a.id, { config: JSON.stringify(cfg), flujo_id: llevaFlujo(cfg) ? flujoId : null, clave: llevaFlujo(cfg) ? claveFlujo : null, media_id: mediaId, media_titulo: cfg.destino === 'siguiente' ? a.media_titulo : cfg.media_titulo || null, estado: a.estado === 'pausada' ? 'pausada' : esperar ? 'esperando' : 'activa' });
    alCambiar();
    return ver(a.id);
  }

  async function pausar(id, { activa } = {}) {
    const a = leer(id);
    const esperando = a.config.destino === 'siguiente' && !a.media_id;
    if (activa) {
      if (!esperando) await zernio('PATCH', `/comment-automations/${a.zernio_id}`, { isActive: true });
      if (a.flujo_id) await zernio('POST', `/workflows/${a.flujo_id}/activate`).catch(() => {});
      set(a.id, { estado: esperando ? 'esperando' : 'activa' });
    } else {
      await zernio('PATCH', `/comment-automations/${a.zernio_id}`, { isActive: false });
      set(a.id, { estado: 'pausada' });
    }
    alCambiar();
    return ver(a.id);
  }

  async function borrar(id) {
    const a = leer(id);
    if (a.zernio_id) await zernio('DELETE', `/comment-automations/${a.zernio_id}`).catch((e) => { if (!/not.?found|404/i.test(e.message)) throw e; });
    if (a.flujo_id) await zernio('DELETE', `/workflows/${a.flujo_id}`).catch(() => {});
    q.borrar.run(a.id);
    alCambiar();
    return { ok: true };
  }

  // ---------- «La siguiente publicación» ----------
  // Mira si ha salido un post (o una story) después de crear la automatización y la engancha a él
  let revisando = false;
  async function revisarSiguientes() {
    const pendientes = rows(q.esperando);
    if (revisando || !pendientes.length || !configurado()) return { enganchadas: 0 };
    const m = graph();
    if (!m) return { enganchadas: 0 };
    revisando = true;
    let enganchadas = 0;
    try {
      const recientes = {};
      for (const tipo of new Set(pendientes.map((p) => JSON.parse(p.config).tipo))) {
        recientes[tipo] = tipo === 'story'
          ? (await m.g.get(`${m.ig}/stories`, { fields: 'id,timestamp' })).data || []
          : (await m.g.get(`${m.ig}/media`, { fields: 'id,caption,timestamp', limit: 5 })).data || [];
      }
      for (const p of pendientes) {
        const cfg = JSON.parse(p.config);
        // La más antigua de las que salieron después (si salieron dos, la primera)
        const nuevo = (recientes[cfg.tipo] || []).filter((x) => new Date(x.timestamp) > new Date(p.desde)).sort((x, y) => new Date(x.timestamp) - new Date(y.timestamp))[0];
        if (!nuevo) continue;
        const titulo = cfg.tipo === 'story' ? 'Story' : corto(nuevo.caption, 120) || 'Publicación';
        await zernio('PATCH', `/comment-automations/${p.zernio_id}`, { platformPostId: nuevo.id, postTitle: titulo, isActive: true });
        set(p.id, { estado: 'activa', media_id: nuevo.id, media_titulo: titulo });
        log(`«${cfg.nombre}» enganchada a ${cfg.tipo === 'story' ? 'la story' : 'la publicación'} ${nuevo.id}`);
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
    const cfg = JSON.parse(r.config);
    return {
      id: r.id, ...cfg, estado: r.estado, media_id: r.media_id || cfg.media_id || null, media_titulo: r.media_titulo || cfg.media_titulo || null,
      creado: r.creado, conFlujo: Boolean(r.flujo_id), zernio: z ? { activa: Boolean(z.isActive), stats: z.stats || {} } : null,
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
      } catch (e) { error = e.message; }
    }
    return { lista: locales.map((r) => fila(r, remotas[r.zernio_id])), error };
  }

  async function ver(id) {
    const r = row(q.una, Number(id));
    if (!r) throw new AutomatizacionError('Esa automatización no existe');
    return fila(r, null);
  }

  // Detalle: estadísticas, últimos comentarios que la activaron y las respuestas a la pregunta
  async function detalle(id) {
    const r = row(q.una, Number(id));
    if (!r) throw new AutomatizacionError('Esa automatización no existe');
    const { automation, logs = [] } = await zernio('GET', `/comment-automations/${r.zernio_id}`);
    let respuestas = [];
    if (r.flujo_id) {
      const { executions = [] } = await zernio('GET', `/workflows/${r.flujo_id}/executions?limit=100`).catch(() => ({}));
      respuestas = executions.map((x) => {
        const v = x.variables || {};
        const quien = v['contact.handle'] || v.contact?.handle || v['contact.name'] || v.contact?.name || null;
        return { quien, respuesta: typeof v.respuesta === 'string' ? v.respuesta : v.respuesta?.text || null, estado: x.status, fecha: x.updatedAt || x.createdAt };
      }).filter((x) => x.respuesta || x.estado === 'waiting');
    }
    return {
      ...fila(r, automation),
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

  return { configurado, estado, conectar, medios, crear, editar, pausar, borrar, listar, detalle, revisarSiguientes, iniciar, parar };
}
