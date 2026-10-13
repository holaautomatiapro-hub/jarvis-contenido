import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../server/db.js';
import { createVault } from '../server/vault.js';
import { createJarvis } from '../server/jarvis.js';
import { createLeadMagnets } from '../server/leadmagnets.js';

// GitHub y la web de mentira: el repositorio es un mapa ruta → { contenido, sha }; la web responde 200 si está en el repo
function falsos() {
  const repo = new Map([['crea-leadmagnets/index.html', { contenido: '<html>de otro chat</html>', sha: 's0' }]]);
  const llamadas = [];
  let n = 0;
  const json = (d, status = 200) => ({ ok: status < 400, status, json: async () => d });
  const fetchImpl = async (url, o = {}) => {
    const u = new URL(url);
    if (u.hostname === 'recursos.ejemplo.com') return { ok: repo.has(`${u.pathname.replace(/^\/|\/$/g, '')}/index.html`), status: 200 };
    llamadas.push({ metodo: o.method || 'GET', ruta: decodeURIComponent(u.pathname), cuerpo: o.body ? JSON.parse(o.body) : null });
    if (o.headers.Authorization !== 'Bearer ghp_bueno') return json({ message: 'Bad credentials' }, 401);
    if (u.pathname === '/repos/tu-usuario/recursos') return json({ default_branch: 'main', permissions: { push: true } });
    const m = u.pathname.match(/^\/repos\/tu-usuario\/recursos\/contents\/(.+)$/);
    if (!m) return json({ message: 'Not Found' }, 404);
    const ruta = decodeURIComponent(m[1]);
    const b = o.body ? JSON.parse(o.body) : null;
    if (!o.method || o.method === 'GET') return repo.has(ruta) ? json({ sha: repo.get(ruta).sha }) : json({ message: 'Not Found' }, 404);
    if (o.method === 'PUT') {
      if (repo.has(ruta) && b.sha !== repo.get(ruta).sha) return json({ message: 'sha wrong' }, 409);
      repo.set(ruta, { contenido: Buffer.from(b.content, 'base64').toString('utf8'), sha: `s${++n}` });
      return json({ content: { sha: repo.get(ruta).sha } });
    }
    if (o.method === 'DELETE') { repo.delete(ruta); return json({}); }
    return json({}, 400);
  };
  return { repo, llamadas, fetchImpl };
}

test('lead magnets en tu dominio con tu repositorio de GitHub (como recursos.ejemplo.com)', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-lmgh-'));
  try {
    const jarvis = createJarvis({ db: openDb(':memory:'), vault: createVault(path.join(dir, 'V')) });
    const pieza = jarvis.crearPieza({ titulo: 'Reel del spy de anuncios', formato: 'Reel' });
    const f = falsos();
    const env = {};
    const guardadas = {};
    const lm = createLeadMagnets({ base: dir, jarvis, env, fetchImpl: f.fetchImpl, guardarClaves: (c) => Object.assign(guardadas, c), esperaMs: 1 });
    const crear = (slug, titulo) => {
      mkdirSync(path.join(dir, 'leadmagnets', slug), { recursive: true });
      writeFileSync(path.join(dir, 'leadmagnets', slug, 'index.html'), `<main>${titulo}</main>`);
      writeFileSync(path.join(dir, 'leadmagnets', slug, 'leadmagnet.json'), JSON.stringify({ titulo, pieza: pieza.id }));
    };
    crear('spy-ads', 'Spy de anuncios');
    crear('crea-leadmagnets', 'Otro con el mismo nombre');

    // Conectar: comprueba el token y que puede escribir
    await assert.rejects(lm.conectarGithub({ repo: 'tu-usuario/recursos', token: 'malo', dominio: 'recursos.ejemplo.com' }), /no acepta el token/);
    await assert.rejects(lm.conectarGithub({ repo: 'nada', token: 'ghp_bueno', dominio: 'recursos.ejemplo.com' }), /usuario\/nombre/);
    const e = await lm.conectarGithub({ repo: 'https://github.com/tu-usuario/recursos.git', token: 'ghp_bueno', dominio: 'https://recursos.ejemplo.com/' });
    assert.deepEqual(guardadas, { LM_GITHUB_REPO: 'tu-usuario/recursos', LM_GITHUB_TOKEN: 'ghp_bueno', LM_GITHUB_RAMA: 'main', LM_DOMINIO: 'recursos.ejemplo.com' });
    assert.equal(e.modo, 'github');
    assert.equal(e.github.final, '••••ueno');

    // Publicar: solo su carpeta, documento completo; el enlace con barra final y en la pieza
    const r = await lm.publicar('spy-ads');
    assert.equal(r.url, 'https://recursos.ejemplo.com/spy-ads/');
    assert.equal(r.aviso, undefined, 'la página ya responde');
    assert.match(f.repo.get('spy-ads/index.html').contenido, /^<!doctype html>[\s\S]*viewport[\s\S]*<main>Spy de anuncios<\/main>/);
    const put = f.llamadas.find((l) => l.metodo === 'PUT');
    assert.equal(put.cuerpo.branch, 'main');
    assert.match(put.cuerpo.message, /Añade el lead magnet «Spy de anuncios»/);
    assert.equal(jarvis.leerPieza(pieza.id).leadmagnet_url, 'https://recursos.ejemplo.com/spy-ads/');
    assert.equal(f.repo.get('crea-leadmagnets/index.html').contenido, '<html>de otro chat</html>', 'no toca las demás');

    // Volver a publicar: actualiza el mismo archivo (con su sha)
    writeFileSync(path.join(dir, 'leadmagnets', 'spy-ads', 'index.html'), '<main>Spy v2</main>');
    await lm.publicar('spy-ads');
    assert.match(f.repo.get('spy-ads/index.html').contenido, /Spy v2/);
    assert.match(f.llamadas.filter((l) => l.metodo === 'PUT').at(-1).cuerpo.message, /Actualiza/);

    // Una página que ya está en el repositorio y no es suya no se pisa
    await assert.rejects(lm.publicar('crea-leadmagnets'), /ya hay otra página/);

    // Quitar de internet: borra su carpeta del repositorio y el enlace de la pieza
    await lm.despublicar('spy-ads');
    assert.ok(!f.repo.has('spy-ads/index.html'));
    assert.equal(jarvis.leerPieza(pieza.id).leadmagnet_url, null);
    assert.ok(!f.llamadas.some((l) => l.ruta.startsWith('/v13/')), 'no usa Vercel directamente');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
