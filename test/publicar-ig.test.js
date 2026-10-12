import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createArchivos } from '../server/archivos.js';
import { createAlmacen } from '../server/integrations/almacen.js';
import { createPublicadorIg } from '../server/integrations/publicar-ig.js';
import { planDePublicacion, tipoIg } from '../web/src/lib/planIg.js';
import { getConfig } from '../server/config.js';
import { createApp } from '../server/index.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildServer } from '../mcp/jarvis-mcp.js';

let dir;
before(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-pub-')); const cfg = getConfig({}); ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript); });
after(() => rmSync(dir, { recursive: true, force: true }));

const jpg = (n = 'foto.jpg') => ({ path: `2026-10/1700000000000-abcdef_${n}`, url: `/api/contenido/archivos/2026-10/1700000000000-abcdef_${n}`, nombre: n, mime: 'image/jpeg', tamano: 3 });
const mp4 = (n = 'reel.mp4') => ({ path: `2026-10/1700000000000-abcdef_${n}`, url: `/api/contenido/archivos/2026-10/1700000000000-abcdef_${n}`, nombre: n, mime: 'video/mp4', tamano: 3 });

describe('reglas de publicación', () => {
  test('tipo y problemas', () => {
    assert.equal(tipoIg({ formato: 'Reel', archivos: [mp4()] }), 'REELS');
    assert.equal(tipoIg({ formato: 'Post', archivos: [mp4()] }), 'REELS', 'un post con vídeo es un reel');
    assert.equal(tipoIg({ formato: 'Post', archivos: [jpg(), jpg('b.jpg')] }), 'CAROUSEL');
    assert.deepEqual(planDePublicacion({ formato: 'Reel', fecha: '2026-10-20', hora: '18:00', archivos: [mp4()] }).problemas, []);
    const mal = planDePublicacion({ formato: 'Carrusel', archivos: [{ nombre: 'a.png', mime: 'image/png' }] }).problemas.join(' ');
    assert.match(mal, /día y hora/);
    assert.match(mal, /no es JPG/);
    assert.match(mal, /al menos 2/);
    assert.match(planDePublicacion({ formato: 'Reel', archivos: [jpg()] }, { conFecha: false }).problemas.join(), /necesita un vídeo/);
    assert.match(planDePublicacion({ formato: 'Story', archivos: [jpg(), jpg('b.jpg')] }, { conFecha: false }).problemas.join(), /un solo archivo/);
    assert.match(planDePublicacion({ formato: 'Post', archivos: [] }, { conFecha: false }).problemas.join(), /Sube aquí/);
  });
});

// Meta y Supabase de mentira
function entorno({ procesando = 0, fallarPublicar = false } = {}) {
  const db = openDb(':memory:');
  const jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
  const archivos = createArchivos({ dir: path.join(dir, 'arch') });
  mkdirSync(path.join(dir, 'arch', '2026-10'), { recursive: true });
  for (const n of ['foto.jpg', 'b.jpg', 'reel.mp4']) writeFileSync(path.join(dir, 'arch', '2026-10', `1700000000000-abcdef_${n}`), 'xyz');
  const llamadas = [];
  let n = 0;
  const estados = new Map();
  const fetchImpl = async (u, o = {}) => {
    const url = new URL(u);
    if (url.hostname.endsWith('supabase.co')) {
      llamadas.push({ supabase: o.method, ruta: url.pathname });
      if (o.method === 'POST') { for await (const _ of o.body) { /* consumir */ } }
      return new Response('{}', { status: 200 });
    }
    const ruta = url.pathname.replace(/^\/v[\d.]+\//, '');
    const body = o.body ? Object.fromEntries(new URLSearchParams(o.body)) : null;
    llamadas.push({ ruta, method: o.method || 'GET', body, query: Object.fromEntries(url.searchParams) });
    if (o.method === 'POST' && ruta === 'ig1/media') { const id = `c${++n}`; estados.set(id, procesando); return Response.json({ id }); }
    if (o.method === 'POST' && ruta === 'ig1/media_publish') return fallarPublicar ? Response.json({ error: { code: 9007, message: 'Media ID is not available' } }, { status: 400 }) : Response.json({ id: 'm99' });
    if (ruta === 'm99') return Response.json({ permalink: 'https://instagram.com/p/xyz' });
    if (estados.has(ruta)) { const k = estados.get(ruta); estados.set(ruta, k - 1); return Response.json({ status_code: k > 0 ? 'IN_PROGRESS' : 'FINISHED' }); }
    return Response.json({ error: { code: 803, message: `ruta ${ruta}` } }, { status: 404 });
  };
  const instagram = { estado: () => ({ conectadoMeta: true, username: 'micuenta' }), conexion: () => ({ token: 'tok', igUserId: 'ig1' }) };
  const almacen = createAlmacen({ env: { CRM_SUPABASE_URL: 'https://abc.supabase.co', CRM_SUPABASE_ANON_KEY: 'eyJ'.padEnd(40, 'x') }, fetchImpl });
  let reloj = new Date('2026-10-20T17:00:00');
  const pub = createPublicadorIg({ db, jarvis, instagram, almacen, archivos, fetchImpl, ahora: () => reloj, dormir: async () => {}, esperaMax: 0, log: { warn: () => {} } });
  return { db, jarvis, pub, llamadas, mover: (d) => { reloj = new Date(d); } };
}

describe('publicador', () => {
  test('una foto programada se publica a su hora, y no antes', async () => {
    const { jarvis, pub, llamadas, mover } = entorno();
    const p = jarvis.crearPieza({ titulo: 'Foto', formato: 'Post', fecha: '2026-10-20', hora: '18:00', caption: 'Hola **GUÍA**', archivos: [jpg()] });
    const m = pub.marcar(p.id, true);
    assert.equal(m.publicar_ig, 1);
    assert.equal(m.estado, 'listo');
    assert.equal((await pub.revisar()).publicadas, 0, 'son las 17:00');
    assert.equal(llamadas.length, 0);
    mover('2026-10-20T18:00:30');
    assert.equal((await pub.revisar()).publicadas, 1);
    const crear = llamadas.find((l) => l.ruta === 'ig1/media');
    assert.match(crear.body.image_url, /^https:\/\/abc\.supabase\.co\/storage\/v1\/object\/public\/contenido\/jarvis\//);
    assert.equal(crear.body.caption, 'Hola 𝗚𝗨𝗜́𝗔', 'lo que va entre ** se publica en negrita Unicode');
    const f = jarvis.listarPiezas().find((x) => x.id === p.id);
    assert.equal(f.ig_estado, 'publicado');
    assert.equal(f.estado, 'publicado');
    assert.equal(f.ig_permalink, 'https://instagram.com/p/xyz');
    assert.ok(llamadas.some((l) => l.supabase === 'DELETE'), 'borra el archivo del bucket después');
    assert.throws(() => pub.marcar(p.id, true), /ya está publicada/);
  });

  test('un reel espera a que Instagram procese el vídeo, aunque haga falta otra vuelta', async () => {
    const { jarvis, pub, llamadas } = entorno({ procesando: 2 });
    const p = jarvis.crearPieza({ titulo: 'Reel', formato: 'Reel', archivos: [mp4()] });
    pub.publicarAhora(p.id);
    await new Promise((ok) => setTimeout(ok, 20));
    let f = jarvis.listarPiezas().find((x) => x.id === p.id);
    assert.equal(f.ig_estado, 'procesando', 'esperaMax 0: se queda procesando para la próxima vuelta');
    await pub.revisar(); await pub.revisar();
    f = jarvis.listarPiezas().find((x) => x.id === p.id);
    assert.equal(f.ig_estado, 'publicado');
    assert.equal(llamadas.filter((l) => l.ruta === 'ig1/media').length, 1, 'no crea el contenedor dos veces');
    assert.equal(llamadas.find((l) => l.ruta === 'ig1/media').body.media_type, 'REELS');
    assert.equal(llamadas.filter((l) => l.supabase === 'POST').length, 1, 'no sube el vídeo dos veces');
  });

  test('carrusel: un contenedor por archivo y luego el carrusel', async () => {
    const { jarvis, pub, llamadas } = entorno();
    const p = jarvis.crearPieza({ titulo: 'Carr', formato: 'Carrusel', archivos: [jpg(), mp4()] });
    pub.publicarAhora(p.id);
    await new Promise((ok) => setTimeout(ok, 30));
    const medias = llamadas.filter((l) => l.ruta === 'ig1/media').map((l) => l.body);
    assert.equal(medias.length, 3);
    assert.equal(medias[0].is_carousel_item, 'true');
    assert.equal(medias[1].media_type, 'VIDEO');
    assert.equal(medias[2].media_type, 'CAROUSEL');
    assert.equal(medias[2].children, 'c1,c2');
    assert.equal(jarvis.listarPiezas().find((x) => x.id === p.id).ig_estado, 'publicado');
  });

  test('un error de Meta se queda en la pieza y volver a marcarla reintenta', async () => {
    const { jarvis, pub } = entorno({ fallarPublicar: true });
    const p = jarvis.crearPieza({ titulo: 'Falla', formato: 'Post', fecha: '2026-10-20', hora: '10:00', archivos: [jpg()] });
    pub.marcar(p.id, true);
    await pub.revisar();
    let f = jarvis.listarPiezas().find((x) => x.id === p.id);
    assert.equal(f.ig_estado, 'error');
    assert.match(f.ig_error, /Media ID is not available/);
    pub.marcar(p.id, true);
    f = jarvis.listarPiezas().find((x) => x.id === p.id);
    assert.equal(f.ig_estado, null);
    assert.equal(f.ig_contenedor, null);
  });

  test('no se puede marcar si falta algo', () => {
    const { jarvis, pub } = entorno();
    const p = jarvis.crearPieza({ titulo: 'Sin archivo', formato: 'Reel', fecha: '2026-10-20', hora: '10:00' });
    assert.throws(() => pub.marcar(p.id, true), /Sube aquí el vídeo/);
  });
});

describe('quién puede publicar', () => {
  test('por la API del dashboard sí; por el MCP (Hermes / Claude Code) no', async () => {
    const { jarvis, pub, db } = entorno();
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const port = server.address().port;
    server.on('request', createApp({ jarvis, publicadorIg: pub, port, status: async () => [] }));
    const api = (p, body, method = 'POST') => fetch(`http://127.0.0.1:${port}${p}`, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json() }));
    const { data: p } = await api('/api/piezas', { titulo: 'Desde el dashboard', formato: 'Post', fecha: '2026-10-21', hora: '09:00', archivos: [jpg()], publicar_ig: true });
    assert.equal(p.publicar_ig, 1);
    const malo = await api('/api/piezas', { titulo: 'Sin archivos', formato: 'Reel', publicar_ig: true });
    assert.equal(malo.status, 400);
    const { data: c } = await (await fetch(`http://127.0.0.1:${port}/api/contenido`)).json().then((d) => ({ data: d }));
    assert.equal(c.instagram.disponible, true);
    server.close();

    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(jarvis, { origen: 'hermes' }).connect(a);
    const client = new Client({ name: 't', version: '1' });
    await client.connect(b);
    const q = await client.callTool({ name: 'crear_pieza', arguments: { titulo: 'Desde Telegram', formato: 'Post', fecha: '2026-10-21', hora: '09:00', publicar_ig: true } });
    const creada = JSON.parse(q.content[0].text);
    assert.equal(db.prepare('SELECT publicar_ig FROM piezas WHERE id = ?').get(creada.id).publicar_ig, 0, 'el MCP no puede marcar la publicación');
  });
});

describe('volver a publicar', () => {
  test('la copia comparte archivos, vuelve sin fecha y los archivos no se borran con el original', async () => {
    const { jarvis, pub, mover } = entorno();
    const p = jarvis.crearPieza({ titulo: 'Carrusel top', formato: 'Carrusel', caption: 'Texto', fecha: '2026-10-20', hora: '10:00', archivos: [jpg(), jpg('b.jpg')] });
    pub.marcar(p.id, true);
    mover('2026-10-20T10:01:00');
    await pub.revisar();
    const copia = jarvis.duplicarPieza(p.id);
    assert.equal(copia.fecha, null);
    assert.equal(copia.estado, 'listo');
    assert.equal(copia.caption, 'Texto');
    assert.equal(copia.ig_estado, null);
    assert.equal(copia.publicar_ig, 0);
    assert.deepEqual(copia.archivos.map((a) => a.path), jarvis.listarPiezas().find((x) => x.id === p.id).archivos.map((a) => a.path));
    // Sin fecha no se puede programar; con fecha, sí
    assert.throws(() => pub.marcar(copia.id, true), /día y hora/);
    jarvis.actualizarPieza(copia.id, { fecha: '2026-11-01', hora: '18:00' });
    assert.equal(pub.marcar(copia.id, true).publicar_ig, 1);
  });
});
