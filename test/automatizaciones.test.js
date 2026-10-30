import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createAutomatizaciones, normalizarConfig, cuerpoAutomatizacion, grafoZernio, compilar, palabrasParaZernio, aFormatoNuevo } from '../server/automatizaciones.js';
import { flujoInicial, salidasDe, validarFlujo } from '../web/src/lib/flujo.js';

const CLAVE = 'zernio-clave-secreta-123456';
const DISP = { tipo: 'post', destino: 'publicacion', media_id: '1789', media_titulo: 'Mi reel', palabras: 'GUÍA, guia' };
// Un flujo largo: mensaje con botón → recurso → pregunta con opciones → (Entrenador: etiqueta → esperar → ¿te sigue? → mensaje que vuelve atrás) / otra → fin
function flujoLargo() {
  return {
    nodos: [
      { id: 'inicio', tipo: 'inicio', x: 0, y: 0, datos: {} },
      { id: 'm1', tipo: 'mensaje', datos: { texto: '¡Hola {{first_name}}!', botones: [{ titulo: 'Lo quiero', tipo: 'camino' }, { titulo: 'Ver web', tipo: 'enlace', url: 'https://ejemplo.com' }] } },
      { id: 'm2', tipo: 'mensaje', datos: { texto: 'Aquí tienes', botones: [{ titulo: 'Abrir guía', tipo: 'enlace', url: 'https://ejemplo.com/guia' }] } },
      { id: 'p1', tipo: 'pregunta', datos: { texto: '¿A qué te dedicas?', opciones: ['Entrenador', 'Otro'] } },
      { id: 't1', tipo: 'etiqueta', datos: { accion: 'poner', etiqueta: 'entrenador' } },
      { id: 'e1', tipo: 'esperar', datos: { cantidad: 2, unidad: 'horas' } },
      { id: 'c1', tipo: 'condicion', datos: { tipo: 'sigue' } },
      { id: 'm3', tipo: 'mensaje', datos: { texto: '¿Hablamos?', botones: [{ titulo: 'Sí', tipo: 'camino' }, { titulo: 'Ahora no', tipo: 'camino' }] } },
      { id: 'fin', tipo: 'fin', datos: {} },
    ],
    conexiones: [
      { de: 'inicio', salida: 'siguiente', a: 'm1' }, { de: 'm1', salida: 'b0', a: 'm2' }, { de: 'm2', salida: 'siguiente', a: 'p1' },
      { de: 'p1', salida: 'o0', a: 't1' }, { de: 'p1', salida: 'otra', a: 'fin' }, { de: 't1', salida: 'siguiente', a: 'e1' },
      { de: 'e1', salida: 'siguiente', a: 'c1' }, { de: 'c1', salida: 'si', a: 'm3' }, { de: 'c1', salida: 'no', a: 'fin' },
      { de: 'm3', salida: 'b0', a: 'm2' }, // vuelve atrás: los bucles valen
    ],
  };
}

// Zernio e Instagram de mentira: apunta las llamadas y responde lo mínimo
function falso({ media = [], stories = [] } = {}) {
  const llamadas = [];
  let n = 0;
  const fetchImpl = async (url, o = {}) => {
    const u = String(url);
    const body = o.body ? JSON.parse(o.body) : undefined;
    const json = (j, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'content-type': 'application/json' } });
    if (u.startsWith('https://graph.facebook.com')) {
      llamadas.push(['GRAPH', new URL(u).pathname]);
      return json({ data: u.includes('/stories') ? stories : media });
    }
    const ruta = u.replace('https://zernio.com/api/v1', '');
    llamadas.push([o.method || 'GET', ruta, body]);
    if (o.headers?.Authorization !== `Bearer ${CLAVE}`) return json({ error: 'Unauthorized' }, 401);
    if (ruta === '/accounts') return json({ accounts: [{ _id: 'acc1', platform: 'instagram', profileId: { _id: 'prof1' }, username: 'automatiapro', isActive: true }] });
    if (ruta === '/workflows' && o.method === 'POST') return json({ workflow: { id: `wf${++n}` } });
    if (ruta === '/comment-automations' && o.method === 'POST') return json({ automation: { id: `ca${++n}` } });
    if (ruta.startsWith('/comment-automations?')) return json({ automations: [{ id: 'ca2', isActive: true, stats: { triggered: 5, dmsSent: 4 } }] });
    return json({ success: true });
  };
  return { fetchImpl, llamadas };
}
const instagram = { conexion: () => ({ token: 't', igUserId: 'ig1' }) };
const cuantas = (llamadas, m, ruta) => llamadas.filter((l) => l[0] === m && l[1] === ruta).length;

