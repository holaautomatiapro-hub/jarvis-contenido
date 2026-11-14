import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createAutomatizaciones } from '../server/automatizaciones.js';
import { createManychat, aCsv, normalizarUsuario, etiquetaVisible, leerJsonLista, FASES_BASE } from '../server/manychat.js';
import { createTareas } from '../server/tareas.js';

const CLAVE = 'zernio-clave-secreta-123456';
const CONTACTOS = [
  { id: 'c1', name: 'Ana Pérez', displayIdentifier: 'ana.fit (17841400000000001)', platformIdentifier: 'p1', platform: 'instagram', tags: ['lead', 'jarvis-auto-3'], isSubscribed: true, customFields: { respuesta_p1: 'Entrenadora' }, messagesReceivedCount: 4, lastMessageReceivedAt: '2026-11-10T10:00:00Z', createdAt: '2026-11-01T10:00:00Z' },
  { id: 'c2', name: 'Spam', displayIdentifier: 'Spammer_99', platformIdentifier: 'p2', platform: 'instagram', tags: [], isSubscribed: true, createdAt: '2026-10-01T10:00:00Z' },
  { id: 'c3', name: 'Kivy Fitness', displayIdentifier: 'Kivy Fitness (1627423061598298)', platformIdentifier: 'p3', platform: 'instagram', tags: ['lead'], isSubscribed: true, lastMessageReceivedAt: '2026-11-12T08:00:00Z', createdAt: '2026-11-03T10:00:00Z' },
];

function falso() {
  const llamadas = [];
  const contactos = structuredClone(CONTACTOS);
  let fallaEnvio = 0;
  const convs = [{ id: 'conv1', accountId: 'acc1', platform: 'instagram', participantId: 'p1', participantName: 'Ana', updatedTime: '2026-11-10T10:01:00Z', lastMessage: 'Hola, ¿precio?', unreadCount: 2, status: 'active', instagramProfile: { isFollower: true } }, { id: 'conv2', accountId: 'acc1', platform: 'instagram', participantId: 'p9', participantName: 'Otro', lastMessage: 'Gracias', unreadCount: 0, status: 'active' }];
  const fetchImpl = async (url, o = {}) => {
    const ruta = String(url).replace('https://zernio.com/api/v1', '');
    const body = o.body ? JSON.parse(o.body) : undefined;
    llamadas.push([o.method || 'GET', ruta, body]);
    const json = (j, status = 200) => new Response(JSON.stringify(j), { status });
    if (ruta === '/accounts') return json({ accounts: [{ _id: 'acc1', platform: 'instagram', profileId: 'prof1', username: 'automatiapro', isActive: true }] });
    if (ruta.startsWith('/contacts?')) return json({ contacts: contactos, pagination: { hasMore: false } });
    const c = ruta.match(/^\/contacts\/(c\d)$/);
    if (c && (o.method || 'GET') === 'GET') return json({ contact: contactos.find((x) => x.id === c[1]), channels: [{ platform: 'instagram', displayIdentifier: 'ana.fit', platformIdentifier: 'p1', conversationId: 'conv1', accountId: 'acc1' }] });
    if (c && o.method === 'PATCH') { Object.assign(contactos.find((x) => x.id === c[1]), body); return json({ success: true }); }
    if (ruta === '/comment-automations/ca3') return json({ automation: {}, logs: [{ commenterUsername: 'ana.fit', createdAt: '2026-11-02T09:00:00Z' }] });
    if (ruta === '/comment-automations/ca4') return json({ automation: {}, logs: [{ commenterUsername: 'Ana.Fit', createdAt: '2026-11-08T18:30:00Z' }, { commenterUsername: 'ana.fit', createdAt: '2026-11-09T10:00:00Z' }, { commenterId: 'p3', commenterUsername: 'kivy.fit', createdAt: '2026-11-05T12:00:00Z' }] });
    if (ruta.startsWith('/workflows/wf3/executions')) return json({ executions: [{ variables: { 'contact.handle': 'ana.fit' }, createdAt: '2026-11-02T09:01:00Z' }] });
    if (ruta.startsWith('/inbox/conversations?')) return json({ data: /status=archived/.test(ruta) ? [] : convs });
    if (/\/messages\?/.test(ruta)) return json({ messages: [{ id: 'm1', message: 'Hola', direction: 'incoming', createdAt: '2026-11-10T10:00:00Z' }, { id: 'm2', message: 'Hola Ana', direction: 'outgoing', createdAt: '2026-11-10T10:01:00Z' }] });
    if (/\/messages$/.test(ruta) && o.method === 'POST') {
      if (fallaEnvio-- > 0) return json({ error: { message: 'This message is sent outside of allowed window' } }, 400);
      return json({ success: true });
    }
    return json({ success: true });
  };
  return { fetchImpl, llamadas, contactos, convs, fallar: (n) => { fallaEnvio = n; } };
}

