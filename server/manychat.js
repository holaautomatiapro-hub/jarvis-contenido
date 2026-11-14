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

export function createManychat({ db, auto, alCambiar = () => {}, log = () => {}, ahora = () => Date.now() }) {
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
  DROP TABLE IF EXISTS mc_solicitudes;`);
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
    return { ...c, canales: channels.map((x) => ({ canal: x.platform, usuario: x.displayIdentifier, conversacion: x.conversationId, cuenta: x.accountId, activo: x.lastActiveAt })), conversacion: canal ? { id: canal.conversationId, cuenta: canal.accountId } : null, mensajes };
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
  async function conversaciones({ estado = 'active', noLeidos = '', etiqueta = '', q = '', canal = '' } = {}) {
    const c = await auto.cuenta();
    const r = await z('GET', `/inbox/conversations?profileId=${encodeURIComponent(c.profileId)}&limit=100&sortOrder=desc&status=${estado === 'archived' ? 'archived' : 'active'}${canal ? `&platform=${encodeURIComponent(canal)}` : ''}`);
    const p = pausas();
    const porParticipante = {};
    const u = usuariosConocidos();
    try { for (const x of await todosLosContactos()) if (x.platformIdentifier) porParticipante[x.platformIdentifier] = contacto(x, p, u); } catch { /* sin contactos: la bandeja sigue */ }
    const b = String(q).trim().toLowerCase();
    const lista = (r.data || []).map((x) => {
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
  const archivar = (id, cuenta, estado) => z('PATCH', `/inbox/conversations/${encodeURIComponent(id)}`, { accountId: cuenta, status: estado === 'archived' ? 'archived' : 'active' }).then(() => ({ ok: true }));

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

  // ---------- Tareas periódicas: fin de pausas y bloqueos pendientes ----------
  async function revisar() {
    if (!configurado()) return;
    for (const p of rows(db.prepare('SELECT * FROM mc_pausas WHERE hasta IS NOT NULL AND hasta <= ?'), ahora())) {
      try { await pausar(p.contacto_id, { reanudar: true }); } catch (e) { log(`No se pudo quitar la pausa de ${p.contacto_id}: ${e.message}`); }
    }
    try { await aplicarBloqueos({ forzar: true }); } catch (e) { log(`No se pudieron revisar los bloqueos: ${e.message}`); }
    await sincronizarDeFondo();
  }
  let reloj = null;
  const iniciar = (cada = 5 * 60000) => { if (!reloj) { reloj = setInterval(() => revisar(), cada); reloj.unref?.(); } };

  return { configurado, contactos, csv, fichaContacto, ponerEtiquetas, pausar, conversaciones, verConversacion, enviar, leido, archivar, plantillas, crearPlantilla, editarPlantilla, borrarPlantilla, bloqueos, bloquear, desbloquear, aplicarBloqueos, campos, crearCampo, canales, revisar, iniciar };
}
