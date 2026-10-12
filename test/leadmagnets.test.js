import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync } from 'node:fs';
import { Readable } from 'node:stream';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createLaboratorio } from '../server/laboratorio.js';
import { slugLm, proyectoVercel } from '../server/leadmagnets.js';

let dir, lab, lm, jarvis, vault, env, guardadas, llamadas;
const HTML = '<title>Guía</title><style>body{margin:0}</style><main>Hola</main>';

// Vercel de mentira: guarda lo que le llega y contesta como la API real
function fakeVercel({ dominios = [{ name: 'mis-recursos.vercel.app', verified: true }], token = 'tok_valido_1234567890' } = {}) {
  const subidos = new Map();
  let estados = 0;
  return async (url, o = {}) => {
    const u = new URL(url);
    llamadas.push({ metodo: o.method || 'GET', ruta: u.pathname, query: u.search, cuerpo: o.body });
    const json = (d, status = 200) => ({ ok: status < 400, status, json: async () => d });
    if (o.headers.Authorization !== `Bearer ${token}`) return json({ error: { message: 'Not authorized' } }, 403);
    if (u.pathname === '/v2/user') return json({ user: { username: 'jose' } });
    if (u.pathname === '/v2/files') { subidos.set(o.headers['x-vercel-digest'], o.body); return json({}); }
    if (u.pathname === '/v13/deployments' && o.method === 'POST') {
      const b = JSON.parse(o.body);
      for (const f of b.files) assert.ok(subidos.has(f.sha), `${f.file} subido antes de desplegar`);
      return json({ id: 'dpl_1', readyState: 'QUEUED', url: 'mis-recursos-abc.vercel.app', _files: b.files });
    }
    if (u.pathname === '/v13/deployments/dpl_1') return json({ id: 'dpl_1', readyState: ++estados > 1 ? 'READY' : 'BUILDING', alias: ['mis-recursos.vercel.app'] });
    if (u.pathname.endsWith('/domains')) return json({ domains: dominios });
    return json({ error: { message: 'no' } }, 404);
  };
}

before(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-lm-'));
  vault = path.join(dir, 'V');
  jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(vault) });
  // Sistema de diseño con su guía y su plantilla de lead magnets
  mkdirSync(path.join(vault, '_diseno', 'referencias'), { recursive: true });
  writeFileSync(path.join(vault, '_diseno', 'kit.json'), JSON.stringify({ nombre: 'Automatia Pro', guia: 'CLAUDE.md' }));
  writeFileSync(path.join(vault, '_diseno', 'CLAUDE.md'), '## 6. Lead magnets');
  writeFileSync(path.join(vault, '_diseno', 'referencias', 'leadmagnet-plantilla.html'), HTML);
  env = { PATH: '/usr/bin' };
  guardadas = {};
  llamadas = [];
  lab = createLaboratorio({ dir: path.join(dir, 'Lab'), jarvis, vaultPath: vault, env, leadmagnetsOpc: { fetchImpl: fakeVercel(), guardarClaves: (c) => Object.assign(guardadas, c), esperaMs: 1 } });
  lm = lab.leadmagnets;
});
after(() => rmSync(dir, { recursive: true, force: true }));

