import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createArchivos } from '../server/archivos.js';
import { createApp } from '../server/index.js';
import { createAsistente } from '../server/asistente.js';
import { crearZip, leerZip } from '../server/diseno/zip.js';
import { createKit } from '../server/diseno/kit.js';
import { createMotor, instalarChromium, normalizarDiseno, paginaDiapositiva } from '../server/diseno/motor.js';
import { EventEmitter } from 'node:events';
import { createDisenos } from '../server/diseno/disenos.js';
import { buildServer } from '../mcp/jarvis-mcp.js';

const FALSO = path.resolve('test/fixtures/claude-falso.js');
let dir;
before(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-diseno-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

const KIT = {
  nombre: 'Marca de prueba', handle: '@prueba', verificado: true, duracion: 7, fps: 30, guia: 'GUIA.md', css: ['estilos.css'],
  plantillas: [
    { id: 'rejilla', nombre: 'Rejilla', formatos: ['carrusel', 'story'], ejemplo: 'ejemplos/rejilla.json' },
    { id: 'cine', nombre: 'Cine', formatos: ['carrusel'], cabecera: false, paginacion: false },
  ],
};
const zipDeKit = (extra = []) => crearZip([
  { nombre: 'mi-kit/kit.json', contenido: JSON.stringify(KIT) },
  { nombre: 'mi-kit/GUIA.md', contenido: '# Guía\nMostaza solo en la palabra clave.' },
  { nombre: 'mi-kit/estilos.css', contenido: '.slide { color: #fff; }' },
  { nombre: 'mi-kit/ejemplos/rejilla.json', contenido: '{"slides":[]}' },
  { nombre: '__MACOSX/mi-kit/._kit.json', contenido: 'basura' },
  ...extra,
]);
const slide = (n, extra = {}) => ({ bg: 'black', blocks: [{ html: `<style>.s${n}h { font-size: 60px; }</style><div class="s${n}h" id="s${n}-h">Diapositiva ${n}</div>`, js: `tl.fromTo("#s${n}-h", { opacity: 0 }, { opacity: 1, duration: 0.5 }, 0.2);` }], ...extra });

describe('zip', () => {
  test('lee lo que escribe (deflate, nombres con tildes) y rechaza lo que no es un zip', () => {
    const z = crearZip([{ nombre: 'a/ñandú.txt', contenido: 'x'.repeat(5000) }, { nombre: 'a/b.json', contenido: '{}' }]);
    assert.deepEqual(leerZip(z).map((a) => [a.nombre, a.contenido.length]), [['a/ñandú.txt', 5000], ['a/b.json', 2]]);
    assert.throws(() => leerZip(Buffer.from('no soy un zip, de verdad que no')), /no es un archivo \.zip/);
  });
});

describe('kit de diseño', () => {
  test('sin kit propio usa el de ejemplo; al importar quita la carpeta del zip y guarda el anterior', () => {
    const vault = path.join(dir, 'V1');
    mkdirSync(vault);
    const kit = createKit({ vaultPath: vault, copiasDir: path.join(dir, 'copias') });
    assert.equal(kit.estado().propio, false);
    assert.ok(kit.estado().plantillas.length >= 1);

    const e = kit.importar(zipDeKit());
    assert.equal(e.propio, true);
    assert.equal(e.nombre, 'Marca de prueba');
    assert.deepEqual(e.plantillas.map((p) => p.id), ['rejilla', 'cine']);
    assert.ok(existsSync(path.join(vault, '_diseno', 'GUIA.md')));
    assert.ok(!existsSync(path.join(vault, '_diseno', '__MACOSX')));

    kit.importar(zipDeKit());
    assert.ok(existsSync(path.join(dir, 'copias')), 'el kit anterior queda guardado');
    const k = kit.leer();
    assert.equal(kit.archivo(k, '../../etc/passwd'), null);
    assert.equal(kit.archivo(k, 'GUIA.md'), path.join(vault, '_diseno', 'GUIA.md'));
  });

  test('rechaza un zip sin kit.json o con plantillas mal escritas', () => {
    const kit = createKit({ vaultPath: path.join(dir, 'V2') });
    assert.throws(() => kit.importar(crearZip([{ nombre: 'k/GUIA.md', contenido: 'x' }])), /falta kit\.json/);
    assert.throws(() => kit.importar(crearZip([{ nombre: 'kit.json', contenido: JSON.stringify({ plantillas: [{ id: 'Con Espacios' }] }) }])), /necesita un "id"/);
    assert.throws(() => kit.importar(crearZip([{ nombre: 'kit.json', contenido: '{roto' }])), /no es válido/);
    assert.ok(!existsSync(path.join(dir, 'V2', '_diseno')));
  });
});

describe('motor: diseño y página', () => {
  const kit = { ...KIT, dir: dir, propio: true, fuentes: [], zonaStory: [250, 300], plantillas: KIT.plantillas.map((p) => ({ cabecera: true, paginacion: true, descripcion: '', ...p })) };

  test('valida plantilla, formato y número de diapositivas; junta los blocks', () => {
    assert.throws(() => normalizarDiseno({ plantilla: 'nada', slides: [slide(1)] }, kit), /no existe en el kit/);
    assert.throws(() => normalizarDiseno({ plantilla: 'cine', formato: 'story', slides: [slide(1)] }, kit), /no tiene formato story/);
    assert.throws(() => normalizarDiseno({ plantilla: 'rejilla', slides: Array.from({ length: 11 }, (_, i) => slide(i + 1)) }, kit), /máximo 10/);
    assert.throws(() => normalizarDiseno({ plantilla: 'rejilla', slides: [{ bg: 'black' }] }, kit), /no tiene HTML/);
    const d = normalizarDiseno({ plantilla: 'rejilla', slides: [{ bg: 'grey', glow: 'top', html: '<p>a</p>', blocks: [{ html: '<p>b</p>', js: 'x()' }] }] }, kit);
    assert.equal(d.formato, 'carrusel');
    assert.match(d.slides[0].html, /<p>a<\/p>\n<p>b<\/p>/);
    assert.equal(d.slides[0].bg, 'grey');
  });

  test('marco: cabecera y puntos solo en carrusel, estilos al <head>, contenedor respetado al reordenar y scripts escapados', () => {
    const d = normalizarDiseno({ plantilla: 'rejilla', slides: [slide(1), slide(2), { bg: 'black', blocks: [{ html: '<style>#s7-root .content { top: 0 }</style><b>x</b>', js: 'var a = "</script><script>alert(1)</script>";' }] }] }, kit);
    const p1 = paginaDiapositiva(kit, d, 1);
    assert.match(p1, /class="hdr"><span>@prueba<\/span><svg class="verificado"/);
    assert.match(p1, /<div class="dots"><i class="on"><\/i><i><\/i><i><\/i><\/div>/);
    assert.match(p1, /<style>\n\.s1h \{ font-size: 60px; \}\n<\/style>[\s\S]*<\/head>/, 'el <style> va al head');
    assert.doesNotMatch(p1.split('<div class="content">')[1].split('</div>')[0], /<style>/);
    const p3 = paginaDiapositiva(kit, d, 3);
    assert.match(p3, /id="s7-root"/, 'usa el contenedor al que apunta su CSS');
    assert.doesNotMatch(p3, /<\/script><script>alert/);
    const story = paginaDiapositiva(kit, { ...d, formato: 'story' }, 1);
    assert.doesNotMatch(story, /class="hdr"|class="dots"/);
    assert.match(story, /fmt-story/);
  });
});

describe('diseños: API, exportar a la biblioteca y Claude', () => {
  let server, base, jarvis, archivos, db, vault;
  // Motor sin navegador: devuelve imágenes y vídeos falsos
  const motorFalso = {
    previsualizar: async (d) => ({ imagenes: d.slides.map(() => Buffer.from('jpg')), avisos: d.slides.length > 2 ? [{ diapositiva: 3, texto: '«x» se sale de la imagen' }] : [] }),
    exportar: async (d, tipo, { alProgreso }) => {
      alProgreso({ avance: 1 });
      return { archivos: d.slides.map((_, i) => ({ nombre: `slide-0${i + 1}.${tipo}`, mime: tipo === 'mp4' ? 'video/mp4' : 'image/jpeg', buffer: Buffer.from(`${tipo}${i}`) })), limpiar() {} };
    },
  };
  before(async () => {
    vault = path.join(dir, 'V3');
    db = openDb(':memory:');
    jarvis = createJarvis({ db, vault: createVault(vault) });
    archivos = createArchivos({ dir: path.join(dir, 'contenido3') });
    const kit = createKit({ vaultPath: vault });
    kit.importar(zipDeKit());
    let disenos;
    const asistente = createAsistente({ db, jarvis, vaultPath: vault, emitir: (e) => disenos?.alEventoClaude(e), ejecutarImpl: (o) => {
      // Claude falso: termina sin guardar nada
      queueMicrotask(() => { o.onEvento({ tipo: 'inicio', sesion: 's1' }); o.onEvento({ tipo: 'fin', texto: 'hecho', sesion: 's1' }); });
      return { cancelar() {}, terminado: Promise.resolve() };
    } });
    disenos = createDisenos({ db, jarvis, kit, motor: motorFalso, archivos, previasDir: path.join(vault, '.jarvis', 'disenos'), asistente });
    server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    server.on('request', createApp({ jarvis, archivos, asistente, kit, disenos, port: server.address().port, status: async () => [] }));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());
  const api = (p, body, method = body ? 'POST' : 'GET') => fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, data: await r.json() }));
  const esperar = async (id, estado = 'listo') => {
    for (let i = 0; i < 100; i++) { const { data } = await api(`/api/disenos/${id}`); if (data.estado === estado) return data; await new Promise((r) => setTimeout(r, 20)); }
    throw new Error(`El diseño ${id} no llegó a ${estado}`);
  };

  test('carrusel: guardar → vista previa con avisos → exportar → una pieza; reexportar la sustituye', async () => {
    const { data: lista0 } = await api('/api/disenos');
    assert.equal(lista0.kit.nombre, 'Marca de prueba');
    const { status, data: d } = await api('/api/disenos', { formato: 'carrusel', plantilla: 'rejilla', guion: '# Mi carrusel\nUno, dos, tres.', generar: false });
    assert.equal(status, 200, JSON.stringify(d));
    assert.equal(d.titulo, 'Mi carrusel');
    assert.equal((await api(`/api/disenos/${d.id}/datos`, { slides: [slide(1)], plantilla: 'nada' }, 'PUT')).status, 400);

    const { data: g } = await api(`/api/disenos/${d.id}/datos`, { caption: 'Comenta SETTER 👇', slides: [slide(1), slide(2), slide(3)] }, 'PUT');
    assert.equal(g.diapositivas, 3);
    assert.deepEqual(g.avisos, ['Diapositiva 3: «x» se sale de la imagen']);
    assert.ok(existsSync(g.vistas_previas[0]));
    const { data: v } = await api(`/api/disenos/${d.id}`);
    assert.equal(v.previas.length, 3);
    assert.equal((await fetch(base + v.previas[0])).status, 200);
    assert.equal((await fetch(`${base}/api/disenos/${d.id}/previas/..%2F..%2Fsecreto.jpg`)).status, 404);

    await api(`/api/disenos/${d.id}/exportar`, { tipo: 'jpg' });
    const e1 = await esperar(d.id);
    assert.equal(e1.exportado.tipo, 'jpg');
    const [pid] = e1.exportado.piezas;
    let pieza = jarvis.listarPiezas().find((p) => p.id === pid);
    assert.equal(pieza.formato, 'Carrusel');
    assert.equal(pieza.estado, 'listo');
    assert.equal(pieza.caption, 'Comenta SETTER 👇');
    assert.equal(pieza.archivos.length, 3);
    const viejos = pieza.archivos.map((a) => a.path);

    await api(`/api/disenos/${d.id}/exportar`, { tipo: 'mp4' });
    const e2 = await esperar(d.id);
    assert.deepEqual(e2.exportado.piezas, [pid], 'reexportar actualiza la misma pieza');
    pieza = jarvis.listarPiezas().find((p) => p.id === pid);
    assert.ok(pieza.archivos.every((a) => a.mime === 'video/mp4'));
    assert.ok(viejos.every((p) => !archivos.existe(p)), 'los JPG anteriores se borran');
    assert.equal((await api(`/api/disenos/${d.id}/exportar`, { tipo: 'gif' })).status, 400);
  });

  test('stories: una pieza por story, en una carpeta; la pieza del guion pasa a listo', async () => {
    const origen = jarvis.crearPieza({ titulo: 'Caso de Andrea', estado: 'guion', caption: 'Antes 15, ahora 30' });
    const { data: d } = await api('/api/disenos', { formato: 'story', plantilla: 'rejilla', pieza_id: origen.id, generar: false });
    assert.equal(d.guion, 'Caso de Andrea\n\nAntes 15, ahora 30');
    assert.equal((await api('/api/disenos', { formato: 'story', plantilla: 'cine', guion: 'x', generar: false })).status, 400);
    await api(`/api/disenos/${d.id}/datos`, { slides: [slide(1), slide(2)] }, 'PUT');
    await api(`/api/disenos/${d.id}/exportar`, { tipo: 'jpg' });
    const e = await esperar(d.id);
    const stories = jarvis.listarPiezas().filter((p) => e.exportado.piezas.includes(p.id));
    assert.deepEqual(stories.map((p) => [p.formato, p.carpeta, p.archivos.length]), [['Story', 'Caso de Andrea', 1], ['Story', 'Caso de Andrea', 1]]);
    assert.equal(jarvis.listarPiezas().find((p) => p.id === origen.id).estado, 'listo');
    assert.equal((await api(`/api/disenos/${d.id}`, null, 'DELETE')).status, 200);
    assert.equal((await api(`/api/disenos/${d.id}`)).status, 400);
    assert.ok(jarvis.listarPiezas().some((p) => p.id === stories[0].id), 'borrar el diseño no borra lo exportado');
  });

  test('si Claude termina sin guardar, el diseño queda con un aviso claro', async () => {
    const { data: d } = await api('/api/disenos', { formato: 'carrusel', plantilla: 'cine', guion: 'Top 5 errores' });
    assert.equal(d.estado, 'generando');
    const e = await esperar(d.id, 'error');
    assert.match(e.error, /sin guardar el diseño/);
  });

  test('importar el kit por la API', async () => {
    const r = await fetch(`${base}/api/disenos/kit`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zipDeKit() });
    assert.equal(r.status, 200);
    const mal = await fetch(`${base}/api/disenos/kit`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: Buffer.from('nada') });
    assert.equal(mal.status, 400);
  });

  test('MCP: herramientas de diseño (kit, archivos del kit, medios y guardar)', async () => {
    const llamadas = [];
    const servidor = async (m, ruta, body) => { llamadas.push([m, ruta, body]); return ruta === '/api/disenos' && m === 'GET' ? { disenos: [] } : { ok: true }; };
    const s = buildServer(jarvis, { diseno: { kit: createKit({ vaultPath: vault }), servidor } });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(b);
    const nombres = (await c.listTools()).tools.map((t) => t.name);
    for (const n of ['ver_kit_diseno', 'leer_archivo_kit', 'listar_medios', 'listar_disenos', 'ver_diseno', 'crear_diseno', 'guardar_diseno']) assert.ok(nombres.includes(n), n);
    const json = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { error: r.isError, datos: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) }; };
    const k = (await json('ver_kit_diseno')).datos;
    assert.equal(k.nombre, 'Marca de prueba');
    assert.match(k.reglas, /tl\.fromTo/);
    assert.match((await json('leer_archivo_kit', { archivo: 'GUIA.md' })).datos.contenido, /Mostaza/);
    assert.ok((await json('leer_archivo_kit', { archivo: '../../../etc/hosts' })).error);
    assert.ok((await json('listar_medios', { tipo: 'video' })).datos.every((m) => m.tipo === 'video'));
    await json('guardar_diseno', { id: 7, caption: 'c', slides: [slide(1)] });
    assert.deepEqual(llamadas.at(-1).slice(0, 2), ['PUT', '/api/disenos/7/datos']);
    assert.equal(llamadas.at(-1)[2].slides.length, 1);
  });
});

