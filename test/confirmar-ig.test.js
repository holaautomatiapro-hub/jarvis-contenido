import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault, ensureVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createArchivos } from '../server/archivos.js';
import { createAlmacen } from '../server/integrations/almacen.js';
import { createPublicadorIg } from '../server/integrations/publicar-ig.js';
import { getConfig } from '../server/config.js';
import { configTelegram, createTelegram } from '../server/telegram.js';
import { createConfirmacionesIg, limpiarCodigo } from '../server/confirmar-ig.js';
import { medioPermitido, lanzadoPorHermes, raicesPermitidas } from '../server/medios-telegram.js';
import { buildServer } from '../mcp/jarvis-mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

let dir;
before(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-confirmar-')); const cfg = getConfig({}); ensureVault(path.join(dir, 'V'), cfg.templateDir, cfg.mcpScript); });
after(() => rmSync(dir, { recursive: true, force: true }));

const TOKEN = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ_123-456';
const jpg = (n) => ({ path: `2026-10/1700000000000-abcdef_${n}`, url: `/api/contenido/archivos/2026-10/1700000000000-abcdef_${n}`, nombre: n, mime: 'image/jpeg', tamano: 3 });

// Telegram de mentira: guarda lo que se manda
function telegramFalso() {
  const enviados = [];
  return { enviados, configurado: () => true, enviar: async (t) => { enviados.push({ texto: t }); }, enviarFotos: async (r) => { enviados.push({ fotos: r.map((x) => path.basename(x)) }); } };
}

// Meta y Supabase de mentira (lo justo para publicar una foto)
function entorno({ telegram = telegramFalso() } = {}) {
  const db = openDb(':memory:');
  const jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
  const archivos = createArchivos({ dir: path.join(dir, 'arch') });
  mkdirSync(path.join(dir, 'arch', '2026-10'), { recursive: true });
  for (const n of ['a.jpg', 'b.jpg']) writeFileSync(path.join(dir, 'arch', '2026-10', `1700000000000-abcdef_${n}`), 'xyz');
  const fetchImpl = async (u, o = {}) => {
    const url = new URL(u);
    if (url.hostname.endsWith('supabase.co')) { if (o.method === 'POST') { for await (const _ of o.body) { /* consumir */ } } return new Response('{}'); }
    const ruta = url.pathname.replace(/^\/v[\d.]+\//, '');
    if (o.method === 'POST' && ruta === 'ig1/media') return Response.json({ id: 'c1' });
    if (o.method === 'POST' && ruta === 'ig1/media_publish') return Response.json({ id: 'm99' });
    if (ruta === 'c1') return Response.json({ status_code: 'FINISHED' });
    if (ruta === 'm99') return Response.json({ permalink: 'https://instagram.com/p/xyz' });
    return Response.json({ error: { code: 803, message: ruta } }, { status: 404 });
  };
  const instagram = { estado: () => ({ conectadoMeta: true, username: 'yo' }), conexion: () => ({ token: 'tok', igUserId: 'ig1' }) };
  const almacen = createAlmacen({ env: { CRM_SUPABASE_URL: 'https://abc.supabase.co', CRM_SUPABASE_ANON_KEY: 'eyJ'.padEnd(40, 'x') }, fetchImpl });
  let reloj = new Date('2026-10-20T17:00:00');
  const ahora = () => reloj;
  const avisos = [];
  const pub = createPublicadorIg({ db, jarvis, instagram, almacen, archivos, fetchImpl, ahora, dormir: async () => {}, esperaMax: 0, log: { warn: () => {} },
    prepararVideo: async (ruta) => ({ ruta, limpiar() {}, cambiado: false }), alPublicar: (d) => avisos.push(d) });
  const conf = createConfirmacionesIg({ db, jarvis, publicadorIg: pub, telegram, archivos, ahora, log: { warn: () => {} } });
  return { db, jarvis, pub, conf, telegram, avisos, mover: (d) => { reloj = new Date(d); } };
}
const codigoDe = (telegram) => /publica ([A-Z0-9]{6})/.exec(telegram.enviados.map((m) => m.texto || '').join('\n'))?.[1];

describe('Telegram', () => {
  test('saca el bot y tu chat del .env de Hermes (o del de JARVIS) y no deja el token en los errores', async () => {
    const home = path.join(dir, 'hermes');
    mkdirSync(home, { recursive: true });
    writeFileSync(path.join(home, '.env'), `TELEGRAM_BOT_TOKEN=${TOKEN}\nTELEGRAM_ALLOWED_USERS=1419092436,555\n`);
    assert.deepEqual(configTelegram({ env: { HERMES_HOME: home } }), { token: TOKEN, chat: '1419092436' });
    writeFileSync(path.join(home, '.env'), `TELEGRAM_BOT_TOKEN=${TOKEN}\nTELEGRAM_HOME_CHANNEL=-100777\nTELEGRAM_ALLOWED_USERS=1\n`);
    assert.equal(configTelegram({ env: { HERMES_HOME: home } }).chat, '-100777');
    assert.equal(configTelegram({ env: { HERMES_HOME: home, TELEGRAM_CHAT_ID: '42' } }).chat, '42', 'el de JARVIS manda');
    assert.deepEqual(configTelegram({ env: { HERMES_HOME: path.join(dir, 'no-existe') } }), { token: null, chat: null });

    mkdirSync(path.join(dir, 'arch', '2026-10'), { recursive: true });
    for (const n of ['a.jpg', 'b.jpg']) writeFileSync(path.join(dir, 'arch', '2026-10', `1700000000000-abcdef_${n}`), 'xyz');
    const llamadas = [];
    const t = createTelegram({ env: { HERMES_HOME: home }, fetchImpl: async (u, o) => { llamadas.push({ u: String(u), o }); return Response.json({ ok: true, result: {} }); } });
    assert.equal(t.configurado(), true);
    await t.enviar('hola');
    assert.match(llamadas[0].u, /\/sendMessage$/);
    assert.deepEqual(JSON.parse(llamadas[0].o.body), { chat_id: '-100777', text: 'hola', disable_web_page_preview: true });
    const fotos = ['a.jpg', 'b.jpg'].map((n) => path.join(dir, 'arch', '2026-10', `1700000000000-abcdef_${n}`));
    await t.enviarFotos(fotos);
    assert.match(llamadas[1].u, /\/sendMediaGroup$/);
    assert.equal(llamadas[1].o.body.get('chat_id'), '-100777');
    assert.equal(JSON.parse(llamadas[1].o.body.get('media')).length, 2);
    await t.enviarFotos(fotos.slice(0, 1));
    assert.match(llamadas[2].u, /\/sendPhoto$/);

    const caida = createTelegram({ env: { HERMES_HOME: home }, fetchImpl: async () => { throw new Error(`fetch failed https://api.telegram.org/bot${TOKEN}/sendMessage`); } });
    await assert.rejects(() => caida.enviar('x'), (e) => !e.message.includes(TOKEN));
  });
});

describe('publicar con confirmación', () => {
  test('manda las fotos y un código que la IA no ve; solo con ese código queda programada, y avisa al publicarse', async () => {
    const { jarvis, conf, telegram, pub, avisos, mover } = entorno();
    const p = jarvis.crearPieza({ titulo: 'Carrusel del setter', formato: 'Carrusel', caption: 'Así contesto 300 DMs', archivos: [jpg('a.jpg'), jpg('b.jpg')] });
    const r = await conf.solicitar({ pieza_id: p.id, fecha: '2026-10-20', hora: '18:00' });
    const codigo = codigoDe(telegram);
    assert.match(codigo, /^[A-Z2-9]{6}$/);
    assert.ok(!JSON.stringify(r).includes(codigo), 'lo que ve la IA no lleva el código');
    assert.match(r.aviso, /NO conoces el código/);
    assert.deepEqual(telegram.enviados[0].fotos, ['1700000000000-abcdef_a.jpg', '1700000000000-abcdef_b.jpg']);
    assert.match(telegram.enviados[1].texto, /«Carrusel del setter»[\s\S]*carrusel · 2 fotos[\s\S]*martes 20 oct, 18:00[\s\S]*Así contesto 300 DMs/);
    assert.equal(jarvis.leerPieza(p.id).publicar_ig, 0, 'pedir la confirmación no programa nada');

    await assert.rejects(() => conf.confirmar({ codigo: 'ZZZZZZ' }), /no vale/);
    const ok = await conf.confirmar({ codigo: `publica ${codigo.toLowerCase()}` });
    assert.equal(ok.fecha, '2026-10-20');
    assert.equal(ok.hora, '18:00');
    const q = jarvis.leerPieza(p.id);
    assert.equal(q.publicar_ig, 1);
    assert.match(telegram.enviados.at(-1).texto, /Programado: «Carrusel del setter» sale el martes 20 oct, 18:00/);
    await assert.rejects(() => conf.confirmar({ codigo }), /no vale/, 'el código es de un solo uso');
    assert.deepEqual(conf.programadas().map((x) => [x.titulo, x.fecha, x.hora]), [['Carrusel del setter', '2026-10-20', '18:00']]);

    mover('2026-10-20T18:00:30');
    await pub.revisar();
    assert.equal(jarvis.leerPieza(p.id).ig_estado, 'publicado');
    assert.deepEqual(avisos.map((a) => [a.ok, a.pieza.titulo, a.permalink]), [[true, 'Carrusel del setter', 'https://instagram.com/p/xyz']]);
  });

  test('sin hora sale unos minutos después de confirmar; con hora, con margen; y si la pieza cambia hay que volver a pedirlo', async () => {
    const { jarvis, conf, telegram, mover } = entorno();
    const p = jarvis.crearPieza({ titulo: 'Foto', formato: 'Post', caption: 'Hola', archivos: [jpg('a.jpg')] });
    await assert.rejects(() => conf.solicitar({ pieza_id: p.id, fecha: '2026-10-20', hora: '17:05' }), /10 minutos de margen/);
    await assert.rejects(() => conf.solicitar({ pieza_id: p.id, fecha: '2026-10-20' }), /la hora/);
    await conf.solicitar({ pieza_id: p.id });
    assert.match(telegram.enviados.at(-1).texto, /en cuanto lo confirmes/);
    mover('2026-10-20T17:20:00');
    const r = await conf.confirmar({ codigo: codigoDe(telegram) });
    assert.deepEqual([r.fecha, r.hora], ['2026-10-20', '17:30']);

    const otra = jarvis.crearPieza({ titulo: 'Otra', formato: 'Post', caption: 'Antes', archivos: [jpg('b.jpg')] });
    telegram.enviados.length = 0;
    await conf.solicitar({ pieza_id: otra.id });
    jarvis.actualizarPieza(otra.id, { caption: 'Cambiado después' });
    await assert.rejects(() => conf.confirmar({ codigo: codigoDe(telegram) }), /ha cambiado/);
    assert.equal(jarvis.leerPieza(otra.id).publicar_ig, 0);
  });

  test('caduca, no admite piezas a medias y se bloquea tras varios códigos equivocados', async () => {
    const { jarvis, conf, telegram, mover } = entorno();
    const sin = jarvis.crearPieza({ titulo: 'Sin fotos', formato: 'Post' });
    await assert.rejects(() => conf.solicitar({ pieza_id: sin.id }), /Sube aquí/);
    const p = jarvis.crearPieza({ titulo: 'Foto', formato: 'Post', archivos: [jpg('a.jpg')] });
    await conf.solicitar({ pieza_id: p.id });
    const codigo = codigoDe(telegram);
    mover('2026-10-20T17:31:00');
    await assert.rejects(() => conf.confirmar({ codigo }), /caducado/);

    telegram.enviados.length = 0;
    await conf.solicitar({ pieza_id: p.id });
    const bueno = codigoDe(telegram);
    // El caducado de antes ya cuenta como fallo: 4 más y se bloquea (también para el bueno)
    for (let i = 0; i < 4; i++) await assert.rejects(() => conf.confirmar({ codigo: `AAAAA${i}` }), /no vale/);
    await assert.rejects(() => conf.confirmar({ codigo: bueno }), /Demasiados/);
    assert.equal(jarvis.leerPieza(p.id).publicar_ig, 0);
    assert.equal(limpiarCodigo(' Publica k7m-2qx '), 'K7M2QX');
  });

  test('cancelar no necesita código', async () => {
    const { jarvis, conf, telegram } = entorno();
    const p = jarvis.crearPieza({ titulo: 'Foto', formato: 'Post', archivos: [jpg('a.jpg')] });
    await conf.solicitar({ pieza_id: p.id, fecha: '2026-10-21', hora: '10:00' });
    await conf.confirmar({ codigo: codigoDe(telegram) });
    const r = await conf.cancelar({ pieza_id: p.id });
    assert.equal(r.cancelada, true);
    assert.equal(jarvis.leerPieza(p.id).publicar_ig, 0);
    assert.match(telegram.enviados.at(-1).texto, /Cancelado/);
  });

  test('sin el bot de Telegram no se puede pedir la confirmación', async () => {
    const { jarvis, conf } = entorno({ telegram: { configurado: () => false } });
    const p = jarvis.crearPieza({ titulo: 'Foto', formato: 'Post', archivos: [jpg('a.jpg')] });
    await assert.rejects(() => conf.solicitar({ pieza_id: p.id }), /no puede escribirte por Telegram/);
  });
});

describe('fotos que llegan por Telegram', () => {
  test('solo de la caché de Hermes y solo fotos o vídeos', () => {
    const cache = path.join(dir, 'h', 'cache', 'images');
    mkdirSync(cache, { recursive: true });
    writeFileSync(path.join(cache, 'foto.jpg'), 'x');
    writeFileSync(path.join(cache, 'notas.txt'), 'x');
    writeFileSync(path.join(dir, 'secreto.jpg'), 'x');
    symlinkSync(path.join(dir, 'secreto.jpg'), path.join(cache, 'enlace.jpg'));
    const raices = [path.join(dir, 'h', 'cache')];
    assert.equal(medioPermitido(path.join(cache, 'foto.jpg'), { raices }).mime, 'image/jpeg');
    assert.throws(() => medioPermitido(path.join(cache, 'notas.txt'), { raices }), /no es una foto/);
    assert.throws(() => medioPermitido(path.join(dir, 'secreto.jpg'), { raices }), /caché/);
    assert.throws(() => medioPermitido(path.join(cache, 'enlace.jpg'), { raices }), /caché/, 'un enlace a otro sitio tampoco');
    assert.throws(() => medioPermitido(path.join(cache, '..', '..', '..', 'secreto.jpg'), { raices }), /caché/);
  });

  test('también la caché de las instalaciones antiguas de Hermes (image_cache/)', () => {
    const h = path.join(dir, 'antiguo');
    mkdirSync(path.join(h, 'image_cache'), { recursive: true });
    writeFileSync(path.join(h, 'image_cache', 'img_1.jpg'), 'x');
    writeFileSync(path.join(h, '.env'), 'x');
    const raices = raicesPermitidas({ HERMES_HOME: h });
    assert.equal(medioPermitido(path.join(h, 'image_cache', 'img_1.jpg'), { raices }).mime, 'image/jpeg');
    assert.throws(() => medioPermitido(path.join(h, '.env'), { raices }), /caché/);
  });

  test('reconoce que lo ha arrancado Hermes por el programa del padre o del abuelo, no por sus argumentos', () => {
    const procesos = (tabla) => (f) => {
      const [, pid, que] = /\/proc\/(\d+)\/(\w+)/.exec(f);
      const p = tabla[pid];
      if (!p) throw new Error('no existe');
      return que === 'cmdline' ? p.cmd.join('\0') : `${pid} (x y) S ${p.padre} 1 1`;
    };
    const hermes = { 10: { cmd: ['node', '/j/mcp/jarvis-mcp.js'], padre: 20 }, 20: { cmd: ['/home/u/.hermes/hermes-agent/venv/bin/python', '/home/u/.local/bin/hermes', 'gateway', 'run'], padre: 1 } };
    assert.equal(lanzadoPorHermes({ pid: 20, leer: procesos(hermes) }), true);
    assert.equal(lanzadoPorHermes({ pid: 10, leer: procesos(hermes) }), true, 'a través de un intermediario');
    const claude = { 30: { cmd: ['claude', '-p', '--append-system-prompt', 'Eres JARVIS; Hermes te escribe por Telegram'], padre: 40 }, 40: { cmd: ['node', '/home/u/JARVIS/server/index.js'], padre: 1 } };
    assert.equal(lanzadoPorHermes({ pid: 30, leer: procesos(claude) }), false);
    assert.equal(lanzadoPorHermes({ pid: 99, leer: procesos({}) }), false, 'sin /proc (Windows, Mac)');
  });

  test('las herramientas de publicar solo están en Hermes, y guardar_fotos_en_pieza crea la pieza', async () => {
    const db = openDb(':memory:');
    const jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
    const conectar = async (opciones) => {
      const [a, b] = InMemoryTransport.createLinkedPair();
      await buildServer(jarvis, opciones).connect(a);
      const c = new Client({ name: 't', version: '1' });
      await c.connect(b);
      return c;
    };
    const sinHermes = await conectar({});
    assert.ok(!(await sinHermes.listTools()).tools.some((t) => t.name === 'publicar_en_instagram'));
    // Guardar fotos en una pieza no depende de que sea Hermes (solo acepta las de su caché)
    const soloMedios = (await (await conectar({ medios: { subirLocal: async () => ({}) } })).listTools()).tools.map((t) => t.name);
    assert.ok(soloMedios.includes('guardar_fotos_en_pieza'));
    assert.ok(!soloMedios.includes('publicar_en_instagram'));

    const llamadas = [];
    const publicarIg = {
      subirLocal: async (r) => ({ path: `2026-10/x_${path.basename(r)}`, url: `/api/contenido/archivos/2026-10/x_${path.basename(r)}`, nombre: path.basename(r), mime: 'image/jpeg', tamano: 1 }),
      servidor: async (metodo, ruta, body) => { llamadas.push([metodo, ruta, body]); return { ok: true }; },
    };
    const c = await conectar({ origen: 'hermes', publicarIg });
    const nombres = (await c.listTools()).tools.map((t) => t.name);
    for (const n of ['guardar_fotos_en_pieza', 'publicar_en_instagram', 'confirmar_publicacion_instagram', 'cancelar_publicacion_instagram', 'publicaciones_instagram_programadas']) assert.ok(nombres.includes(n), n);
    const r = JSON.parse((await c.callTool({ name: 'guardar_fotos_en_pieza', arguments: { rutas: ['/c/1.jpg', '/c/2.jpg'], caption: 'Hola' } })).content[0].text);
    const p = jarvis.leerPieza(r.pieza.id);
    assert.deepEqual([p.formato, p.estado, p.caption, p.archivos.length, p.origen], ['Carrusel', 'listo', 'Hola', 2, 'hermes']);
    await c.callTool({ name: 'publicar_en_instagram', arguments: { pieza_id: p.id } });
    await c.callTool({ name: 'confirmar_publicacion_instagram', arguments: { codigo: 'K7M2QX' } });
    assert.deepEqual(llamadas, [['POST', '/api/instagram/confirmacion', { pieza_id: p.id }], ['POST', '/api/instagram/confirmacion/confirmar', { codigo: 'K7M2QX' }]]);
  });
});
