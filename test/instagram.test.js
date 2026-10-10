import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { createInstagram, agregar, formatoDe, PERMISOS } from '../server/integrations/instagram.js';
import { demoInstagram } from '../server/integrations/instagram-demo.js';
import { createGraph, MetaError } from '../server/integrations/meta.js';
import { buildServer } from '../mcp/jarvis-mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const hace = (d) => new Date(Date.now() - d * 86400000).toISOString();

// Simulador de la Graph API: responde según la ruta
function metaFalsa({ tokenValido = 'TOKEN_PAGINA' } = {}) {
  const llamadas = [];
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const MEDIA = [
    { id: 'm1', caption: 'Deja de contestar WhatsApps a mano. Te enseño cómo.', media_type: 'VIDEO', media_product_type: 'REELS', permalink: 'https://instagram.com/p/m1', thumbnail_url: 'https://cdn/t1.jpg', media_url: 'https://cdn/v1.mp4', timestamp: hace(2), like_count: 300, comments_count: 40 },
    { id: 'm2', caption: '7 prompts para vender', media_type: 'CAROUSEL_ALBUM', media_product_type: 'FEED', permalink: 'https://instagram.com/p/m2', media_url: 'https://cdn/c2.jpg', timestamp: hace(5), like_count: 120, comments_count: 10 },
    { id: 'm3', caption: 'Foto antigua', media_type: 'IMAGE', media_product_type: 'FEED', permalink: 'https://instagram.com/p/m3', media_url: 'https://cdn/i3.jpg', timestamp: hace(45), like_count: 50, comments_count: 2 },
  ];
  const fetchImpl = async (url) => {
    const u = new URL(url);
    llamadas.push(u.pathname + u.search);
    if (u.hostname === 'cdn') return new Response(new Uint8Array([1, 2, 3]));
    const ruta = u.pathname.replace(/^\/v[\d.]+\//, '');
    const tok = u.searchParams.get('access_token');
    if (ruta === 'me/accounts') {
      if (tok !== 'TOKEN_USUARIO') return json({ error: { code: 190, message: 'Invalid OAuth access token' } }, 400);
      return json({ data: [{ id: 'p0', name: 'Página sin IG', access_token: 'X' }, { id: 'p1', name: 'AutomatIA Pro', access_token: tokenValido, instagram_business_account: { id: 'ig1', username: 'automatia', profile_picture_url: 'https://cdn/foto.jpg' } }] });
    }
    if (tok !== tokenValido) return json({ error: { code: 190, message: 'expired' } }, 400);
    if (ruta === 'ig1') return json({ username: 'automatia', followers_count: 18500, media_count: 3 });
    if (ruta === 'ig1/insights') {
      const met = u.searchParams.get('metric');
      const values = Array.from({ length: 5 }, (_, i) => ({ value: met === 'reach' ? 1000 + i * 100 : 10 + i, end_time: new Date(Date.now() - (4 - i) * 86400000).toISOString() }));
      return json({ data: [{ name: met, period: 'day', values }] });
    }
    if (ruta === 'ig1/media') return json({ data: MEDIA });
    const mi = ruta.match(/^(m\d)\/insights$/);
    if (mi) {
      const pedidas = u.searchParams.get('metric').split(',');
      // Las imágenes no admiten "views" ni "shares" juntas con el resto: error 100
      if (mi[1] === 'm3' && pedidas.length > 3) return json({ error: { code: 100, message: 'metric not supported' } }, 400);
      if (mi[1] === 'm3' && (pedidas.includes('views') || pedidas.includes('shares'))) return json({ error: { code: 100, message: 'metric not supported' } }, 400);
      const val = { reach: { m1: 9000, m2: 4000, m3: 800 }, views: { m1: 15000, m2: 6000 }, saved: { m1: 120, m2: 300, m3: 5 }, shares: { m1: 80, m2: 40 }, total_interactions: { m1: 540, m2: 470, m3: 57 }, likes: { m1: 300, m2: 120, m3: 50 }, comments: { m1: 40, m2: 10, m3: 2 }, ig_reels_avg_watch_time: { m1: 8400 } };
      return json({ data: pedidas.filter((p) => val[p]?.[mi[1]] != null).map((p) => ({ name: p, values: [{ value: val[p][mi[1]] }] })) });
    }
    return json({ error: { code: 803, message: `ruta desconocida ${ruta}` } }, 404);
  };
  return { fetchImpl, llamadas };
}

let dir, db, vault, ig, meta;
before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-ig-'));
  const cfg = getConfig({});
  ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript);
  db = openDb(':memory:');
  vault = createVault(path.join(dir, 'V'));
  meta = metaFalsa();
  ig = createInstagram({ db, vault, env: { ELEVENLABS_API_KEY: 'k' }, fetchImpl: meta.fetchImpl, sttImpl: async () => 'Deja de contestar WhatsApps a mano. Hoy te enseño el sistema que uso.' });
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('Graph API', () => {
  test('errores traducidos (token caducado)', async () => {
    const g = createGraph({ token: 'malo', fetchImpl: meta.fetchImpl });
    await assert.rejects(g.get('ig1'), (e) => e instanceof MetaError && e.caducado && /Vuelve a conectar/.test(e.message));
  });
  test('sin internet: mensaje claro', async () => {
    const g = createGraph({ token: 't', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
    await assert.rejects(g.get('ig1'), /No puedo conectar con Meta/);
  });
  test('formatos', () => {
    assert.equal(formatoDe({ media_type: 'VIDEO', media_product_type: 'REELS' }), 'Reels');
    assert.equal(formatoDe({ media_type: 'CAROUSEL_ALBUM' }), 'Carruseles');
    assert.equal(formatoDe({ media_type: 'IMAGE' }), 'Imágenes');
  });
});

describe('conexión', () => {
  test('sin conectar: dashboards con datos de ejemplo', () => {
    const r = ig.resumen({ dias: 30 });
    assert.equal(r.demo, true);
    assert.equal(r.estado.conectado, false);
    assert.ok(r.piezas.length > 5 && r.temas.length > 2);
  });

  test('URL de OAuth con permisos y state (requiere app configurada)', () => {
    assert.throws(() => ig.urlConexion('http://localhost:3333/cb', 's'), /META_APP_ID/);
    const conApp = createInstagram({ db, vault, env: { META_APP_ID: '123', META_APP_SECRET: 's' } });
    const u = new URL(conApp.urlConexion('http://localhost:3333/api/instagram/callback', 'abc'));
    assert.equal(u.searchParams.get('client_id'), '123');
    assert.equal(u.searchParams.get('state'), 'abc');
    assert.equal(u.searchParams.get('scope'), PERMISOS.join(','));
    const empresa = createInstagram({ db, vault, env: { META_APP_ID: '123', META_APP_SECRET: 's', META_CONFIG_ID: '999' } });
    const u2 = new URL(empresa.urlConexion('http://localhost:3333/cb', 'x'));
    assert.equal(u2.searchParams.get('config_id'), '999');
    assert.equal(u2.searchParams.get('scope'), null);
  });

  test('token inválido da un error claro', async () => {
    await assert.rejects(ig.conectarConToken('malo'), /Vuelve a conectar/);
  });

  test('conecta con token: elige la página que tiene Instagram y guarda el token de página', async () => {
    const r = await ig.conectarConToken('TOKEN_USUARIO');
    assert.equal(r.username, 'automatia');
    assert.equal(r.pagina, 'AutomatIA Pro');
    assert.equal(ig.conexion().token, 'TOKEN_PAGINA');
    assert.equal(ig.estado().conectado, true);
  });
});

describe('sincronización', () => {
  test('trae publicaciones, métricas (con métricas no soportadas) y series de la cuenta', async () => {
    const r = await ig.sincronizar();
    assert.equal(r.publicaciones, 3);
    const res = ig.resumen({ dias: 30 });
    assert.equal(res.demo, false);
    const m1 = res.piezas.find((p) => p.id === 'm1');
    assert.equal(m1.alcance, 9000);
    assert.equal(m1.views, 15000);
    assert.equal(m1.ver_medio_ms, 8400);
    assert.equal(m1.formato, 'Reels');
    assert.ok(!res.piezas.some((p) => p.id === 'm3'), 'la de hace 45 días queda fuera de 30 días');
    const m3 = ig.resumen({ dias: 90 }).piezas.find((p) => p.id === 'm3');
    assert.equal(m3.alcance, 800, 'se recuperan las métricas básicas aunque falle el lote completo');
    assert.equal(m3.views, null);
    const k = Object.fromEntries(res.kpis.map((x) => [x.id, x]));
    assert.equal(k.alcance.value, 1000 + 1100 + 1200 + 1300 + 1400, 'alcance de la cuenta por días');
    assert.equal(k.seguidores.value, 18500);
    assert.equal(k.seguidores.extra, 10 + 11 + 12 + 13 + 14);
    assert.equal(k.guardados.value, 420);
  });

  test('transcribe los reels a 03-Transcripciones con sus métricas y saca el gancho', () => {
    const notas = vault.list().filter((n) => n.carpeta === '03-Transcripciones');
    assert.equal(notas.length, 1);
    const md = vault.read(notas[0].path).contenido;
    assert.match(md, /tipo: transcripcion/);
    assert.match(md, /ig_id: m1/);
    assert.match(md, /alcance: 9000/);
    assert.match(md, /## Transcripción\n\nDeja de contestar WhatsApps/);
    const m1 = ig.resumen({ dias: 30 }).piezas.find((p) => p.id === 'm1');
    assert.equal(m1.transcrita, true);
    assert.equal(m1.gancho, 'Deja de contestar WhatsApps a mano.');
    assert.equal(ig.estado().transcripcion.hechas, 1);
  });

  test('volver a sincronizar no duplica ni vuelve a transcribir', async () => {
    await ig.sincronizar();
    assert.equal(vault.list().filter((n) => n.carpeta === '03-Transcripciones').length, 1);
    assert.equal(ig.resumen({ dias: 90 }).piezas.length, 3);
  });

  test('temas: sin tema → etiquetar → aparecen en los insights', () => {
    assert.equal(ig.sinTema().length, 3);
    ig.etiquetar([{ id: 'm1', tema: 'Automatización' }, { id: 'm2', tema: 'Herramientas' }, { id: 'm3', tema: '' }]);
    assert.equal(ig.sinTema().length, 1);
    const temas = ig.resumen({ dias: 30 }).temas.map((t) => t.tema);
    assert.deepEqual(temas.sort(), ['Automatización', 'Herramientas']);
  });
});

describe('agregación', () => {
  test('KPIs, formatos y comparación con el periodo anterior', () => {
    const { media, serie } = demoInstagram();
    const r = agregar({ media, serie, dias: 30 });
    assert.equal(r.diaria.length, 30);
    assert.equal(r.formatos.reduce((a, f) => a + f.pct, 0) >= 99, true);
    assert.ok(r.kpis.every((k) => Array.isArray(k.series)));
    assert.ok(typeof r.kpis[0].delta === 'number');
    assert.ok(r.piezas.every((p) => typeof p.vsMedia === 'number'));
  });
});

describe('MCP', () => {
  test('metricas_instagram y etiquetar_publicaciones', async () => {
    const jarvis = createJarvis({ db, vault });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(jarvis, { instagram: ig }).connect(a);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(b);
    const r = JSON.parse((await c.callTool({ name: 'metricas_instagram', arguments: { dias: 30 } })).content[0].text);
    assert.equal(r.cuenta, '@automatia');
    assert.equal(r.datosDeEjemplo, false);
    assert.equal(r.piezas[0].id, 'm1');
    const e = JSON.parse((await c.callTool({ name: 'etiquetar_publicaciones', arguments: { etiquetas: [{ id: 'm3', tema: 'Mentalidad' }] } })).content[0].text);
    assert.equal(e.etiquetadas, 1);
    assert.equal(ig.sinTema().length, 0);
  });
});
