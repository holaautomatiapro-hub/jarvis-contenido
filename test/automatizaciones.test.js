import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createAutomatizaciones, normalizarConfig, cuerpoAutomatizacion, grafoFlujo, llevaFlujo, palabrasParaZernio } from '../server/automatizaciones.js';

const CLAVE = 'zernio-clave-secreta-123456';
const BASE = {
  nombre: 'Guía', tipo: 'post', destino: 'publicacion', media_id: '1789', media_titulo: 'Mi reel',
  palabras: 'GUÍA, guia', mensaje: '¡Hola {{first_name}}!', boton: 'Lo quiero',
  recurso: { enlace: 'https://ejemplo.com/guia', titulo: 'Abrir guía' },
};

// Zernio e Instagram de mentira: apunta las llamadas y responde lo mínimo
function falso({ media = [], stories = [], cuentas } = {}) {
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
    if (ruta === '/accounts') return json({ accounts: cuentas || [{ _id: 'acc1', platform: 'instagram', profileId: { _id: 'prof1' }, username: 'automatiapro', isActive: true }] });
    if (ruta === '/workflows' && o.method === 'POST') return json({ workflow: { id: `wf${++n}` } });
    if (ruta === '/comment-automations' && o.method === 'POST') return json({ automation: { id: `ca${++n}` } });
    if (ruta.startsWith('/comment-automations?')) return json({ automations: [{ id: 'ca2', isActive: true, stats: { triggered: 5, dmsSent: 4 } }] });
    return json({ success: true });
  };
  return { fetchImpl, llamadas };
}
const instagram = { conexion: () => ({ token: 't', igUserId: 'ig1' }) };

