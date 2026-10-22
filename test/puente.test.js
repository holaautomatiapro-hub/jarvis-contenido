import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createArchivos } from '../server/archivos.js';
import { createApp } from '../server/index.js';
import { rutaFfmpeg } from '../server/diseno/motor.js';

// Habla con el conector como lo hace Claude Code: JSON-RPC por stdio, una línea por mensaje
function conector(url) {
  const p = spawn(process.execPath, [path.resolve('puente/jarvis-puente.mjs')], { env: { ...process.env, JARVIS_URL: url }, stdio: ['pipe', 'pipe', 'pipe'] });
  const esperando = new Map();
  createInterface({ input: p.stdout }).on('line', (l) => { const m = JSON.parse(l); esperando.get(m.id)?.(m); esperando.delete(m.id); });
  let n = 0;
  const pedir = (method, params) => new Promise((ok) => { n += 1; esperando.set(n, ok); p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`); });
  return { pedir, avisar: (method) => p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`), cerrar: () => p.kill() };
}

describe('conector de JARVIS para Claude Code', () => {
  test('«súbelo a JARVIS»: un carrusel (el PNG pasa a JPG), unas stories en orden y el calendario', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-puente-'));
    const server = http.createServer();
    let c;
    try {
      const ff = await rutaFfmpeg();
      const png = path.join(dir, 'slide 1.png');
      const jpg = path.join(dir, 'slide-2.jpg');
      assert.equal(spawnSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1080x1350', '-frames:v', '1', png]).status, 0);
      assert.equal(spawnSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=1080x1350', '-frames:v', '1', jpg]).status, 0);
      writeFileSync(path.join(dir, 'notas.txt'), 'hola');
      const jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
      const archivos = createArchivos({ dir: path.join(dir, 'contenido') });
      await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
      server.on('request', createApp({ jarvis, archivos, port: server.address().port, status: async () => [] }));
      const url = `http://127.0.0.1:${server.address().port}`;

      // Se descarga con la dirección de este JARVIS dentro
      const codigo = await (await fetch(`${url}/puente/jarvis-puente.mjs?url=${encodeURIComponent('https://jarvis.ejemplo.ts.net')}`)).text();
      assert.match(codigo, /process\.env\.JARVIS_URL \|\| "https:\/\/jarvis\.ejemplo\.ts\.net"/);

      c = conector(url);
      const ini = await c.pedir('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
      assert.equal(ini.result.serverInfo.name, 'jarvis');
      c.avisar('notifications/initialized');
      const { result: { tools } } = await c.pedir('tools/list', {});
      assert.deepEqual(tools.map((t) => t.name), ['subir_a_jarvis', 'ver_calendario_jarvis']);

      const llamar = async (name, args) => (await c.pedir('tools/call', { name, arguments: args })).result;
      const mal = await llamar('subir_a_jarvis', { archivos: [path.join(dir, 'notas.txt')] });
      assert.equal(mal.isError, true);
      assert.match(mal.content[0].text, /no es una foto ni un vídeo/);

      const r = await llamar('subir_a_jarvis', { archivos: [png, jpg], titulo: 'Deja de contestar DMs a mano', caption: 'Comenta SETTER', fecha: '2026-10-29', hora: '18:00', carpeta: 'Desde Claude' });
      assert.equal(r.isError, undefined, r.content[0].text);
      assert.match(r.content[0].text, /Subido a JARVIS: «Deja de contestar DMs a mano» \(Carrusel, 2 archivos\)[\s\S]*2026-10-29 a las 18:00/);
      const car = jarvis.listarPiezas().find((p) => p.titulo === 'Deja de contestar DMs a mano');
      assert.equal(car.formato, 'Carrusel');
      assert.equal(car.carpeta, 'Desde Claude');
      assert.equal(car.caption, 'Comenta SETTER');
      assert.deepEqual(car.archivos.map((a) => a.mime), ['image/jpeg', 'image/jpeg'], 'el PNG llega como JPG');
      assert.match(car.archivos[0].nombre, /^slide 1\.jpg$/);

      // Stories: una por archivo, en orden y cada 30 min; sin Instagram conectado, avisa pero quedan programadas
      const s = await llamar('subir_a_jarvis', { archivos: [jpg, png], formato: 'Story', titulo: 'Mi día', fecha: '2026-10-30', hora: '23:45', minutos_entre_stories: 30, publicar_en_instagram: true });
      assert.match(s.content[0].text, /Subidas a JARVIS 2 stories «Mi día»[\s\S]*la última a las 00:15[\s\S]*no quedará para publicarse sola en Instagram/);
      const st = jarvis.listarPiezas().filter((p) => p.formato === 'Story').sort((a, b) => a.id - b.id);
      assert.deepEqual(st.map((p) => [p.titulo, p.fecha, p.hora]), [['Mi día · 1/2', '2026-10-30', '23:45'], ['Mi día · 2/2', '2026-10-31', '00:15']]);

      const cal = JSON.parse((await llamar('ver_calendario_jarvis', { desde: '2026-10-29', dias: 3 })).content[0].text);
      assert.deepEqual(cal.piezas.map((p) => p.titulo), ['Deja de contestar DMs a mano', 'Mi día · 1/2', 'Mi día · 2/2']);
      assert.ok(cal.carpetas.includes('Desde Claude'));

      // Si JARVIS no está, lo dice claro
      const lejos = conector('http://127.0.0.1:1');
      const sin = (await lejos.pedir('tools/call', { name: 'ver_calendario_jarvis', arguments: {} })).result;
      lejos.cerrar();
      assert.match(sin.content[0].text, /No llego a JARVIS en http:\/\/127\.0\.0\.1:1[\s\S]*Tailscale/);
    } finally { c?.cerrar(); server.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