describe('instalar Chromium cuando falta', () => {
  const proceso = (code, salida = '') => (bin, args) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter(); p.stderr = new EventEmitter();
    p.args = args;
    setImmediate(() => { p.stderr.emit('data', Buffer.from(salida)); p.emit('close', code); });
    proceso.ultimo = args;
    return p;
  };
  test('lanza el instalador de Playwright, explica el error y permite reintentar', async () => {
    const fallo = 'Downloading Chromium\nError: Download failed: server returned code 403 body \'request blocked\'\n    at ChildProcess.<anonymous> (x.js:1:1)\nError: Download failure, code=1\n';
    await assert.rejects(instalarChromium({ ejecutar: proceso(1, fallo) }), /Download failed: server returned code 403/);
    assert.ok(proceso.ultimo.includes('install') && proceso.ultimo.includes('chromium') && proceso.ultimo.includes('--only-shell'));
    await instalarChromium({ ejecutar: proceso(0) }); // tras un fallo se puede volver a intentar
  });
});

// Con un navegador de verdad (Edge/Chrome o el Chromium de Playwright): si no hay, se salta
describe('motor con navegador', () => {
  let motor, kit, hayNavegador = true;
  before(async () => {
    const vault = path.join(dir, 'V4');
    mkdirSync(vault, { recursive: true });
    kit = createKit({ vaultPath: vault });
    motor = createMotor({ kit, cerrarTrasMs: 10 });
    try { await motor.previsualizar(JSON.parse(readFileSync('diseno/kit-ejemplo/ejemplos/basica.json', 'utf8'))); } catch (e) { if (/navegador/.test(e.message)) hayNavegador = false; else throw e; }
  });
  after(() => motor.cerrar());

  test('el kit de ejemplo se dibuja sin avisos y detecta un texto que se sale', async (t) => {
    if (!hayNavegador) return t.skip('No hay navegador en este equipo');
    const d = JSON.parse(readFileSync('diseno/kit-ejemplo/ejemplos/basica.json', 'utf8'));
    const r = await motor.previsualizar(d);
    assert.equal(r.imagenes.length, 3);
    assert.ok(r.imagenes.every((b) => b[0] === 0xff && b[1] === 0xd8), 'son JPG');
    assert.deepEqual(r.avisos, []);
    const malo = await motor.previsualizar({ ...d, slides: [{ bg: 'black', html: '<div style="position:absolute;left:900px;top:300px;white-space:nowrap;font-size:80px">Un titular demasiado largo</div><div class="titular">Uno</div><div class="titular" style="margin-top:-90px">Dos</div>' }] });
    const textos = malo.avisos.map((a) => a.texto).join('\n');
    assert.match(textos, /se sale de la imagen/);
    assert.match(textos, /«Uno» se monta sobre «Dos»|«Dos» se monta sobre «Uno»/);
  });

  test('vídeo MP4 de 7 s (si hay ffmpeg)', async (t) => {
    if (!hayNavegador) return t.skip('No hay navegador en este equipo');
    const d = JSON.parse(readFileSync('diseno/kit-ejemplo/ejemplos/basica.json', 'utf8'));
    let r;
    try { r = await motor.exportar({ ...d, slides: d.slides.slice(0, 1) }, 'mp4'); } catch (e) { if (/ffmpeg/.test(e.message)) return t.skip('No hay ffmpeg'); throw e; }
    try {
      const mp4 = readFileSync(r.archivos[0].ruta);
      assert.equal(mp4.subarray(4, 8).toString(), 'ftyp');
      assert.ok(mp4.length > 10_000);
    } finally { r.limpiar(); }
  });
});

