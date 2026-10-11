import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { createApp } from '../server/index.js';
import { buildServer } from '../mcp/jarvis-mcp.js';

let dir, jarvis, server, base, cambios = 0;
before(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-api-'));
  const cfg = getConfig({});
  ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript);
  jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
  server = http.createServer();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  server.on('request', createApp({ jarvis, port, onChange: () => cambios++, status: async () => [] }));
  base = `http://127.0.0.1:${port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const api = (p, opts = {}) => fetch(base + p, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });

describe('API REST', () => {
  test('rechaza otros Host (DNS rebinding)', async () => {
    const status = await new Promise((ok, ko) => {
      const u = new URL(base);
      http.get({ host: u.hostname, port: u.port, path: '/api/health', headers: { host: 'evil.example:3333' } }, (r) => { r.resume(); ok(r.statusCode); }).on('error', ko);
    });
    assert.equal(status, 403);
  });

  test('inicio vacío devuelve datos de ejemplo', async () => {
    const r = await (await api('/api/inicio')).json();
    assert.equal(r.demo, true);
  });

  test('crear idea por la API y verla en el pipeline', async () => {
    const r = await api('/api/ideas', { method: 'POST', body: JSON.stringify({ texto: 'Idea desde el dashboard' }) });
    assert.equal(r.status, 200);
    const piezas = await (await api('/api/piezas')).json();
    assert.equal(piezas[0].titulo, 'Idea desde el dashboard');
    assert.ok(cambios > 0, 'avisa al WebSocket');
    const inicio = await (await api('/api/inicio')).json();
    assert.equal(inicio.demo, false);
  });

  test('errores de validación → 400 con mensaje', async () => {
    const r = await api('/api/tareas', { method: 'POST', body: JSON.stringify({ titulo: '' }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /titulo/);
    const t = await api('/api/notas/leer?ruta=../../etc/passwd');
    assert.equal(t.status, 400);
  });

  test('tareas: crear y completar', async () => {
    const t = await (await api('/api/tareas', { method: 'POST', body: JSON.stringify({ titulo: 'Editar reel' }) })).json();
    const u = await (await api(`/api/tareas/${t.id}`, { method: 'PATCH', body: JSON.stringify({ hecha: true }) })).json();
    assert.equal(u.hecha, 1);
  });
});

describe('MCP jarvis', () => {
  let client;
  before(async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(jarvis, { origen: 'hermes' }).connect(a);
    client = new Client({ name: 'test', version: '1' });
    await client.connect(b);
  });

  const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    return { error: r.isError, data: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) };
  };

  test('expone las herramientas', async () => {
    const { tools } = await client.listTools();
    const nombres = tools.map((t) => t.name);
    for (const n of ['capturar_idea', 'crear_pieza', 'mover_pieza', 'anadir_tarea', 'actualizar_tarea', 'listar_tareas', 'tareas_de_hoy', 'resumen_del_dia', 'buscar_notas', 'leer_nota']) {
      assert.ok(nombres.includes(n), n);
    }
  });

  test('una idea desde Telegram aparece en el pipeline con origen hermes', async () => {
    const { data } = await call('capturar_idea', { texto: 'idea: test' });
    assert.equal(data.pieza.origen, 'hermes');
    const { data: lista } = await call('listar_pipeline', { estado: 'idea' });
    assert.ok(lista.some((p) => p.titulo === 'test'), 'el prefijo "idea:" no forma parte del título');
    const { data: notas } = await call('buscar_notas', { consulta: 'test' });
    assert.ok(notas.length >= 1);
  });

  test('mover pieza y resumen del día', async () => {
    const { data: p } = await call('crear_pieza', { titulo: 'Reel prueba', formato: 'reel' });
    const { data: m } = await call('mover_pieza', { id: p.id, estado: 'grabar' });
    assert.equal(m.estado, 'grabar');
    const { data: r } = await call('resumen_del_dia');
    assert.ok(r.pipeline.grabar >= 1);
  });

  test('errores devueltos como error de herramienta, no como caída', async () => {
    const r = await call('leer_nota', { ruta: '../fuera.md' });
    assert.equal(r.error, true);
    assert.match(r.data, /fuera del vault/);
  });
});

test('en un VPS solo se abre desde las direcciones de JARVIS_HOSTS (Tailscale)', async () => {
  const antes = process.env.JARVIS_HOSTS;
  process.env.JARVIS_HOSTS = 'jarvis.tail123.ts.net';
  const srv = http.createServer();
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const port = srv.address().port;
  srv.on('request', createApp({ jarvis, port, status: async () => [] }));
  const pedir = (host, extra = {}) => new Promise((ok, ko) => {
    http.request({ host: '127.0.0.1', port, path: '/api/tareas', method: extra.method || 'GET', headers: { host, ...(extra.headers || {}) } }, (r) => { r.resume(); ok(r.statusCode); }).on('error', ko).end(extra.body);
  });
  try {
    assert.equal(await pedir('jarvis.tail123.ts.net'), 200);
    assert.equal(await pedir('JARVIS.tail123.ts.net'), 200, 'sin distinguir mayúsculas');
    assert.equal(await pedir('otra.ejemplo.com'), 403);
    assert.equal(await pedir('jarvis.tail123.ts.net', { method: 'POST', headers: { origin: 'https://malo.example', 'content-type': 'application/json' }, body: '{}' }), 403, 'CSRF');
  } finally {
    srv.close();
    if (antes === undefined) delete process.env.JARVIS_HOSTS; else process.env.JARVIS_HOSTS = antes;
  }
});