describe('Automatizaciones (Zernio)', () => {
  test('palabras: da igual mayúsculas y tildes; valida el disparador', () => {
    const c = normalizarConfig({ disparador: { ...DISP, palabras: 'guia, guía, GUIA, GUÍA, Guía, info' }, flujo: flujoLargo() });
    assert.deepEqual(c.disparador.palabras, ['guía', 'info']);
    assert.deepEqual(palabrasParaZernio(['guía']).sort(), ['GUIA', 'GUÍA', 'Guia', 'Guía', 'guia', 'guía'].sort());
    assert.throws(() => normalizarConfig({ disparador: { ...DISP, media_id: '' }, flujo: flujoLargo() }), /Elige la publicación/);
    assert.throws(() => normalizarConfig({ disparador: { tipo: 'mensaje' }, flujo: flujoLargo() }), /palabra que te tienen que escribir/);
    assert.equal(normalizarConfig({ disparador: { ...DISP, tipo: 'story', respuestas: ['hola'] }, flujo: flujoLargo() }).disparador.respuestas.length, 0, 'una story no tiene respuesta pública');
  });

  test('el tablero se valida: primer mensaje, botones, enlaces y esperas', () => {
    // Al empezar solo está el disparador
    assert.deepEqual(flujoInicial().nodos.map((n) => n.tipo), ['inicio']);
    assert.match(validarFlujo(flujoInicial(), { tipo: 'post' }).errores.join(), /Añade el primer bloque/);
    const f = {
      nodos: [{ id: 'inicio', tipo: 'inicio', datos: {} }, { id: 'n1', tipo: 'mensaje', datos: { texto: 'Hola', botones: [{ titulo: 'Lo quiero', tipo: 'camino' }] } }, { id: 'n2', tipo: 'mensaje', datos: { texto: 'Aquí', botones: [{ titulo: 'Ver', tipo: 'enlace', url: '' }] } }],
      conexiones: [{ de: 'inicio', salida: 'siguiente', a: 'n1' }, { de: 'n1', salida: 'b0', a: 'n2' }],
    };
    assert.match(validarFlujo(f, { tipo: 'post' }).errores.join(), /necesita un enlace/);
    f.nodos[2].datos.botones[0].url = 'https://ejemplo.com/guia';
    assert.deepEqual(validarFlujo(f, { tipo: 'post' }).errores, []);
    const roto = { ...f, conexiones: f.conexiones.filter((c) => c.de !== 'n1') };
    assert.match(validarFlujo(roto, { tipo: 'post' }).errores.join(), /no lleva a ningún bloque/);
    const conPregunta = { nodos: [{ id: 'inicio', tipo: 'inicio', datos: {} }, { id: 'p', tipo: 'pregunta', datos: { texto: '¿?' } }], conexiones: [{ de: 'inicio', salida: 'siguiente', a: 'p' }] };
    assert.match(validarFlujo(conPregunta, { tipo: 'post' }).errores.join(), /Tras el disparador va un Mensaje/);
    assert.deepEqual(validarFlujo(conPregunta, { tipo: 'mensaje' }).errores, [], 'por privado sí puede empezar con una pregunta');
    assert.deepEqual(validarFlujo(flujoLargo(), { tipo: 'post' }).errores, []);
    const largo = flujoLargo();
    largo.nodos.find((n) => n.id === 'e1').datos = { cantidad: 2, unidad: 'dias' };
    assert.match(validarFlujo(largo, { tipo: 'post' }).avisos.join(), /24 h/);
    // El primer mensaje no tiene «si no pulsa» (Meta no deja escribir más sin respuesta)
    assert.deepEqual(salidasDe(largo.nodos[1], { primero: true }).map((s) => s.id), ['b0']);
    assert.deepEqual(salidasDe(largo.nodos[7]).map((s) => s.id), ['b0', 'b1', 'sin_respuesta']);
  });

  test('un flujo largo se convierte en un workflow de Zernio por cada botón del primer mensaje', () => {
    const cfg = normalizarConfig({ nombre: 'Guía', disparador: { ...DISP, sigueme: true, respuestas: 'Enviado 📩\nMira tus mensajes' }, flujo: flujoLargo() });
    const { ramas, comentario } = compilar(cfg);
    assert.ok(comentario);
    assert.deepEqual(ramas.map((r) => r.rama), ['b0'], 'el botón de enlace no abre camino');
    const g = ramas[0].grafo;
    const ids = new Set(g.nodes.map((x) => x.id));
    assert.ok(g.edges.every((e) => ids.has(e.source) && ids.has(e.target)), 'todas las flechas apuntan a nodos que existen');
    assert.deepEqual(g.nodes[0].config, { triggerType: 'inbound_message', keywords: [ramas[0].clave], matchType: 'exact' });
    const tipos = g.nodes.map((x) => x.type);
    for (const t of ['send_message', 'wait_for_reply', 'set_field', 'condition', 'add_tag', 'delay', 'end']) assert.ok(tipos.includes(t), t);
    assert.equal(g.nodes.filter((x) => x.id === 'm2').length, 1, 'm2 una sola vez aunque m3 vuelva a él');
    assert.ok(g.edges.some((e) => e.source === 'm3_c' && e.target === 'm2' && e.sourceHandle === 'b0'));
    assert.deepEqual(g.nodes.find((x) => x.id === 'p1_f').config, { field: 'respuesta_p1', value: '{{r_p1}}' });
    assert.ok(g.edges.some((e) => e.source === 'p1_c' && e.target === 't1' && e.sourceHandle === 'q0'));
    assert.ok(g.edges.some((e) => e.source === 'p1_c' && e.target === 't1' && e.sourceHandle === 't0'));
    assert.deepEqual(g.nodes.find((x) => x.id === 'e1').config, { delayMinutes: 120 });
    assert.deepEqual(g.nodes.find((x) => x.id === 'c1').config.rules[0], { id: 'si', variable: 'contact.isFollower', operator: 'is_true' });
    const cuerpo = cuerpoAutomatizacion(cfg, { idsRamas: { b0: 'wf9' } });
    assert.deepEqual(cuerpo.buttons, [{ type: 'postback', title: 'Lo quiero', payload: 'zernio:workflow:wf9' }, { type: 'url', title: 'Ver web', url: 'https://ejemplo.com' }]);
    assert.equal(cuerpo.dmMessage, '¡Hola {{first_name}}!');
    assert.deepEqual(cuerpo.audience, { followerStatus: 'follower', whenUnknown: 'verify' });
    assert.equal(cuerpo.followGate.profileButtonLabel, 'Ver perfil');
    assert.deepEqual([cuerpo.commentReply, cuerpo.commentReplyVariations], ['Enviado 📩', ['Mira tus mensajes']]);
    assert.ok(cuerpo.keywords.includes('GUIA') && cuerpo.keywords.includes('Guía'));
    const story = cuerpoAutomatizacion(normalizarConfig({ disparador: { ...DISP, tipo: 'story', destino: 'cualquiera' }, flujo: flujoLargo() }), { idsRamas: { b0: 'x' } });
    assert.equal(story.trigger, 'story_reply');
    assert.equal(story.platformPostId, undefined, 'cualquier story');
  });

  test('Esperar: segundos antes de la respuesta privada y tramo horario', () => {
    // Esperar 30 s justo después del disparador → la respuesta privada sale 30 s después
    const f = flujoLargo();
    f.nodos.push({ id: 'e0', tipo: 'esperar', datos: { cantidad: 30, unidad: 'segundos' } });
    f.conexiones = f.conexiones.filter((c) => c.de !== 'inicio');
    f.conexiones.push({ de: 'inicio', salida: 'siguiente', a: 'e0' }, { de: 'e0', salida: 'siguiente', a: 'm1' });
    assert.deepEqual(validarFlujo(f, { tipo: 'post' }).errores, []);
    const cfg = normalizarConfig({ disparador: DISP, flujo: f });
    const cuerpo = cuerpoAutomatizacion(cfg, { idsRamas: { b0: 'wf1' } });
    assert.equal(cuerpo.dmDelaySeconds, 30);
    assert.equal(cuerpo.dmMessage, '¡Hola {{first_name}}!');
    assert.deepEqual(compilar(cfg).ramas.map((r) => r.rama), ['b0']);
    // Con horario antes de la respuesta privada, no
    f.nodos.at(-1).datos.horario = { activo: true, desde: 9, hasta: 21 };
    assert.match(validarFlujo(f, { tipo: 'post' }).errores.join(), /no puede llevar horario/);
    // Más adelante, con horario de 9 a 21: mira la hora y, si no toca, espera 15 min y vuelve a mirar
    const g = flujoLargo();
    g.nodos.find((n) => n.id === 'e1').datos = { cantidad: 10, unidad: 'segundos', horario: { activo: true, desde: 9, hasta: 21 } };
    assert.match(validarFlujo(g, { tipo: 'post' }).avisos.join(), /como mínimo 1 minuto/);
    const z = compilar(normalizarConfig({ disparador: DISP, flujo: g })).ramas[0].grafo;
    assert.deepEqual(z.nodes.find((x) => x.id === 'e1').config, { delayMinutes: 1 }, 'los segundos se redondean a 1 minuto');
    assert.equal(z.nodes.find((x) => x.id === 'e1_h').type, 'webhook');
    assert.match(z.nodes.find((x) => x.id === 'e1_h').config.url, /Europe%2FMadrid/);
    assert.deepEqual(z.nodes.find((x) => x.id === 'e1_a').config.rules[0], { id: 'si', variable: 'h_e1.body.hour', operator: 'greater_or_equal', value: 9 });
    assert.ok(z.edges.some((e) => e.source === 'e1_a' && e.target === 'e1_b' && e.sourceHandle === 'si'));
    assert.ok(z.edges.some((e) => e.source === 'e1_b' && e.target === 'c1' && e.sourceHandle === 'si'));
    assert.ok(z.edges.some((e) => e.source === 'e1_r' && e.target === 'e1_h'), 'fuera de horario vuelve a mirar');
    assert.ok(z.edges.some((e) => e.source === 'e1_h' && e.target === 'c1' && e.sourceHandle === 'error'), 'si no sabe la hora, envía igual');
    // De 22 a 8 (cruza la medianoche): vale si es ≥ 22 o < 8
    g.nodes = undefined;
    const noche = flujoLargo();
    noche.nodos.find((n) => n.id === 'e1').datos = { cantidad: 0, unidad: 'minutos', horario: { activo: true, desde: 22, hasta: 8 } };
    const zn = compilar(normalizarConfig({ disparador: DISP, flujo: noche })).ramas[0].grafo;
    assert.ok(!zn.nodes.some((x) => x.id === 'e1'), 'sin espera, directo a mirar la hora');
    assert.ok(zn.edges.some((e) => e.source === 't1' && e.target === 'e1_h'));
    assert.ok(zn.edges.some((e) => e.source === 'e1_a' && e.target === 'c1' && e.sourceHandle === 'si'));
    assert.ok(zn.edges.some((e) => e.source === 'e1_a' && e.target === 'e1_b' && e.sourceHandle === 'default'));
    const ids = new Set(zn.nodes.map((x) => x.id));
    assert.ok(zn.edges.every((e) => ids.has(e.source) && ids.has(e.target)));
  });

  test('palabra por privado: un solo workflow que empieza por el primer bloque', () => {
    const cfg = normalizarConfig({ disparador: { tipo: 'mensaje', palabras: 'precio' }, flujo: flujoLargo() });
    const { ramas, comentario } = compilar(cfg);
    assert.equal(comentario, null);
    assert.equal(ramas[0].rama, 'principal');
    const g = ramas[0].grafo;
    assert.equal(g.nodes[0].config.matchType, 'contains');
    assert.ok(g.nodes[0].config.keywords.includes('PRECIO'));
    assert.ok(g.edges.some((e) => e.source === 'inicio' && e.target === 'm1'));
  });

  test('las del formulario de antes se pasan al tablero', () => {
    const viejo = { nombre: 'Guía', tipo: 'post', destino: 'cualquiera', palabras: ['guía'], mensaje: 'Hola', boton: 'Lo quiero', recurso: { enlace: 'https://ej.com', titulo: 'Abrir' }, pregunta: { texto: '¿Qué tal?', opciones: [], gracias: 'Gracias' } };
    const n = aFormatoNuevo(viejo);
    assert.equal(n.disparador.tipo, 'post');
    assert.deepEqual(n.flujo.nodos.map((x) => x.tipo), ['inicio', 'mensaje', 'mensaje', 'pregunta', 'mensaje']);
    assert.deepEqual(validarFlujo(n.flujo, n.disparador).errores, []);
  });

  test('crear, listar, pausar, duplicar, editar y borrar', async () => {
    const { fetchImpl, llamadas } = falso();
    const a = createAutomatizaciones({ db: openDb(':memory:'), env: { ZERNIO_API_KEY: CLAVE }, fetchImpl, instagram });
    const r = await a.crear({ nombre: 'Guía', disparador: DISP, flujo: flujoLargo() });
    assert.equal(r.estado, 'activa');
    const wf = llamadas.find((l) => l[0] === 'POST' && l[1] === '/workflows')[2];
    assert.deepEqual([wf.profileId, wf.accountId, wf.platform, wf.name], ['prof1', 'acc1', 'instagram', 'JARVIS · Guía · botón 1']);
    assert.ok(llamadas.some((l) => l[0] === 'POST' && l[1] === '/workflows/wf1/activate'));
    const ca = llamadas.find((l) => l[0] === 'POST' && l[1] === '/comment-automations')[2];
    assert.equal(ca.buttons[0].payload, 'zernio:workflow:wf1');
    assert.equal(ca.isActive, true);
    assert.equal((await a.listar()).lista[0].zernio.stats.dmsSent, 4);

    assert.equal((await a.pausar(r.id, { activa: false })).estado, 'pausada');
    assert.deepEqual(llamadas.at(-1), ['PATCH', '/comment-automations/ca2', { isActive: false }]);
    assert.equal((await a.pausar(r.id, { activa: true })).estado, 'activa');

    const copia = await a.duplicar(r.id);
    assert.equal(copia.nombre, 'Guía (copia)');
    assert.equal(copia.estado, 'pausada');
    assert.equal(llamadas.filter((l) => l[0] === 'POST' && l[1] === '/comment-automations').at(-1)[2].isActive, false);
    assert.equal((await a.listar()).lista.length, 2);

    // Quitar el camino del botón borra su workflow
    const f = flujoLargo();
    f.nodos[1].datos.botones = [{ titulo: 'Ver web', tipo: 'enlace', url: 'https://ejemplo.com' }];
    await a.editar(r.id, { nombre: 'Guía', disparador: DISP, flujo: f });
    assert.equal(cuantas(llamadas, 'DELETE', '/workflows/wf1'), 1);

    await a.borrar(r.id);
    assert.ok(llamadas.some((l) => l[0] === 'DELETE' && l[1] === '/comment-automations/ca2'));
    assert.equal((await a.listar()).lista.length, 1);
  });

  test('editar el flujo actualiza el mismo workflow (no crea otro)', async () => {
    const { fetchImpl, llamadas } = falso();
    const a = createAutomatizaciones({ db: openDb(':memory:'), env: { ZERNIO_API_KEY: CLAVE }, fetchImpl, instagram });
    const r = await a.crear({ disparador: DISP, flujo: flujoLargo() });
    const f = flujoLargo();
    f.nodos.find((n) => n.id === 'm2').datos.texto = 'Texto nuevo';
    await a.editar(r.id, { disparador: DISP, flujo: f });
    assert.equal(cuantas(llamadas, 'POST', '/workflows'), 1);
    const parche = llamadas.find((l) => l[0] === 'PATCH' && l[1] === '/workflows/wf1')[2];
    assert.equal(parche.nodes.find((x) => x.id === 'm2').config.text, 'Texto nuevo');
    const creado = llamadas.find((l) => l[0] === 'POST' && l[1] === '/workflows')[2];
    assert.deepEqual(parche.nodes[0].config, creado.nodes[0].config, 'conserva la palabra secreta');
  });

  test('«la siguiente publicación»: espera en pausa y se engancha sola al post que sale después', async () => {
    const media = [];
    const { fetchImpl, llamadas } = falso({ media });
    const a = createAutomatizaciones({ db: openDb(':memory:'), env: { ZERNIO_API_KEY: CLAVE }, fetchImpl, instagram });
    const r = await a.crear({ disparador: { ...DISP, destino: 'siguiente', media_id: '' }, flujo: flujoLargo() });
    assert.equal(r.estado, 'esperando');
    const ca = llamadas.find((l) => l[1] === '/comment-automations')[2];
    assert.equal(ca.isActive, false);
    assert.equal(ca.platformPostId, undefined);
    media.push({ id: 'viejo', caption: 'Antiguo', timestamp: '2020-01-01T10:00:00+0000' });
    assert.equal((await a.revisarSiguientes()).enganchadas, 0);
    media.unshift({ id: 'nuevo', caption: 'Mi reel nuevo', timestamp: new Date(Date.now() + 60000).toISOString() });
    assert.equal((await a.revisarSiguientes()).enganchadas, 1);
    assert.deepEqual(llamadas.at(-1), ['PATCH', '/comment-automations/ca2', { platformPostId: 'nuevo', postTitle: 'Mi reel nuevo', isActive: true }]);
    const { lista } = await a.listar();
    assert.equal(lista[0].estado, 'activa');
    assert.equal(lista[0].media_id, 'nuevo');
    const sinMeta = createAutomatizaciones({ db: openDb(':memory:'), env: { ZERNIO_API_KEY: CLAVE }, fetchImpl, instagram: null });
    await assert.rejects(sinMeta.crear({ disparador: { ...DISP, destino: 'siguiente' }, flujo: flujoLargo() }), /conéctalo con Facebook/);
  });

  test('si Zernio falla al crear, no queda nada a medias', async () => {
    const { fetchImpl: base, llamadas } = falso();
    const fetchImpl = async (url, o) => (String(url).endsWith('/comment-automations') && o?.method === 'POST' ? new Response(JSON.stringify({ error: { message: 'Post already has an active automation' } }), { status: 409 }) : base(url, o));
    const db = openDb(':memory:');
    const a = createAutomatizaciones({ db, env: { ZERNIO_API_KEY: CLAVE }, fetchImpl, instagram });
    await assert.rejects(a.crear({ disparador: DISP, flujo: flujoLargo() }), /Zernio: Post already has an active automation/);
    assert.ok(llamadas.some((l) => l[0] === 'DELETE' && l[1].startsWith('/workflows/')), 'borra el workflow que llegó a crear');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM automatizaciones').get().n, 0);
  });

  test('conectar: comprueba la clave antes de guardarla y nunca la enseña en los errores', async () => {
    const { fetchImpl } = falso();
    const env = {};
    const guardadas = [];
    const a = createAutomatizaciones({ db: openDb(':memory:'), env, fetchImpl, instagram, guardarEnv: (c) => guardadas.push(c) });
    assert.equal((await a.estado()).configurado, false);
    const mala = 'otra-clave-que-no-vale-123';
    await assert.rejects(a.conectar({ clave: mala }), (e) => /no acepta la API key/.test(e.message) && !e.message.includes(mala));
    assert.equal(env.ZERNIO_API_KEY, undefined, 'si no vale, no se queda');
    assert.equal(guardadas.length, 0);
    const r = await a.conectar({ clave: CLAVE });
    assert.equal(r.cuenta, 'automatiapro');
    assert.deepEqual(guardadas, [{ ZERNIO_API_KEY: CLAVE }]);
  });

  test('grafoZernio: las salidas sin conectar terminan en un único fin', () => {
    const f = { nodos: [{ id: 'inicio', tipo: 'inicio', datos: {} }, { id: 'p', tipo: 'pregunta', datos: { texto: '¿Qué?', opciones: [], esperaHoras: 24, campo: '' } }], conexiones: [] };
    const g = grafoZernio(f, 'p', { triggerType: 'inbound_message' });
    assert.equal(g.nodes.filter((x) => x.type === 'end').length, 1);
    assert.ok(g.edges.some((e) => e.source === 'p_w' && e.target === 'fin_jarvis' && e.sourceHandle === 'timeout'));
  });
});
