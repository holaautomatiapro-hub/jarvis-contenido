import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createMiniaturas } from '../server/miniaturas.js';
import { rutaFfmpeg } from '../server/diseno/motor.js';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createApp } from '../server/index.js';

describe('miniaturas de la biblioteca', () => {
  test('de un vídeo, un JPG pequeño; se guarda y, si el archivo cambia, se rehace', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-mini-'));
    try {
      const ff = await rutaFfmpeg();
      const video = path.join(dir, 'reel.mp4');
      const r = spawnSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=10', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
      assert.equal(r.status, 0, String(r.stderr));
      const llamadas = [];
      const ffmpeg = async () => { llamadas.push(1); return ff; };
      const m = createMiniaturas({ dir: path.join(dir, '.mini'), resolver: (rel) => { if (rel !== 'reel.mp4') throw new Error('no'); return video; }, ffmpeg });
      const f = await m.ruta('reel.mp4');
      assert.ok(f && existsSync(f));
      const jpg = readFileSync(f);
      assert.equal(jpg[0], 0xff, 'es un JPG');
      assert.ok(jpg.length < 60_000, `pequeña (${jpg.length} bytes)`);
      assert.equal(await m.ruta('reel.mp4'), f);
      assert.equal(llamadas.length, 1, 'la segunda vez, de lo guardado');
      utimesSync(video, new Date(), new Date(Date.now() + 5000));
      const f2 = await m.ruta('reel.mp4');
      assert.notEqual(f2, f, 'el archivo cambió: otra miniatura');
      assert.equal(await m.ruta('otro.mp4'), null);
      // Un archivo que no es imagen ni vídeo: null, y no se reintenta enseguida
      const roto = path.join(dir, 'roto.jpg');
      writeFileSync(roto, 'no soy una foto');
      const m2 = createMiniaturas({ dir: path.join(dir, '.mini'), resolver: () => roto, ffmpeg });
      const antes = llamadas.length;
      assert.equal(await m2.ruta('roto.jpg'), null);
      assert.equal(await m2.ruta('roto.jpg'), null);
      assert.equal(llamadas.length, antes + 1);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('API: la miniatura se sirve para guardar en el navegador y las respuestas grandes van comprimidas', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-mini-'));
    const server = http.createServer();
    try {
      const jpg = path.join(dir, 'x.jpg');
      writeFileSync(jpg, Buffer.from([0xff, 0xd8, 0xff]));
      const jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
      for (let i = 0; i < 60; i++) jarvis.crearPieza({ titulo: `Pieza ${i} con un título bastante largo para que pese`, caption: 'x'.repeat(200) });
      const miniaturas = { ruta: async (rel) => (rel === '2026-10/1792349805588-8a648e_reel.mp4' ? jpg : null) };
      mkdirSync(path.join(dir, 'contenido'), { recursive: true });
      const archivos = { dir: path.join(dir, 'contenido'), ruta: () => jpg };
      await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
      server.on('request', createApp({ jarvis, archivos, miniaturas, port: server.address().port, status: async () => [] }));
      const base = `http://127.0.0.1:${server.address().port}`;
      const r = await fetch(`${base}/api/contenido/miniatura/2026-10/1792349805588-8a648e_reel.mp4`);
      assert.equal(r.status, 200);
      assert.match(r.headers.get('cache-control'), /immutable/);
      assert.equal((await fetch(`${base}/api/contenido/miniatura/2026-10/1792349805588-8a648e_otro.mp4`)).status, 404);
      // Comprimido a mano para ver la cabecera (fetch lo descomprime solo)
      const crudo = await new Promise((ok, mal) => http.get(`${base}/api/contenido`, { headers: { 'accept-encoding': 'gzip' } }, (res) => {
        const trozos = []; res.on('data', (t) => trozos.push(t)); res.on('end', () => ok({ h: res.headers, cuerpo: Buffer.concat(trozos) }));
      }).on('error', mal));
      assert.equal(crudo.h['content-encoding'], 'gzip');
      assert.equal(JSON.parse(gunzipSync(crudo.cuerpo)).piezas.length, 60);
    } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
