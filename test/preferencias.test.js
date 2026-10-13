import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createPreferencias } from '../server/preferencias.js';
import { createAsistente } from '../server/asistente.js';
import { createApp } from '../server/index.js';
import { buildServer } from '../mcp/jarvis-mcp.js';

let dir, db, jarvis, pref;
before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-pref-'));
  db = openDb(':memory:');
  jarvis = createJarvis({ db, vault: createVault(path.join(dir, 'V')) });
  pref = createPreferencias({ db });
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('lo que JARVIS aprende de ti', () => {
  test('guardar, no repetir, cambiar y quitar', () => {
    const a = pref.guardar({ ambito: 'diseno', texto: '  Títulos de 6 palabras como mucho.  ' });
    assert.equal(a.texto, 'Títulos de 6 palabras como mucho.');
    assert.equal(pref.guardar({ ambito: 'diseno', texto: 'títulos de 6 palabras como mucho' }).repetida, true);
    pref.guardar({ ambito: 'escritura', texto: 'Tutea siempre' });
    assert.equal(pref.listar().length, 2);
    assert.equal(pref.cambiar(a.id, { texto: 'Títulos de 5 palabras como mucho' }).texto, 'Títulos de 5 palabras como mucho');
    assert.throws(() => pref.guardar({ ambito: 'otra', texto: 'x' }), /ámbito/);
    assert.throws(() => pref.guardar({ ambito: 'diseno', texto: '   ' }), /Escribe/);
  });

  test('las instrucciones llevan solo los ámbitos de esa conversación y cómo apuntar lo nuevo', () => {
    const d = pref.instrucciones(['diseno']);
    assert.match(d, /LO QUE HAS APRENDIDO[\s\S]*Diseño \(carruseles[\s\S]*- Títulos de 5 palabras/);
    assert.doesNotMatch(d, /Tutea/);
    assert.match(d, /guardar_preferencia \(ámbito diseno;/);
    assert.match(pref.instrucciones(['diseno', 'escritura']), /Tutea siempre/);
    assert.doesNotMatch(createPreferencias({ db: openDb(':memory:') }).instrucciones(['diseno']), /LO QUE HAS APRENDIDO/, 'sin nada aprendido no hay lista');
  });

  test('van en las instrucciones de cada mensaje a Claude', async () => {
    let sistema;
    const asistente = createAsistente({ db, jarvis, vaultPath: dir, entornos: { diseno: () => ({ sistema: pref.instrucciones(['diseno']) }) }, ejecutarImpl: (o) => { sistema = o.sistema; return { cancelar() {}, terminado: Promise.resolve() }; } });
    asistente.preguntar({ texto: 'hazme la 3 más grande', conversacion: 'diseno' });
    assert.match(sistema, /Estás en DISEÑO[\s\S]*- Títulos de 5 palabras/);
  });

  test('MCP: Claude las lee y apunta las nuevas; la API las enseña y las quita', async () => {
    const [a, b] = InMemoryTransport.createLinkedPair();
    await buildServer(jarvis, { preferencias: pref }).connect(a);
    const cli = new Client({ name: 't', version: '1' });
    await cli.connect(b);
    const llamar = async (name, args) => JSON.parse((await cli.callTool({ name, arguments: args })).content[0].text);
    assert.equal((await llamar('ver_preferencias', { ambito: 'escritura' }))[0].texto, 'Tutea siempre');
    const n = await llamar('guardar_preferencia', { ambito: 'diseno', texto: 'La última slide siempre con @automatiapro' });
    assert.equal(n.origen, 'claude');

    const server = http.createServer();
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    server.on('request', createApp({ jarvis, preferencias: pref, port: server.address().port, status: async () => [] }));
    const base = `http://127.0.0.1:${server.address().port}`;
    try {
      const l = await (await fetch(`${base}/api/preferencias`)).json();
      assert.ok(l.ambitos.diseno && l.preferencias.some((p) => p.id === n.id));
      assert.equal((await fetch(`${base}/api/preferencias/${n.id}`, { method: 'DELETE' })).status, 200);
      assert.ok(!pref.listar().some((p) => p.id === n.id));
    } finally { server.close(); }
  });
});
