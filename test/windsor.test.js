import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createInstagram } from '../server/integrations/instagram.js';
import { mediaDeWindsor, normalizarFecha } from '../server/integrations/windsor.js';

const dia = (n) => new Date(Date.now() - n * 86400000).toLocaleDateString('sv-SE');

// Windsor de mentira: acepta solo los campos que "tiene" el plan y cuenta las peticiones
function windsorFalso({ validos, filas }) {
  const peticiones = [];
  const fetchImpl = async (u) => {
    const url = new URL(u);
    assert.equal(url.origin, 'https://connectors.windsor.ai');
    assert.equal(url.searchParams.get('api_key'), 'clave-windsor-123456');
    const campos = url.searchParams.get('fields').split(',');
    peticiones.push(campos);
    const malos = campos.filter((c) => !validos.has(c));
    if (malos.length) return new Response(JSON.stringify({ error: `Unknown field ${malos[0]}` }), { status: 400 });
    const grupo = campos.includes('media_id') ? 'media' : campos.includes('story_id') ? 'historias' : 'cuenta';
    return new Response(JSON.stringify({ data: filas[grupo].map((f) => Object.fromEntries(campos.map((c) => [c, f[c] ?? null]))) }));
  };
  return { fetchImpl, peticiones };
}

test('normaliza fechas y filas de Windsor', () => {
  assert.equal(normalizarFecha('2026-10-01T10:00:00+0000'), '2026-10-01T10:00:00+00:00');
  const m = mediaDeWindsor({ media_id: 1, media_type: 'VIDEO', media_product_type: 'REELS', timestamp: '2026-10-01T10:00:00+0000', media_views: '1200', media_reach: 900, media_like_count: 50, media_comments_count: 5, media_saved: 10, media_shares: 3, media_reels_avg_watch_time: 7400, media_url: 'https://v.mp4' });
  assert.equal(m.formato, 'Reels');
  assert.equal(m.views, 1200);
  assert.equal(m.interacciones, 68);
  assert.equal(m.media_url, 'https://v.mp4');
  assert.equal(JSON.parse(m.extra).media_reels_avg_watch_time, 7400);
  assert.equal(mediaDeWindsor({ media_id: 2, media_type: 'CAROUSEL_ALBUM', timestamp: 'x' }).formato, 'Carruseles');
});

test('sin app de Meta, Windsor llena los dashboards y guarda todas las métricas', async () => {
  const validos = new Set([
    'media_id', 'timestamp', 'media_type', 'media_caption', 'media_permalink', 'media_thumbnail_url', 'media_views', 'media_reach', 'media_like_count', 'media_comments_count', 'media_saved', 'media_shares',
    'media_product_type', 'media_total_interactions',
    'date', 'followers_count', 'follower_count', 'reach', 'profile_views', 'website_clicks', 'username',
  ]); // historias no existen en este plan
  const filas = {
    media: [
      { media_id: '111', timestamp: `${dia(2)}T10:00:00+0000`, media_type: 'VIDEO', media_product_type: 'REELS', media_caption: 'Tres errores al grabar. Y uno más', media_views: 5000, media_reach: 3000, media_like_count: 200, media_comments_count: 10, media_saved: 40, media_shares: 12, media_total_interactions: 262 },
      { media_id: '222', timestamp: `${dia(5)}T10:00:00+0000`, media_type: 'CAROUSEL_ALBUM', media_views: 1000, media_reach: 800, media_like_count: 50 },
      { media_id: null, timestamp: null, media_views: 6000 }, // fila de totales
    ],
    cuenta: [
      { date: dia(1), username: 'micuenta', followers_count: 1500, follower_count: 12, reach: 2000, profile_views: 90, website_clicks: 4 },
      { date: dia(2), username: 'micuenta', followers_count: 1488, follower_count: 8, reach: 1500, profile_views: 60, website_clicks: 2 },
    ],
    historias: [],
  };
  const { fetchImpl, peticiones } = windsorFalso({ validos, filas });
  const db = openDb(':memory:');
  const ig = createInstagram({ db, vault: null, env: { WINDSOR_API_KEY: 'clave-windsor-123456' }, fetchImpl });

  const antes = ig.estado();
  assert.equal(antes.conectado, true);
  assert.equal(antes.fuente, 'windsor');
  assert.equal(ig.resumen().demo, true, 'hasta la primera sincronización, datos de ejemplo');

  const r = await ig.sincronizar({ transcribir: false });
  assert.equal(r.fuente, 'windsor');
  assert.equal(r.publicaciones, 2);
  assert.equal(r.dias, 2);
  assert.equal(r.historias, 0);

  const res = ig.resumen({ dias: 30 });
  assert.equal(res.demo, false);
  const k = Object.fromEntries(res.kpis.map((x) => [x.id, x.value]));
  assert.equal(k.alcance, 3500, 'alcance diario de la cuenta');
  assert.equal(k.views, 6000);
  assert.equal(k.seguidores, 1500);
  assert.equal(res.piezas[0].gancho, 'Tres errores al grabar.');
  const todas = Object.fromEntries(res.todas.cuenta.map((m) => [m.id, m.valor]));
  assert.equal(todas.profile_views, 150);
  assert.equal(todas.website_clicks, 6);
  assert.equal(todas.followers_count, 1500, 'los seguidores son el último valor, no la suma');
  assert.equal(res.todas.cuenta.find((m) => m.id === 'profile_views').label, 'Visitas al perfil');
  assert.equal(ig.estado().username, 'micuenta');

  // La segunda vez ya sabe qué campos valen: solo 2 peticiones de datos (las historias no existen)
  const n = peticiones.length;
  await ig.sincronizar({ transcribir: false });
  assert.equal(peticiones.length - n, 2);
  assert.ok(peticiones.at(-1).includes('profile_views'));
  assert.ok(!peticiones.at(-1).includes('impressions'), 'descarta lo que el plan no tiene');
});

