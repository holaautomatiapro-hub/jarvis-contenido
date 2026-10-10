import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { createAds, soloEnPausa, normalizarCuenta } from '../server/integrations/ads.js';
import { buildServer } from '../mcp/jarvis-mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const hace = (d) => new Date(Date.now() - d * 86400000).toISOString();

// Simulador de la Marketing API y la Ad Library; registra todo lo que se envía
function metaFalsa({ fallarEn } = {}) {
  const posts = [];
  const gets = [];
  let n = 100;
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, opts = {}) => {
    const u = new URL(url);
    const ruta = u.pathname.replace(/^\/v[\d.]+\//, '');
    if (opts.method === 'POST') {
      const body = Object.fromEntries(new URLSearchParams(opts.body));
      posts.push({ ruta, body });
      if (fallarEn && ruta.endsWith(fallarEn)) return json({ error: { code: 100, message: 'Invalid parameter', error_user_msg: 'El público es demasiado pequeño' } }, 400);
      return json({ id: String(++n) });
    }
    gets.push(ruta + u.search);
    if (ruta === 'me/adaccounts') return json({ data: [{ id: 'act_123', name: 'AutomatIA Pro', account_status: 1, currency: 'EUR' }] });
    if (ruta === 'act_123') return json({ name: 'AutomatIA Pro', currency: 'EUR', account_status: 1 });
    if (ruta === 'act_123/campaigns') return json({ data: [
      { id: 'c1', name: 'TOFU Septiembre', status: 'ACTIVE', effective_status: 'ACTIVE', objective: 'OUTCOME_ENGAGEMENT' },
      { id: 'c2', name: 'Vieja', status: 'ARCHIVED', effective_status: 'ARCHIVED' },
    ] });
    if (ruta === 'act_123/insights') {
      if (u.searchParams.get('time_increment')) return json({ data: [{ date_start: '2026-10-01', spend: '20.5', clicks: '100' }, { date_start: '2026-10-02', spend: '30', clicks: '140' }] });
      return json({ data: [{ campaign_id: 'c1', campaign_name: 'TOFU Septiembre', spend: '5421.36', impressions: '200000', reach: '120000', clicks: '5420', ctr: '2.71', cpc: '1.0003', cpm: '27.1', actions: [{ action_type: 'post_engagement', value: '9000' }, { action_type: 'lead', value: '150' }] }] });
    }
    if (ruta === 'ads_archive') {
      if (u.searchParams.get('search_terms') === 'Sin Verificar') return json({ error: { code: 10, message: 'Application does not have permission' } }, 400);
      return json({ data: [
        { id: 'lib1', page_id: '999', page_name: 'Marca Uno', ad_creative_bodies: ['Responde en 5 segundos'], ad_delivery_start_time: hace(90), publisher_platforms: ['instagram'], eu_total_reach: 50000 },
        { id: 'lib2', page_id: '999', page_name: 'Marca Uno', ad_creative_bodies: ['Webinar'], ad_delivery_start_time: hace(20), ad_delivery_stop_time: hace(10) },
      ] });
    }
    return json({ error: { code: 803, message: `ruta ${ruta}` } }, 404);
  };
  return { fetchImpl, posts, gets };
}

let db, vault, meta, ads;
const instagram = { conexion: () => ({ token: 'TP', tokenUsuario: 'TU', igUserId: 'ig1', paginaId: 'p1' }), estado: () => ({ conectado: true }) };

before(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-ads-'));
  const cfg = getConfig({});
  ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript);
  db = openDb(':memory:');
  vault = createVault(path.join(dir, 'V'));
  const ins = db.prepare("INSERT INTO ig_media (id, formato, caption, gancho, fecha, alcance, interacciones, guardados, compartidos, permalink) VALUES (?, 'Reels', ?, ?, ?, ?, ?, ?, ?, ?)");
  ins.run('r1', 'Reel top', 'Así recuperé 14 clientes', hace(3), 10000, 900, 400, 200, 'https://ig/r1');
  ins.run('r2', 'Reel normal', 'Otro reel', hace(5), 10000, 300, 50, 10, 'https://ig/r2');
  ins.run('r3', 'Reel flojo', 'Reel flojo', hace(8), 10000, 100, 5, 1, 'https://ig/r3');
  db.prepare("INSERT INTO comp_perfiles (username, nombre) VALUES ('marcauno', 'Marca Uno'), ('otro', 'Sin Verificar')").run();
  meta = metaFalsa();
  ads = createAds({ db, instagram, env: { ADS_PRESUPUESTO_MAX_DIA: '40' }, fetchImpl: meta.fetchImpl });
});

describe('regla de oro: todo en pausa', () => {
  test('soloEnPausa bloquea cualquier estado que no sea PAUSED', () => {
    assert.throws(() => soloEnPausa({ status: 'ACTIVE' }), /PAUSA/);
    assert.throws(() => soloEnPausa({}), /PAUSA/);
    assert.deepEqual(soloEnPausa({ status: 'PAUSED', name: 'x' }), { status: 'PAUSED', name: 'x' });
  });

  test('normaliza el ID de la cuenta', () => {
    assert.equal(normalizarCuenta('123'), 'act_123');
    assert.equal(normalizarCuenta('act_123'), 'act_123');
    assert.equal(normalizarCuenta(''), null);
  });
});

