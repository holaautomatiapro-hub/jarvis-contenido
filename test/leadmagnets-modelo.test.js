import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createLeadMagnets } from '../server/leadmagnets.js';

const img = (n) => `data:image/webp;base64,${'A'.repeat(n)}`;
const MODELO = `<!doctype html><html lang="es"><head><title>Landing prellamada · Guía paso a paso · Marca</title><style>:root{--amber:#E39B12}</style></head><body>
<header class="hero band"><h1>Tu vídeo prellamada</h1><img src="${img(100)}" alt="logo"></header>
<section class="blk" id="pasos"><h2>Ocho pasos</h2></section>
<section class="join band" id="comunidad"><figure class="banner"><img src="${img(30000)}" alt="IA para Entrenadores"></figure>
<section class="wa"><h2>Comunidad de WhatsApp</h2><figure class="banner"><img src="${img(30000)}" alt="Comunidad de WhatsApp «Los 300»"></figure></section></section>
</body></html>`;

describe('lead magnet modelo', () => {
  test('se trae de su enlace, deja los banners como marcadores y JARVIS copia su diseño y su estructura', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-lmm-'));
    try {
      const pedidas = [];
      const lm = createLeadMagnets({ base: dir, fetchImpl: async (u) => { pedidas.push(String(u)); return new Response(MODELO, { status: 200 }); } });
      await assert.rejects(lm.importarPlantilla('http://x.com/'), /https/);
      const e = await lm.importarPlantilla('https://recursos.marca.es/landing-prellamada/');
      assert.equal(e.plantilla.url, 'https://recursos.marca.es/landing-prellamada/');
      const t = readFileSync(path.join(dir, 'leadmagnets', '_comun', 'plantilla.html'), 'utf8');
      assert.ok(t.indexOf('{{SKOOL}}') > 0 && t.indexOf('{{WA}}') > t.indexOf('{{SKOOL}}'), 'Skool primero y WhatsApp después');
      assert.ok(t.includes(img(100)), 'las imágenes pequeñas se quedan');
      assert.deepEqual(e.banners, { skool: 'leadmagnets/_comun/skool.webp', whatsapp: 'leadmagnets/_comun/whatsapp.webp' }, 'sin banners subidos, se cogen del modelo');
      const { prompt } = lm.nuevo({ titulo: 'Checklist de cierre', tipo: 'checklist' });
      assert.match(prompt, /MI LEAD MAGNET MODELO está en .*plantilla\.html/);
      assert.match(prompt, /SU MISMO DISEÑO Y SU MISMA ESTRUCTURA/);
      assert.match(prompt, /recursos\.marca\.es\/landing-prellamada/);
      lm.quitarPlantilla();
      assert.equal(lm.estado().plantilla, null);
      assert.doesNotMatch(lm.nuevo({ titulo: 'Otro' }).prompt, /MODELO/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test('los que ya tenías publicados se guardan con título y enlace, se editan y se borran sin tocar tu web', async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'jarvis-lmm-'));
    try {
      const metodos = [];
      const lm = createLeadMagnets({ base: dir, fetchImpl: async (u, o = {}) => { metodos.push(o.method || 'GET'); return new Response(MODELO, { status: 200 }); } });
      const r = await lm.anadirPorEnlace({ url: 'https://recursos.marca.es/landing-prellamada/' });
      assert.equal(r.slug, 'landing-prellamada');
      assert.equal(r.conPagina, true);
      const x = lm.lista().find((l) => l.slug === 'landing-prellamada');
      assert.equal(x.titulo, 'Landing prellamada');
      assert.equal(x.url, 'https://recursos.marca.es/landing-prellamada/');
      assert.equal(x.externo, true);
      assert.equal(x.listo, true, 'con su página, para cambiarla con JARVIS');
      await assert.rejects(lm.anadirPorEnlace({ url: 'https://recursos.marca.es/landing-prellamada/' }), /ya está guardado/);
      lm.editarDatos('landing-prellamada', { titulo: 'Landing prellamada (v2)', url: 'https://recursos.marca.es/prellamada/' });
      assert.equal(lm.lista()[0].titulo, 'Landing prellamada (v2)');
      assert.equal(lm.lista()[0].url, 'https://recursos.marca.es/prellamada/');
      assert.throws(() => lm.editarDatos('landing-prellamada', { url: 'ftp://x' }), /https/);
      await assert.rejects(lm.despublicar('landing-prellamada'), /fuera de JARVIS/);
      const antes = metodos.length;
      await lm.borrar('landing-prellamada');
      assert.equal(metodos.length, antes, 'no se llama a GitHub ni a Vercel');
      assert.equal(existsSync(path.join(dir, 'leadmagnets', 'landing-prellamada')), false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
