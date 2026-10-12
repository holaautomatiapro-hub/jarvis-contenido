import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createAsistente } from '../server/asistente.js';
import { createApp } from '../server/index.js';
import { promptCaption, limpiarCaption, createContextoCaption } from '../server/caption.js';
import { createArchivos } from '../server/archivos.js';
import { rutaFfmpeg } from '../server/diseno/motor.js';

describe('Caption con IA', () => {
  test('el encargo usa la voz, el guion, el lead magnet y la negrita', () => {
    assert.throws(() => promptCaption({}), /Ponle antes un título/);
    const p = promptCaption({ titulo: '3 errores al contratar un setter', formato: 'Carrusel', nota: '02-Guiones/setter.md', leadmagnet: true, leadmagnet_url: 'https://recursos.vercel.app/setter', palabra: 'setter!', archivos: ['01.jpg', { nombre: '02.jpg' }] });
    assert.match(p, /Tipo: Carrusel/);
    assert.match(p, /lee la nota 02-Guiones\/setter\.md con leer_nota/);
    assert.match(p, /_voz\.md/);
    assert.match(p, /_diseno\/kit\.json/);
    assert.match(p, /Comenta \*\*SETTER\*\* y te lo envío/);
    assert.match(p, /https:\/\/recursos\.vercel\.app\/setter/);
    assert.match(p, /01\.jpg, 02\.jpg/);
    assert.match(p, /Responde SOLO con el caption/);
    // Con caption ya escrito, lo mejora
    assert.match(promptCaption({ caption: 'Hola a todos' }), /úsalo de base y mejóralo/);
    // Sin lead magnet ni palabra no impone cierre de palabra clave
    assert.doesNotMatch(promptCaption({ titulo: 'x' }), /Comenta \*\*/);
  });

  test('con el contenido dentro: transcripción del reel y slides del carrusel', () => {
    const p = promptCaption({ formato: 'Reel' }, { transcripciones: [{ texto: 'Probé con ocho setters en dos años' }], imagenes: ['/v/.jarvis/caption/x/01-fotograma-1.jpg'] });
    assert.match(p, /transcripción automática/);
    assert.match(p, /Probé con ocho setters en dos años/);
    assert.match(p, /fotogramas del vídeo/);
    assert.match(p, /sale de ESTE contenido/);
    const c = promptCaption({ formato: 'Carrusel' }, { imagenes: ['/v/a/01.jpg', '/v/a/02.jpg'] });
    assert.match(c, /slides del carrusel/);
    assert.match(c, /- \/v\/a\/02\.jpg/);
    assert.doesNotMatch(promptCaption({ titulo: 'x' }), /ESTE contenido/);
  });

  test('prepara el contenido: transcribe el vídeo (una vez), saca fotogramas y copia las fotos', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-ctx-'));
    try {
      const archivos = createArchivos({ dir: path.join(dir, 'arch') });
      mkdirSync(path.join(dir, 'arch', '2026-10'), { recursive: true });
      const video = path.join(dir, 'arch', '2026-10', '1700000000000-abcdef_reel.mp4');
      const ffmpeg = await rutaFfmpeg();
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=320x568:d=3', '-f', 'lavfi', '-i', 'sine=f=440:d=3', '-shortest', '-c:v', 'libx264', '-c:a', 'aac', video]);
      writeFileSync(path.join(dir, 'arch', '2026-10', '1700000000000-abcdef_slide.jpg'), 'jpg');
      let veces = 0;
      const ctx = createContextoCaption({ archivos, vaultPath: path.join(dir, 'V'), transcribirImpl: async (audio) => { veces++; assert.ok(existsSync(audio)); return 'Probé con ocho setters'; } });
      const lista = [
        { path: '2026-10/1700000000000-abcdef_reel.mp4', mime: 'video/mp4', nombre: 'reel.mp4' },
        { path: '2026-10/1700000000000-abcdef_slide.jpg', mime: 'image/jpeg', nombre: 'slide.jpg' },
        { path: '../fuera.jpg', mime: 'image/jpeg' },
      ];
      const r = await ctx.preparar(lista);
      assert.deepEqual(r.transcripciones.map((t) => t.texto), ['Probé con ocho setters']);
      assert.equal(r.imagenes.filter((f) => /fotograma/.test(f)).length, 2, 'dos fotogramas del vídeo');
      assert.ok(r.imagenes.some((f) => /02\.jpg$/.test(f)), 'la foto copiada al vault');
      assert.ok(r.imagenes.every((f) => f.startsWith(path.join(dir, 'V', '.jarvis', 'caption'))));
      await ctx.preparar(lista);
      assert.equal(veces, 1, 'la transcripción se guarda y no se repite');
      // Sin nada con qué transcribir: lo dice
      const sin = createContextoCaption({ archivos, vaultPath: path.join(dir, 'V2'), env: {} });
      const r2 = await sin.preparar(lista.slice(0, 1));
      assert.match(r2.avisos.join(), /no hay con qué transcribir/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('limpia lo que devuelve Claude', () => {
    assert.equal(limpiarCaption('```\nHola 👇\n```'), 'Hola 👇');
    assert.equal(limpiarCaption('Caption:\nHola'), 'Hola');
    assert.equal(limpiarCaption('«Hola»'), 'Hola');
    assert.equal(limpiarCaption('x'.repeat(3000)).length, 2200);
    assert.throws(() => limpiarCaption('  '), /no ha devuelto/);
  });

  describe('API', () => {
    let dir, server, base, pedidos;
    before(async () => {
      dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-cap-'));
      const db = openDb(':memory:');
      const jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
      pedidos = [];
      const asistente = createAsistente({ db, jarvis, vaultPath: path.join(dir, 'V'), ejecutarImpl: (o) => {
        pedidos.push(o);
        queueMicrotask(() => (/FALLA/.test(o.prompt) ? o.onEvento({ tipo: 'error', mensaje: 'Claude Code no tiene la sesión iniciada.' }) : o.onEvento({ tipo: 'fin', texto: '```\n¿Contratas tu primer setter? 👇\n\nComenta **SETTER**\n```' })));
        return { cancelar() {}, terminado: Promise.resolve() };
      } });
      server = http.createServer();
      await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
      server.on('request', createApp({ jarvis, asistente, port: server.address().port, status: async () => [] }));
      base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });
    const post = (body) => fetch(`${base}/api/caption`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, data: await r.json() }));

    test('devuelve el caption limpio, con Sonnet, en el vault y sin memoria', async () => {
      const r = await post({ titulo: 'Setter', leadmagnet: true });
      assert.equal(r.status, 200);
      assert.equal(r.data.caption, '¿Contratas tu primer setter? 👇\n\nComenta **SETTER**');
      assert.equal(pedidos[0].modelo, 'sonnet');
      assert.equal(pedidos[0].cwd, path.join(dir, 'V'));
      assert.equal(pedidos[0].sesion, undefined);
    });

    test('errores claros', async () => {
      assert.match((await post({})).data.error, /Ponle antes un título/);
      const r = await post({ titulo: 'FALLA' });
      assert.equal(r.status, 400);
      assert.match(r.data.error, /sesión iniciada/);
    });
  });
});
