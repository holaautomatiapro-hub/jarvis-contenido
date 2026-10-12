import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { getConfig } from '../server/config.js';
import { createPublicar, promptAdaptar, REDES_POR_DEFECTO } from '../server/publicar.js';
import { createApp } from '../server/index.js';
import { buildServer } from '../mcp/jarvis-mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

let pieza;

// createPublicar necesita la misma base de datos que jarvis
function nuevo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-pub-'));
  const cfg = getConfig({});
  ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript);
  const v = createVault(path.join(dir, 'V'));
  const db = openDb(':memory:');
  const j = createJarvis({ db, vault: v });
  return { db, vault: v, jarvis: j, pub: createPublicar({ db, jarvis: j, vault: v }) };
}

describe('versiones por red', () => {
  let ctx;
  before(() => {
    ctx = nuevo();
    pieza = ctx.jarvis.capturarIdea({ texto: 'Cómo JARVIS me organiza el día\nDemo del dashboard' }).pieza;
  });

  test('el prompt para JARVIS incluye la pieza, las redes y la regla de no publicar', () => {
    const { prompt, redes } = ctx.pub.prepararAdaptacion({ piezaId: pieza.id, redes: ['linkedin', 'x', 'inventada'] });
    assert.deepEqual(redes, ['linkedin', 'x']);
    assert.match(prompt, new RegExp(`pieza #${pieza.id}`));
    assert.match(prompt, /guardar_versiones/);
    assert.match(prompt, /No publiques nada/);
    assert.match(prompt, /Demo del dashboard/, 'incluye el contenido de la nota');
    assert.deepEqual(ctx.pub.prepararAdaptacion({ piezaId: pieza.id }).redes, REDES_POR_DEFECTO);
  });

  test('desde un texto nuevo crea la idea en el pipeline', () => {
    const r = ctx.pub.prepararAdaptacion({ texto: 'Reel sobre automatizar comentarios', redes: ['tiktok'] });
    assert.equal(r.pieza.estado, 'idea');
    assert.ok(ctx.jarvis.listarPiezas().some((p) => p.id === r.pieza.id));
    assert.throws(() => ctx.pub.prepararAdaptacion({}), /Falta/);
  });

  test('guarda versiones, valida red y fecha, y escribe la nota en 06-Publicaciones', () => {
    const r = ctx.pub.guardarVersiones({ piezaId: pieza.id, versiones: [
      { red: 'instagram_reel', formato: 'Reel 30 s', texto: 'GANCHO: Cada mañana le pregunto a JARVIS qué toca hoy…', extra: '#productividad #ia', notas: 'Grabar en vertical', fecha: '2026-10-12', hora: '09:00' },
      { red: 'linkedin', texto: 'Llevo un mes organizando mi día con un asistente de IA…' },
    ] });
    assert.equal(r.versiones.length, 2);
    assert.match(r.nota, /^06-Publicaciones\/.*versiones/);
    const md = ctx.vault.read(r.nota).contenido;
    assert.match(md, /## Instagram Reel · 2026-10-12 09:00/);
    assert.match(md, /> Grabar en vertical/);
    assert.throws(() => ctx.pub.guardarVersiones({ piezaId: pieza.id, versiones: [{ red: 'myspace', texto: 'x' }] }), /Red no válida/);
    assert.throws(() => ctx.pub.guardarVersiones({ piezaId: pieza.id, versiones: [{ red: 'x', texto: 'x', fecha: '12/10/2026' }] }), /AAAA-MM-DD/);
    assert.throws(() => ctx.pub.guardarVersiones({ piezaId: 999, versiones: [{ red: 'x', texto: 'x' }] }), /no existe/);
  });

  test('regenerar reemplaza la versión sin publicar de esa red (no duplica)', () => {
    ctx.pub.guardarVersiones({ piezaId: pieza.id, versiones: [{ red: 'linkedin', texto: 'Versión 2' }] });
    const vs = ctx.pub.listarPieza(pieza.id).versiones.filter((v) => v.red === 'linkedin');
    assert.equal(vs.length, 1);
    assert.equal(vs[0].texto, 'Versión 2');
  });

  test('calendario por semana y lista sin fecha', () => {
    const c = ctx.pub.calendario({ desde: '2026-10-12', hasta: '2026-10-18' });
    assert.equal(c.versiones.length, 1);
    assert.equal(c.versiones[0].red, 'instagram_reel');
    assert.equal(c.versiones[0].pieza_titulo, 'Cómo JARVIS me organiza el día');
    assert.equal(c.sinFecha.length, 1);
  });

  test('programar, marcar publicado y, con todas publicadas, la pieza pasa a Publicado', () => {
    const [reel, li] = ctx.pub.listarPieza(pieza.id).versiones;
    ctx.pub.programar(li.id, { fecha: '2026-10-13', hora: '18:30' });
    assert.equal(ctx.pub.calendario({ desde: '2026-10-12', hasta: '2026-10-18' }).versiones.length, 2);
    ctx.pub.marcar(reel.id, true);
    assert.notEqual(ctx.jarvis.listarPiezas().find((p) => p.id === pieza.id).estado, 'publicado');
    ctx.pub.marcar(li.id, true);
    assert.equal(ctx.jarvis.listarPiezas().find((p) => p.id === pieza.id).estado, 'publicado');
    assert.match(ctx.vault.read(ctx.pub.guardarVersiones({ piezaId: pieza.id, versiones: [{ red: 'x', texto: 'hilo' }] }).nota).contenido, /✅ publicado/);
  });

  test('desmarcar una versión devuelve la pieza a Listo', () => {
    const [reel] = ctx.pub.listarPieza(pieza.id).versiones;
    ctx.pub.marcar(reel.id, false);
    assert.equal(ctx.jarvis.leerPieza(pieza.id).estado, 'listo');
  });

  test('un solo calendario: las versiones sin día salen con su pieza y el calendario trae las piezas', () => {
    const p = ctx.jarvis.crearPieza({ titulo: 'Reel del miércoles', formato: 'Reel', fecha: '2026-10-14', hora: '19:00' });
    ctx.pub.guardarVersiones({ piezaId: p.id, versiones: [{ red: 'tiktok', texto: 'guion' }, { red: 'linkedin', texto: 'post', fecha: '2026-10-16' }] });
    const c = ctx.pub.calendario({ desde: '2026-10-12', hasta: '2026-10-18' });
    assert.ok(c.piezas.some((x) => x.id === p.id));
    const tiktok = c.versiones.find((v) => v.pieza_id === p.id && v.red === 'tiktok');
    assert.equal(tiktok.dia, '2026-10-14', 'sin fecha propia, el día de la pieza');
    assert.equal(tiktok.hora_dia, '19:00');
    assert.equal(c.versiones.find((v) => v.pieza_id === p.id && v.red === 'linkedin').dia, '2026-10-16');
    assert.ok(!c.sinFecha.some((v) => v.pieza_id === p.id), 'tiene día gracias a su pieza');
    assert.deepEqual(ctx.pub.resumen().filter((v) => v.pieza_id === p.id).map((v) => v.red), ['tiktok', 'linkedin']);
  });

  test('MCP: guardar_versiones y programar_version', async () => {
    const p2 = ctx.jarvis.crearPieza({ titulo: 'Carrusel herramientas' });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(ctx.jarvis, { publicar: ctx.pub, origen: 'hermes' }).connect(a);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(b);
    const r = JSON.parse((await c.callTool({ name: 'guardar_versiones', arguments: { piezaId: p2.id, versiones: [{ red: 'instagram_carrusel', texto: 'Slide 1: …' }] } })).content[0].text);
    const p = JSON.parse((await c.callTool({ name: 'programar_version', arguments: { id: r.versiones[0], fecha: '2026-10-15', hora: '12:00' } })).content[0].text);
    assert.equal(p.fecha, '2026-10-15');
    assert.equal(ctx.pub.listarPieza(p2.id).versiones[0].origen, 'hermes');
    const mal = await c.callTool({ name: 'guardar_versiones', arguments: { piezaId: p2.id, versiones: [{ red: 'myspace', texto: 'x' }] } });
    assert.equal(mal.isError, true);
  });

  test('API: /api/publicar/adaptar lanza a JARVIS en la conversación "publicar"', async () => {
    const llamadas = [];
    const asistente = { preguntar: (o) => { llamadas.push(o); return { id: 1 }; }, estado: () => ({ ocupadoAqui: false }) };
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const port = server.address().port;
    server.on('request', createApp({ jarvis: ctx.jarvis, asistente, publicar: ctx.pub, port, status: async () => [] }));
    const r = await fetch(`http://127.0.0.1:${port}/api/publicar/adaptar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: 'Idea nueva', redes: ['threads'] }) });
    const d = await r.json();
    server.close();
    assert.equal(r.status, 200, JSON.stringify(d));
    assert.equal(llamadas[0].conversacion, 'publicar');
    assert.match(llamadas[0].texto, /Threads/);
    assert.equal(d.pieza.titulo, 'Idea nueva');
  });
});