describe('Automatizaciones (Zernio)', () => {
  test('valida lo que hace falta y limpia el formulario', () => {
    const c = normalizarConfig(BASE);
    assert.deepEqual(c.palabras, ['guía'], 'GUÍA y guia son la misma palabra');
    assert.equal(c.coincidencia, 'palabra');
    assert.throws(() => normalizarConfig({ ...BASE, media_id: '' }), /Elige la publicación/);
    assert.throws(() => normalizarConfig({ ...BASE, mensaje: '' }), /mensaje privado/);
    assert.throws(() => normalizarConfig({ ...BASE, recurso: { enlace: 'http://x.com' } }), /https/);
    assert.throws(() => normalizarConfig({ ...BASE, recurso: {} }), /enlace del recurso o una pregunta/);
    assert.equal(normalizarConfig({ ...BASE, tipo: 'story', respuestas: ['hola'] }).respuestas.length, 0, 'una story no tiene respuesta pública');
    // Da igual mayúsculas o tildes: se queda una (la de tilde) y en Zernio se dan de alta todas las formas
    const p = normalizarConfig({ ...BASE, palabras: 'guia, guía, GUIA, GUÍA, Guía, info' }).palabras;
    assert.deepEqual(p, ['guía', 'info']);
    assert.deepEqual(palabrasParaZernio(['guía']).sort(), ['GUIA', 'GUÍA', 'Guia', 'Guía', 'guia', 'guía'].sort());
  });

  test('cuerpo para Zernio: botón al enlace, «sígueme primero», story y repetición', () => {
    const sin = cuerpoAutomatizacion(normalizarConfig(BASE));
    assert.deepEqual(sin.buttons, [{ type: 'url', title: 'Lo quiero', url: 'https://ejemplo.com/guia' }]);
    assert.equal(sin.trigger, 'comment');
    assert.ok(sin.keywords.includes('GUIA') && sin.keywords.includes('Guía') && sin.keywords.includes('guia'));
    assert.equal(sin.platformPostId, '1789');
    assert.deepEqual(sin.audience, { followerStatus: 'any' });
    assert.deepEqual(sin.repeatPolicy, { mode: 'once' });
    const con = cuerpoAutomatizacion(normalizarConfig({ ...BASE, sigueme: true, repetir: 'cada', respuestas: 'Enviado 📩\nMira tus mensajes', pregunta: { texto: '¿A qué te dedicas?' } }), { flujoId: 'wf9' });
    assert.deepEqual(con.buttons, [{ type: 'postback', title: 'Lo quiero', payload: 'zernio:workflow:wf9' }]);
    assert.deepEqual(con.audience, { followerStatus: 'follower', whenUnknown: 'verify' });
    assert.equal(con.followGate.profileButtonLabel, 'Ver perfil');
    assert.equal(con.commentReply, 'Enviado 📩');
    assert.deepEqual(con.commentReplyVariations, ['Mira tus mensajes']);
    assert.deepEqual(con.repeatPolicy, { mode: 'every_comment', cooldownHours: 24 });
    const story = cuerpoAutomatizacion(normalizarConfig({ ...BASE, tipo: 'story', destino: 'cualquiera' }));
    assert.equal(story.trigger, 'story_reply');
    assert.equal(story.platformPostId, undefined, 'cualquier story');
    assert.equal(story.commentReply, undefined);
  });

  test('el flujo de después del botón: recurso → pregunta → guarda la respuesta', () => {
    const cfg = normalizarConfig({ ...BASE, pregunta: { texto: '¿A qué te dedicas?', opciones: 'Entrenador, Otro', gracias: '¡Gracias!' } });
    assert.ok(llevaFlujo(cfg));
    const g = grafoFlujo(cfg, { id: 7, clave: 'jarvis-7-abc' });
    const tipos = g.nodes.map((x) => x.type);
    assert.deepEqual(tipos, ['trigger', 'send_message', 'send_message', 'wait_for_reply', 'set_field', 'add_tag', 'send_message', 'end']);
    assert.deepEqual(g.nodes[0].config, { triggerType: 'inbound_message', keywords: ['jarvis-7-abc'], matchType: 'exact' });
    assert.deepEqual(g.nodes[1].config.buttons, [{ type: 'url', title: 'Abrir guía', url: 'https://ejemplo.com/guia' }]);
    assert.deepEqual(g.nodes[2].config.quickReplies.map((q) => q.title), ['Entrenador', 'Otro']);
    assert.ok(g.edges.some((e) => e.source === 'espera' && e.target === 'guardar' && e.sourceHandle === 'reply'));
    assert.ok(g.edges.some((e) => e.source === 'espera' && e.target === 'fin' && e.sourceHandle === 'timeout'));
    // Todas las aristas apuntan a nodos que existen
    const ids = new Set(g.nodes.map((x) => x.id));
    assert.ok(g.edges.every((e) => ids.has(e.source) && ids.has(e.target)));
  });

  test('crear con pregunta: flujo activado y automatización con su botón; pausar, reanudar y borrar', async () => {
    const { fetchImpl, llamadas } = falso();
    const a = createAutomatizaciones({ db: openDb(':memory:'), env: { ZERNIO_API_KEY: CLAVE }, fetchImpl, instagram });
    const r = await a.crear({ ...BASE, pregunta: { texto: '¿A qué te dedicas?' } });
    assert.equal(r.estado, 'activa');
    assert.equal(r.conFlujo, true);
    const wf = llamadas.find((l) => l[0] === 'POST' && l[1] === '/workflows')[2];
    assert.deepEqual([wf.profileId, wf.accountId, wf.platform], ['prof1', 'acc1', 'instagram']);
    assert.ok(llamadas.some((l) => l[0] === 'POST' && l[1] === '/workflows/wf1/activate'));
    const ca = llamadas.find((l) => l[0] === 'POST' && l[1] === '/comment-automations')[2];
    assert.equal(ca.buttons[0].payload, 'zernio:workflow:wf1');
    assert.equal(ca.isActive, true);

    const { lista } = await a.listar();
    assert.equal(lista[0].zernio.stats.dmsSent, 4);

    assert.equal((await a.pausar(r.id, { activa: false })).estado, 'pausada');
    assert.deepEqual(llamadas.at(-1), ['PATCH', '/comment-automations/ca2', { isActive: false }]);
    assert.equal((await a.pausar(r.id, { activa: true })).estado, 'activa');

    await a.borrar(r.id);
    assert.ok(llamadas.some((l) => l[0] === 'DELETE' && l[1] === '/comment-automations/ca2'));
    assert.ok(llamadas.some((l) => l[0] === 'DELETE' && l[1] === '/workflows/wf1'));
    assert.equal((await a.listar()).lista.length, 0);
  });

  test('«la siguiente publicación»: espera en pausa y se engancha sola al post que sale después', async () => {
    const media = [];
    const { fetchImpl, llamadas } = falso({ media });
    const a = createAutomatizaciones({ db: openDb(':memory:'), env: { ZERNIO_API_KEY: CLAVE }, fetchImpl, instagram });
    const r = await a.crear({ ...BASE, destino: 'siguiente', media_id: '' });
    assert.equal(r.estado, 'esperando');
    const ca = llamadas.find((l) => l[1] === '/comment-automations')[2];
    assert.equal(ca.isActive, false);
    assert.equal(ca.platformPostId, undefined);
    // Un post anterior no vale
    media.push({ id: 'viejo', caption: 'Antiguo', timestamp: '2020-01-01T10:00:00+0000' });
    assert.equal((await a.revisarSiguientes()).enganchadas, 0);
    media.unshift({ id: 'nuevo', caption: 'Mi reel nuevo', timestamp: new Date(Date.now() + 60000).toISOString() });
    assert.equal((await a.revisarSiguientes()).enganchadas, 1);
    assert.deepEqual(llamadas.at(-1), ['PATCH', '/comment-automations/ca1', { platformPostId: 'nuevo', postTitle: 'Mi reel nuevo', isActive: true }]);
    const { lista } = await a.listar();
    assert.equal(lista[0].estado, 'activa');
    assert.equal(lista[0].media_id, 'nuevo');
    // Sin la conexión de Meta no se puede saber cuándo sale
    const sinMeta = createAutomatizaciones({ db: openDb(':memory:'), env: { ZERNIO_API_KEY: CLAVE }, fetchImpl, instagram: null });
    await assert.rejects(sinMeta.crear({ ...BASE, destino: 'siguiente' }), /conéctalo con Facebook/);
  });

  test('si Zernio falla al crear, no queda nada a medias', async () => {
    const { fetchImpl: base, llamadas } = falso();
    const fetchImpl = async (url, o) => (String(url).endsWith('/comment-automations') && o?.method === 'POST' ? new Response(JSON.stringify({ error: { message: 'Post already has an active automation' } }), { status: 409 }) : base(url, o));
    const db = openDb(':memory:');
    const a = createAutomatizaciones({ db, env: { ZERNIO_API_KEY: CLAVE }, fetchImpl, instagram });
    await assert.rejects(a.crear({ ...BASE, pregunta: { texto: '¿Qué tal?' } }), /Zernio: Post already has an active automation/);
    assert.ok(llamadas.some((l) => l[0] === 'DELETE' && l[1].startsWith('/workflows/')), 'borra el flujo que llegó a crear');
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
});
