import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { createAds } from '../server/integrations/ads.js';
import { metricasDe, resultadoDe } from '../server/integrations/ads-explorador.js';
import { buildServer } from '../mcp/jarvis-mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const INS_ANUNCIO = {
  spend: '100', impressions: '20000', reach: '12000', frequency: '1.6667', clicks: '500', inline_link_clicks: '300', ctr: '2.5', inline_link_click_ctr: '1.5', cpc: '0.2', cost_per_inline_link_click: '0.3333', cpm: '5',
  actions: [{ action_type: 'link_click', value: '300' }, { action_type: 'video_view', value: '6000' }, { action_type: 'lead', value: '20' }, { action_type: 'onsite_conversion.post_save', value: '45' }],
  video_thruplay_watched_actions: [{ action_type: 'video_view', value: '1500' }], video_p100_watched_actions: [{ action_type: 'video_view', value: '900' }],
  quality_ranking: 'ABOVE_AVERAGE',
};

// Simulador de la Marketing API: registra lo que se pide
function metaFalsa() {
  const gets = [];
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url) => {
    const u = new URL(url);
    const ruta = u.pathname.replace(/^\/v[\d.]+\//, '');
    const p = Object.fromEntries(u.searchParams);
    gets.push({ ruta, p });
    if (ruta === 'me/adaccounts') return json({ data: [{ id: 'act_123', name: 'Mía', account_status: 1, currency: 'EUR', business: { id: '77', name: 'AutomatIA' } }, { id: 'act_555', name: 'Personal', account_status: 1, currency: 'EUR' }] });
    if (ruta === 'me/businesses') return json({ data: [{ id: '77', name: 'AutomatIA' }] });
    if (ruta === '77/owned_ad_accounts') return json({ data: [{ id: 'act_123', name: 'Mía', account_status: 1, currency: 'EUR' }] });
    if (ruta === '77/client_ad_accounts') return json({ data: [{ id: 'act_999', name: 'Cliente', account_status: 2, currency: 'USD' }] });
    if (ruta === 'act_123') return json({ name: 'Mía', currency: 'EUR', account_status: 1, business: { name: 'AutomatIA' } });
    if (ruta === 'act_123/campaigns') return json({ data: [
      { id: '111', name: 'Leads', effective_status: 'ACTIVE', objective: 'OUTCOME_LEADS', daily_budget: '2500' },
      { id: '112', name: 'Sin gasto', effective_status: 'PAUSED', objective: 'OUTCOME_ENGAGEMENT', lifetime_budget: '30000' },
    ] });
    if (ruta === '111/adsets') return json({ data: [{ id: '211', name: 'Lookalike', effective_status: 'ACTIVE', campaign_id: '111', campaign: { name: 'Leads', objective: 'OUTCOME_LEADS', daily_budget: '2500' }, optimization_goal: 'LEAD_GENERATION' }] });
    if (ruta === 'act_123/insights' || ruta === '111/insights') {
      if (!p.level) return json({ data: [{ ...INS_ANUNCIO, spend: '150', impressions: '30000' }] });
      if (p.level === 'campaign') return json({ data: [{ campaign_id: '111', ...INS_ANUNCIO }] });
      if (p.level === 'adset') return json({ data: [{ adset_id: '211', ...INS_ANUNCIO }] });
    }
    if (ruta === '311') return json({ id: '311', name: 'Reel guía', effective_status: 'ACTIVE', campaign_id: '111', adset_id: '211', campaign: { name: 'Leads', objective: 'OUTCOME_LEADS' }, adset: { name: 'Lookalike', optimization_goal: 'LEAD_GENERATION' }, creative: { id: '411' }, preview_shareable_link: 'https://fb.me/x' });
    if (ruta === '411') return json({ id: '411', body: 'Descarga la guía', title: 'Guía gratis', call_to_action_type: 'LEARN_MORE', thumbnail_url: 'https://img/t.jpg', object_story_spec: { link_data: { link: 'https://web/guia' } } });
    if (ruta === '311/insights') {
      if (p.breakdowns === 'gender') return json({ error: { code: 100, message: 'no' } }, 400);
      if (p.breakdowns === 'age') return json({ data: [{ age: '25-34', ...INS_ANUNCIO }, { age: '35-44', ...INS_ANUNCIO, spend: '300' }] });
      if (p.breakdowns) return json({ data: [] });
      if (p.time_increment) return json({ data: [{ date_start: '2026-10-01', ...INS_ANUNCIO }, { date_start: '2026-10-02', ...INS_ANUNCIO }] });
      return json({ data: [INS_ANUNCIO] });
    }
    return json({ error: { code: 803, message: `ruta ${ruta}` } }, 404);
  };
  return { fetchImpl, gets };
}