describe('cuenta y rendimiento', () => {
  test('sin cuenta elegida: error claro', async () => {
    await assert.rejects(ads.rendimiento(), /Falta la cuenta publicitaria/);
  });

  test('lista y elige cuenta; calcula totales, CTR, CPC y resultados', async () => {
    assert.equal((await ads.cuentas())[0].id, 'act_123');
    ads.elegirCuenta('123');
    const r = await ads.rendimiento({ dias: 30 });
    assert.equal(r.cuenta.moneda, 'EUR');
    assert.equal(r.campanas.length, 1, 'oculta campañas archivadas sin gasto');
    const c = r.campanas[0];
    assert.equal(c.gasto, 5421.36);
    assert.equal(c.ctr, 2.71);
    assert.equal(c.resultados, 150, 'prioriza leads frente a interacciones');
    assert.equal(c.tipoResultado, 'leads');
    assert.equal(r.totales.cpc, Math.round((5421.36 / 5420) * 100) / 100);
    assert.equal(r.diario.length, 2);
  });

  test('usa caché 15 minutos salvo que se fuerce', async () => {
    const antes = meta.gets.length;
    await ads.rendimiento({ dias: 30 });
    assert.equal(meta.gets.length, antes);
    await ads.rendimiento({ dias: 30, forzar: true });
    assert.ok(meta.gets.length > antes);
  });
});

describe('Ad Library', () => {
  test('busca por nombre o por ID de página, calcula días activo y explica el error de verificación', async () => {
    ads.paginaCompetidor('marcauno', '999');
    const r = await ads.sincronizarBiblioteca();
    assert.equal(r.anuncios, 2);
    assert.match(r.errores[0].error, /verifiques tu identidad/);
    assert.ok(meta.gets.some((g) => g.includes('search_page_ids')));
    const lib = ads.biblioteca();
    assert.equal(lib[0].id, 'lib1');
    assert.equal(lib[0].activo, true);
    assert.ok(lib[0].diasActivo >= 89);
    assert.equal(lib[1].activo, false);
  });
});

describe('qué impulsar', () => {
  test('recomienda la pieza que más se guarda y comparte', () => {
    const r = ads.recomendarImpulso();
    assert.equal(r[0].id, 'r1');
    assert.match(r[0].motivo, /más que tu media/);
  });
});

describe('borradores y creación', () => {
  test('validaciones: presupuesto máximo, días y publicación real', () => {
    assert.throws(() => ads.proponer({ publicacionId: 'r1', presupuestoDia: 41, dias: 7 }), /máximo permitido es 40/);
    assert.throws(() => ads.proponer({ publicacionId: 'r1', presupuestoDia: 10, dias: 45 }), /1 a 30 días/);
    assert.throws(() => ads.proponer({ publicacionId: 'nada', presupuestoDia: 10, dias: 7 }), /Elige una publicación/);
    assert.throws(() => ads.proponer({ publicacionId: 'demo-3', presupuestoDia: 10, dias: 7 }), /ejemplo/);
  });

  test('proponer NO llama a Meta; confirmar crea campaña, conjunto, creativo y anuncio, todo en pausa', async () => {
    const postsAntes = meta.posts.length;
    const b = ads.proponer({ publicacionId: 'r1', objetivo: 'interaccion', presupuestoDia: 10, dias: 7 }, 'claude');
    assert.equal(meta.posts.length, postsAntes, 'proponer no toca Meta');
    assert.equal(b.gastoMaximo, 70);
    const r = await ads.confirmar(b.id);
    assert.equal(r.estado, 'creada');
    const nuevos = meta.posts.slice(postsAntes);
    assert.deepEqual(nuevos.map((p) => p.ruta), ['act_123/campaigns', 'act_123/adsets', 'act_123/adcreatives', 'act_123/ads']);
    for (const p of nuevos.filter((x) => !x.ruta.endsWith('adcreatives'))) assert.equal(p.body.status, 'PAUSED', p.ruta);
    assert.ok(!nuevos.some((p) => JSON.stringify(p.body).includes('ACTIVE')), 'nunca se envía ACTIVE');
    const adset = nuevos[1].body;
    assert.equal(adset.daily_budget, '1000', 'céntimos');
    assert.equal(JSON.parse(adset.targeting).geo_locations.countries[0], 'ES');
    assert.equal(nuevos[2].body.source_instagram_media_id, 'r1');
    assert.match(r.enlace, /adsmanager\.facebook\.com.*act=123/);
    await assert.rejects(ads.confirmar(b.id), /ya se procesó/);
  });

  test('si falla a mitad, dice en qué paso y lo creado queda en pausa', async () => {
    const m2 = metaFalsa({ fallarEn: 'adsets' });
    const ads2 = createAds({ db, instagram, env: {}, fetchImpl: m2.fetchImpl });
    const b = ads2.proponer({ publicacionId: 'r2', presupuestoDia: 5, dias: 3 });
    await assert.rejects(ads2.confirmar(b.id), /conjunto de anuncios: Meta: El público es demasiado pequeño.*en pausa/);
    assert.equal(ads2.leerBorrador(b.id).estado, 'error');
    assert.equal(m2.posts.length, 2);
    assert.equal(m2.posts[0].body.status, 'PAUSED');
  });
});

describe('MCP', () => {
  test('JARVIS puede proponer pero no existe ninguna herramienta para crear ni activar', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(createJarvis({ db, vault }), { ads, origen: 'hermes' }).connect(a);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(b);
    const nombres = (await c.listTools()).tools.map((t) => t.name);
    assert.ok(nombres.includes('proponer_campana') && nombres.includes('ads_rendimiento'));
    assert.ok(!nombres.some((n) => /confirm|crear_campana|activar/.test(n)));
    const antes = meta.posts.length;
    const r = JSON.parse((await c.callTool({ name: 'proponer_campana', arguments: { publicacionId: 'r1', objetivo: 'alcance', presupuestoDia: 8, dias: 5 } })).content[0].text);
    assert.equal(r.estado, 'borrador');
    assert.match(r.aviso, /PAUSA/);
    assert.equal(meta.posts.length, antes);
    assert.equal(ads.leerBorrador(r.id).origen, 'hermes');
  });
});
