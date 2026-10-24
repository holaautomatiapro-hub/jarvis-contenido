import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createApp } from '../server/index.js';
import { createAcceso, hashClave, claveCorrecta, claveLocal } from '../server/acceso.js';

describe('contraseña de JARVIS', () => {
  test('la contraseña se guarda cifrada y se comprueba', () => {
    const h = hashClave('secreta123');
    assert.match(h, /^scrypt:[0-9a-f]{32}:[0-9a-f]{64}$/);
    assert.ok(claveCorrecta('secreta123', h));
    assert.ok(!claveCorrecta('secreta124', h));
    assert.ok(!claveCorrecta('secreta123', ''));
  });

  test('sin sesión solo se ve la página de entrar; con sesión, clave local o token del conector, todo', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-acceso-'));
    const server = http.createServer();
    try {
      const env = { JARVIS_CLAVE: hashClave('secreta123'), JARVIS_NOMBRE: 'Andrea' };
      let ahora = Date.now();
      const acceso = createAcceso({ dataDir: path.join(dir, 'data'), env, ahora: () => ahora });
      const jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
      await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
      server.on('request', createApp({ jarvis, acceso, port: server.address().port, status: async () => [] }));
      const base = `http://127.0.0.1:${server.address().port}`;
      const pedir = (ruta, { metodo = 'GET', json, cabeceras = {} } = {}) => fetch(base + ruta, { method: metodo, headers: { ...(json ? { 'content-type': 'application/json' } : {}), ...cabeceras }, body: json && JSON.stringify(json), redirect: 'manual' });

      // Sin sesión
      const portada = await pedir('/');
      assert.equal(portada.status, 401);
      const html = await portada.text();
      assert.match(html, /type="password"/);
      assert.match(html, /El JARVIS de Andrea/);
      const api = await pedir('/api/tareas');
      assert.equal(api.status, 401);
      assert.equal((await api.json()).sesion, true);
      assert.equal((await pedir('/api/health')).status, 200, 'el instalador comprueba que responde');
      assert.equal((await pedir('/puente/jarvis-puente.mjs')).status, 401, 'el conector tampoco se descarga sin permiso');

      // Entrar
      assert.equal((await pedir('/api/login', { metodo: 'POST', json: { clave: 'mala' } })).status, 401);
      const bien = await pedir('/api/login', { metodo: 'POST', json: { clave: 'secreta123' } });
      assert.equal(bien.status, 200);
      const cookie = bien.headers.get('set-cookie');
      assert.match(cookie, /^jarvis_sesion=\d+\.[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=15552000$/);
      const conSesion = { cookie: cookie.split(';')[0] };
      assert.equal((await pedir('/api/tareas', { cabeceras: conSesion })).status, 200);
      assert.deepEqual(await (await pedir('/api/acceso', { cabeceras: conSesion })).json(), { conClave: true, nombre: null });

      // El MCP y los scripts del propio servidor: su clave local (un archivo que solo lee su dueño)
      const local = claveLocal(path.join(dir, 'data'));
      assert.equal((await pedir('/api/tareas', { cabeceras: { 'x-jarvis-local': local } })).status, 200);
      assert.equal((await pedir('/api/tareas', { cabeceras: { 'x-jarvis-local': 'x'.repeat(64) } })).status, 401);
      if (process.platform !== 'win32') assert.equal(statSync(path.join(dir, 'data', 'local.key')).mode & 0o777, 0o600);

      // El conector de Claude Code: se descarga con un enlace de una hora y lleva su token dentro
      const { t } = await (await pedir('/api/puente/enlace', { metodo: 'POST', cabeceras: conSesion })).json();
      const codigo = await (await pedir(`/puente/jarvis-puente.mjs?url=${encodeURIComponent('https://jarvis-andrea.ejemplo.ts.net')}&t=${t}`)).text();
      const token = /process\.env\.JARVIS_TOKEN \|\| "([\w-]+)"/.exec(codigo)?.[1];
      assert.ok(token, 'el token va dentro');
      assert.equal((await pedir('/api/tareas', { cabeceras: { authorization: `Bearer ${token}` } })).status, 200);
      ahora += 2 * 60 * 60_000;
      assert.equal((await pedir(`/puente/jarvis-puente.mjs?t=${t}`)).status, 401, 'el enlace de descarga caduca a la hora');

      // Cambiar la contraseña cierra las sesiones y anula el token del conector
      env.JARVIS_CLAVE = hashClave('otra-clave-1');
      assert.equal((await pedir('/api/tareas', { cabeceras: conSesion })).status, 401);
      assert.equal((await pedir('/api/tareas', { cabeceras: { authorization: `Bearer ${token}` } })).status, 401);

      // Quien prueba contraseñas tiene que esperar
      for (let i = 0; i < 5; i++) await pedir('/api/login', { metodo: 'POST', json: { clave: `mal${i}` } });
      const frenado = await pedir('/api/login', { metodo: 'POST', json: { clave: 'otra-clave-1' } });
      assert.equal(frenado.status, 429);
      assert.match((await frenado.json()).error, /Espera \d+ s/);
      ahora += 60_000;
      assert.equal((await pedir('/api/login', { metodo: 'POST', json: { clave: 'otra-clave-1' } })).status, 200);
    } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
  });

  test('sin JARVIS_CLAVE todo sigue abierto (como siempre, solo con Tailscale)', () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-acceso-'));
    try {
      const acceso = createAcceso({ dataDir: dir, env: {} });
      assert.equal(acceso.activa(), false);
      assert.equal(acceso.autorizado({ headers: {} }), true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
