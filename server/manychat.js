// «Manychat» de JARVIS: bandeja de entrada, contactos, plantillas de mensajes y bloqueos, sobre Zernio (la misma
// cuenta que las automatizaciones). Las conversaciones y los contactos viven en Zernio; aquí solo se guardan las
// plantillas, los bloqueos (por usuario de Instagram) y las pausas temporales.
//
// Bloquear o pausar a alguien le pone una etiqueta en Zernio (jarvis-bloqueado / jarvis-pausado) que todos los flujos
// miran al empezar; el bloqueo además marca el contacto como bloqueado en Zernio.
import { row, rows } from './db.js';
import { ETIQUETA_BLOQUEADO, ETIQUETA_PAUSADO } from './automatizaciones.js';

export class ManychatError extends Error {
  constructor(m) { super(m); this.publico = true; }
}

const corto = (s, n) => String(s ?? '').trim().slice(0, n);
const SISTEMA = new Set([ETIQUETA_BLOQUEADO, ETIQUETA_PAUSADO]);
export const etiquetaVisible = (t) => !SISTEMA.has(t) && !String(t).startsWith('jarvis-auto-');
export const normalizarUsuario = (u) => String(u || '').trim().replace(/^@+/, '').replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/[/?#].*$/, '').replace(/\s*\(\d+\)$/, '').toLowerCase();
// Zernio da el contacto como «usuario (id)» o «Nombre Visible (id)»: solo vale como usuario si lo parece
export const usuarioDeZernio = (d) => { const u = normalizarUsuario(d); return /^[a-z0-9._]{1,30}$/.test(u) ? u : null; };
const usuarioValido = (u) => /^[a-z0-9._]{1,30}$/.test(u);

// Una fila del CSV (comillas solo cuando hacen falta; ; y saltos de línea dentro de un campo, entre comillas)
const celda = (v) => {
  const t = v == null ? '' : Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return /[",;\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
export function aCsv(columnas, filas) {
  // BOM para que Excel abra bien las tildes; separador «;» (Excel en español)
  return `﻿${[columnas.map((c) => celda(c.nombre)).join(';'), ...filas.map((f) => columnas.map((c) => celda(c.valor(f))).join(';'))].join('\r\n')}\r\n`;
}

// Columnas predeterminadas del pipeline de ventas. «criterio» es lo que lee la IA para saber cuándo mover a alguien.
export const FASES_BASE = [
  { id: 'iniciada', nombre: 'Iniciada', criterio: 'Ha entrado por una automatización o te ha escrito, pero aún no hay una conversación de verdad (solo la palabra clave, el recurso o un saludo).' },
  { id: 'conexion', nombre: 'Conexión', criterio: 'Responde y hay conversación: se rompe el hielo, da las gracias por el recurso, comenta algo personal o general.' },
  { id: 'descubrimiento', nombre: 'Descubrimiento', criterio: 'Cuenta a qué se dedica, cómo es su negocio o su situación, qué problema tiene o qué quiere conseguir.' },
  { id: 'cualificacion', nombre: 'Cualificación', criterio: 'Se comprueba si encaja: tiene el problema de verdad, urgencia, capacidad de invertir o decide él/ella.' },
  { id: 'propuesta', nombre: 'Propuesta de llamada', criterio: 'Se le ha propuesto una llamada o reunión y aún no ha contestado si sí o no.' },
  { id: 'pendiente_agendar', nombre: 'Pendiente de agendar', criterio: 'Ha dicho que sí a la llamada pero todavía no ha reservado día y hora.' },
  { id: 'agendado', nombre: 'Agendado', criterio: 'Ha reservado o confirmado un día y una hora para la llamada.' },
  { id: 'ganado', nombre: 'Ganado', criterio: 'Ha comprado, pagado o confirmado que entra.' },
  { id: 'perdido', nombre: 'Perdido', criterio: 'Dice que no le interesa, que no puede, que no encaja o pide que no se le escriba más.' },
];
const FINALES = new Set(['ganado', 'perdido']);

// Saca el primer JSON (lista) de la respuesta de la IA
export function leerJsonLista(texto) {
  const t = String(texto || '');
  const i = t.indexOf('[');
  const j = t.lastIndexOf(']');
  if (i < 0 || j < i) return [];
  try { const v = JSON.parse(t.slice(i, j + 1)); return Array.isArray(v) ? v : []; } catch { return []; }
}

export function createManychat({ db, auto, ia = null, alCambiar = () => {}, log = () => {}, ahora = () => Date.now() }) {
  db.exec(`CREATE TABLE IF NOT EXISTS mc_plantillas (
    id INTEGER PRIMARY KEY,
    nombre TEXT NOT NULL,
    carpeta TEXT,
    texto TEXT NOT NULL,
    botones TEXT NOT NULL DEFAULT '[]',
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime')),
    actualizado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS mc_bloqueos (
    id INTEGER PRIMARY KEY,
    usuario TEXT NOT NULL UNIQUE,
    motivo TEXT,
    contacto_id TEXT,
    creado TEXT NOT NULL DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS mc_pausas (
    contacto_id TEXT PRIMARY KEY,
    hasta INTEGER
  );
  CREATE TABLE IF NOT EXISTS mc_pedidos (
    clave TEXT NOT NULL,
    automatizacion_id INTEGER NOT NULL,
    nombre TEXT,
    usuario TEXT,
    participante TEXT,
    contacto TEXT,
    primera TEXT NOT NULL,
    ultima TEXT NOT NULL,
    PRIMARY KEY (clave, automatizacion_id)
  );
  CREATE TABLE IF NOT EXISTS mc_usuarios (
    participante TEXT PRIMARY KEY,
    usuario TEXT NOT NULL
  );
  DROP TABLE IF EXISTS mc_solicitudes;
  CREATE TABLE IF NOT EXISTS mc_cerradas (
    conversacion_id TEXT PRIMARY KEY,
    cerrada TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mc_fases (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    criterio TEXT,
    orden INTEGER NOT NULL,
    base INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS mc_etapas (
    contacto_id TEXT PRIMARY KEY,
    fase TEXT NOT NULL,
    por TEXT NOT NULL DEFAULT 'manual',
    motivo TEXT,
    movido TEXT NOT NULL,
    analizado TEXT
  );
  CREATE TABLE IF NOT EXISTS mc_ajustes (
    clave TEXT PRIMARY KEY,
    valor TEXT
  );`);
  if (!row(db.prepare('SELECT COUNT(*) AS n FROM mc_fases')).n) {
    const ins = db.prepare('INSERT INTO mc_fases (id, nombre, criterio, orden, base) VALUES (?, ?, ?, ?, 1)');
    FASES_BASE.forEach((f, i) => ins.run(f.id, f.nombre, f.criterio, i));
  }
  const ajuste = (k, def = null) => row(db.prepare('SELECT valor FROM mc_ajustes WHERE clave = ?'), k)?.valor ?? def;
  const ponerAjuste = (k, v) => db.prepare('INSERT INTO mc_ajustes (clave, valor) VALUES (?, ?) ON CONFLICT (clave) DO UPDATE SET valor = excluded.valor').run(k, v == null ? null : String(v));
  const z = (...a) => auto.zernio(...a);
  const configurado = () => auto.configurado();

  // ---------- Contactos (se leen todos de Zernio y se guardan un minuto) ----------
  let cache = null;
  async function todosLosContactos({ forzar = false } = {}) {
    if (!forzar && cache && ahora() - cache.en < 60000) return cache.lista;
    const c = await auto.cuenta();
    const lista = [];
    for (let skip = 0; skip < 20000; skip += 100) {
      const r = await z('GET', `/contacts?profileId=${encodeURIComponent(c.profileId)}&limit=100&skip=${skip}`);
      lista.push(...(r.contacts || []));
      if (!r.pagination?.hasMore || !(r.contacts || []).length) break;
    }
    cache = { lista, en: ahora() };
    return lista;
  }
  const olvidar = () => { cache = null; };
  const pausas = () => Object.fromEntries(rows(db.prepare('SELECT * FROM mc_pausas')).map((p) => [p.contacto_id, p.hasta]));
  // Usuario de Instagram de cada contacto: el que viene en los comentarios (por su id de Instagram) o, si no, el de Zernio
  const usuariosConocidos = () => Object.fromEntries(rows(db.prepare('SELECT * FROM mc_usuarios')).map((u) => [u.participante, u.usuario]));
  const contacto = (c, p = pausas(), u = usuariosConocidos()) => ({
    id: c.id, nombre: c.name || null, usuario: u[c.platformIdentifier] || usuarioDeZernio(c.displayIdentifier), foto: c.avatarUrl || null, canal: c.platform || null,
    participante: c.platformIdentifier || null,
    etiquetas: (c.tags || []).filter(etiquetaVisible), bloqueado: Boolean(c.isBlocked) || (c.tags || []).includes(ETIQUETA_BLOQUEADO),
    pausado: (c.tags || []).includes(ETIQUETA_PAUSADO), pausaHasta: p[c.id] || null,
    automatizaciones: (c.tags || []).filter((t) => t.startsWith('jarvis-auto-')).map((t) => Number(t.slice('jarvis-auto-'.length))),
    suscrito: c.isSubscribed !== false, campos: c.customFields || {}, notas: c.notes || '',
    recibidos: c.messagesReceivedCount || 0, enviados: c.messagesSentCount || 0,
    ultimoRecibido: c.lastMessageReceivedAt || null, ultimoEnviado: c.lastMessageSentAt || null, creado: c.createdAt || null,
  });

  // ---------- Recursos pedidos: quién pidió qué y cuándo (se va guardando para no perderlo) ----------
  let ultimaSync = 0;
  async function sincronizarSolicitudes({ forzar = false } = {}) {
    if (!configurado() || (!forzar && ahora() - ultimaSync < 10 * 60000)) return;
    ultimaSync = ahora();
    const guardar = db.prepare(`INSERT INTO mc_pedidos (clave, automatizacion_id, nombre, usuario, participante, contacto, primera, ultima) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (clave, automatizacion_id) DO UPDATE SET nombre = excluded.nombre,
        usuario = COALESCE(excluded.usuario, usuario), participante = COALESCE(excluded.participante, participante), contacto = COALESCE(excluded.contacto, contacto),
        primera = MIN(primera, excluded.primera), ultima = MAX(ultima, excluded.ultima)`);
    const conocido = db.prepare('INSERT INTO mc_usuarios (participante, usuario) VALUES (?, ?) ON CONFLICT (participante) DO UPDATE SET usuario = excluded.usuario');
    for (const x of await auto.solicitudes()) {
      const f = new Date(x.fecha);
      if (Number.isNaN(f.getTime())) continue;
      const usuario = x.usuario && /^[a-z0-9._]{1,30}$/.test(x.usuario) ? x.usuario : null;
      const clave = x.participante ? `p:${x.participante}` : x.contacto ? `c:${x.contacto}` : usuario ? `u:${usuario}` : null;
      if (!clave) continue;
      if (x.participante && usuario) conocido.run(x.participante, usuario);
      guardar.run(clave, x.automatizacion, x.nombre || null, usuario, x.participante || null, x.contacto || null, f.toISOString(), f.toISOString());
    }
  }
  const sincronizarDeFondo = () => sincronizarSolicitudes().catch((e) => log(`No se pudieron leer los recursos pedidos: ${e.message}`));
  function nombresAutomatizaciones() {
    try {
      return Object.fromEntries(rows(db.prepare('SELECT id, config FROM automatizaciones')).map((r) => {
        try { return [r.id, JSON.parse(r.config).nombre || null]; } catch { return [r.id, null]; }
      }));
    } catch { return {}; }
  }
  // Lo que ha pedido cada persona, del primero al último (las que solo conocemos por la etiqueta, sin fecha, al final)
  function conRecursos(lista) {
    const por = { p: {}, c: {}, u: {} };
    for (const s of rows(db.prepare('SELECT * FROM mc_pedidos ORDER BY primera'))) {
      if (s.participante) (por.p[s.participante] ||= []).push(s);
      if (s.contacto) (por.c[s.contacto] ||= []).push(s);
      if (s.usuario) (por.u[s.usuario] ||= []).push(s);
    }
    const nombres = nombresAutomatizaciones();
    return lista.map((c) => {
      const pedidos = [];
      // Por su id de Instagram, por su ficha de Zernio o por su usuario; cada automatización una vez, con su primera fecha
      for (const s of [...(por.p[c.participante] || []), ...(por.c[c.id] || []), ...(c.usuario ? por.u[c.usuario] || [] : [])]) {
        const ya = pedidos.find((x) => x.id === s.automatizacion_id);
        if (ya) { if (s.primera < ya.fecha) ya.fecha = s.primera; continue; }
        pedidos.push({ id: s.automatizacion_id, nombre: nombres[s.automatizacion_id] || s.nombre || `Automatización ${s.automatizacion_id}`, fecha: s.primera });
      }
      pedidos.sort((a, b) => a.fecha.localeCompare(b.fecha));
      for (const id of c.automatizaciones) if (!pedidos.some((x) => x.id === id)) pedidos.push({ id, nombre: nombres[id] || `Automatización ${id}`, fecha: null });
      return { ...c, recursos: pedidos, recursoEntrada: pedidos[0] || null };
    });
  }

  // Filtros de la lista de contactos (y del CSV)
  function filtrar(lista, { q = '', etiqueta = '', estado = '', desde = '', hasta = '', automatizacion = '' } = {}) {
    const b = String(q).trim().toLowerCase();
    return lista.filter((c) => (!b || `${c.nombre || ''} ${c.usuario || ''}`.toLowerCase().includes(b))
      && (!etiqueta || c.etiquetas.includes(etiqueta))
      && (!automatizacion || (c.recursos ? c.recursos.some((x) => x.id === Number(automatizacion)) : c.automatizaciones.includes(Number(automatizacion))))
      && (!estado || (estado === 'bloqueado' ? c.bloqueado : estado === 'pausado' ? c.pausado : estado === 'suscrito' ? c.suscrito && !c.bloqueado : true))
      && (!desde || String(c.creado || '').slice(0, 10) >= desde)
      && (!hasta || String(c.creado || '').slice(0, 10) <= hasta));
  }

  async function contactos(filtros = {}) {
    sincronizarDeFondo();
    const p = pausas();
    const u = usuariosConocidos();
    const todos = conRecursos((await todosLosContactos({ forzar: filtros.forzar === '1' })).map((c) => contacto(c, p, u)));
    const lista = filtrar(todos, filtros)
      .sort((a, b) => String(b.ultimoRecibido || b.creado || '').localeCompare(String(a.ultimoRecibido || a.creado || '')));
    const etiquetas = {};
    for (const c of todos) for (const t of c.etiquetas) etiquetas[t] = (etiquetas[t] || 0) + 1;
    return { total: lista.length, lista: lista.slice(0, Number(filtros.limite) || 500), etiquetas: Object.entries(etiquetas).sort((a, b) => b[1] - a[1]).map(([nombre, n]) => ({ nombre, n })) };
  }

  // Fechas del CSV a la española y en hora de España: 14/11/2026 18:30
  const fecha = (f) => (f ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(f)).replace(',', '') : '');
  const ultimoMensaje = (c) => [c.ultimoRecibido, c.ultimoEnviado].filter(Boolean).sort().pop() || null;

  async function csv(filtros = {}) {
    try { await sincronizarSolicitudes({ forzar: true }); } catch (e) { log(`No se pudieron leer los recursos pedidos: ${e.message}`); }
    const p = pausas();
    const u = usuariosConocidos();
    const lista = filtrar(conRecursos((await todosLosContactos({ forzar: true })).map((c) => contacto(c, p, u))), filtros);
    const columnas = [
      // Sin usuario conocido (Zernio solo da su nombre visible), se pone ese nombre para no dejar la fila sin nadie
      { nombre: 'Usuario', valor: (c) => (c.usuario ? `@${c.usuario}` : c.nombre || '') },
      { nombre: 'Perfil de Instagram', valor: (c) => (c.usuario && c.canal !== 'facebook' && c.canal !== 'whatsapp' ? `https://www.instagram.com/${c.usuario}/` : '') },
      { nombre: 'Fecha de entrada', valor: (c) => fecha(c.recursoEntrada?.fecha || (c.recursoEntrada ? c.creado : null)) },
      { nombre: 'Último mensaje', valor: (c) => fecha(ultimoMensaje(c)) },
      { nombre: 'Recursos pedidos', valor: (c) => c.recursos.length },
      { nombre: 'Qué recursos', valor: (c) => c.recursos.map((x) => x.nombre).join(' · ') },
    ];
    return { nombre: `contactos-${new Date(ahora()).toISOString().slice(0, 10)}.csv`, contenido: aCsv(columnas, lista), total: lista.length };
  }

  async function fichaContacto(id) {
    const { contact, channels = [] } = await z('GET', `/contacts/${encodeURIComponent(id)}`);
    if (!contact) throw new ManychatError('Ese contacto no existe');
    const [c] = conRecursos([contacto({ ...contact, platform: channels[0]?.platform, platformIdentifier: channels[0]?.platformIdentifier, displayIdentifier: channels[0]?.displayIdentifier })]);
    const canal = channels.find((x) => x.conversationId) || null;
    const mensajes = canal ? await mensajesDe(canal.conversationId, canal.accountId).catch(() => []) : [];
    return { ...c, etapa: etapaDe(c.id), canales: channels.map((x) => ({ canal: x.platform, usuario: x.displayIdentifier, conversacion: x.conversationId, cuenta: x.accountId, activo: x.lastActiveAt })), conversacion: canal ? { id: canal.conversationId, cuenta: canal.accountId } : null, mensajes };
  }

  async function ponerEtiquetas(id, etiquetas = []) {
    const { contact } = await z('GET', `/contacts/${encodeURIComponent(id)}`);
    const propias = (contact?.tags || []).filter((t) => !etiquetaVisible(t));
    const nuevas = [...new Set((Array.isArray(etiquetas) ? etiquetas : []).map((t) => corto(t, 40)).filter((t) => t && etiquetaVisible(t)))];
    await z('PATCH', `/contacts/${encodeURIComponent(id)}`, { tags: [...propias, ...nuevas] });
    olvidar();
    return { etiquetas: nuevas };
  }
  async function cambiarEtiquetaSistema(id, etiqueta, poner, extra = {}) {
    const { contact } = await z('GET', `/contacts/${encodeURIComponent(id)}`);
    const tags = (contact?.tags || []).filter((t) => t !== etiqueta);
    await z('PATCH', `/contacts/${encodeURIComponent(id)}`, { tags: poner ? [...tags, etiqueta] : tags, ...extra });
    olvidar();
  }

  // Pausar las automatizaciones de una persona (minutos; null = hasta que se reanude a mano)
  async function pausar(id, { minutos = null, reanudar = false } = {}) {
    if (reanudar) {
      await cambiarEtiquetaSistema(id, ETIQUETA_PAUSADO, false);
      db.prepare('DELETE FROM mc_pausas WHERE contacto_id = ?').run(String(id));
      return { pausado: false };
    }
    await cambiarEtiquetaSistema(id, ETIQUETA_PAUSADO, true);
    const hasta = Number(minutos) > 0 ? ahora() + Number(minutos) * 60000 : null;
    db.prepare('INSERT INTO mc_pausas (contacto_id, hasta) VALUES (?, ?) ON CONFLICT(contacto_id) DO UPDATE SET hasta = excluded.hasta').run(String(id), hasta);
    return { pausado: true, hasta };
  }

  // ---------- Bandeja ----------
  // Cerrar un chat: se archiva en Zernio y además se apunta aquí, así se quita de «Abiertos» aunque Zernio tarde o no lo
  // archive. Si la persona vuelve a escribir después de cerrarlo, se reabre solo (como en ManyChat).
  const cerradas = () => Object.fromEntries(rows(db.prepare('SELECT * FROM mc_cerradas')).map((x) => [x.conversacion_id, x.cerrada]));
  const sigueCerrada = (x, cerr) => Boolean(cerr[x.id]) && !(x.updatedTime && x.updatedTime > cerr[x.id]);

  async function conversaciones({ estado = 'active', noLeidos = '', etiqueta = '', q = '', canal = '' } = {}) {
    const c = await auto.cuenta();
    const pedir = (st) => z('GET', `/inbox/conversations?profileId=${encodeURIComponent(c.profileId)}&limit=100&sortOrder=desc&status=${st}${canal ? `&platform=${encodeURIComponent(canal)}` : ''}`);
    const r = await pedir('active');
    const cerr = cerradas();
    // Las que volvieron a escribir tras cerrarlas: se reabren
    for (const x of r.data || []) if (cerr[x.id] && !sigueCerrada(x, cerr)) { db.prepare('DELETE FROM mc_cerradas WHERE conversacion_id = ?').run(x.id); delete cerr[x.id]; }
    let datos;
    if (estado === 'archived') {
      const a = await pedir('archived').catch(() => ({ data: [] }));
      const vistos = new Set();
      datos = [...(a.data || []).map((x) => ({ ...x, status: 'archived' })), ...(r.data || []).filter((x) => sigueCerrada(x, cerr)).map((x) => ({ ...x, status: 'archived' }))]
        .filter((x) => !vistos.has(x.id) && vistos.add(x.id))
        .sort((x, y) => String(y.updatedTime || '').localeCompare(String(x.updatedTime || '')));
    } else datos = (r.data || []).filter((x) => !sigueCerrada(x, cerr));
    const p = pausas();
    const porParticipante = {};
    const u = usuariosConocidos();
    try { for (const x of await todosLosContactos()) if (x.platformIdentifier) porParticipante[x.platformIdentifier] = contacto(x, p, u); } catch { /* sin contactos: la bandeja sigue */ }
    const b = String(q).trim().toLowerCase();
    const lista = datos.map((x) => {
      const ct = porParticipante[x.participantId] || null;
      return {
        id: x.id, cuenta: x.accountId, canal: x.platform, nombre: x.participantName || ct?.nombre || ct?.usuario || 'Sin nombre', usuario: ct?.usuario || null,
        foto: x.participantPicture || ct?.foto || null, ultimo: x.lastMessage || '', fecha: x.updatedTime || null, noLeidos: x.unreadCount || 0,
        estado: x.status || 'active', sigue: x.instagramProfile?.isFollower ?? null, seguidores: x.instagramProfile?.followerCount ?? null,
        enlace: x.url || null, contacto: ct ? { id: ct.id, etiquetas: ct.etiquetas, bloqueado: ct.bloqueado, pausado: ct.pausado, pausaHasta: ct.pausaHasta } : null,
      };
    }).filter((x) => (!noLeidos || x.noLeidos > 0) && (!etiqueta || x.contacto?.etiquetas.includes(etiqueta)) && (!b || `${x.nombre} ${x.usuario || ''} ${x.ultimo}`.toLowerCase().includes(b)));
    return { lista, hayMas: Boolean(r.pagination?.hasMore) };
  }

  async function mensajesDe(conversacion, cuenta) {
    const r = await z('GET', `/inbox/conversations/${encodeURIComponent(conversacion)}/messages?accountId=${encodeURIComponent(cuenta)}&limit=100&sortOrder=asc`);
    return (r.messages || []).map((m) => ({
      id: m.id, texto: m.message || '', de: m.direction === 'outgoing' ? 'yo' : 'suyo', fecha: m.createdAt, borrado: Boolean(m.isDeleted),
      adjuntos: (m.attachments || []).map((a) => ({ tipo: a.originalType || a.type, url: a.refreshUrl || a.url || null, vista: a.previewUrl || null })),
      historia: m.storyReply ? { url: m.storyReply.storyUrl || null } : null, mencion: Boolean(m.isStoryMention),
    }));
  }

  async function verConversacion(id, cuenta) {
    if (!cuenta) throw new ManychatError('Falta la cuenta de la conversación');
    const mensajes = await mensajesDe(id, cuenta);
    // Lo que queda de ventana: 24 h tras su último mensaje (7 días respondiendo tú a mano)
    const ultimoSuyo = [...mensajes].reverse().find((m) => m.de === 'suyo')?.fecha || null;
    return { mensajes, ultimoSuyo };
  }

  async function enviar(id, { cuenta, texto, botones = [] } = {}) {
    if (!cuenta) throw new ManychatError('Falta la cuenta de la conversación');
    const msg = corto(texto, 1000);
    if (!msg) throw new ManychatError('Escribe el mensaje');
    const bs = (Array.isArray(botones) ? botones : []).slice(0, 3).filter((b) => b?.titulo && /^https:\/\//i.test(b.url || '')).map((b) => ({ type: 'url', title: corto(b.titulo, 20), url: b.url }));
    if (bs.length && msg.length > 640) throw new ManychatError('Con botones, el mensaje va hasta 640 caracteres');
    const cuerpo = { accountId: cuenta, message: msg, ...(bs.length ? { buttons: bs } : {}) };
    try {
      await z('POST', `/inbox/conversations/${encodeURIComponent(id)}/messages`, cuerpo);
      return { ok: true, etiqueta: null };
    } catch (e) {
      // Fuera de las 24 h: como lo escribe una persona, Meta deja contestar hasta 7 días con HUMAN_AGENT
      if (!/24|window|outside|allowed|policy|2018278/i.test(e.message)) throw e;
      try {
        await z('POST', `/inbox/conversations/${encodeURIComponent(id)}/messages`, { ...cuerpo, messageTag: 'HUMAN_AGENT', messagingType: 'MESSAGE_TAG' });
        return { ok: true, etiqueta: 'HUMAN_AGENT' };
      } catch (e2) {
        throw new ManychatError(`No se ha podido enviar: han pasado más de 7 días desde su último mensaje o Meta no lo permite (${e2.message})`);
      }
    }
  }
  const leido = (id, cuenta) => z('POST', `/inbox/conversations/${encodeURIComponent(id)}/read`, { accountId: cuenta }).then(() => ({ ok: true }));
  async function archivar(id, cuenta, estado) {
    if (!id) throw new ManychatError('Falta la conversación');
    const cerrar = estado === 'archived';
    if (cerrar) db.prepare('INSERT INTO mc_cerradas (conversacion_id, cerrada) VALUES (?, ?) ON CONFLICT (conversacion_id) DO UPDATE SET cerrada = excluded.cerrada').run(String(id), new Date(ahora()).toISOString());
    else db.prepare('DELETE FROM mc_cerradas WHERE conversacion_id = ?').run(String(id));
    let zernio = true;
    try { if (cuenta) await z('PATCH', `/inbox/conversations/${encodeURIComponent(id)}`, { accountId: cuenta, status: cerrar ? 'archived' : 'active' }); else zernio = false; }
    catch (e) { zernio = false; log(`Zernio no archivó la conversación ${id}: ${e.message}`); }
    return { ok: true, estado: cerrar ? 'archived' : 'active', zernio };
  }

  // ---------- Plantillas ----------
  const plantilla = (r) => ({ ...r, botones: JSON.parse(r.botones || '[]') });
  const limpiarPlantilla = (d = {}) => {
    const p = { nombre: corto(d.nombre, 80), carpeta: corto(d.carpeta, 40) || null, texto: corto(d.texto, 1000), botones: (Array.isArray(d.botones) ? d.botones : []).slice(0, 3).map((b) => ({ titulo: corto(b.titulo, 20), url: corto(b.url, 1000) })).filter((b) => b.titulo) };
    if (!p.nombre) throw new ManychatError('Ponle un nombre a la plantilla');
    if (!p.texto) throw new ManychatError('Escribe el texto de la plantilla');
    if (p.botones.some((b) => !/^https:\/\//i.test(b.url))) throw new ManychatError('Los botones de la plantilla necesitan un enlace https://');
    if (p.botones.length && p.texto.length > 640) throw new ManychatError('Con botones, el texto va hasta 640 caracteres');
    return p;
  };
  const plantillas = () => rows(db.prepare('SELECT * FROM mc_plantillas ORDER BY carpeta, nombre')).map(plantilla);
  function crearPlantilla(d) {
    const p = limpiarPlantilla(d);
    const r = db.prepare('INSERT INTO mc_plantillas (nombre, carpeta, texto, botones) VALUES (?, ?, ?, ?)').run(p.nombre, p.carpeta, p.texto, JSON.stringify(p.botones));
    alCambiar();
    return plantilla(row(db.prepare('SELECT * FROM mc_plantillas WHERE id = ?'), Number(r.lastInsertRowid)));
  }
  function editarPlantilla(id, d) {
    if (!row(db.prepare('SELECT id FROM mc_plantillas WHERE id = ?'), Number(id))) throw new ManychatError('Esa plantilla no existe');
    const p = limpiarPlantilla(d);
    db.prepare("UPDATE mc_plantillas SET nombre = ?, carpeta = ?, texto = ?, botones = ?, actualizado = datetime('now','localtime') WHERE id = ?").run(p.nombre, p.carpeta, p.texto, JSON.stringify(p.botones), Number(id));
    alCambiar();
    return plantilla(row(db.prepare('SELECT * FROM mc_plantillas WHERE id = ?'), Number(id)));
  }
  function borrarPlantilla(id) { db.prepare('DELETE FROM mc_plantillas WHERE id = ?').run(Number(id)); alCambiar(); return { ok: true }; }

  // ---------- Bloqueos ----------
  const bloqueos = () => rows(db.prepare('SELECT * FROM mc_bloqueos ORDER BY creado DESC')).map((b) => ({ ...b, aplicado: Boolean(b.contacto_id) }));
  // Busca entre los contactos de Zernio a los bloqueados que aún no se habían encontrado y los marca
  async function aplicarBloqueos({ forzar = false } = {}) {
    const pendientes = rows(db.prepare('SELECT * FROM mc_bloqueos WHERE contacto_id IS NULL'));
    if (!pendientes.length || !configurado()) return { aplicados: 0 };
    try { await sincronizarSolicitudes(); } catch { /* sin registros: se mira el usuario de Zernio */ }
    const u = usuariosConocidos();
    const lista = await todosLosContactos({ forzar });
    let aplicados = 0;
    for (const b of pendientes) {
      const c = lista.find((x) => (u[x.platformIdentifier] || usuarioDeZernio(x.displayIdentifier)) === b.usuario);
      if (!c) continue;
      await cambiarEtiquetaSistema(c.id, ETIQUETA_BLOQUEADO, true, { isBlocked: true });
      db.prepare('UPDATE mc_bloqueos SET contacto_id = ? WHERE id = ?').run(c.id, b.id);
      aplicados++;
    }
    if (aplicados) alCambiar();
    return { aplicados };
  }
  async function bloquear({ usuario, motivo } = {}) {
    const u = normalizarUsuario(usuario);
    if (!usuarioValido(u)) throw new ManychatError('Escribe el usuario de Instagram (solo letras, números, puntos y guiones bajos)');
    db.prepare('INSERT INTO mc_bloqueos (usuario, motivo) VALUES (?, ?) ON CONFLICT(usuario) DO UPDATE SET motivo = COALESCE(excluded.motivo, motivo)').run(u, corto(motivo, 200) || null);
    try { await aplicarBloqueos({ forzar: true }); } catch (e) { log(`No se pudo aplicar el bloqueo de @${u} ahora: ${e.message}`); }
    alCambiar();
    return bloqueos().find((b) => b.usuario === u);
  }
  async function desbloquear(id) {
    const b = row(db.prepare('SELECT * FROM mc_bloqueos WHERE id = ?'), Number(id));
    if (!b) throw new ManychatError('Ese bloqueo no existe');
    if (b.contacto_id) await cambiarEtiquetaSistema(b.contacto_id, ETIQUETA_BLOQUEADO, false, { isBlocked: false });
    db.prepare('DELETE FROM mc_bloqueos WHERE id = ?').run(b.id);
    alCambiar();
    return { ok: true };
  }

  // ---------- Configuración ----------
  async function campos() {
    const c = await auto.cuenta();
    const { fields = [] } = await z('GET', `/custom-fields?profileId=${encodeURIComponent(c.profileId)}`);
    return fields.map((f) => ({ id: f.id, nombre: f.name, clave: f.slug, tipo: f.type, opciones: f.options || [] }));
  }
  async function crearCampo({ nombre, tipo = 'text', opciones = [] } = {}) {
    const n = corto(nombre, 60);
    if (!n) throw new ManychatError('Ponle nombre al campo');
    const t = ['text', 'number', 'date', 'boolean', 'select'].includes(tipo) ? tipo : 'text';
    const c = await auto.cuenta();
    await z('POST', '/custom-fields', { profileId: c.profileId, name: n, type: t, ...(t === 'select' ? { options: (opciones || []).map((o) => corto(o, 60)).filter(Boolean) } : {}) });
    return campos();
  }
  async function canales() {
    const { accounts = [] } = await z('GET', '/accounts');
    return accounts.filter((a) => ['instagram', 'facebook', 'whatsapp'].includes(a.platform)).map((a) => ({ id: a._id, canal: a.platform, usuario: a.username || a.displayName || null, activo: a.isActive !== false, reconectar: Boolean(a.needsReconnection) }));
  }

  // ---------- Pipeline de ventas ----------
  const fases = () => rows(db.prepare('SELECT * FROM mc_fases ORDER BY orden')).map((f) => ({ id: f.id, nombre: f.nombre, criterio: f.criterio || '', base: Boolean(f.base), final: FINALES.has(f.id) }));
  const etapas = () => Object.fromEntries(rows(db.prepare('SELECT * FROM mc_etapas')).map((e) => [e.contacto_id, e]));

  // Columnas: se pueden añadir, renombrar, cambiar su criterio y reordenar; las predeterminadas no se borran
  function guardarFases(lista) {
    if (!Array.isArray(lista) || !lista.length) throw new ManychatError('Faltan las columnas');
    const actuales = fases();
    const nuevas = lista.map((f) => ({ id: f.id && actuales.some((a) => a.id === f.id) ? f.id : null, nombre: corto(f.nombre, 40), criterio: corto(f.criterio, 400) }));
    if (nuevas.some((f) => !f.nombre)) throw new ManychatError('Cada columna necesita un nombre');
    for (const b of actuales.filter((a) => a.base)) if (!nuevas.some((f) => f.id === b.id)) throw new ManychatError(`«${b.nombre}» es una columna predeterminada: se puede renombrar o mover, pero no borrar`);
    const quedan = new Set(nuevas.map((f) => f.id).filter(Boolean));
    db.exec('BEGIN');
    try {
      for (const a of actuales.filter((x) => !quedan.has(x.id))) {
        db.prepare("UPDATE mc_etapas SET fase = 'iniciada' WHERE fase = ?").run(a.id);
        db.prepare('DELETE FROM mc_fases WHERE id = ?').run(a.id);
      }
      nuevas.forEach((f, i) => {
        if (f.id) db.prepare('UPDATE mc_fases SET nombre = ?, criterio = ?, orden = ? WHERE id = ?').run(f.nombre, f.criterio || null, i, f.id);
        else db.prepare('INSERT INTO mc_fases (id, nombre, criterio, orden, base) VALUES (?, ?, ?, ?, 0)').run(`f_${ahora().toString(36)}_${i}`, f.nombre, f.criterio || null, i);
      });
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    alCambiar();
    return fases();
  }

  function mover(contactoId, fase, { por = 'manual', motivo = null } = {}) {
    if (!contactoId) throw new ManychatError('Falta el contacto');
    if (!fases().some((f) => f.id === fase)) throw new ManychatError('Esa columna no existe');
    const ya = new Date(ahora()).toISOString();
    db.prepare(`INSERT INTO mc_etapas (contacto_id, fase, por, motivo, movido) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (contacto_id) DO UPDATE SET fase = excluded.fase, por = excluded.por, motivo = excluded.motivo, movido = excluded.movido`).run(String(contactoId), fase, por, motivo ? corto(motivo, 200) : null, ya);
    if (por === 'manual') alCambiar();
    return { contacto: String(contactoId), fase, por, motivo, movido: ya };
  }
  const etapaDe = (id, e = etapas()) => {
    const x = e[id];
    return x ? { fase: x.fase, por: x.por, motivo: x.motivo, movido: x.movido } : { fase: 'iniciada', por: null, motivo: null, movido: null };
  };

  const estadoIa = () => ({ activo: ajuste('pipeline_ia', '1') === '1', disponible: Boolean(ia), ultima: ajuste('pipeline_ia_ultima'), error: ajuste('pipeline_ia_error'), movidos: Number(ajuste('pipeline_ia_movidos', 0)) });
  function activarIa(activo) { ponerAjuste('pipeline_ia', activo ? '1' : '0'); return estadoIa(); }

  async function pipeline() {
    const p = pausas();
    const u = usuariosConocidos();
    const e = etapas();
    const lista = conRecursos((await todosLosContactos()).map((c) => contacto(c, p, u))).filter((c) => !c.bloqueado);
    const fs = fases();
    const tarjetas = lista.map((c) => {
      const et = etapaDe(c.id, e);
      return { id: c.id, nombre: c.nombre, usuario: c.usuario, foto: c.foto, recurso: c.recursoEntrada?.nombre || null, ultimoRecibido: c.ultimoRecibido, creado: c.creado,
        fase: fs.some((f) => f.id === et.fase) ? et.fase : 'iniciada', por: et.por, motivo: et.motivo, movido: et.movido };
    }).sort((a, b) => String(b.ultimoRecibido || b.creado || '').localeCompare(String(a.ultimoRecibido || a.creado || '')));
    return { fases: fs, tarjetas, ia: estadoIa() };
  }

  // La IA lee las conversaciones con mensajes nuevos y propone la fase. Reglas: solo hacia delante (o a Ganado/Perdido),
  // nunca saca a nadie de Ganado o Perdido, y si moviste tú a alguien, no lo toca hasta que haya mensajes nuevos.
  let analizando = false;
  async function analizar({ forzar = false, maximo = 12 } = {}) {
    if (!ia) throw new ManychatError('La IA no está disponible en este JARVIS (hace falta Claude Code)');
    if (analizando) return { ...estadoIa(), enCurso: true };
    analizando = true;
    let movidos = 0;
    try {
      const fs = fases();
      const orden = Object.fromEntries(fs.map((f, i) => [f.id, i]));
      const e = etapas();
      const { lista } = await conversaciones({ estado: 'active' });
      const candidatos = lista.filter((x) => {
        if (!x.contacto || x.contacto.bloqueado) return false;
        const et = e[x.contacto.id];
        if (et && FINALES.has(et.fase)) return false;
        if (et?.por === 'manual' && x.fecha && et.movido >= x.fecha) return false;
        return forzar || !et?.analizado || (x.fecha && x.fecha > et.analizado);
      }).slice(0, maximo);
      if (!candidatos.length) { ponerAjuste('pipeline_ia_ultima', new Date(ahora()).toISOString()); ponerAjuste('pipeline_ia_error', null); return { ...estadoIa(), analizados: 0, movidos: 0 }; }
      const bloques = [];
      for (const x of candidatos) {
        const msgs = (await mensajesDe(x.id, x.cuenta).catch(() => [])).slice(-30);
        const actual = etapaDe(x.contacto.id, e).fase;
        bloques.push(`### Contacto ${x.contacto.id} (fase actual: ${actual})\n${msgs.map((m) => `[${m.de === 'yo' ? 'Cuenta' : 'Persona'}] ${(m.texto || (m.adjuntos.length ? '(adjunto)' : '')).replace(/\s+/g, ' ').slice(0, 300)}`).join('\n') || '(sin mensajes)'}`);
      }
      const prompt = `Eres el asistente de ventas de una cuenta de Instagram que vende por mensaje directo. Para cada conversación, di en qué fase del proceso de venta está ahora.

Fases, en orden:
${fs.map((f) => `- ${f.id} (${f.nombre}): ${f.criterio || 'sin descripción'}`).join('\n')}

Los mensajes de «Cuenta» pueden ser automáticos (la entrega de un recurso no cuenta como conversación). Si no está claro, deja la fase actual.
Responde SOLO con un JSON, sin texto alrededor:
[{"id": "<id del contacto>", "fase": "<id de la fase>", "motivo": "<por qué, máximo 12 palabras>"}]

${bloques.join('\n\n')}`;
      const respuesta = leerJsonLista(await ia(prompt));
      const ya = new Date(ahora()).toISOString();
      for (const x of candidatos) {
        const id = x.contacto.id;
        const r = respuesta.find((y) => String(y?.id) === id);
        const actual = etapaDe(id, e).fase;
        if (r && r.fase in orden && r.fase !== actual && !FINALES.has(actual) && (FINALES.has(r.fase) || orden[r.fase] > (orden[actual] ?? 0))) {
          mover(id, r.fase, { por: 'ia', motivo: r.motivo || null });
          movidos++;
        }
        // Aunque no se mueva, queda leído hasta aquí (y sin «manual» si había mensajes nuevos)
        db.prepare(`INSERT INTO mc_etapas (contacto_id, fase, por, movido, analizado) VALUES (?, 'iniciada', 'ia', ?, ?)
          ON CONFLICT (contacto_id) DO UPDATE SET analizado = excluded.analizado`).run(id, ya, ya);
      }
      ponerAjuste('pipeline_ia_ultima', ya);
      ponerAjuste('pipeline_ia_error', null);
      ponerAjuste('pipeline_ia_movidos', Number(ajuste('pipeline_ia_movidos', 0)) + movidos);
      if (movidos) alCambiar();
      return { ...estadoIa(), analizados: candidatos.length, movidos };
    } catch (err) {
      ponerAjuste('pipeline_ia_error', err.message);
      throw err;
    } finally { analizando = false; }
  }
  async function analizarSiToca() {
    const est = estadoIa();
    if (!ia || !est.activo || !configurado()) return;
    if (est.ultima && ahora() - Date.parse(est.ultima) < 15 * 60000) return;
    try { await analizar(); } catch (e) { log(`El pipeline no pudo leer las conversaciones: ${e.message}`); }
  }

  // ---------- Tareas periódicas: fin de pausas y bloqueos pendientes ----------
  async function revisar() {
    if (!configurado()) return;
    for (const p of rows(db.prepare('SELECT * FROM mc_pausas WHERE hasta IS NOT NULL AND hasta <= ?'), ahora())) {
      try { await pausar(p.contacto_id, { reanudar: true }); } catch (e) { log(`No se pudo quitar la pausa de ${p.contacto_id}: ${e.message}`); }
    }
    try { await aplicarBloqueos({ forzar: true }); } catch (e) { log(`No se pudieron revisar los bloqueos: ${e.message}`); }
    await sincronizarDeFondo();
    await analizarSiToca();
  }
  let reloj = null;
  const iniciar = (cada = 5 * 60000) => { if (!reloj) { reloj = setInterval(() => revisar(), cada); reloj.unref?.(); } };

  return { configurado, contactos, csv, fichaContacto, ponerEtiquetas, pausar, conversaciones, verConversacion, enviar, leido, archivar, plantillas, crearPlantilla, editarPlantilla, borrarPlantilla, bloqueos, bloquear, desbloquear, aplicarBloqueos, campos, crearCampo, canales, fases, guardarFases, mover, pipeline, analizar, activarIa, etapaDe, revisar, iniciar };
}
