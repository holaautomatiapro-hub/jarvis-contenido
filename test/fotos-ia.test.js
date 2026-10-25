import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { openDb, ajustes } from '../server/db.js';
import { createJarvis } from '../server/jarvis.js';
import { createVault } from '../server/vault.js';
import { createArchivos } from '../server/archivos.js';
import { spawnSync } from 'node:child_process';
import { createFotosIa, promptFoto, aJpg, IDENTIDAD_BASE, ESTILO_SIN_PERSONA } from '../server/fotos-ia.js';
import { rutaFfmpeg } from '../server/diseno/motor.js';
import { createKit } from '../server/diseno/kit.js';
import { buildServer } from '../mcp/jarvis-mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const CLAVE = 'kie-clave-secreta-1234567890';
let dir;
before(() => { dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-fotos-')); });
after(() => rmSync(dir, { recursive: true, force: true }));

// Kie AI de mentira: sube referencias, crea tareas y las da por hechas a la segunda consulta
function kieFalso({ falla = false } = {}) {
  const llamadas = [];
  let n = 0;
  const consultas = {};
  const fetchImpl = async (url, o = {}) => {
    const u = new URL(url);
    const body = o.body ? JSON.parse(o.body) : null;
    llamadas.push({ url: u.origin + u.pathname, body, auth: o.headers?.authorization });
    const json = (d, status = 200) => new Response(JSON.stringify(d), { status });
    if (u.pathname === '/api/file-base64-upload') return json({ code: 200, data: { downloadUrl: `https://kie.test/ref/${body.fileName}` } });
    if (u.pathname === '/api/v1/jobs/createTask') return json({ code: 200, data: { taskId: `t${++n}` } });
    if (u.pathname === '/api/v1/jobs/recordInfo') {
      const id = u.searchParams.get('taskId');
      consultas[id] = (consultas[id] || 0) + 1;
      if (consultas[id] < 2) return json({ code: 200, data: { state: 'generating' } });
      if (falla) return json({ code: 200, data: { state: 'fail', failMsg: 'contenido no permitido' } });
      return json({ code: 200, data: { state: 'success', resultJson: JSON.stringify({ resultUrls: [`https://kie.test/out/${id}.png`] }) } });
    }
    if (u.hostname === 'kie.test' && u.pathname.startsWith('/out/')) return new Response(Buffer.from(`png-${u.pathname}`));
    return json({ code: 404 }, 404);
  };
  return { fetchImpl, llamadas };
}

function montar({ falla = false, conCara = true, identidad = null, env = {} } = {}) {
  const base = mkdtempSync(path.join(dir, 'm-'));
  const db = openDb(':memory:');
  const vault = path.join(base, 'vault');
  mkdirSync(vault, { recursive: true });
  if (identidad) writeFileSync(path.join(vault, '_identidad-foto.md'), identidad);
  const jarvis = createJarvis({ db, vault: createVault(vault) });
  const archivos = createArchivos({ dir: path.join(base, 'contenido') });
  const cara = path.join(base, 'cara');
  mkdirSync(cara);
  if (conCara) for (const f of ['01-frente.jpg', '02-perfil.jpg', 'notas.txt']) writeFileSync(path.join(cara, f), `foto ${f}`);
  const kie = kieFalso({ falla });
  const fotos = createFotosIa({ env: { KIE_API_KEY: CLAVE, ...env }, jarvis, archivos, ajustesDb: ajustes(db), carpetaCara: cara, fetchImpl: kie.fetchImpl, convertir: async (b) => Buffer.concat([Buffer.from('jpg:'), b]), esperaMs: 1, primeraEsperaMs: 1 });
  return { fotos, kie, jarvis, archivos };
}

const esperar = async (fotos, id) => {
  for (let i = 0; i < 200; i++) { const t = fotos.ver(id); if (t.estado !== 'generando') return t; await new Promise((r) => setTimeout(r, 5)); }
  throw new Error('no terminó');
};

describe('fotos con IA (Kie AI)', () => {
  test('el prompt: sin persona, estilo editorial sin texto; contigo, identidad + tus correcciones + la escena', () => {
    assert.equal(promptFoto({ descripcion: 'A coffee on a desk' }), `A coffee on a desk. ${ESTILO_SIN_PERSONA}`);
    const p = promptFoto({ descripcion: 'He is on stage', conmigo: true, identidad: 'His irises are DARK BROWN.' });
    assert.ok(p.startsWith(IDENTIDAD_BASE));
    assert.match(p, /His irises are DARK BROWN\.\n\nSCENE: He is on stage\n\n/);
    assert.match(p, /not a different person\.$/);
  });

  test('contigo: sube tus fotos de referencia una vez, genera, guarda en la biblioteca y crea la pieza', async () => {
    const { fotos, kie, jarvis, archivos } = montar({ identidad: '---\ntipo: identidad\n---\nHis irises are DARK BROWN.' });
    const e = fotos.estado();
    assert.deepEqual([e.configurado, e.modelo, e.referencias, e.identidad, e.hoy, e.maxDia], [true, 'nano-banana-pro', 2, true, 0, 30]);
    assert.deepEqual(e.fotosCara.map((f) => f.ruta), ['imagenes/_mi-cara/01-frente.jpg', 'imagenes/_mi-cara/02-perfil.jpg']);
    assert.equal(e.identidadTexto, 'His irises are DARK BROWN.', 'sin la cabecera de la nota');
    const r = fotos.generar({ descripcion: 'Jose on stage with a headset mic, sharp', conmigo: true, cantidad: 2, formato: '9:16' });
    assert.equal(r.costeAprox, 0.24);
    const t = await esperar(fotos, r.id);
    assert.equal(t.estado, 'listo', t.error);
    assert.equal(t.fotos.length, 2);
    assert.match(t.fotos[0].url, /^\/api\/contenido\/archivos\/.+\.jpg$/);
    assert.equal(readFileSync(t.fotos[0].ruta, 'utf8').slice(0, 4), 'jpg:', 'se guarda convertida a JPG');
    assert.ok(archivos.existe(t.fotos[0].url.replace('/api/contenido/archivos/', '')));
    const subidas = kie.llamadas.filter((l) => l.url.endsWith('/file-base64-upload'));
    assert.equal(subidas.length, 2, 'solo las fotos (no notas.txt)');
    const crear = kie.llamadas.filter((l) => l.url.endsWith('/createTask'));
    assert.equal(crear.length, 2);
    assert.deepEqual(crear[0].body.input.image_input, ['https://kie.test/ref/01-frente.jpg', 'https://kie.test/ref/02-perfil.jpg']);
    assert.equal(crear[0].body.model, 'nano-banana-pro');
    assert.equal(crear[0].body.input.aspect_ratio, '9:16');
    assert.match(crear[0].body.input.prompt, /DARK BROWN/);
    assert.doesNotMatch(crear[0].body.input.prompt, /tipo: identidad/, 'sin la cabecera de la nota');
    assert.ok(kie.llamadas.every((l) => !l.auth || l.auth === `Bearer ${CLAVE}`));
    const pieza = jarvis.listarPiezas().find((p) => p.id === t.pieza_id);
    assert.equal(pieza.carpeta, 'Fotos con IA');
    assert.equal(pieza.archivos.length, 2);
    assert.equal(fotos.estado().hoy, 2);
    // Las correcciones se guardan en la nota del vault y entran en el siguiente prompt
    assert.equal(fotos.guardarIdentidad('His irises are GREEN-FREE dark brown.').identidadTexto, 'His irises are GREEN-FREE dark brown.');
    // La segunda vez reutiliza las referencias subidas
    const r2 = fotos.generar({ descripcion: 'Jose working at a laptop', conmigo: true });
    await esperar(fotos, r2.id);
    assert.equal(kie.llamadas.filter((l) => l.url.endsWith('/file-base64-upload')).length, 2);
  });

  test('sin persona no manda referencias; sin fotos de tu cara, «contigo» explica qué falta', async () => {
    const { fotos, kie } = montar({ conCara: false });
    const t = await esperar(fotos, fotos.generar({ descripcion: 'Trail running shoes on wet rocks' }).id);
    assert.equal(t.estado, 'listo');
    assert.equal(kie.llamadas.find((l) => l.url.endsWith('/createTask')).body.input.image_input, undefined);
    const t2 = await esperar(fotos, fotos.generar({ descripcion: 'Jose on stage, smiling', conmigo: true }).id);
    assert.equal(t2.estado, 'error');
    assert.match(t2.error, /Laboratorio → Imágenes → Mi cara/);
  });

  test('límites, errores de Kie y la clave nunca sale', async () => {
    const { fotos } = montar({ env: { KIE_MAX_FOTOS_DIA: '3' } });
    assert.throws(() => fotos.generar({ descripcion: 'x' }), /Describe la escena/);
    assert.throws(() => fotos.generar({ descripcion: 'A coffee on a desk', formato: '5:4' }), /Formato no válido/);
    fotos.generar({ descripcion: 'A coffee on a desk', cantidad: 3 });
    assert.throws(() => fotos.generar({ descripcion: 'Another coffee on a desk' }), /máximo 3/);

    const mal = montar({ falla: true });
    const t = await esperar(mal.fotos, mal.fotos.generar({ descripcion: 'A coffee on a desk' }).id);
    assert.equal(t.estado, 'error');
    assert.match(t.error, /contenido no permitido/);

    const sinClave = createFotosIa({ env: {}, jarvis: null, archivos: null, ajustesDb: ajustes(openDb(':memory:')) });
    assert.throws(() => sinClave.generar({ descripcion: 'A coffee on a desk' }), /npm run claves/);

    const rota = createFotosIa({ env: { KIE_API_KEY: CLAVE }, jarvis: null, archivos: null, ajustesDb: ajustes(openDb(':memory:')), fetchImpl: async () => { throw new Error(`fallo con ${CLAVE}`); }, primeraEsperaMs: 1 });
    const t2 = await esperar(rota, rota.generar({ descripcion: 'A coffee on a desk' }).id);
    assert.equal(t2.estado, 'error');
    assert.ok(!t2.error.includes(CLAVE), t2.error);
  });

  test('convierte el PNG de Kie a JPG', async (t) => {
    const ff = await rutaFfmpeg();
    const png = path.join(dir, 'kie.png');
    if (spawnSync(ff, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x400', '-frames:v', '1', png]).status !== 0) return t.skip('No hay ffmpeg');
    const jpg = await aJpg(readFileSync(png));
    assert.equal(jpg[0], 0xff);
    assert.equal(jpg[1], 0xd8);
  });

  test('la clave se pega desde el panel: Kie la comprueba, se guarda en el .env y no se devuelve', async () => {
    const guardadas = [];
    const env = {};
    const fetchImpl = async (url, o) => {
      assert.match(url, /\/api\/v1\/chat\/credit$/);
      const ok = o.headers.authorization === `Bearer ${CLAVE}`;
      return new Response(JSON.stringify(ok ? { code: 200, data: 812 } : { code: 401, msg: 'unauthorized' }), { status: ok ? 200 : 401 });
    };
    const f = createFotosIa({ env, jarvis: { vault: { read: () => { throw new Error('no'); } } }, archivos: null, ajustesDb: ajustes(openDb(':memory:')), carpetaCara: null, fetchImpl, guardarClaves: (c) => guardadas.push(c) });
    assert.equal(f.estado().configurado, false);
    await assert.rejects(f.conectar({ clave: 'con espacios no' }), /no parece de Kie/);
    await assert.rejects(f.conectar({ clave: 'otra-clave-que-no-vale-123' }), /no acepta esa clave/);
    assert.equal(guardadas.length, 0);
    const r = await f.conectar({ clave: ` ${CLAVE} ` });
    assert.deepEqual(guardadas, [{ KIE_API_KEY: CLAVE }]);
    assert.equal(env.KIE_API_KEY, CLAVE);
    assert.equal(r.configurado, true);
    assert.equal(r.creditos, 812);
    assert.equal(r.final, `••••${CLAVE.slice(-4)}`);
    assert.ok(!JSON.stringify(r).includes(CLAVE), 'la clave no vuelve al navegador');
  });

  test('MCP generar_foto: lo encarga al dashboard y espera a que salga', async () => {
    const llamadas = [];
    let vueltas = 0;
    const servidor = async (m, ruta, body) => {
      llamadas.push([m, ruta, body]);
      if (m === 'POST') return { id: 'abc', costeAprox: 0.12 };
      return ++vueltas < 2 ? { estado: 'generando' } : { estado: 'listo', fotos: [{ url: '/api/contenido/archivos/2026-10/f.jpg', ruta: '/datos/f.jpg', nombre: 'f.jpg' }], pieza_id: 9 };
    };
    const vault = mkdtempSync(path.join(dir, 'v-'));
    const s = buildServer(createJarvis({ db: openDb(':memory:'), vault: createVault(vault) }), { diseno: { kit: createKit({ vaultPath: vault }), servidor, cadaMs: 1 } });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await s.connect(a);
    const c = new Client({ name: 't', version: '1' });
    await c.connect(b);
    const r = await c.callTool({ name: 'generar_foto', arguments: { descripcion: 'Jose on stage, sharp', conmigo: true } });
    const d = JSON.parse(r.content[0].text);
    assert.deepEqual(llamadas[0], ['POST', '/api/fotos-ia', { descripcion: 'Jose on stage, sharp', conmigo: true }]);
    assert.deepEqual(d.fotos, [{ url: '/api/contenido/archivos/2026-10/f.jpg', ruta: '/datos/f.jpg' }]);
    assert.equal(d.pieza_id, 9);
  });
});
