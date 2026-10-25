import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
import { createMotor, instalarChromium, normalizarDiseno, paginaDiapositiva, rutaFfmpeg } from '../server/diseno/motor.js';
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
    { id: 'rejilla', nombre: 'Rejilla', formatos: ['carrusel', 'story'], ejemplo: 'ejemplos/rejilla.json', ejemplos: ['ejemplos/rejilla-2.json'] },
    { id: 'cine', nombre: 'Cine', formatos: ['carrusel'], cabecera: false, paginacion: false },
    { id: 'anuncio', nombre: 'Anuncio', formatos: ['carrusel', 'story'], cabecera: false, paginacion: false, anuncio: true, guia: 'ANUNCIOS.md' },
  ],
  piezas: [{ archivo: 'piezas/cta.json', nombre: 'CTA de comentarios', descripcion: 'Post con comentarios' }, 'piezas/movil.json', { nada: 1 }],
  referencias: [{ archivo: 'referencias/plantilla-1.jpg', descripcion: 'Las 8 diapositivas' }],
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
    assert.deepEqual(e.plantillas.map((p) => p.id), ['rejilla', 'cine', 'anuncio']);
    assert.equal(e.plantillas[2].anuncio, true);
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
    assert.equal(d.slides[0].fondo, '');
  });

  test('fondo: va a sangre entre .bg y la cabecera, fuera de .content, con sus estilos en el <head>', () => {
    const d = normalizarDiseno({ plantilla: 'rejilla', slides: [{ bg: 'black', fondo: '<style>.s1-foto { inset: 0 }</style><img class="s1-foto" src="img/a.jpg">', html: '<p>Texto</p>' }] }, kit);
    const p = paginaDiapositiva(kit, d, 1);
    const i = (t) => p.indexOf(t);
    assert.ok(i('class="bg bg-black"') < i('class="s1-foto"') && i('class="s1-foto"') < i('class="content"'), 'el fondo va detrás del contenido');
    assert.ok(i('.s1-foto { inset: 0 }') < i('</head>'), 'sus estilos van al <head>');
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
  const dibujadas = [];
  const exportadas = [];
  const prompts = [];
  const motorFalso = {
    previsualizar: async (d, { solo } = {}) => {
      const ns = d.slides.map((_, i) => i + 1).filter((n) => !solo || solo.includes(n));
      dibujadas.push(ns);
      return { imagenes: d.slides.map((_, i) => (ns.includes(i + 1) ? Buffer.from('jpg') : null)), avisos: ns.includes(3) && d.slides.length > 2 ? [{ diapositiva: 3, texto: '«x» se sale de la imagen' }] : [] };
    },
    fotogramas: async (d, n, segundos) => segundos.map((segundo) => ({ segundo, buffer: Buffer.from(`f${n}-${segundo}`) })),
    exportar: async (d, tipo, { alProgreso, solo }) => {
      alProgreso({ avance: 1 });
      const ns = d.slides.map((_, i) => i + 1).filter((n) => !solo || solo.includes(n));
      exportadas.push(ns);
      return { archivos: ns.map((n) => ({ n, nombre: `slide-0${n}.${tipo}`, mime: tipo === 'mp4' ? 'video/mp4' : 'image/jpeg', buffer: Buffer.from(`${tipo}${n}`) })), limpiar() {} };
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
      prompts.push(o.prompt);
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

    const { data: f } = await api(`/api/disenos/${d.id}/fotogramas`, { diapositiva: 2, segundos: [1, 2.5] });
    assert.deepEqual(f.fotogramas.map((x) => x.segundo), [1, 2.5]);
    assert.equal(readFileSync(f.fotogramas[1].ruta, 'utf8'), 'f2-2.5');
    assert.equal((await api(`/api/disenos/${d.id}/fotogramas`, { diapositiva: 9 })).status, 400);
    const { data: v2 } = await api(`/api/disenos/${d.id}`);
    assert.deepEqual(v2.previas, v.previas, 'los fotogramas no cambian las vistas previas');

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

  test('creativos de anuncio: plantilla de anuncios, encargo propio y a la biblioteca como pieza «Anuncio»', async () => {
    assert.equal((await api('/api/anuncios/creativos', { tipo: 'gif', brief: 'Un anuncio cualquiera' })).status, 400);
    assert.match((await api('/api/anuncios/creativos', { tipo: 'imagen', brief: 'x' })).data.error, /Cuenta de qué va/);
    const { status, data: d } = await api('/api/anuncios/creativos', { tipo: 'imagen', brief: 'Entrenadores que contestan mensajes todo el día', oferta: 'Prueba 14 días gratis', palabra: 'SETTER', variantes: 2, material: ['/api/contenido/archivos/2026-10/a.jpg', 'https://otra.web/x.jpg'] });
    assert.equal(status, 200, JSON.stringify(d));
    assert.equal(d.uso, 'anuncio');
    assert.equal(d.plantilla, 'anuncio', 'usa la plantilla de anuncios aunque no se pida');
    assert.equal(d.formato, 'carrusel');
    await esperar(d.id, 'error'); // el Claude falso termina sin guardar
    const p = prompts.at(-1);
    assert.match(p, /^Diseña el creativo de anuncio #\d+/);
    assert.match(p, /2 diapositivas, y cada una es un anuncio distinto/);
    assert.match(p, /ANUNCIOS\.md/);
    assert.match(p, /Prueba 14 días gratis/);
    assert.match(p, /\/api\/contenido\/archivos\/2026-10\/a\.jpg/);
    assert.doesNotMatch(p, /otra\.web/, 'solo material de la biblioteca');
    assert.match(p, /Texto principal/);
    // Un diseño normal nunca coge la plantilla de anuncios
    const { data: normal } = await api('/api/disenos', { formato: 'story', guion: 'Stories normales', generar: false });
    assert.equal(normal.plantilla, 'rejilla');
    // Vídeo: 9:16, una diapositiva larga
    const { data: v } = await api('/api/anuncios/creativos', { tipo: 'video', brief: 'Testimonio de Andrea con gráficos encima' });
    assert.equal(v.formato, 'story');
    await esperar(v.id, 'error');
    assert.match(prompts.at(-1), /vídeo vertical 9:16/);
    // Exportar: una pieza «Anuncio» con las variantes y los textos para Meta, en la carpeta Anuncios
    await api(`/api/disenos/${d.id}/datos`, { caption: 'VARIANTE 1\nTexto principal: …', slides: [slide(1), slide(2)] }, 'PUT');
    await api(`/api/disenos/${d.id}/exportar`, { tipo: 'jpg' });
    const e = await esperar(d.id);
    const pieza = jarvis.listarPiezas().find((x) => x.id === e.exportado.piezas[0]);
    assert.equal(pieza.formato, 'Anuncio');
    assert.equal(pieza.carpeta, 'Anuncios');
    assert.equal(pieza.archivos.length, 2);
    assert.match(pieza.caption, /Texto principal/);
  });

  test('editar una diapositiva: solo se dibuja esa y al exportar solo se saca y se sustituye esa', async () => {
    const { data: d } = await api('/api/disenos', { formato: 'carrusel', plantilla: 'rejilla', guion: 'Cinco slides', generar: false });
    await api(`/api/disenos/${d.id}/datos`, { slides: [1, 2, 3, 4, 5].map(slide) }, 'PUT');
    assert.deepEqual(dibujadas.at(-1), [1, 2, 3, 4, 5]);
    await api(`/api/disenos/${d.id}/exportar`, { tipo: 'mp4' });
    const e1 = await esperar(d.id);
    assert.deepEqual(exportadas.at(-1), [1, 2, 3, 4, 5]);
    assert.deepEqual(e1.cambiadas, []);
    const pieza1 = jarvis.listarPiezas().find((p) => p.id === e1.exportado.piezas[0]);

    // Claude cambia solo la 5
    const slides = [1, 2, 3, 4, 5].map(slide);
    slides[4] = { bg: 'black', html: '<div class="titular">La 5, ahora con el botón visible</div>' };
    const { data: g } = await api(`/api/disenos/${d.id}/datos`, { slides }, 'PUT');
    assert.deepEqual(dibujadas.at(-1), [5], 'solo se vuelve a dibujar la 5');
    assert.deepEqual(g.redibujadas, [5]);
    assert.deepEqual(g.avisos, ['Diapositiva 3: «x» se sale de la imagen'], 'los avisos de las que no cambian se conservan');
    const { data: v } = await api(`/api/disenos/${d.id}`);
    assert.equal(v.previas.length, 5);
    assert.deepEqual(v.cambiadas, [5], 'la 5 ha cambiado desde la exportación');

    await api(`/api/disenos/${d.id}/exportar`, { tipo: 'mp4' });
    const e2 = await esperar(d.id);
    assert.deepEqual(exportadas.at(-1), [5], 'solo se exporta la 5');
    assert.deepEqual(e2.exportado.piezas, e1.exportado.piezas, 'en la misma pieza');
    const pieza2 = jarvis.listarPiezas().find((p) => p.id === e2.exportado.piezas[0]);
    assert.deepEqual(pieza2.archivos.slice(0, 4).map((a) => a.path), pieza1.archivos.slice(0, 4).map((a) => a.path), 'las otras cuatro siguen siendo las mismas');
    assert.notEqual(pieza2.archivos[4].path, pieza1.archivos[4].path, 'la 5 se sustituye');
    assert.ok(!archivos.existe(pieza1.archivos[4].path), 'y la antigua se borra');
    assert.ok(archivos.existe(pieza1.archivos[0].path));

    // Sin cambios: hay que elegir cuáles; elegidas a mano, solo esas
    assert.match((await api(`/api/disenos/${d.id}/exportar`, { tipo: 'mp4' })).data.error, /No ha cambiado nada/);
    await api(`/api/disenos/${d.id}/exportar`, { tipo: 'mp4', solo: [2, 4] });
    await esperar(d.id);
    assert.deepEqual(exportadas.at(-1), [2, 4]);
    // En otro formato, o con «todo», salen todas
    await api(`/api/disenos/${d.id}/exportar`, { tipo: 'jpg', solo: [2] });
    await esperar(d.id);
    assert.deepEqual(exportadas.at(-1), [1, 2, 3, 4, 5]);
    await api(`/api/disenos/${d.id}/exportar`, { tipo: 'jpg', todo: true });
    await esperar(d.id);
    assert.deepEqual(exportadas.at(-1), [1, 2, 3, 4, 5]);
  });

  test('otra versión desde el diseño: sabe de qué diseño sale una pieza y no toca ni la pieza ni lo exportado', async () => {
    const ds = createDisenos({ db, jarvis, kit: createKit({ vaultPath: vault }), motor: motorFalso, archivos, previasDir: path.join(vault, '.jarvis', 'disenos') });
    const d = ds.crear({ formato: 'carrusel', plantilla: 'rejilla', guion: 'Para convertir', generar: false });
    await ds.guardarDatos(d.id, { slides: [1, 2].map(slide) });
    ds.exportar(d.id, { tipo: 'jpg' });
    await esperar(d.id);
    const pid = ds.obtener(d.id).exportado.piezas[0];
    assert.deepEqual(ds.deLaPieza(pid), { id: d.id, formato: 'carrusel', tipo: 'jpg', indice: 0 });
    assert.equal(ds.deLaPieza(999999), null);
    const r = await ds.otraVersion(d.id, 'mp4');
    assert.deepEqual(r.archivos.map((a) => a.mime), ['video/mp4', 'video/mp4']);
    assert.equal(jarvis.leerPieza(pid).archivos[0].mime, 'image/jpeg', 'la pieza no cambia');
    assert.equal(ds.obtener(d.id).exportado.tipo, 'jpg', 'lo exportado del diseño sigue igual');
  });

  test('una exportación se puede parar a medias: se queda como estaba y sin error', async () => {
    let seguir;
    const lento = { ...motorFalso, exportar: async (d, tipo, { alProgreso }) => {
      alProgreso({ avance: 0.1 });
      await new Promise((r) => { seguir = r; });
      alProgreso({ avance: 0.5 }); // aquí se da cuenta de que la han parado
      return { archivos: [], limpiar() {} };
    } };
    const ds = createDisenos({ db, jarvis, kit: createKit({ vaultPath: vault }), motor: lento, archivos, previasDir: path.join(vault, '.jarvis', 'disenos') });
    const d = ds.crear({ formato: 'carrusel', plantilla: 'rejilla', guion: 'Para parar', generar: false });
    await ds.guardarDatos(d.id, { slides: [1, 2].map(slide) });
    const piezas = jarvis.listarPiezas().length;
    ds.exportar(d.id, { tipo: 'mp4' });
    for (let i = 0; i < 50 && !seguir; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(ds.obtener(d.id).estado, 'exportando');
    assert.deepEqual(ds.pararExportacion(d.id), { ok: true });
    seguir();
    const e = await esperar(d.id);
    assert.equal(e.estado, 'listo');
    assert.equal(e.error, null);
    assert.equal(e.exportado, null, 'no se ha exportado nada');
    assert.equal(jarvis.listarPiezas().length, piezas);
    assert.throws(() => ds.pararExportacion(d.id), /Ya ha terminado/);
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

  test('progreso: Claude lo diseña desde Replicar; los pasos avanzan con lo que hace, lo exporta él y se apunta lo que tardó', async () => {
    const asistenteFalso = { conversacionActiva: () => 'replicar', estado: () => ({ ocupado: true }) };
    const ds = createDisenos({ db, jarvis, kit: createKit({ vaultPath: vault }), motor: motorFalso, archivos, previasDir: path.join(vault, '.jarvis', 'disenos'), asistente: asistenteFalso });
    const ev = (e) => ds.alEventoClaude({ conversacion: 'replicar', ...e });
    const d = ds.crear({ formato: 'carrusel', plantilla: 'rejilla', guion: 'Replicado', generar: false });
    assert.equal(d.estado, 'generando');
    assert.equal(d.trabajo.paso, 'empezando');
    assert.equal(d.trabajo.estimado, 300_000, 'sin historial: 5 min');
    ev({ tipo: 'herramienta', nombre: 'ver_kit_diseno' });
    assert.equal(ds.obtener(d.id).trabajo.texto, 'Estudiando tu sistema de diseño');
    ev({ tipo: 'resultado_herramienta', ok: true });
    assert.equal(ds.obtener(d.id).trabajo.paso, 'escribiendo');
    ev({ tipo: 'herramienta', nombre: 'guardar_diseno' });
    await ds.guardarDatos(d.id, { slides: [slide(1)] });
    assert.equal(ds.obtener(d.id).estado, 'generando', 'sigue diseñando hasta que Claude termina');
    ev({ tipo: 'resultado_herramienta', ok: true });
    assert.equal(ds.obtener(d.id).trabajo.paso, 'revisando');
    ev({ tipo: 'herramienta', nombre: 'Read' });
    assert.equal(ds.obtener(d.id).trabajo.paso, 'revisando', 'mirar la vista previa no vuelve atrás');
    ds.exportar(d.id, { tipo: 'jpg' }); // lo exporta Claude mientras trabaja
    await esperar(d.id);
    await new Promise((r) => setTimeout(r, Math.max(0, 1100 - (Date.now() - d.trabajo.inicio))));
    ev({ tipo: 'fin', texto: 'hecho' });
    const fin = ds.obtener(d.id);
    assert.equal(fin.trabajo, null);
    assert.equal(fin.estado, 'listo');
    assert.ok(fin.exportado);
    assert.equal(ds.crear({ formato: 'carrusel', plantilla: 'rejilla', guion: 'Otro', generar: false }).trabajo.estimado < 300_000, true, 'el siguiente estima con lo que tardó este');
  });

  test('portadas: plantillas del kit, generar una diapositiva y exportarla a una imagen para la pieza', async () => {
    // De serie: Carrusel (4:5) y Testimonio (9:16), sin imagen hasta que se sube la de referencia
    const { data: t } = await api('/api/portadas');
    assert.deepEqual(t.tipos.map((x) => [x.id, x.formato, x.muestra]), [['carrusel', 'carrusel', null], ['testimonio', 'story', null]]);
    assert.match((await api('/api/portadas', { tipo: 'testimonio', titulo: 'x' })).data.error, /Sube primero la imagen de referencia de «Testimonio»/);
    const subir = (q, cuerpo = Buffer.from('png')) => fetch(`${base}/api/portadas/plantillas?${q}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: cuerpo }).then(async (r) => ({ status: r.status, data: await r.json() }));
    assert.equal((await subir('id=testimonio&nombre_archivo=andrea.gif')).status, 400);
    const s1 = await subir('id=testimonio&nombre_archivo=andrea.JPEG');
    assert.match(s1.data.tipos.find((x) => x.id === 'testimonio').muestra, /^\/api\/portadas\/muestra\/testimonio\?v=/);
    const img = await fetch(`${base}/api/portadas/muestra/testimonio`);
    assert.equal(img.status, 200);
    assert.equal(await img.text(), 'png');
    // Añadir otra plantilla y borrarla
    const s2 = await subir('nombre=Lanzamiento&formato=story&nombre_archivo=l.png');
    assert.deepEqual(s2.data.tipos.at(-1), { ...s2.data.tipos.at(-1), id: 'lanzamiento', nombre: 'Lanzamiento', formato: 'story' });
    assert.equal((await api('/api/portadas/plantillas/lanzamiento', null, 'DELETE')).data.tipos.length, 2);
    assert.equal((await api('/api/portadas', { tipo: 'nada', titulo: 'x' })).status, 400);
    assert.match((await api('/api/portadas', { tipo: 'testimonio' })).data.error, /título/);
    const pieza = jarvis.crearPieza({ titulo: 'Reel del setter', formato: 'Reel' });
    const { data: d } = await api('/api/portadas', { tipo: 'testimonio', titulo: 'Contraté antes a un setter IA', descripcion: 'Fondo blanco con letras negras', foto: { url: '/api/contenido/archivos/2026-10/yo.jpg', mime: 'image/jpeg' }, pieza_id: pieza.id });
    assert.equal(d.uso, 'portada');
    assert.equal(d.formato, 'story');
    // Mientras no llega a la pieza, se ve en la lista de Diseño (si se cierra la ventana, no se pierde)
    assert.ok((await api('/api/disenos')).data.disenos.some((x) => x.id === d.id));
    const e = await esperar(d.id, 'error');
    assert.match(e.error, /sin guardar/);
    // Claude la guarda (una diapositiva) y se exporta a la biblioteca como imagen
    assert.equal((await api(`/api/disenos/${d.id}/datos`, { slides: [slide(1)] }, 'PUT')).status, 200);
    const { data: a } = await api(`/api/portadas/${d.id}/exportar`, {});
    assert.equal(a.mime, 'image/jpeg');
    assert.match(a.nombre, /portada-contrate-antes-a-un-setter-ia/);
    assert.deepEqual((await api(`/api/portadas/${d.id}/exportar`, {})).data, a, 'no la exporta dos veces');
    // Ya en la pieza, deja de salir en la lista de Diseño
    assert.ok(!(await api('/api/disenos')).data.disenos.some((x) => x.id === d.id));
  });

  test('logo: se sube su archivo y la portada lo pone tal cual (sin él, no se dibuja)', async () => {
    const textos = [];
    const asistenteFalso = { estado: () => ({ ocupado: false }), nuevaSesion() {}, preguntar: ({ texto }) => { textos.push(texto); return { id: 1 }; }, conversacionActiva: () => null };
    const ds = createDisenos({ db, jarvis, kit: createKit({ vaultPath: vault }), motor: motorFalso, archivos, previasDir: path.join(vault, '.jarvis', 'disenos'), asistente: asistenteFalso });
    await ds.crearPortada({ tipo: 'testimonio', titulo: 'Sin logo' });
    assert.match(textos.at(-1), /NUNCA lo dibujes.*déjalo fuera/);
    const subir = (nombre, cuerpo = Buffer.from('png')) => fetch(`${base}/api/portadas/logos?nombre_archivo=${nombre}`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: cuerpo }).then(async (r) => ({ status: r.status, data: await r.json() }));
    assert.equal((await subir('logo.svg')).status, 400, 'SVG no (se sirve como imagen de la biblioteca)');
    const r = await subir('logo-blanco.png');
    assert.equal(r.status, 200);
    const [logo] = r.data.logos;
    assert.match(logo.url, /^\/api\/contenido\/archivos\/.*logo-blanco\.png$/);
    assert.ok(archivos.existe(logo.path));
    await ds.crearPortada({ tipo: 'testimonio', titulo: 'Con logo' });
    const p = textos.at(-1);
    assert.ok(p.includes(logo.url), 'el prompt lleva el archivo del logo');
    assert.match(p, /usa SIEMPRE el archivo real con <img src> \(NUNCA lo dibujes/);
    assert.match(p, /mismo sitio, con el mismo tamaño/);
    // Y en los diseños normales también
    ds.crear({ formato: 'carrusel', plantilla: 'rejilla', guion: 'Con logo' });
    assert.ok(textos.at(-1).includes(logo.url));
    const fuera = await fetch(`${base}/api/portadas/logos?path=${encodeURIComponent(logo.path)}`, { method: 'DELETE' }).then((x) => x.json());
    assert.deepEqual(fuera.logos, []);
    assert.ok(!archivos.existe(logo.path), 'se borra de la biblioteca');
  });

  test('portada en segundo plano: al terminar se pone sola en la pieza y sale en «Trabajando en…» mientras tanto', async () => {
    const emitidos = [];
    const asistenteFalso = { estado: () => ({ ocupado: false }), nuevaSesion() {}, preguntar: () => ({ id: 1 }), conversacionActiva: () => null };
    const ds = createDisenos({ db, jarvis, kit: createKit({ vaultPath: vault }), motor: motorFalso, archivos, previasDir: path.join(vault, '.jarvis', 'disenos'), asistente: asistenteFalso, emitir: (e) => emitidos.push(e) });
    const reel = jarvis.crearPieza({ titulo: 'Reel del setter IA', formato: 'Reel' });
    const carrusel = jarvis.crearPieza({ titulo: 'Carrusel del setter', formato: 'Carrusel', archivos: [] });
    const hacer = async (pieza) => {
      const d = await ds.crearPortada({ tipo: 'testimonio', titulo: `Portada de ${pieza.titulo}`, pieza });
      assert.ok(ds.trabajos().some((t) => t.id === d.id && t.trabajo?.paso === 'empezando'), 'mientras, sale en lo que está haciendo');
      await ds.guardarDatos(d.id, { slides: [slide(1)] });
      ds.alEventoClaude({ conversacion: 'diseno', tipo: 'fin', texto: 'hecha' });
      for (let i = 0; i < 50 && !emitidos.some((e) => e.type === 'portada' && e.diseno === d.id); i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(!ds.trabajos().some((t) => t.id === d.id), 'y al terminar deja de salir');
      return emitidos.find((e) => e.type === 'portada' && e.diseno === d.id);
    };
    const e1 = await hacer(reel);
    assert.equal(e1.comoPortada, true);
    assert.equal(jarvis.leerPieza(reel.id).portada.path, e1.archivo.path, 'en un reel queda como su portada');
    const e2 = await hacer(carrusel);
    assert.equal(e2.comoPortada, false);
    assert.equal(jarvis.leerPieza(carrusel.id).archivos[0].path, e2.archivo.path, 'en un carrusel, como primera imagen');
    // Si la ventana sigue abierta y la exporta también, no se duplica
    assert.deepEqual(await ds.exportarPortada(e2.diseno), e2.archivo);
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
    for (const n of ['ver_kit_diseno', 'leer_archivo_kit', 'listar_medios', 'ver_pieza', 'transcribir_pieza', 'transcribir_video', 'subtitulos_video', 'listar_disenos', 'ver_diseno', 'crear_diseno', 'guardar_diseno']) assert.ok(nombres.includes(n), n);
    const json = async (name, args = {}) => { const r = await c.callTool({ name, arguments: args }); return { error: r.isError, datos: r.isError ? r.content[0].text : JSON.parse(r.content[0].text) }; };
    const k = (await json('ver_kit_diseno')).datos;
    assert.equal(k.nombre, 'Marca de prueba');
    assert.deepEqual(k.plantillas[0].ejemplos, ['ejemplos/rejilla.json', 'ejemplos/rejilla-2.json']);
    assert.deepEqual(k.piezas.map((p) => [p.archivo, p.nombre]), [['piezas/cta.json', 'CTA de comentarios'], ['piezas/movil.json', 'movil']]);
    assert.ok(path.isAbsolute(k.referencias[0].ruta) && k.referencias[0].ruta.endsWith(path.join('referencias', 'plantilla-1.jpg')), 'la referencia se puede abrir con Read');
    assert.match(k.reglas, /tl\.fromTo/);
    assert.match((await json('leer_archivo_kit', { archivo: 'GUIA.md' })).datos.contenido, /Mostaza/);
    assert.ok((await json('leer_archivo_kit', { archivo: '../../../etc/hosts' })).error);
    assert.ok((await json('listar_medios', { tipo: 'video' })).datos.every((m) => m.tipo === 'video'));
    await json('guardar_diseno', { id: 7, caption: 'c', slides: [slide(1)] });
    assert.deepEqual(llamadas.at(-1).slice(0, 2), ['PUT', '/api/disenos/7/datos']);
    assert.equal(llamadas.at(-1)[2].slides.length, 1);
    await json('ver_fotogramas_diseno', { id: 7, diapositiva: 2, segundos: [1.5] });
    assert.deepEqual(llamadas.at(-1), ['POST', '/api/disenos/7/fotogramas', { diapositiva: 2, segundos: [1.5] }]);
  });

  test('MCP: transcribir espera, preguntando, a que acabe la transcripción en segundo plano', async () => {
    const llamadas = [];
    let vueltas = 0;
    const servidor = async (m, ruta) => {
      llamadas.push([m, ruta]);
      if (m === 'POST') return { estado: 'haciendo', clave: 'pieza-170' };
      vueltas += 1;
      return vueltas < 3 ? { estado: 'haciendo', clave: 'pieza-170', progreso: vueltas * 30 } : { estado: 'listo', clave: 'pieza-170', transcripciones: [{ n: 1, texto: 'Hola, soy Miguel' }] };
    };
    const s = buildServer(jarvis, { diseno: { kit: createKit({ vaultPath: vault }), servidor, cadaMs: 5 } });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(b);
    const r = await c.callTool({ name: 'transcribir_pieza', arguments: { pieza_id: 170 } });
    assert.equal(JSON.parse(r.content[0].text).transcripciones[0].texto, 'Hola, soy Miguel');
    assert.deepEqual(llamadas.map((l) => l.join(' ')), ['POST /api/piezas/170/transcribir', 'GET /api/transcripciones?clave=pieza-170', 'GET /api/transcripciones?clave=pieza-170', 'GET /api/transcripciones?clave=pieza-170']);
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
    // Un texto tapado por una capa opaca (el pie de un post bajo la hoja de comentarios) no se ve: no es que se pisen
    const tapado = await motor.previsualizar({ ...d, slides: [{ bg: 'black', html: '<div style="position:relative;width:600px;height:300px"><p style="position:absolute;left:0;top:40px;margin:0;font-size:40px;color:#fff">Pie del post escondido</p><div style="position:absolute;inset:0;background:#1c1c1e"><p style="position:absolute;left:0;top:40px;margin:0;font-size:40px;color:#fff">Respuesta encima</p></div></div>' }] });
    assert.deepEqual(tapado.avisos, []);
  });

  test('saca fotogramas a mitad de animación (distintos del final)', async (t) => {
    if (!hayNavegador) return t.skip('No hay navegador en este equipo');
    const d = JSON.parse(readFileSync('diseno/kit-ejemplo/ejemplos/basica.json', 'utf8'));
    const f = await motor.fotogramas(d, 1, [0, 99]);
    assert.deepEqual(f.map((x) => x.segundo), [0, 7], 'los segundos se ajustan a lo que dura la diapositiva');
    assert.ok(f.every((x) => x.buffer[0] === 0xff && x.buffer[1] === 0xd8), 'son JPG');
    assert.notDeepEqual(f[0].buffer, f[1].buffer, 'al principio y al final no se ve igual');
  });

  test('un vídeo MP4 de la biblioteca (H.264, como los del móvil) se ve en el diseño', async (t) => {
    if (!hayNavegador) return t.skip('No hay navegador en este equipo');
    const ffmpeg = await rutaFfmpeg();
    const origen = path.join(dir, 'movil.mp4');
    if (spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x568:rate=15', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', origen]).status !== 0) return t.skip('No hay ffmpeg con H.264');
    const archivos = createArchivos({ dir: path.join(dir, 'contenido-video') });
    const a = await archivos.guardar(createReadStream(origen), { nombre: 'grabacion.mp4', mime: 'video/mp4' });
    const conVideo = createMotor({ kit, archivos, cerrarTrasMs: 10 });
    try {
      const d = JSON.parse(readFileSync('diseno/kit-ejemplo/ejemplos/basica.json', 'utf8'));
      const r = await conVideo.previsualizar({ ...d, slides: [{ bg: 'black', html: `<video src="${a.url}" muted playsinline style="width:600px"></video><div class="titular">Con vídeo</div>` }] });
      assert.deepEqual(r.avisos.map((x) => x.texto), [], 'el vídeo carga');
      assert.ok(existsSync(path.join(archivos.dir, '.webm2')), 'se guarda la versión WebM para la próxima vez');
    } finally { await conVideo.cerrar(); }
  });

  test('una diapositiva más larga, con el sonido de un trozo del vídeo y subtítulos sincronizados', async (t) => {
    if (!hayNavegador) return t.skip('No hay navegador en este equipo');
    const ffmpeg = await rutaFfmpeg();
    const origen = path.join(dir, 'entrevista.mp4');
    // Un vídeo de 8 s con sonido (como la entrevista de un cliente)
    if (spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=320x568:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=8', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', origen]).status !== 0) return t.skip('No hay ffmpeg con H.264');
    const archivos = createArchivos({ dir: path.join(dir, 'contenido-sonido') });
    const a = await archivos.guardar(createReadStream(origen), { nombre: 'miguel.mp4', mime: 'video/mp4' });
    const conVideo = createMotor({ kit, archivos, cerrarTrasMs: 10 });
    try {
      const d = JSON.parse(readFileSync('diseno/kit-ejemplo/ejemplos/basica.json', 'utf8'));
      const lineas = [[0.2, 1.4, 'Antes trabajaba doce horas'], [1.5, 2.8, 'y ahora ya no']];
      const conSonido = { bg: 'black', duracion: 3, html: `<style>#s2-sub .sub-linea { font-size: 48px; color: #fff; }</style><video src="${a.url}" muted playsinline data-start="0" data-from="4" data-audio style="width:600px"></video><div id="s2-sub" style="position:absolute;left:60px;right:60px;bottom:120px"></div>`, js: `subtitulos('#s2-sub', ${JSON.stringify(lineas)}, 0);` };
      const diseno = { ...d, slides: [d.slides[0], conSonido] };
      assert.equal(normalizarDiseno(diseno, kit.leer()).slides[1].duracion, 3);
      assert.equal(normalizarDiseno({ ...diseno, slides: [{ ...conSonido, duracion: 500 }] }, kit.leer()).slides[0].duracion, 60, 'como mucho 60 s');
      const prev = await conVideo.previsualizar(diseno);
      assert.deepEqual(prev.avisos.map((x) => x.texto), [], 'sin avisos (los subtítulos no cuentan como animación tardía)');
      const r = await conVideo.exportar(diseno, 'mp4');
      try {
        const info = (n) => spawnSync(ffmpeg, ['-hide_banner', '-i', r.archivos.find((x) => x.n === n).ruta]).stderr.toString();
        const dur = (txt) => { const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(txt); return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]); };
        assert.ok(Math.abs(dur(info(2)) - 3) < 0.2, `la diapositiva con vídeo dura 3 s (${dur(info(2))})`);
        const volumen = (n) => Number(/max_volume: (-?[\d.inf]+) dB/.exec(spawnSync(ffmpeg, ['-hide_banner', '-i', r.archivos.find((x) => x.n === n).ruta, '-af', 'volumedetect', '-f', 'null', '-']).stderr.toString())?.[1]);
        assert.match(info(2), /Audio: aac/, 'lleva el sonido del vídeo');
        assert.ok(volumen(2) > -30, `y se oye (${volumen(2)} dB)`);
        assert.ok(Math.abs(dur(info(1)) - kit.leer().duracion) < 0.2, 'las demás duran lo de siempre');
        assert.match(info(1), /Audio: aac/, 'y llevan una pista de audio (Instagram la exige en los carruseles)…');
        assert.ok(!(volumen(1) > -80), `…en silencio (${volumen(1)} dB)`);
      } finally { r.limpiar(); }
    } finally { await conVideo.cerrar(); }
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