let db, vault, meta, ads;
const conectada = { conexion: () => ({ tokenUsuario: 'TU' }), estado: () => ({ conectado: true }) };

before(() => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-adsx-'));
  const cfg = getConfig({});
  ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript);
  db = openDb(':memory:');
  vault = createVault(path.join(dir, 'V'));
  meta = metaFalsa();
  ads = createAds({ db, instagram: conectada, env: { META_AD_ACCOUNT_ID: '123' }, fetchImpl: meta.fetchImpl });
});

describe('métricas', () => {
  test('saca todas las métricas de una fila de Meta', () => {
    const m = metricasDe(INS_ANUNCIO);
    assert.equal(m.gasto, 100);
    assert.equal(m.frecuencia, 1.67);
    assert.equal(m.leads, 20);
    assert.equal(m.coste_lead, 5);
    assert.equal(m.guardados, 45);
    assert.equal(m.thruplay, 1500);
    assert.equal(m.hook_rate, 30); // 6000 de 20000 impresiones
    assert.equal(m.hold_rate, 25); // 1500 de 6000
    assert.equal(m.calidad, 'Por encima de la media');
    assert.equal(m.compras, 0);
    assert.equal(m.roas, 0);
  });
  test('el resultado depende de para qué se optimiza', () => {
    const m = metricasDe(INS_ANUNCIO);
    assert.equal(resultadoDe(m, { optimizacion: 'LEAD_GENERATION' }).resultados, 20);
    assert.equal(resultadoDe(m, { optimizacion: 'THRUPLAY' }).resultados, 1500);
    assert.equal(resultadoDe(m, { objetivo: 'OUTCOME_TRAFFIC' }).tipoResultado, 'clics en el enlace');
    assert.equal(resultadoDe(metricasDe({}), {}).resultados, 0);
  });
});

