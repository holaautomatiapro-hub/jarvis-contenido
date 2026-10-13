import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createReadStream, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createArchivos } from '../server/archivos.js';
import { createAdjuntos, duracionDe, textoAdjuntos } from '../server/adjuntos.js';
import { rutaFfmpeg } from '../server/diseno/motor.js';
import { createApp } from '../server/index.js';

let dir, archivos, adjuntos, ffmpeg, video;
before(async () => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-adj-'));
  archivos = createArchivos({ dir: path.join(dir, 'contenido') });
  adjuntos = createAdjuntos({ archivos, vaultPath: path.join(dir, 'V'), env: { ELEVENLABS_API_KEY: 'x' }, sttImpl: async (buf, { nombre }) => `Hola, soy el vídeo ${nombre} (${buf.length > 0 ? 'con audio' : 'vacío'})` });
  ffmpeg = await rutaFfmpeg();
  video = path.join(dir, 'prueba.mp4');
  const r = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=duration=4:size=320x240:rate=10', '-pix_fmt', 'yuv420p', video]);
  if (r.status !== 0) video = null;
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('adjuntos del chat', () => {
  test('duración desde lo que escribe ffmpeg', () => {
    assert.equal(duracionDe('  Duration: 00:01:02.50, start: 0'), 62.5);
    assert.equal(duracionDe('sin nada'), null);
  });

  test('un vídeo: fotogramas en el vault, transcripción y su url para usarlo en un diseño', async (t) => {
    if (!video) return t.skip('No hay ffmpeg');
    const a = await archivos.guardar(createReadStream(video), { nombre: 'mi reel.mp4', mime: 'video/mp4' });
    const p = await adjuntos.preparar(a);
    assert.equal(p.tipo, 'video');
    assert.equal(Math.round(p.duracion), 4);
    assert.ok(p.fotogramas.length >= 3 && p.fotogramas.length <= 8, `${p.fotogramas.length} fotogramas`);
    assert.ok(p.fotogramas.every((f) => f.includes(path.join('V', '.jarvis', 'adjuntos')) && existsSync(f)));
    assert.match(p.transcripcion, /soy el vídeo mi reel\.mp4/);
    const txt = textoAdjuntos([p]);
    assert.match(txt, /^\n\n\[Adjuntos\]\n/);
    assert.match(txt, /- Vídeo «mi reel\.mp4» \(0:04\)\. Para verlo, sus fotogramas en orden \(léelos con Read\): .*01\.jpg/);
    assert.match(txt, /<video src>\): \/api\/contenido\/archivos\//);
    assert.match(txt, /Lo que se dice:\n"""\nHola/);
  });

  test('una foto: copia en el vault para verla', async () => {
    writeFileSync(path.join(dir, 'f.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const a = await archivos.guardar(createReadStream(path.join(dir, 'f.jpg')), { nombre: 'portada.jpg', mime: 'image/jpeg' });
    const p = await adjuntos.preparar(a);
    assert.equal(p.tipo, 'foto');
    assert.ok(existsSync(p.fotogramas[0]));
    assert.match(textoAdjuntos([p]), /- Foto «portada\.jpg»\. Para verla: Read .*foto\.jpg\. Para usarla en un diseño: \/api\/contenido\/archivos\//);
  });

  test('API: se sube, se prepara y el mensaje a Claude lleva los adjuntos por su id', async () => {
    const preguntas = [];
    const asistente = { preguntar: (b) => { preguntas.push(b); return { id: 1 }; }, cancelar() {}, nuevaSesion() {}, estado: () => ({ ocupado: false, eventos: [] }) };
    const db = openDb(':memory:');
    const jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    server.on('request', createApp({ jarvis, archivos, asistente, adjuntos, port: server.address().port, status: async () => [] }));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const r = await fetch(`${base}/api/jarvis/adjuntos?nombre=ref.jpg&mime=image/jpeg`, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]) });
      const a = await r.json();
      assert.equal(r.status, 200, JSON.stringify(a));
      assert.equal(a.tipo, 'foto');
      const post = (body) => fetch(`${base}/api/jarvis/preguntar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.equal((await post({ texto: '[Diseño #3] usa esta foto en la 2', conversacion: 'diseno', adjuntos: [a.id] })).status, 200);
      assert.match(preguntas[0].texto, /^\[Diseño #3\] usa esta foto en la 2\n\n\[Adjuntos\]\n[\s\S]*Foto «ref\.jpg»/);
      assert.equal(preguntas[0].adjuntos, undefined, 'a Claude solo le llega el texto');
      const caducado = await post({ texto: 'hola', adjuntos: ['nada'] });
      assert.equal(caducado.status, 400);
      assert.match((await caducado.json()).error, /caducado/);
      assert.equal((await fetch(`${base}/api/jarvis/adjuntos?nombre=doc.pdf&mime=application/pdf`, { method: 'POST', body: Readable.from([Buffer.from('x')]), duplex: 'half' })).status, 400, 'solo fotos y vídeos');
    } finally { server.close(); }
  });
});