test('una clave mala da un error claro', async () => {
  const fetchImpl = async () => new Response('{"error":"Invalid api_key"}', { status: 401 });
  const ig = createInstagram({ db: openDb(':memory:'), vault: null, env: { WINDSOR_API_KEY: 'clave-mala-1234567890' }, fetchImpl });
  await assert.rejects(ig.sincronizar({ transcribir: false }), /no acepta la clave/);
  assert.match(ig.estado().error, /no acepta la clave/);
});

test('métricas que solo admiten los últimos 30 días se piden aparte y se juntan', async () => {
  const peticiones = [];
  const fetchImpl = async (u) => {
    const url = new URL(u);
    const campos = url.searchParams.get('fields').split(',');
    const desde = url.searchParams.get('date_from');
    peticiones.push({ campos, desde });
    const conocidos = new Set(['media_id', 'timestamp', 'media_views', 'date', 'reach', 'follower_count', 'followers_count']);
    const malos = campos.filter((c) => !conocidos.has(c));
    if (malos.length) return new Response(JSON.stringify({ error: `Unknown field(s): ${malos.join(', ')}` }), { status: 400 });
    if (campos.includes('follower_count') && desde < dia(30)) {
      return new Response(JSON.stringify({ error: '(follower_count) supports the last 30 days only. Use date_preset=last_30d, or a date_from within the last 30 days. [Error pulling data for account 123]' }), { status: 400 });
    }
    if (campos.includes('media_id')) return new Response(JSON.stringify({ data: [{ media_id: 'a', timestamp: `${dia(3)}T10:00:00+0000`, media_views: 10 }] }));
    const dias = [dia(1), dia(2), dia(200)];
    return new Response(JSON.stringify({ data: dias.filter((d) => d >= desde).map((d) => Object.fromEntries(campos.map((c) => [c, c === 'date' ? d : c === 'follower_count' ? 5 : 100]))) }));
  };
  const db = openDb(':memory:');
  const ig = createInstagram({ db, vault: null, env: { WINDSOR_API_KEY: 'clave-windsor-123456' }, fetchImpl });
  const r = await ig.sincronizar({ transcribir: false });
  assert.deepEqual(r.avisos, []);
  assert.equal(r.dias, 3);
  const nuevos = db.prepare("SELECT fecha, valor FROM ig_serie WHERE metrica = 'nuevos' ORDER BY fecha").all();
  assert.deepEqual(nuevos.map((x) => x.fecha), [dia(2), dia(1)], 'seguidores nuevos solo de los últimos 30 días');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM ig_serie WHERE metrica = 'alcance'").get().n, 3, 'el alcance sí trae todo el año');
  // La segunda vez ya sabe el límite: no vuelve a fallar
  const n = peticiones.length;
  await ig.sincronizar({ transcribir: false });
  const nuevas = peticiones.slice(n);
  assert.equal(nuevas.length, 3, 'publicaciones + cuenta (sin límite) + cuenta (follower_count, 30 días)');
});

test('si fallan las métricas de la cuenta, las publicaciones se guardan y se avisa', async () => {
  const fetchImpl = async (u) => {
    const campos = new URL(u).searchParams.get('fields').split(',');
    if (campos.includes('media_id')) return new Response(JSON.stringify({ data: campos.length > 2 ? [] : [{ media_id: 'a', timestamp: `${dia(1)}T10:00:00+0000` }] }));
    if (campos.length === 1) return new Response(JSON.stringify({ data: [] }));
    return new Response(JSON.stringify({ error: 'Something odd for account 1' }), { status: 400 });
  };
  const ig = createInstagram({ db: openDb(':memory:'), vault: null, env: { WINDSOR_API_KEY: 'clave-windsor-123456' }, fetchImpl });
  const r = await ig.sincronizar({ transcribir: false });
  assert.equal(r.ok, true);
  assert.equal(ig.estado().error, null);
});

test('una sincronización que no trae me gusta ni comentarios no borra los que ya había', async () => {
  const validos = new Set(['media_id', 'timestamp', 'media_type', 'media_reach', 'media_like_count', 'media_comments_count', 'media_saved', 'date', 'reach']);
  const filas = {
    media: [{ media_id: '333', timestamp: `${dia(3)}T10:00:00+0000`, media_type: 'CAROUSEL_ALBUM', media_reach: 400, media_like_count: 30, media_comments_count: 65, media_saved: 15 }],
    cuenta: [{ date: dia(1), reach: 500 }],
    historias: [],
  };
  const { fetchImpl } = windsorFalso({ validos, filas });
  const db = openDb(':memory:');
  const ig = createInstagram({ db, vault: null, env: { WINDSOR_API_KEY: 'clave-windsor-123456' }, fetchImpl });
  await ig.sincronizar({ transcribir: false });
  filas.media[0] = { ...filas.media[0], media_like_count: null, media_comments_count: null };
  await ig.sincronizar({ transcribir: false });
  const p = ig.resumen({ dias: 30 }).piezas.find((x) => x.id === '333');
  assert.equal(p.comentarios, 65);
  assert.equal(p.likes, 30);
});