describe('Administrador de anuncios', () => {
  test('cuentas de todos los Business Manager, sin repetir', async () => {
    const r = await ads.cuentasNegocio();
    const bm = r.grupos.find((g) => g.negocio?.id === '77');
    assert.deepEqual(bm.cuentas.map((c) => c.id), ['act_123', 'act_999']);
    assert.deepEqual(r.grupos.find((g) => !g.negocio).cuentas.map((c) => c.id), ['act_555']);
    assert.equal(r.porDefecto, 'act_123');
  });

  test('campañas con sus métricas, presupuestos y total', async () => {
    const r = await ads.explorar({ nivel: 'campanas', periodo: 'last_7d' });
    assert.equal(r.cuenta.negocio, 'AutomatIA');
    const [leads, sinGasto] = r.filas;
    assert.equal(leads.m.gasto, 100);
    assert.equal(leads.m.resultados, 20); // objetivo leads
    assert.deepEqual(leads.m.presupuesto, { valor: 25, tipo: 'diario' });
    assert.deepEqual(sinGasto.m.presupuesto, { valor: 300, tipo: 'total' });
    assert.equal(sinGasto.m.gasto, 0);
    assert.equal(sinGasto.m.estado, 'En pausa');
    assert.match(leads.enlace, /manage\/campaigns\?act=123&selected_campaign_ids=111/);
    assert.equal(r.total.m.gasto, 150);
    assert.equal(r.total.m.resultados, 20); // todas las filas cuentan leads
    assert.ok(r.columnasAcciones.some((c) => c.id === 'accion:onsite_conversion.post_save' && c.nombre === 'Guardados'));
    const pedido = meta.gets.find((g) => g.ruta === 'act_123/campaigns');
    assert.deepEqual(JSON.parse(pedido.p.effective_status), ['ACTIVE', 'PAUSED', 'IN_PROCESS', 'WITH_ISSUES']);
    assert.ok(meta.gets.some((g) => g.ruta === 'act_123/insights' && g.p.level === 'campaign' && g.p.date_preset === 'last_7d'));
  });

  test('los conjuntos de una campaña se piden a la campaña, y la caché evita repetir', async () => {
    const antes = meta.gets.length;
    const r = await ads.explorar({ nivel: 'conjuntos', campana: '111' });
    assert.equal(r.filas[0].campana.nombre, 'Leads');
    assert.equal(r.filas[0].m.presupuesto.tipo, 'campaña'); // presupuesto en la campaña
    assert.equal(r.filas[0].m.optimizacion, 'Clientes potenciales');
    assert.ok(meta.gets.slice(antes).some((g) => g.ruta === '111/insights' && g.p.level === 'adset'));
    const n = meta.gets.length;
    await ads.explorar({ nivel: 'conjuntos', campana: '111' });
    assert.equal(meta.gets.length, n);
    await ads.explorar({ nivel: 'conjuntos', campana: '111', forzar: true });
    assert.ok(meta.gets.length > n);
  });

  test('rechaza identificadores y fechas raros', async () => {
    await assert.rejects(() => ads.explorar({ nivel: 'conjuntos', campana: '1/../me' }), /no válido/);
    await assert.rejects(() => ads.explorar({ nivel: 'nada' }), /Nivel/);
    await assert.rejects(() => ads.explorar({ nivel: 'campanas', desde: '2026-10-05', hasta: '2026-10-01' }), /fechas/);
    await assert.rejects(() => ads.explorar({ nivel: 'campanas', cuenta: 'act_12x' }), /no válida/);
  });

  test('detalle de un anuncio: creativo, día a día y repartos (aunque uno falle)', async () => {
    const d = await ads.detalle({ nivel: 'anuncios', id: '311', periodo: 'last_30d' });
    assert.equal(d.fila.nombre, 'Reel guía');
    assert.equal(d.fila.m.resultados, 20);
    assert.equal(d.creativo.texto, 'Descarga la guía');
    assert.equal(d.creativo.enlace, 'https://web/guia');
    assert.equal(d.vistaPrevia, 'https://fb.me/x');
    assert.equal(d.diario.length, 2);
    assert.deepEqual(d.desgloses.edad.map((x) => x.clave), ['35-44', '25-34']); // por gasto
    assert.equal(d.desgloses.sexo, null);
    assert.ok(meta.gets.some((g) => g.ruta === '411' && g.p.thumbnail_width === '600'));
  });

  test('columnas: se guardan las válidas', () => {
    assert.ok(ads.columnas().elegidas.includes('gasto'));
    const r = ads.guardarColumnas(['gasto', 'inventada', 'accion:lead', 'gasto']);
    assert.deepEqual(r.elegidas, ['gasto', 'accion:lead']);
    assert.throws(() => ads.guardarColumnas([]), /al menos/);
  });

  test('sin conexión enseña el ejemplo', async () => {
    const sin = createAds({ db: openDb(':memory:'), instagram: { conexion: () => null, estado: () => ({ conectado: false }) }, env: {}, fetchImpl: meta.fetchImpl });
    const r = await sin.explorar({ nivel: 'anuncios', conjunto: '9101' });
    assert.ok(r.demo);
    assert.ok(r.filas.length > 0 && r.filas.every((f) => f.conjunto.id === '9101'));
    assert.ok((await sin.cuentasNegocio()).demo);
    const d = await sin.detalle({ nivel: 'conjuntos', id: '9201' });
    assert.ok(d.segmentacion && d.diario.length === 30);
  });

  test('herramientas del MCP', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(createJarvis({ db, vault }), { ads }).connect(a);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(b);
    const r = JSON.parse((await c.callTool({ name: 'ads_explorar', arguments: { nivel: 'campanas' } })).content[0].text);
    assert.equal(r.filas[0].metricas.leads, 20);
    assert.equal(r.filas[1].metricas.gasto, undefined); // los ceros no se mandan
    const d = JSON.parse((await c.callTool({ name: 'ads_detalle', arguments: { nivel: 'anuncios', id: '311' } })).content[0].text);
    assert.equal(d.creativo.titulo, 'Guía gratis');
  });
});
