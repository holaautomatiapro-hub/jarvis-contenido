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
import { createRecordatorios } from '../server/recordatorios.js';
import { lunesDe, sumarDias } from '../server/tareas.js';
import { getConfig } from '../server/config.js';
import { createApp } from '../server/index.js';
import { buildServer } from '../mcp/jarvis-mcp.js';

const hoy = new Date().toLocaleDateString('sv-SE');
let dir, db, jarvis, recordatorios, server, base;
before(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-inicio-'));
  const cfg = getConfig({});
  ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript);
  db = openDb(':memory:');
  jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
  recordatorios = createRecordatorios({ db });
  const ads = { estado: () => ({ conectado: true, cuenta: 'act_1' }), rendimiento: async ({ dias }) => ({ dias, totales: { gasto: 12, impresiones: 1000, clics: 20, ctr: 2 }, campanas: [], actualizado: new Date().toISOString() }) };
  server = http.createServer();
  await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
  const port = server.address().port;
  server.on('request', createApp({ jarvis, recordatorios, ads, port, status: async () => [] }));
  base = `http://127.0.0.1:${port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const api = async (p, opts = {}) => {
  const r = await fetch(base + p, { ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined, headers: { 'content-type': 'application/json' } });
  return { status: r.status, json: await r.json() };
};

describe('Recordatorios', () => {
  test('diarios y de algunos días: salen solo el día que toca', () => {
    const r = createRecordatorios({ db: openDb(':memory:') });
    const diario = r.crear({ texto: 'Subir una story' });
    const lunes = r.crear({ texto: 'Revisar métricas', dias: [1], hora: '09:30' });
    assert.deepEqual(diario.dias, [0, 1, 2, 3, 4, 5, 6]);
    const unLunes = lunesDe(hoy), unMartes = sumarDias(unLunes, 1);
    assert.deepEqual(r.deHoy({ fecha: unLunes }).map((x) => x.id), [lunes.id, diario.id], 'los que tienen hora, primero');
    assert.deepEqual(r.deHoy({ fecha: unMartes }).map((x) => x.id), [diario.id]);
    r.actualizar(lunes.id, { activo: false });
    assert.deepEqual(r.deHoy({ fecha: unLunes }).map((x) => x.id), [diario.id]);
  });

  test('marcar es por día: mañana vuelve a salir pendiente', () => {
    const r = createRecordatorios({ db: openDb(':memory:') });
    const x = r.crear({ texto: 'Responder DMs' });
    r.marcar(x.id, { fecha: hoy });
    assert.equal(r.deHoy({ fecha: hoy })[0].hecho, true);
    assert.equal(r.deHoy({ fecha: sumarDias(hoy, 1) })[0].hecho, false);
    r.marcar(x.id, { fecha: hoy, hecho: false });
    assert.equal(r.deHoy({ fecha: hoy })[0].hecho, false);
  });

  test('valida texto, días y hora', () => {
    const r = createRecordatorios({ db: openDb(':memory:') });
    assert.throws(() => r.crear({ texto: '  ' }), /Escribe/);
    assert.throws(() => r.crear({ texto: 'x', dias: [9] }), /al menos un día/);
    assert.throws(() => r.crear({ texto: 'x', hora: '9h' }), /HH:MM/);
    assert.throws(() => r.borrar(999), /no existe/);
  });

  test('API: crear, editar, marcar y borrar', async () => {
    const c = await api('/api/recordatorios', { method: 'POST', body: { texto: 'Publicar story', dias: [0, 1, 2, 3, 4, 5, 6] } });
    assert.equal(c.status, 200);
    const e = await api(`/api/recordatorios/${c.json.id}`, { method: 'PATCH', body: { texto: 'Publicar 3 stories', hora: '18:00' } });
    assert.equal(e.json.texto, 'Publicar 3 stories');
    await api(`/api/recordatorios/${c.json.id}/hecho`, { method: 'POST', body: {} });
    let inicio = (await api('/api/inicio')).json;
    assert.deepEqual(inicio.recordatorios.map((r) => [r.texto, r.hecho]), [['Publicar 3 stories', true]]);
    assert.equal((await api('/api/recordatorios', { method: 'POST', body: { texto: '' } })).status, 400);
    await api(`/api/recordatorios/${c.json.id}`, { method: 'DELETE' });
    inicio = (await api('/api/inicio')).json;
    assert.equal(inicio.recordatorios.length, 0);
  });
});

describe('Inicio', () => {
  test('tareas de hoy, de la semana, del mes y atrasadas', async () => {
    const t = (titulo, plazo_tipo, plazo) => jarvis.crearTarea({ titulo, plazo_tipo, plazo });
    const deHoy = t('De hoy', 'dia', hoy);
    t('De esta semana', 'semana', hoy);
    t('De este mes', 'mes', hoy.slice(0, 7));
    t('Atrasada', 'dia', sumarDias(hoy, -40));
    t('Sin fecha', null);
    const hecha = t('Hecha hoy', 'dia', hoy);
    jarvis.marcarTarea(hecha.id, true);
    const vieja = t('Terminada hace tiempo', 'dia', sumarDias(hoy, -60));
    db.prepare("UPDATE tareas SET estado = 'terminada', hecha = 1, completada = '2000-01-01 10:00:00' WHERE id = ?").run(vieja.id);

    const { json: r } = await api('/api/inicio');
    const titulos = (k) => r.tareas[k].map((x) => x.titulo).sort();
    // Cada una sale donde vence: la de la semana vence el domingo y la del mes el último día
    const domingo = sumarDias(lunesDe(hoy), 6);
    const finMes = new Date(Number(hoy.slice(0, 4)), Number(hoy.slice(5, 7)), 0, 12).toLocaleDateString('sv-SE');
    assert.deepEqual(titulos('hoy'), ['De hoy', 'Hecha hoy', ...(domingo === hoy ? ['De esta semana'] : []), ...(finMes === hoy ? ['De este mes'] : [])].sort());
    assert.ok(titulos('semana').includes('De esta semana') && titulos('semana').includes('De hoy'));
    assert.equal(titulos('semana').includes('De este mes'), finMes <= domingo);
    assert.ok(titulos('mes').includes('De este mes') && titulos('mes').includes('De hoy'));
    assert.deepEqual(titulos('atrasadas'), ['Atrasada']);
    assert.ok(!JSON.stringify(r.tareas).includes('Sin fecha'));
    assert.ok(!JSON.stringify(r.tareas).includes('hace tiempo'));
    assert.equal(r.tareas.hoy.find((x) => x.id === deHoy.id).hecha, false);
  });

  test('qué se publica hoy y en qué estado', async () => {
    const a = jarvis.crearPieza({ titulo: 'Reel de hoy', formato: 'reel', fecha: hoy, estado: 'listo' });
    db.prepare("UPDATE piezas SET hora = '19:00', publicar_ig = 1 WHERE id = ?").run(a.id);
    const b = jarvis.crearPieza({ titulo: 'Carrusel de hoy', formato: 'carrusel', fecha: hoy, estado: 'editar' });
    db.prepare("UPDATE piezas SET hora = '09:00', ig_estado = 'error', ig_error = 'Token caducado' WHERE id = ?").run(b.id);
    jarvis.crearPieza({ titulo: 'De mañana', fecha: sumarDias(hoy, 1) });
    db.prepare("INSERT INTO pub_versiones (pieza_id, red, texto, fecha, hora) VALUES (?, 'linkedin', 'Post', ?, '12:00')").run(a.id, hoy);

    const { json: r } = await api('/api/inicio');
    assert.deepEqual(r.publicaHoy.map((p) => [p.hora, p.titulo, p.etiqueta, p.instagram]), [
      ['09:00', 'Carrusel de hoy', 'Editar', 'error'],
      ['12:00', 'Reel de hoy', 'Pendiente', null],
      ['19:00', 'Reel de hoy', 'Listo', 'programado'],
    ]);
    assert.equal(r.publicaHoy[0].error, 'Token caducado');
    assert.equal(r.publicaHoy[1].red, 'linkedin');
  });

  test('devuelve la fecha de hoy y qué paneles hay', async () => {
    const { json: r } = await api('/api/inicio');
    assert.equal(r.fecha, hoy);
    assert.equal(r.conRecordatorios, true);
  });

  test('Meta Ads de 7 días aparte', async () => {
    const { json: r } = await api('/api/inicio/ads');
    assert.equal(r.datos.dias, 7);
    assert.equal(r.datos.totales.gasto, 12);
  });
});

describe('MCP: recordatorios', () => {
  test('Hermes crea, consulta y marca recordatorios', async () => {
    const r = createRecordatorios({ db: openDb(':memory:') });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(jarvis, { origen: 'hermes', recordatorios: r }).connect(a);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(b);
    const call = async (name, args = {}) => {
      const res = await client.callTool({ name, arguments: args });
      assert.ok(!res.isError, res.content[0].text);
      return JSON.parse(res.content[0].text);
    };
    const x = await call('crear_recordatorio', { texto: 'Subir story' });
    assert.equal(x.origen, 'hermes');
    await call('marcar_recordatorio', { id: x.id });
    assert.equal((await call('recordatorios_de_hoy'))[0].hecho, true);
    await call('borrar_recordatorio', { id: x.id });
    assert.equal((await call('listar_recordatorios')).length, 0);
  });
});

describe('Notas: editar, renombrar y borrar', () => {
  test('guardar no pisa una nota que cambió en Obsidian', () => {
    const ruta = jarvis.vault.create('00-Inbox', 'Para editar', 'uno');
    const n = jarvis.vault.read(ruta);
    const r = jarvis.editarNota(ruta, { contenido: 'dos', modificado: n.modificado });
    assert.equal(r.contenido, 'dos');
    assert.throws(() => jarvis.editarNota(ruta, { contenido: 'tres', modificado: '2000-01-01T00:00:00.000Z' }), /ha cambiado/);
    assert.equal(jarvis.vault.read(ruta).contenido, 'dos');
  });

  test('renombrar mantiene enlazada la pieza y no pisa otra nota', () => {
    const pieza = jarvis.crearPieza({ titulo: 'Guion del reel', estado: 'guion' });
    const ruta = jarvis.vault.create('02-Guiones', 'Guion viejo', 'texto');
    db.prepare('UPDATE piezas SET nota = ? WHERE id = ?').run(ruta, pieza.id);
    jarvis.vault.create('02-Guiones', 'Ocupado', 'x');
    assert.throws(() => jarvis.editarNota(ruta, { titulo: 'Ocupado' }), /Ya hay una nota/);
    const r = jarvis.editarNota(ruta, { titulo: 'Guion nuevo: 3 errores' });
    assert.equal(r.path, '02-Guiones/Guion nuevo 3 errores.md');
    assert.equal(db.prepare('SELECT nota FROM piezas WHERE id = ?').get(pieza.id).nota, r.path);
  });

  test('borrar la manda a la papelera (.trash) y se puede restaurar', async () => {
    const ruta = jarvis.vault.create('01-Ideas', 'Para borrar', 'adiós');
    const b = await api(`/api/notas?ruta=${encodeURIComponent(ruta)}`, { method: 'DELETE' });
    assert.equal(b.json.papelera, '.trash/01-Ideas/Para borrar.md');
    assert.ok(!jarvis.vault.list().some((n) => n.path === ruta), 'ya no sale en la lista');
    // Otra con el mismo nombre borrada después no pisa a la primera en la papelera
    jarvis.vault.create('01-Ideas', 'Para borrar', 'otra');
    assert.equal(jarvis.borrarNota(ruta).papelera, '.trash/01-Ideas/Para borrar 2.md');
    const r = await api('/api/notas/restaurar', { method: 'POST', body: b.json });
    assert.equal(r.json.path, ruta);
    assert.equal(r.json.contenido, 'adiós');
    assert.equal((await api('/api/notas/restaurar', { method: 'POST', body: { papelera: '.trash/../CLAUDE.md' } })).status, 400);
    assert.equal((await api('/api/notas?ruta=..%2Fx.md', { method: 'DELETE' })).status, 400);
  });

  test('API: editar contenido y título a la vez', async () => {
    const ruta = jarvis.vault.create('00-Inbox', 'Borrador', 'hola');
    const { modificado } = jarvis.vault.read(ruta);
    const r = await api('/api/notas', { method: 'PUT', body: { ruta, contenido: 'hola mundo', titulo: 'Definitiva', modificado } });
    assert.equal(r.status, 200);
    assert.equal(r.json.path, '00-Inbox/Definitiva.md');
    assert.equal(r.json.contenido, 'hola mundo');
  });
});

describe('Lead magnet en las piezas', () => {
  test('se marca, guarda el enlace y sale en «Hoy se publica»', async () => {
    const c = await api('/api/piezas', { method: 'POST', body: { titulo: 'Reel con guía', fecha: hoy, leadmagnet: true, leadmagnet_url: 'https://automatia.pro/guia' } });
    assert.equal(c.status, 200);
    assert.equal(c.json.leadmagnet, 1);
    assert.equal(c.json.leadmagnet_url, 'https://automatia.pro/guia');
    const { json: r } = await api('/api/inicio');
    assert.equal(r.publicaHoy.find((p) => p.titulo === 'Reel con guía').leadmagnet, 'https://automatia.pro/guia');
    // Sin la casilla no se guarda el enlace; con un enlace, la casilla se marca sola
    const u = await api(`/api/piezas/${c.json.id}`, { method: 'PATCH', body: { leadmagnet: false } });
    assert.equal(u.json.leadmagnet, 0);
    assert.equal(u.json.leadmagnet_url, null);
    const v = await api(`/api/piezas/${c.json.id}`, { method: 'PATCH', body: { leadmagnet_url: 'https://x.com/lm' } });
    assert.equal(v.json.leadmagnet, 1);
    const mal = await api(`/api/piezas/${c.json.id}`, { method: 'PATCH', body: { leadmagnet: true, leadmagnet_url: 'mi guía' } });
    assert.equal(mal.status, 400);
    assert.match(mal.json.error, /https/);
  });
});
