import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createAsistente } from '../server/asistente.js';
import { createApp } from '../server/index.js';
import { promptCaption, limpiarCaption } from '../server/caption.js';

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