function montar({ ia = null } = {}) {
  const f = falso();
  const db = openDb(':memory:');
  const auto = createAutomatizaciones({ db, env: { ZERNIO_API_KEY: CLAVE }, fetchImpl: f.fetchImpl });
  let t = Date.parse('2026-11-14T12:00:00Z');
  const mc = createManychat({ db, auto, ia, ahora: () => t });
  return { ...f, db, mc, avanzar: (ms) => { t += ms; } };
}

describe('Manychat', () => {
  test('utilidades: usuario de Instagram, etiquetas internas y CSV para Excel', () => {
    assert.equal(normalizarUsuario(' @Ana.Fit '), 'ana.fit');
    assert.equal(normalizarUsuario('https://www.instagram.com/ana.fit/?hl=es'), 'ana.fit');
    assert.equal(normalizarUsuario('ana.fit (17841400000000001)'), 'ana.fit');
    assert.equal(etiquetaVisible('jarvis-bloqueado'), false);
    assert.equal(etiquetaVisible('jarvis-auto-3'), false);
    assert.equal(etiquetaVisible('lead'), true);
    const csv = aCsv([{ nombre: 'Nombre', valor: (x) => x.n }, { nombre: 'Nota', valor: (x) => x.t }], [{ n: 'Ana', t: 'dice "hola"; adiós' }]);
    assert.ok(csv.startsWith('﻿Nombre;Nota\r\n'));
    assert.match(csv, /Ana;"dice ""hola""; adiós"/);
  });

  test('contactos: lista con filtros, etiquetas visibles y en qué automatizaciones ha entrado', async () => {
    const { mc } = montar();
    const todos = await mc.contactos();
    assert.equal(todos.total, 3);
    const ana = todos.lista.find((c) => c.id === 'c1');
    assert.equal(ana.usuario, 'ana.fit');
    assert.equal(todos.lista.find((c) => c.id === 'c3').usuario, null);
    assert.deepEqual(ana.etiquetas, ['lead']);
    assert.deepEqual(ana.automatizaciones, [3]);
    assert.deepEqual(todos.etiquetas, [{ nombre: 'lead', n: 2 }]);
    assert.equal((await mc.contactos({ etiqueta: 'lead' })).total, 2);
    assert.equal((await mc.contactos({ q: 'spam' })).total, 1);
    assert.equal((await mc.contactos({ desde: '2026-10-15' })).total, 2);
    assert.equal((await mc.contactos({ automatizacion: '3' })).total, 1);
  });

  test('CSV: usuario, enlace al perfil, fecha de entrada, último mensaje y recursos pedidos', async () => {
    const { mc, db } = montar();
    db.prepare('INSERT INTO automatizaciones (id, config, zernio_id, flujos) VALUES (?, ?, ?, ?)').run(3, JSON.stringify({ nombre: 'Guía de reels' }), 'ca3', JSON.stringify([{ rama: 'b0', id: 'wf3' }]));
    db.prepare('INSERT INTO automatizaciones (id, config, zernio_id) VALUES (?, ?, ?)').run(4, JSON.stringify({ nombre: 'Plantilla Notion' }), 'ca4');
    const r = await mc.csv({ etiqueta: 'lead' });
    assert.equal(r.total, 2);
    assert.match(r.nombre, /^contactos-2026-11-14\.csv$/);
    const lineas = r.contenido.replace('\ufeff', '').trim().split('\r\n');
    assert.equal(lineas.length, 3);
    assert.equal(lineas[0], 'Usuario;Perfil de Instagram;Fecha de entrada;Último mensaje;Recursos pedidos;Qué recursos');
    // Zernio da «ana.fit (id)»: se queda el usuario. Entró por la guía (2 nov, 10:00 en España) y luego pidió la plantilla
    assert.ok(lineas.includes('@ana.fit;https://www.instagram.com/ana.fit/;02/11/2026 10:00;10/11/2026 11:00;2;Guía de reels · Plantilla Notion'));
    // «Kivy Fitness (id)» no es un usuario: el real sale de su comentario (por su id de Instagram)
    assert.ok(lineas.includes('@kivy.fit;https://www.instagram.com/kivy.fit/;05/11/2026 13:00;12/11/2026 09:00;1;Plantilla Notion'));
    // El filtro por automatización usa los recursos pedidos (no solo la etiqueta interna)
    assert.deepEqual((await mc.contactos({ automatizacion: '4' })).lista.map((c) => c.id).sort(), ['c1', 'c3']);
    // Se guarda: aunque Zernio deje de devolver esos registros, el CSV los sigue teniendo (y no se duplican)
    await mc.csv({});
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mc_pedidos').get().n, 3);
    const ficha = await mc.fichaContacto('c1');
    assert.deepEqual(ficha.recursos.map((x) => x.nombre), ['Guía de reels', 'Plantilla Notion']);
    const lista = await mc.contactos({});
    assert.equal(lista.lista.find((c) => c.id === 'c2').recursoEntrada, null);
  });

  test('bandeja: conversaciones con su contacto, filtros, mensajes y enviar (también fuera de las 24 h)', async () => {
    const { mc, llamadas, fallar } = montar();
    const { lista } = await mc.conversaciones();
    assert.equal(lista.length, 2);
    assert.equal(lista[0].usuario, 'ana.fit');
    assert.deepEqual(lista[0].contacto.etiquetas, ['lead']);
    assert.equal(lista[0].sigue, true);
    assert.equal((await mc.conversaciones({ noLeidos: '1' })).lista.length, 1);
    assert.equal((await mc.conversaciones({ etiqueta: 'lead' })).lista.length, 1);
    assert.equal((await mc.conversaciones({ q: 'gracias' })).lista.length, 1);
    const v = await mc.verConversacion('conv1', 'acc1');
    assert.deepEqual(v.mensajes.map((m) => m.de), ['suyo', 'yo']);
    assert.equal(v.ultimoSuyo, '2026-11-10T10:00:00Z');
    assert.deepEqual(await mc.enviar('conv1', { cuenta: 'acc1', texto: 'Te lo paso 👇', botones: [{ titulo: 'Ver', url: 'https://ej.com' }] }), { ok: true, etiqueta: null });
    assert.deepEqual(llamadas.at(-1)[2], { accountId: 'acc1', message: 'Te lo paso 👇', buttons: [{ type: 'url', title: 'Ver', url: 'https://ej.com' }] });
    // Pasadas las 24 h: se reintenta como respuesta de una persona (HUMAN_AGENT, hasta 7 días)
    fallar(1);
    assert.equal((await mc.enviar('conv1', { cuenta: 'acc1', texto: 'Hola' })).etiqueta, 'HUMAN_AGENT');
    assert.deepEqual([llamadas.at(-1)[2].messageTag, llamadas.at(-1)[2].messagingType], ['HUMAN_AGENT', 'MESSAGE_TAG']);
    fallar(2);
    await assert.rejects(mc.enviar('conv1', { cuenta: 'acc1', texto: 'Hola' }), /más de 7 días/);
    await assert.rejects(mc.enviar('conv1', { cuenta: 'acc1', texto: '' }), /Escribe el mensaje/);
  });

  test('etiquetas y pausa: no se tocan las internas; la pausa con tiempo se quita sola', async () => {
    const { mc, contactos, avanzar } = montar();
    await mc.ponerEtiquetas('c1', ['cliente', 'jarvis-bloqueado']);
    assert.deepEqual(contactos[0].tags.sort(), ['cliente', 'jarvis-auto-3'].sort(), 'conserva la de la automatización y no deja poner una interna');
    const p = await mc.pausar('c1', { minutos: 60 });
    assert.equal(p.pausado, true);
    assert.ok(contactos[0].tags.includes('jarvis-pausado'));
    avanzar(30 * 60000);
    await mc.revisar();
    assert.ok(contactos[0].tags.includes('jarvis-pausado'), 'a la media hora sigue en pausa');
    avanzar(31 * 60000);
    await mc.revisar();
    assert.ok(!contactos[0].tags.includes('jarvis-pausado'), 'a la hora se reanuda sola');
  });

  test('bloqueos: por usuario de Instagram; se aplica al contacto (aunque llegue después) y se puede quitar', async () => {
    const { mc, contactos } = montar();
    await assert.rejects(mc.bloquear({ usuario: 'no vale!' }), /usuario de Instagram/);
    const b = await mc.bloquear({ usuario: '@spammer_99', motivo: 'spam' });
    assert.equal(b.usuario, 'spammer_99');
    assert.equal(b.aplicado, true);
    assert.equal(contactos[1].isBlocked, true);
    assert.ok(contactos[1].tags.includes('jarvis-bloqueado'));
    // Alguien que aún no ha escrito: queda pendiente y se aplica cuando aparece
    const nuevo = await mc.bloquear({ usuario: 'todavia_no' });
    assert.equal(nuevo.aplicado, false);
    contactos.push({ id: 'c3', displayIdentifier: 'Todavia_No', platformIdentifier: 'p3', tags: [] });
    await mc.revisar();
    assert.equal(mc.bloqueos().find((x) => x.usuario === 'todavia_no').aplicado, true);
    assert.ok(contactos[2].tags.includes('jarvis-bloqueado'));
    await mc.desbloquear(b.id);
    assert.equal(contactos[1].isBlocked, false);
    assert.ok(!contactos[1].tags.includes('jarvis-bloqueado'));
    assert.equal(mc.bloqueos().length, 1);
  });

  test('plantillas: crear, validar, editar y borrar', () => {
    const { mc } = montar();
    assert.throws(() => mc.crearPlantilla({ nombre: '', texto: 'x' }), /nombre/);
    assert.throws(() => mc.crearPlantilla({ nombre: 'a', texto: 'x', botones: [{ titulo: 'Ver', url: 'http://x' }] }), /https/);
    const p = mc.crearPlantilla({ nombre: 'Precio', carpeta: 'Ventas', texto: 'Hola {{first_name}} 👋', botones: [{ titulo: 'Agenda', url: 'https://cal.com/x' }] });
    assert.deepEqual(p.botones, [{ titulo: 'Agenda', url: 'https://cal.com/x' }]);
    assert.equal(mc.editarPlantilla(p.id, { ...p, texto: 'Nuevo' }).texto, 'Nuevo');
    assert.equal(mc.plantillas().length, 1);
    mc.borrarPlantilla(p.id);
    assert.equal(mc.plantillas().length, 0);
  });

  test('cerrar un chat: sale de «Abiertos» aunque Zernio no lo archive y se reabre si vuelve a escribir', async () => {
    const { mc, convs, llamadas, avanzar } = montar();
    const r = await mc.archivar('conv1', 'acc1', 'archived');
    assert.equal(r.estado, 'archived');
    assert.ok(llamadas.some(([m, ruta, b]) => m === 'PATCH' && ruta === '/inbox/conversations/conv1' && b.status === 'archived'));
    assert.deepEqual((await mc.conversaciones({ estado: 'active' })).lista.map((x) => x.id), ['conv2']);
    assert.deepEqual((await mc.conversaciones({ estado: 'archived' })).lista.map((x) => x.id), ['conv1']);
    // Vuelve a escribir después de cerrarlo: se reabre solo
    avanzar(60000);
    convs[0].updatedTime = '2026-11-14T12:05:00Z';
    assert.deepEqual((await mc.conversaciones({ estado: 'active' })).lista.map((x) => x.id), ['conv1', 'conv2']);
    // Reabrir a mano
    await mc.archivar('conv2', 'acc1', 'archived');
    await mc.archivar('conv2', 'acc1', 'active');
    assert.equal((await mc.conversaciones({ estado: 'active' })).lista.length, 2);
  });

  test('pipeline: columnas predeterminadas, añadir/renombrar/borrar y mover a mano', async () => {
    const { mc } = montar();
    assert.deepEqual(mc.fases().map((f) => f.nombre), FASES_BASE.map((f) => f.nombre));
    assert.deepEqual(FASES_BASE.map((f) => f.nombre), ['Iniciada', 'Conexión', 'Descubrimiento', 'Cualificación', 'Propuesta de llamada', 'Pendiente de agendar', 'Agendado', 'Ganado', 'Perdido']);
    const p = await mc.pipeline();
    assert.ok(p.tarjetas.every((t) => t.fase === 'iniciada'));
    // Una columna nueva entre Agendado y Ganado
    const fs = mc.fases();
    const nuevas = [...fs.slice(0, 7), { nombre: 'Seguimiento', criterio: 'Hizo la llamada y lo está pensando' }, ...fs.slice(7)];
    const guardadas = mc.guardarFases(nuevas);
    assert.equal(guardadas[7].nombre, 'Seguimiento');
    assert.equal(guardadas[7].base, false);
    mc.mover('c1', guardadas[7].id);
    assert.equal((await mc.pipeline()).tarjetas.find((t) => t.id === 'c1').fase, guardadas[7].id);
    // Las predeterminadas no se borran; las nuevas sí (y quien estaba ahí vuelve a Iniciada)
    assert.throws(() => mc.guardarFases(guardadas.filter((f) => f.id !== 'ganado')), /predeterminada/);
    mc.guardarFases(guardadas.filter((f) => f.base).map((f) => (f.id === 'propuesta' ? { ...f, nombre: 'Llamada propuesta' } : f)));
    assert.equal(mc.fases().find((f) => f.id === 'propuesta').nombre, 'Llamada propuesta');
    assert.equal((await mc.pipeline()).tarjetas.find((t) => t.id === 'c1').fase, 'iniciada');
    assert.throws(() => mc.mover('c1', 'no-existe'), /no existe/);
    // Los bloqueados no salen en el pipeline
    assert.ok(!(await mc.pipeline()).tarjetas.some((t) => t.id === 'c2' && t.bloqueado));
  });

  test('pipeline con IA: lee las conversaciones nuevas y mueve solo hacia delante', async () => {
    const preguntas = [];
    let propone = 'descubrimiento';
    const { mc, convs, avanzar } = montar({ ia: async (prompt) => { preguntas.push(prompt); return `Aquí va: [{"id": "c1", "fase": "${propone}", "motivo": "Cuenta a qué se dedica"}]`; } });
    let r = await mc.analizar();
    assert.equal(r.analizados, 1); // conv2 no tiene contacto
    assert.equal(r.movidos, 1);
    assert.match(preguntas[0], /descubrimiento \(Descubrimiento\)/);
    assert.match(preguntas[0], /\[Persona\] Hola/);
    let c1 = (await mc.pipeline()).tarjetas.find((t) => t.id === 'c1');
    assert.equal(c1.fase, 'descubrimiento');
    assert.equal(c1.por, 'ia');
    assert.equal(c1.motivo, 'Cuenta a qué se dedica');
    // Sin mensajes nuevos no vuelve a preguntar
    r = await mc.analizar();
    assert.equal(r.analizados, 0);
    // Nunca hacia atrás
    propone = 'conexion';
    convs[0].updatedTime = '2026-11-14T12:10:00Z';
    avanzar(60000);
    await mc.analizar();
    assert.equal((await mc.pipeline()).tarjetas.find((t) => t.id === 'c1').fase, 'descubrimiento');
    // Si lo mueves tú, no lo toca hasta que haya mensajes nuevos
    avanzar(15 * 60000);
    mc.mover('c1', 'agendado');
    propone = 'perdido';
    r = await mc.analizar({ forzar: true });
    assert.equal(r.analizados, 0);
    convs[0].updatedTime = '2026-11-14T12:20:00Z';
    await mc.analizar();
    c1 = (await mc.pipeline()).tarjetas.find((t) => t.id === 'c1');
    assert.equal(c1.fase, 'perdido'); // a Ganado/Perdido sí puede ir desde cualquier fase
    // De Ganado/Perdido no la saca nunca
    propone = 'ganado';
    convs[0].updatedTime = '2026-11-14T12:30:00Z';
    r = await mc.analizar();
    assert.equal(r.analizados, 0);
    // Apagar la IA
    assert.equal(mc.activarIa(false).activo, false);
    assert.deepEqual(leerJsonLista('nada'), []);
  });

  test('tareas de un contacto: se crean desde la ficha y se listan por persona', () => {
    const db = openDb(':memory:');
    const tareas = createTareas({ db, registrar: () => {} });
    const t = tareas.crear({ titulo: 'Mandarle el enlace de la llamada', fecha: '2026-11-15', categoria: 'ventas', contacto_id: 'c1', contacto_nombre: '@ana.fit' });
    tareas.crear({ titulo: 'Grabar reel', fecha: '2026-11-15' });
    assert.equal(t.contacto_id, 'c1');
    assert.equal(t.contacto_nombre, '@ana.fit');
    assert.deepEqual(tareas.listar({ contacto: '*' }).tareas.map((x) => x.titulo), ['Mandarle el enlace de la llamada']);
    assert.equal(tareas.listar({ contacto: 'c1' }).tareas.length, 1);
    assert.equal(tareas.listar({ contacto: 'c9' }).tareas.length, 0);
    assert.equal(tareas.listar({ texto: 'ana.fit' }).tareas.length, 1);
  });
});
