import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, mkdtempSync, rmSync, statSync } from 'node:fs';
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

test('otra versión de una pieza: fotos → vídeo y vídeo → imagen, se ve antes y al usarla sustituye', async (t) => {
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

    // Un post de una foto → vídeo (y pasa a ser un reel)
    const a1 = await subir(foto, 'image/jpeg');
    const post = jarvis.crearPieza({ titulo: 'Post replicado', formato: 'Post', archivos: [a1] });
    assert.equal(conv.destinoDe(post), 'video');
    const e1 = conv.empezar(post.id);
    assert.equal(e1.estado, 'haciendo');
    assert.throws(() => conv.empezar(post.id), /Ya se está/);
    const l1 = await esperar(conv, post.id);
    assert.equal(l1.estado, 'listo', l1.error);
    assert.equal(l1.archivos[0].mime, 'video/mp4');
    assert.ok(statSync(archivos.ruta(l1.archivos[0].path)).size > 1000);
    assert.equal(jarvis.leerPieza(post.id).archivos[0].path, a1.path, 'hasta usarla no cambia nada');
    const p1 = conv.aceptar(post.id);
    assert.equal(p1.formato, 'Reel');
    assert.equal(p1.archivos[0].path, l1.archivos[0].path);
    assert.ok(!archivos.existe(a1.path), 'la foto anterior se borra');
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

    // Mezclado o vacío: no se puede
    const mezcla = jarvis.crearPieza({ titulo: 'Mezcla', formato: 'Carrusel', archivos: [v1, await subir(foto, 'image/jpeg')] });
    assert.throws(() => conv.empezar(mezcla.id), /mezclados/);
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
      otraVersion: async (id, tipo, { alProgreso }) => { llamadas.push(['otra', id, tipo]); alProgreso({ avance: 1 }); return { archivos: [await guardar('s1.mp4', 'video/mp4'), await guardar('s2.mp4', 'video/mp4')], huellas: ['h1', 'h2'] }; },
      aceptarOtraVersion: (id, d) => llamadas.push(['aceptar', id, d.tipo, d.huellas]),
    };
    const conv = createConversiones({ jarvis, archivos, disenos });
    conv.empezar(carrusel.id);
    const l = await esperar(conv, carrusel.id);
    assert.equal(l.deDiseno, true);
    assert.deepEqual(llamadas[0], ['otra', 9, 'mp4']);
    const p = conv.aceptar(carrusel.id);
    assert.equal(p.formato, 'Carrusel', 'un carrusel en vídeo sigue siendo carrusel');
    assert.deepEqual(p.archivos.map((a) => a.mime), ['video/mp4', 'video/mp4']);
    assert.deepEqual(llamadas[1], ['aceptar', 9, 'mp4', ['h1', 'h2']], 'el diseño sabe que ahora está exportado en vídeo');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
