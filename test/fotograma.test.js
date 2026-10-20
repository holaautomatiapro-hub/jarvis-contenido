import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { rutaFfmpeg } from '../server/diseno/motor.js';
import { createArchivos } from '../server/archivos.js';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createApp } from '../server/index.js';

describe('portada del reel desde un fotograma', () => {
  test('saca un JPG del segundo elegido y lo guarda en Contenido', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-fotograma-'));
    const server = http.createServer();
    try {
      const ff = await rutaFfmpeg();
      const video = path.join(dir, 'reel.mp4');
      const r = spawnSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1080x1920:rate=10', '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
      assert.equal(r.status, 0, String(r.stderr));
      const archivos = createArchivos({ dir: path.join(dir, 'contenido') });
      mkdirSync(path.join(dir, 'contenido', '2026-10'), { recursive: true });
      const rel = '2026-10/1792349805588-8a648e_mi_reel.mp4';
      copyFileSync(video, archivos.ruta(rel));
      const jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
      await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
      server.on('request', createApp({ jarvis, archivos, port: server.address().port, status: async () => [] }));
      const pedir = (body) => fetch(`http://127.0.0.1:${server.address().port}/api/contenido/fotograma`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (x) => ({ status: x.status, ...(await x.json()) }));

      const a = await pedir({ path: rel, segundo: 1.5 });
      assert.equal(a.status, 200, a.error);
      assert.equal(a.mime, 'image/jpeg');
      assert.match(a.nombre, /^portada-mi_reel-1_5s\.jpg$/);
      const jpg = readFileSync(archivos.ruta(a.path));
      assert.equal(jpg[0], 0xff, 'es un JPG');
      // Más allá del final del vídeo, o algo que no es un vídeo: se avisa
      assert.equal((await pedir({ path: rel, segundo: 60 })).status, 400);
      assert.equal((await pedir({ path: '2026-10/1792349805588-8a648e_foto.jpg', segundo: 1 })).status, 400);
      assert.equal((await pedir({ path: '../../etc/passwd.mp4', segundo: 1 })).status, 400);
      // Para elegir el momento aunque el navegador no sepa abrir el vídeo
      const base = `http://127.0.0.1:${server.address().port}/api/contenido/fotograma`;
      const dur = await (await fetch(`${base}/duracion?ruta=${encodeURIComponent(rel)}`)).json();
      assert.ok(Math.abs(dur.duracion - 3) < 0.2, `dura ${dur.duracion}`);
      const previa = await fetch(`${base}/previa?ruta=${encodeURIComponent(rel)}&s=2`);
      assert.equal(previa.headers.get('content-type'), 'image/jpeg');
      assert.equal(Buffer.from(await previa.arrayBuffer())[0], 0xff);
      assert.equal((await fetch(`${base}/previa?ruta=x.jpg&s=2`)).status, 400);
    } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