describe('Lead magnets', () => {
  test('nombres', () => {
    assert.equal(slugLm('Guía: contrata a tu 1er SETTER!'), 'guia-contrata-a-tu-1er-setter');
    assert.equal(proyectoVercel('Mis Recursos'), 'mis-recursos');
    assert.equal(proyectoVercel(''), 'leadmagnets');
  });

  test('crear: carpeta, datos y encargo para Claude con la guía y la plantilla del kit', () => {
    const p = jarvis.crearPieza({ titulo: 'Reel setter', formato: 'Reel', caption: 'Comenta SETTER' });
    const { slug, prompt } = lm.nuevo({ titulo: 'Guía del setter', tipo: 'checklist', palabra: 'setter!', pieza: p.id, contenido: 'Paso 1: …' });
    assert.equal(slug, 'guia-del-setter');
    assert.match(prompt, /Checklist para marcar/);
    assert.match(prompt, /_diseno[\\/]CLAUDE\.md/);
    assert.match(prompt, /leadmagnet-plantilla\.html/);
    assert.match(prompt, /Comenta \*\*SETTER\*\*/);
    assert.match(prompt, /Reel setter/);
    assert.match(prompt, /captura\.mjs" leadmagnets\/guia-del-setter\/index\.html/);
    assert.match(prompt, /No hay banners subidos/);
    assert.throws(() => lm.nuevo({ titulo: '  ' }), /de qué va/);
    // Otro con el mismo tema no pisa al primero
    assert.equal(lm.nuevo({ titulo: 'Guía del setter' }).slug, 'guia-del-setter-2');
    const l = lm.lista();
    assert.equal(l.length, 2);
    const g = l.find((x) => x.slug === 'guia-del-setter');
    assert.equal(g.listo, false);
    assert.equal(g.palabra, 'SETTER');
    assert.equal(g.pieza, p.id);
  });

  test('rehacer uno existente usa su carpeta y su página actual', () => {
    writeFileSync(path.join(lab.dir, 'leadmagnets', 'guia-del-setter', 'index.html'), HTML);
    const { slug, prompt } = lm.nuevo({ slug: 'guia-del-setter', titulo: 'Guía del setter', indicaciones: 'más corto' });
    assert.equal(slug, 'guia-del-setter');
    assert.match(prompt, /^Rehaz/);
    assert.match(prompt, /La versión actual está en leadmagnets\/guia-del-setter\/index\.html/);
  });

  test('banners de las comunidades', async () => {
    await assert.rejects(lm.subirBanner(Readable.from([Buffer.from('x')]), { cual: 'skool', nombre: 'a.gif' }), /jpg, png o webp/);
    await assert.rejects(lm.subirBanner(Readable.from([Buffer.from('x')]), { cual: 'otro', nombre: 'a.png' }), /no válido/);
    const b = await lm.subirBanner(Readable.from([Buffer.from('png')]), { cual: 'skool', nombre: 'Banner Skool.PNG' });
    assert.equal(b.skool, 'leadmagnets/_comun/skool.png');
    assert.equal(b.whatsapp, null);
    assert.match(lm.nuevo({ slug: 'guia-del-setter', titulo: 'Guía del setter' }).prompt, /Skool → leadmagnets\/_comun\/skool\.png.*El que falte/s);
    // Se puede ver desde el navegador (y _comun no sale como lead magnet)
    assert.ok(lab.archivo('leadmagnets/_comun/skool.png').abs);
    assert.ok(!lm.lista().some((x) => x.slug === '_comun'));
  });

  test('sin Vercel no publica; el token se comprueba y se guarda en el .env', async () => {
    await assert.rejects(lm.publicar('guia-del-setter'), /Conecta Vercel/);
    await assert.rejects(lm.conectarVercel({ token: 'tok_malo_123456789012' }), /no acepta el token/);
    await assert.rejects(lm.conectarVercel({ token: 'con espacios' }), /no parece de Vercel/);
    await assert.rejects(lm.conectarVercel({ token: 'tok_valido_1234567890', equipo: 'mal' }), /team_/);
    assert.deepEqual(guardadas, {});
    const r = await lm.conectarVercel({ token: 'tok_valido_1234567890', proyecto: 'Mis Recursos' });
    assert.equal(r.usuario, 'jose');
    assert.equal(r.conectado, true);
    assert.equal(r.final, '••••7890');
    assert.equal(guardadas.VERCEL_TOKEN, 'tok_valido_1234567890');
    assert.equal(guardadas.VERCEL_PROYECTO, 'mis-recursos');
    assert.equal(env.VERCEL_TOKEN, 'tok_valido_1234567890', 'se usa sin reiniciar');
    assert.ok(!JSON.stringify(lm.estado()).includes('tok_valido_1234567890'), 'el token nunca vuelve al navegador');
  });

  test('publica en Vercel (documento completo), pone el enlace en la pieza y vuelve a desplegar los demás', async () => {
    await assert.rejects(lm.publicar('guia-del-setter-2'), /todavía no tiene página/);
    writeFileSync(path.join(lab.dir, 'leadmagnets', 'guia-del-setter-2', 'index.html'), 'Hola {{WA}}');
    await assert.rejects(lm.publicar('guia-del-setter-2'), /\{\{SKOOL\}\} o \{\{WA\}\}/);

    llamadas = [];
    const r = await lm.publicar('guia-del-setter');
    assert.equal(r.url, 'https://mis-recursos.vercel.app/guia-del-setter');
    const dep = llamadas.find((l) => l.ruta === '/v13/deployments' && l.metodo === 'POST');
    const cuerpo = JSON.parse(dep.cuerpo);
    assert.equal(cuerpo.name, 'mis-recursos');
    assert.equal(cuerpo.target, 'production');
    assert.deepEqual(cuerpo.files.map((f) => f.file).sort(), ['guia-del-setter/index.html', 'index.html', 'vercel.json']);
    const subida = llamadas.find((l) => l.ruta === '/v2/files' && String(l.cuerpo).includes('<main>Hola'));
    const html = String(subida.cuerpo);
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
    const p = jarvis.listarPiezas().find((x) => x.titulo === 'Reel setter');
    assert.equal(p.leadmagnet, 1);
    assert.equal(p.leadmagnet_url, 'https://mis-recursos.vercel.app/guia-del-setter');
    const g = lm.lista().find((x) => x.slug === 'guia-del-setter');
    assert.equal(g.url, r.url);
    assert.equal(g.cambiado, false);

    // Un segundo despliegue lleva también el primero (si no, Vercel lo quitaría)
    writeFileSync(path.join(lab.dir, 'leadmagnets', 'guia-del-setter-2', 'index.html'), '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body>Dos</body></html>');
    llamadas = [];
    await lm.publicar('guia-del-setter-2');
    const files = JSON.parse(llamadas.find((l) => l.ruta === '/v13/deployments' && l.metodo === 'POST').cuerpo).files.map((f) => f.file);
    assert.ok(files.includes('guia-del-setter/index.html') && files.includes('guia-del-setter-2/index.html'));
    const html2 = String(llamadas.find((l) => l.ruta === '/v2/files' && String(l.cuerpo).includes('Dos')).cuerpo);
    assert.equal((html2.match(/viewport/g) || []).length, 1, 'no duplica lo que ya está');

    // Cambios sin publicar
    const f = path.join(lab.dir, 'leadmagnets', 'guia-del-setter', 'index.html');
    const fut = new Date(Date.now() + 60_000);
    utimesSync(f, fut, fut);
    assert.equal(lm.lista().find((x) => x.slug === 'guia-del-setter').cambiado, true);
  });

  test('asignar a otra pieza, quitar de internet y borrar', async () => {
    const otra = jarvis.crearPieza({ titulo: 'Carrusel setter', formato: 'Carrusel' });
    lm.asignar('guia-del-setter-2', otra.id);
    const p = jarvis.listarPiezas().find((x) => x.id === otra.id);
    assert.equal(p.leadmagnet_url, 'https://mis-recursos.vercel.app/guia-del-setter-2');

    llamadas = [];
    await lm.despublicar('guia-del-setter');
    const files = JSON.parse(llamadas.find((l) => l.ruta === '/v13/deployments' && l.metodo === 'POST').cuerpo).files.map((f) => f.file);
    assert.ok(!files.includes('guia-del-setter/index.html'));
    assert.ok(files.includes('guia-del-setter-2/index.html'));
    assert.equal(lm.lista().find((x) => x.slug === 'guia-del-setter').url, null);

    await lm.borrar('guia-del-setter-2');
    assert.ok(!existsSync(path.join(lab.dir, 'leadmagnets', 'guia-del-setter-2')));
    assert.throws(() => lm.asignar('../x', 1), /no válido/);
  });

  test('dominio propio y vista previa aislada', async () => {
    env.VERCEL_DOMINIO = 'recursos.automatia.pro';
    llamadas = [];
    const r = await lm.publicar('guia-del-setter');
    assert.equal(r.url, 'https://recursos.automatia.pro/guia-del-setter');
    assert.ok(!llamadas.some((l) => l.ruta.endsWith('/domains')));
    delete env.VERCEL_DOMINIO;
    const a = lab.archivo('leadmagnets/guia-del-setter/index.html');
    assert.match(a.mime, /^text\/html/);
    assert.match(readFileSync(a.abs, 'utf8'), /<main>Hola/);
  });
});
