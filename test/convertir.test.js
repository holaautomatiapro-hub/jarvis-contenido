import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createArchivos } from '../server/archivos.js';
import { createConversiones } from '../server/convertir.js';
import { rutaFfmpeg } from '../server/diseno/motor.js';

const esperar = async (conv, id) => {
  for (let i = 0; i < 300; i++) { const e = conv.estado(id); if (e && e.estado !== 'haciendo') return e; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('no termina');
};

test('otra versión de una pieza: fotos → vídeo y vídeo → imagen, se ve antes y se añaden las que elijas', async (t) => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-conv-'));
  try {
    const ffmpeg = await rutaFfmpeg();
    const foto = path.join(dir, 'a.jpg');
    const video = path.join(dir, 'v.mp4');
    if (spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=800x1000', '-frames:v', '1', foto]).status !== 0) return t.skip('No hay ffmpeg');
    spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=2:size=540x960:rate=15', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
    const jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
    const archivos = createArchivos({ dir: path.join(dir, 'contenido') });
    const eventos = [];
    const conv = createConversiones({ jarvis, archivos, emitir: (e) => eventos.push(e) });
    const subir = (f, mime) => archivos.guardar(createReadStream(f), { nombre: path.basename(f), mime });

    // Un post de dos fotos → sus vídeos; se queda solo con uno y se añade al final, sin quitar las fotos
    const a1 = await subir(foto, 'image/jpeg');
    const a2 = await subir(foto, 'image/jpeg');
    const post = jarvis.crearPieza({ titulo: 'Post replicado', formato: 'Carrusel', archivos: [a1, a2] });
    assert.equal(conv.destinoDe(post), 'video');
    const e1 = conv.empezar(post.id);
    assert.equal(e1.estado, 'haciendo');
    assert.throws(() => conv.empezar(post.id), /Ya se está/);
    const l1 = await esperar(conv, post.id);
    assert.equal(l1.estado, 'listo', l1.error);
    assert.deepEqual(l1.archivos.map((a) => a.mime), ['video/mp4', 'video/mp4']);
    assert.ok(statSync(archivos.ruta(l1.archivos[0].path)).size > 1000);
    assert.equal(jarvis.leerPieza(post.id).archivos.length, 2, 'hasta elegir no cambia nada');
    assert.throws(() => conv.aceptar(post.id, { elegidos: [] }), /al menos una/);
    const { pieza: p1, nuevos } = conv.aceptar(post.id, { elegidos: [l1.archivos[1].path] });
    assert.equal(p1.formato, 'Carrusel', 'el tipo no cambia: lo decides tú');
    assert.deepEqual(p1.archivos.map((a) => a.path), [a1.path, a2.path, l1.archivos[1].path], 'se añade al final; las fotos siguen');
    assert.deepEqual(nuevos.map((a) => a.path), [l1.archivos[1].path]);
    assert.ok(archivos.existe(a1.path), 'lo que ya tenía no se borra');
    assert.ok(!archivos.existe(l1.archivos[0].path), 'el que no se ha elegido se borra');
    assert.equal(conv.estado(post.id), null);
    assert.ok(eventos.some((e) => e.type === 'conversion' && e.pieza === post.id));

    // Un reel → imagen (un fotograma) y descartarla deja todo como estaba
    const v1 = await subir(video, 'video/mp4');
    const reel = jarvis.crearPieza({ titulo: 'Reel', formato: 'Reel', archivos: [v1] });
    conv.empezar(reel.id);
    const l2 = await esperar(conv, reel.id);
    assert.equal(l2.archivos[0].mime, 'image/jpeg');
    conv.descartar(reel.id);
    assert.ok(!archivos.existe(l2.archivos[0].path));
    assert.equal(jarvis.leerPieza(reel.id).archivos[0].path, v1.path);

    // Con fotos y vídeos hay que elegir; el vídeo sale solo de las fotos
    const mezcla = jarvis.crearPieza({ titulo: 'Mezcla', formato: 'Carrusel', archivos: [v1, await subir(foto, 'image/jpeg')] });
    assert.throws(() => conv.empezar(mezcla.id), /elige/);
    conv.empezar(mezcla.id, { a: 'video' });
    const l3 = await esperar(conv, mezcla.id);
    assert.equal(l3.archivos.length, 1, 'un vídeo por foto, no por cada archivo');
    assert.equal(conv.aceptar(mezcla.id).pieza.archivos.length, 3, 'sin elegir, se añaden todas');
    assert.throws(() => conv.empezar(jarvis.crearPieza({ titulo: 'Solo vídeo', formato: 'Reel', archivos: [v1] }).id, { a: 'video' }), /no tiene fotos/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('si la pieza sale de un diseño, se saca la otra versión desde el diseño (con su animación)', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-conv2-'));
  try {
    const jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
    const archivos = createArchivos({ dir: path.join(dir, 'contenido') });
    const guardar = (n, mime) => archivos.guardar((async function* () { yield Buffer.from(n); })(), { nombre: n, mime });
    const jpgs = [await guardar('s1.jpg', 'image/jpeg'), await guardar('s2.jpg', 'image/jpeg')];
    const carrusel = jarvis.crearPieza({ titulo: 'Tu Claude es un pelota', formato: 'Carrusel', archivos: jpgs });
    const llamadas = [];
    const disenos = {
      deLaPieza: (pid) => (pid === carrusel.id ? { id: 9, formato: 'carrusel', tipo: 'jpg', indice: 0 } : null),
      otraVersion: async (id, tipo, { alProgreso }) => { llamadas.push(['otra', id, tipo]); alProgreso({ avance: 1 }); return { archivos: [await guardar('s1.mp4', 'video/mp4'), await guardar('s2.mp4', 'video/mp4')] }; },
    };
    const conv = createConversiones({ jarvis, archivos, disenos });
    conv.empezar(carrusel.id);
    const l = await esperar(conv, carrusel.id);
    assert.equal(l.deDiseno, true);
    assert.deepEqual(llamadas[0], ['otra', 9, 'mp4']);
    const { pieza: p } = conv.aceptar(carrusel.id);
    assert.equal(p.formato, 'Carrusel');
    assert.deepEqual(p.archivos.map((a) => a.mime), ['image/jpeg', 'image/jpeg', 'video/mp4', 'video/mp4']);
    assert.equal(llamadas.length, 1, 'lo exportado del diseño no se toca');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('se puede parar a medias desde «Trabajando»: se corta y no se queda nada', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-conv3-'));
  try {
    const jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
    const archivos = createArchivos({ dir: path.join(dir, 'contenido') });
    const guardar = (n, mime) => archivos.guardar((async function* () { yield Buffer.from(n); })(), { nombre: n, mime });
    const fotos = [await guardar('a.jpg', 'image/jpeg'), await guardar('b.jpg', 'image/jpeg')];
    const pieza = jarvis.crearPieza({ titulo: 'Post', formato: 'Post', archivos: fotos });
    // Un ffmpeg de mentira que escribe el vídeo y luego se queda «trabajando» hasta que lo cortan
    const senales = [];
    const ff = (args, { signal } = {}) => new Promise((ok, ko) => {
      senales.push(signal);
      writeFileSync(args.at(-1), 'x');
      if (senales.length === 1) return setTimeout(ok, 10);
      signal.addEventListener('abort', () => ko(new Error('cortado')));
    });
    const conv = createConversiones({ jarvis, archivos, ff });
    conv.empezar(pieza.id);
    for (let i = 0; i < 100 && senales.length < 2; i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(conv.trabajos().length, 1);
    assert.deepEqual(conv.parar(pieza.id), { ok: true });
    assert.ok(senales[1].aborted, 'se corta el ffmpeg que estaba en marcha');
    assert.equal(conv.trabajos().length, 0);
    assert.equal(conv.estado(pieza.id), null);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(conv.estado(pieza.id), null, 'no vuelve como error');
    const enBiblioteca = readdirSync(path.join(dir, 'contenido'), { recursive: true }).filter((f) => /\.mp4$/.test(f));
    assert.deepEqual(enBiblioteca, [], 'el vídeo que ya estaba hecho se borra');
    assert.throws(() => conv.parar(pieza.id), /Ya ha terminado/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
